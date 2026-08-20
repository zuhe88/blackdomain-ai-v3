(function () {
  "use strict";

  if (window.__blackdomainAtgPacketWorkerInstalled) return;
  window.__blackdomainAtgPacketWorkerInstalled = true;

  const SOCKET_ORIGIN = "https://socket.godeebxp.com";
  const CLIENT_TYPE = "web";
  const CYCLE_PAUSE_MS = 10 * 1000;
  const FULL_SCAN_INTERVAL_MS = 15 * 60 * 1000;
  const GAME_SWITCH_GAP_MS = 800;
  const REQUEST_TIMEOUT_MS = 15000;
  const REQUEST_GAP_MS = 120;
  const MAX_SOURCE_PAGES = 20;
  const GAME_TARGETS = [
    { name: "戰神賽特1", checksum: "88d5a6c6b3ebe4c6410b52b1c1aba71f2fad6de0", code: "g1001" },
    { name: "戰神賽特2", checksum: "361d567d94ac569664c82068a30b762e8d8438b8", code: "g1005" },
    { name: "古神巴風特", checksum: "2b4c37c532b5e60f542a29c23e602748c06fd426", code: "g1007" },
    { name: "虎小妹", checksum: "9c0ec83253193a1c672c2906b83e88e29a61a826", code: "g1009" },
    { name: "赤三國", checksum: "e19fdb8f5121a0abeecca7638e92d010dbe496c1", code: "g1008" },
  ];

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const gameStates = new Map();
  const watchedRooms = new Map();
  const tableCatalogs = new Map();
  const lastFullScans = new Map();
  let lobbySocket = null;
  let activeLobbyToken = "";
  let lobbyGames = [];
  let bootstrapPromise = null;
  let stopping = false;
  const forcedFullScans = new Set();

  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function installExclusiveRelayHost() {
    setTimeout(() => {
      window.stop();
      const render = () => {
        if (!document.body) {
          setTimeout(render, 25);
          return;
        }
        document.title = "BLACKDOMAIN ATG 五款封包主機";
        document.body.innerHTML = `
          <main style="min-height:100vh;display:grid;place-items:center;background:#070b12;color:#e8f3ff;font-family:system-ui,sans-serif">
            <section style="max-width:620px;padding:40px;text-align:center;border:1px solid #1f4568;border-radius:18px;background:#0b1420;box-shadow:0 0 60px #0a78c522">
              <div style="font-size:13px;letter-spacing:.28em;color:#56b8ff">BLACKDOMAIN RELAY</div>
              <h1 style="margin:16px 0 8px;font-size:30px">ATG 五款封包主機運作中</h1>
              <p style="margin:0;color:#9cb4c9;line-height:1.8">戰神賽特1・戰神賽特2・古神巴風特・虎小妹・赤三國</p>
              <div id="blackdomain-packet-status" style="margin:24px auto 0;display:grid;gap:8px;text-align:left;max-width:420px">
                ${GAME_TARGETS.map((target) => `<div style="display:flex;justify-content:space-between;gap:20px;padding:9px 12px;border-radius:9px;background:#07101a"><b>${target.name}</b><span id="blackdomain-status-${target.code}" style="color:#9cb4c9">等待掃描</span></div>`).join("")}
              </div>
              <p style="margin:22px 0 0;color:#5fd59b">此分頁請保持開啟，不需要切換遊戲。</p>
            </section>
          </main>`;
      };
      render();
    }, 75);
  }

  function emit(body) {
    window.dispatchEvent(new CustomEvent("BLACKDOMAIN_ELECTRONIC_RELAY", {
      detail: { ...body, relayMode: "packet-worker" },
    }));
  }

  function setHostStatus(target, message, kind = "pending") {
    const node = document.getElementById(`blackdomain-status-${target.code}`);
    if (!node) return;
    const clean = String(message || "").replace(/[a-f\d]{24,}/gi, "…").slice(0, 72);
    node.textContent = clean;
    node.style.color = kind === "ok" ? "#5fd59b" : kind === "error" ? "#ff8b8b" : "#56b8ff";
  }

  function parsePageContext() {
    try {
      const current = new URL(window.location.href);
      const rawLobbyUrl = current.searchParams.get("goback_url");
      const lobby = rawLobbyUrl
        ? new URL(rawLobbyUrl)
        : current.pathname.includes("/egames/lobby/game/") ? current : null;
      if (!lobby) return null;
      const token = String(lobby.searchParams.get("t") || "").trim();
      if (!token || lobby.hostname !== current.hostname) return null;
      return {
        token: activeLobbyToken || token,
        locale: String(lobby.searchParams.get("locale") || current.searchParams.get("locale") || "zh-TW"),
      };
    } catch {
      return null;
    }
  }

  function manualGameCaptureRequested() {
    try {
      const current = new URL(window.location.href);
      if (current.searchParams.get("blackdomain_manual") === "1") return true;
      const rawLobbyUrl = current.searchParams.get("goback_url");
      return rawLobbyUrl
        ? new URL(rawLobbyUrl).searchParams.get("blackdomain_manual") === "1"
        : false;
    } catch {
      return false;
    }
  }

  function connectSocket() {
    return new Promise((resolve, reject) => {
      if (typeof window.io !== "function") {
        reject(new Error("socket.io client unavailable"));
        return;
      }
      window.__blackdomainAtgPacketSocketCreating = true;
      let socket;
      try {
        socket = window.io(SOCKET_ORIGIN, {
          transports: ["websocket", "polling"],
          upgrade: true,
          forceNew: true,
          reconnection: false,
          timeout: REQUEST_TIMEOUT_MS,
        });
      } finally {
        window.__blackdomainAtgPacketSocketCreating = false;
      }
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("socket connection timeout"));
      }, REQUEST_TIMEOUT_MS);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once("connect_error", (error) => {
        clearTimeout(timer);
        socket.close();
        reject(error instanceof Error ? error : new Error("socket connection failed"));
      });
    });
  }

  function emitAck(socket, eventName, payload) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${eventName} timeout`)), REQUEST_TIMEOUT_MS);
      socket.emit(eventName, payload, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
    });
  }

  function parsePlainResponse(value) {
    if (typeof value === "string") {
      try { return JSON.parse(value); } catch { return null; }
    }
    return value && typeof value === "object" ? value : null;
  }

  async function bytesFrom(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
    if (value?.type === "Buffer" && Array.isArray(value.data)) return new Uint8Array(value.data);
    throw new Error("unexpected encrypted response type");
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("deflate decompression unavailable");
    }
    const stream = new DecompressionStream("deflate");
    const writer = stream.writable.getWriter();
    const completed = new Response(stream.readable).arrayBuffer();
    await writer.write(bytes);
    await writer.close();
    return new Uint8Array(await completed);
  }

  async function decryptResponse(value, requestToken) {
    const encrypted = await bytesFrom(value);
    if (encrypted.length < 29) throw new Error("encrypted response is too short");
    const iv = encrypted.slice(0, 12);
    const tag = encrypted.slice(12, 28);
    const ciphertext = encrypted.slice(28);
    const ciphertextAndTag = new Uint8Array(ciphertext.length + tag.length);
    ciphertextAndTag.set(ciphertext);
    ciphertextAndTag.set(tag, ciphertext.length);
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(requestToken));
    const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      key,
      ciphertextAndTag,
    );
    const uncompressed = await inflate(new Uint8Array(plaintext));
    return JSON.parse(decoder.decode(uncompressed));
  }

  async function decodeGameResponse(value, requestToken) {
    const zippedPayload = value?.zip === 1 ? value.data : null;
    if (zippedPayload) {
      const uncompressed = await inflate(await bytesFrom(zippedPayload));
      return JSON.parse(decoder.decode(uncompressed));
    }
    const binary = value instanceof ArrayBuffer
      || ArrayBuffer.isView(value)
      || value instanceof Blob
      || (value?.type === "Buffer" && Array.isArray(value.data));
    if (binary) return decryptResponse(value, requestToken);
    const plain = parsePlainResponse(value);
    if (plain) return plain;
    throw new Error("unexpected game response type");
  }

  async function gameRequestNow(state, eventName, payload = {}) {
    if (!state.socket?.connected) throw new Error(`${state.target.name} socket unavailable`);
    const requestToken = state.token;
    const packet = await emitAck(state.socket, eventName, {
      ...payload,
      token: requestToken,
      // Match ATG's official sender byte-for-byte. Legacy games reject the
      // redundant `request` field and require the normalized locale casing.
      locale: String(state.locale || "zh-tw").toLowerCase(),
    });
    const response = await decodeGameResponse(packet, requestToken);
    if (response?.token) state.token = String(response.token);
    return response;
  }

  function enqueue(state, operation) {
    const result = state.queue.then(operation, operation);
    state.queue = result.catch(() => {});
    return result;
  }

  function objectCandidates(root, maximumDepth = 5) {
    const results = [];
    const visited = new Set();
    function visit(value, depth) {
      if (!value || typeof value !== "object" || visited.has(value) || depth > maximumDepth) return;
      visited.add(value);
      results.push(value);
      Object.values(value).forEach((child) => visit(child, depth + 1));
    }
    visit(root, 0);
    return results;
  }

  function tablePage(response) {
    for (const candidate of objectCandidates(response)) {
      if (!Array.isArray(candidate.tables)) continue;
      const tables = candidate.tables.map(normalizeTable).filter(Boolean);
      if (candidate.tables.length && !tables.length) continue;
      return {
        tables,
        page: Number(candidate.currentPage ?? candidate.page) || 1,
        totalPages: Math.min(
          MAX_SOURCE_PAGES,
          Math.max(1, Number(candidate.totalPages ?? response?.totalPages) || 1),
        ),
      };
    }
    return null;
  }

  function normalizeTable(table) {
    const number = Number(table?.number ?? table?.roomNumber ?? table?.tableNumber);
    const roomId = table?.roomId ?? table?.id;
    const status = String(table?.status || "");
    if (!Number.isInteger(number) || number <= 0 || roomId == null || !status) return null;
    return {
      roomId: String(roomId),
      number,
      status,
      occupied: status !== "Empty",
      dayWin: table.dayWin,
      dayBet: table.dayBet,
      hourWin: table.hourWin,
      hourBet: table.hourBet,
      todayWin: table.todayWin,
      todayBet: table.todayBet,
      todayRtp: table.todayRtp ?? table.todayRate ?? table.todayScoreRate ?? table.hourRtp ?? table.hourRate,
      dayRtp: table.dayRtp ?? table.dayRate ?? table.dayScoreRate ?? table.rtp ?? table.scoreRate,
      mgCounts: Array.isArray(table.mgCounts) ? table.mgCounts.slice(0, 3) : undefined,
    };
  }

  function normalizeDetail(response, table) {
    const detail = objectCandidates(response).find((candidate) => (
      candidate.dayBet != null
      || candidate.hourBet != null
      || candidate.todayBet != null
      || candidate.todayRtp != null
      || candidate.dayRtp != null
      || candidate.mgCounts != null
    ));
    if (!detail) return null;
    return {
      roomId: String(detail.roomId ?? table?.roomId ?? ""),
      number: Number(detail.number ?? detail.roomNumber ?? table?.number) || undefined,
      status: detail.status ?? table?.status,
      dayWin: detail.dayWin,
      dayBet: detail.dayBet,
      hourWin: detail.hourWin,
      hourBet: detail.hourBet,
      todayWin: detail.todayWin,
      todayBet: detail.todayBet,
      todayRtp: detail.todayRtp ?? detail.todayRate ?? detail.todayScoreRate ?? detail.hourRtp ?? detail.hourRate,
      dayRtp: detail.dayRtp ?? detail.dayRate ?? detail.dayScoreRate ?? detail.rtp ?? detail.scoreRate,
      mgCounts: Array.isArray(detail.mgCounts) ? detail.mgCounts.slice(0, 3) : undefined,
      capturedAt: Date.now(),
    };
  }

  async function connectGame(launch, context) {
    const state = {
      target: launch.target,
      token: launch.token,
      locale: context.locale,
      socket: null,
      queue: Promise.resolve(),
      tablesByNumber: new Map(tableCatalogs.get(launch.target.name) || []),
      scanInFlight: false,
      detailCursor: 0,
    };
    state.socket = await connectSocket();
    state.socket.on("disconnect", () => { state.socket = null; });
    state.initialResponse = await gameRequestNow(state, "initial", {
      clientType: CLIENT_TYPE,
      deviceInfo: {
        browser: { name: "Chrome", version: navigator.userAgent },
        os: { name: "Windows" },
        platform: { type: "DESKTOP_BROWSER" },
        engine: { name: "blackdomain-packet-worker" },
      },
    });
    gameStates.clear();
    gameStates.set(state.target.name, state);
    return state;
  }

  async function scanGame(state) {
    if (state.scanInFlight || !state.socket?.connected) return false;
    state.scanInFlight = true;
    try {
      await enqueue(state, async () => {
        const scanId = `packet-${Date.now()}-${state.target.code}`;
        const emptyTables = new Map();
        let totalPages = 1;
        for (let page = 1; page <= totalPages; page += 1) {
          const response = await gameRequestNow(state, "getSlotTables", { page });
          const data = tablePage(response) || (page === 1 ? tablePage(state.initialResponse) : null);
          if (!data) throw new Error(`${state.target.name} returned no table page`);
          totalPages = Math.max(totalPages, data.totalPages);
          data.tables.forEach((table) => {
            state.tablesByNumber.set(table.number, table);
            if (table.status === "Empty") emptyTables.set(table.roomId, table);
          });
          emit({
            type: "tables",
            gameName: state.target.name,
            scanId,
            page,
            totalPages,
            scanComplete: page >= totalPages,
            emptyOnly: true,
            sourcePagesCovered: page,
            sourcePageCount: totalPages,
            tables: page >= totalPages ? [...emptyTables.values()] : data.tables.filter((table) => table.status === "Empty"),
          });
          if (page < totalPages) await delay(REQUEST_GAP_MS);
        }
        tableCatalogs.set(state.target.name, new Map(state.tablesByNumber));
        lastFullScans.set(state.target.name, Date.now());
      });
      return true;
    } catch (error) {
      console.warn(`[BLACKDOMAIN Packet] ${state.target.name} scan failed`, error?.message || error);
      throw error;
    } finally {
      state.scanInFlight = false;
    }
  }

  async function pollDetail(state) {
    const roomNumbers = watchedRooms.get(state.target.name) || [];
    if (!roomNumbers.length || !state.socket?.connected) return;
    const roomNumber = roomNumbers[state.detailCursor % roomNumbers.length];
    state.detailCursor = (state.detailCursor + 1) % roomNumbers.length;
    const table = state.tablesByNumber.get(roomNumber);
    if (!table) return;
    try {
      await enqueue(state, async () => {
        const response = await gameRequestNow(state, "getSlotTableDetail", { roomId: table.roomId });
        const detail = normalizeDetail(response, table);
        if (detail) emit({ type: "detail", gameName: state.target.name, detail });
      });
    } catch (error) {
      console.warn(`[BLACKDOMAIN Packet] ${state.target.name} detail failed`, error?.message || error);
    }
  }

  function findLobbyGame(games, target) {
    return objectCandidates(games, 4).find((candidate) => (
      String(candidate.checksum || candidate.gameId || candidate.id || "") === target.checksum
      || String(candidate.code || candidate.gameCode || "").toLowerCase() === target.code
    ));
  }

  async function initializeLobby(context) {
    lobbySocket?.close();
    lobbySocket = await connectSocket();
    let lobbyToken = activeLobbyToken || context.token;
    const initial = parsePlainResponse(await emitAck(lobbySocket, "lobbyInitial", {
      token: lobbyToken,
      clientType: CLIENT_TYPE,
    }));
    if (!initial || Number(initial.status) !== 200) throw new Error("lobbyInitial rejected");
    if (initial.token) lobbyToken = String(initial.token);
    activeLobbyToken = lobbyToken;
    lobbyGames = initial.content?.games ?? initial.games ?? initial.content ?? [];
  }

  async function createLaunch(target, context) {
    if (!lobbySocket?.connected) await initializeLobby(context);
    const game = findLobbyGame(lobbyGames, target);
    const code = String(game?.code ?? game?.gameCode ?? target.code);
    const played = parsePlainResponse(await emitAck(lobbySocket, "lobbyPlay", {
      token: activeLobbyToken,
      clientType: CLIENT_TYPE,
      code,
    }));
    if (!played || Number(played.status) !== 200 || !played.redirectUrl) {
      throw new Error(`${target.name} launch rejected`);
    }
    if (played.token) activeLobbyToken = String(played.token);
    const redirect = new URL(played.redirectUrl, window.location.href);
    const token = String(redirect.searchParams.get("t") || "").trim();
    if (!token) throw new Error(`${target.name} launch token missing`);
    return { target, token };
  }

  async function scanTarget(target, context) {
    let state = null;
    try {
      setHostStatus(target, "正在連線…");
      const launch = await createLaunch(target, context);
      state = await connectGame(launch, context);
      const lastFullScanAt = Number(lastFullScans.get(target.name)) || 0;
      const fullScanDue = forcedFullScans.has(target.name)
        || !state.tablesByNumber.size
        || Date.now() - lastFullScanAt >= FULL_SCAN_INTERVAL_MS;
      if (fullScanDue) {
        setHostStatus(target, "正在讀取房間…");
        await scanGame(state);
        forcedFullScans.delete(target.name);
      } else if ((watchedRooms.get(target.name) || []).length) {
        setHostStatus(target, "正在更新推薦 RTP…");
      }
      const detailCount = Math.min(12, (watchedRooms.get(target.name) || []).length);
      for (let index = 0; index < detailCount; index += 1) {
        await pollDetail(state);
        if (index + 1 < detailCount) await delay(REQUEST_GAP_MS);
      }
      setHostStatus(target, `已同步 ${new Date().toLocaleTimeString("zh-TW", { hour12: false })}`, "ok");
      console.info(`[BLACKDOMAIN Packet] ${target.name} packet ${fullScanDue ? "full scan" : "RTP refresh"} complete`);
    } catch (error) {
      setHostStatus(target, `失敗：${error?.message || "未知錯誤"}`, "error");
      console.warn(`[BLACKDOMAIN Packet] ${target.name} packet scan failed`, error?.message || error);
      if (!state) {
        lobbySocket?.close();
        lobbySocket = null;
      }
    } finally {
      state?.socket?.close();
      gameStates.delete(target.name);
    }
  }

  async function bootstrap() {
    if (bootstrapPromise || stopping) return bootstrapPromise;
    bootstrapPromise = (async () => {
      const context = parsePageContext();
      if (!context) throw new Error("ATG lobby token unavailable");
      await initializeLobby(context);
      console.info("[BLACKDOMAIN Packet] sequential five-game packet scan active");
      while (!stopping) {
        for (const target of GAME_TARGETS) {
          if (stopping) break;
          await scanTarget(target, context);
          if (!stopping) await delay(GAME_SWITCH_GAP_MS);
        }
        if (stopping) break;
        if (forcedFullScans.size) continue;
        else await delay(CYCLE_PAUSE_MS);
        if (!lobbySocket?.connected) await initializeLobby(context);
      }
    })().catch((error) => {
      console.warn("[BLACKDOMAIN Packet] bootstrap failed", error?.message || error);
      gameStates.forEach((state) => state.socket?.close());
      gameStates.clear();
      lobbySocket?.close();
      lobbySocket = null;
      if (!stopping) setTimeout(bootstrap, 3000);
    }).finally(() => {
      bootstrapPromise = null;
    });
    return bootstrapPromise;
  }

  window.addEventListener("BLACKDOMAIN_ELECTRONIC_WATCH_ROOMS", (event) => {
    const grouped = new Map(GAME_TARGETS.map((target) => [target.name, []]));
    const rooms = Array.isArray(event.detail?.rooms) ? event.detail.rooms : [];
    rooms.forEach((room) => {
      const number = Number(room?.roomNumber);
      if (grouped.has(room?.gameName) && Number.isInteger(number)) grouped.get(room.gameName).push(number);
    });
    grouped.forEach((numbers, gameName) => watchedRooms.set(gameName, [...new Set(numbers)]));
  });

  window.addEventListener("BLACKDOMAIN_ELECTRONIC_FORCE_REFRESH", () => {
    GAME_TARGETS.forEach((target) => forcedFullScans.add(target.name));
  });

  window.addEventListener("beforeunload", () => {
    stopping = true;
    gameStates.forEach((state) => state.socket?.close());
    lobbySocket?.close();
  });

  if (parsePageContext() && !manualGameCaptureRequested()) {
    installExclusiveRelayHost();
    bootstrap();
  } else if (manualGameCaptureRequested()) {
    console.info("[BLACKDOMAIN Packet] manual game capture mode active");
  } else {
    console.warn("[BLACKDOMAIN Packet] no ATG launch context; packet host not started");
  }

  console.info("[BLACKDOMAIN Packet] sequential five-game packet worker installed");
}());
