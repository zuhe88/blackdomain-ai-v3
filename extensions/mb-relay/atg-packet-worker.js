(function () {
  "use strict";

  if (window.__blackdomainAtgPacketWorkerInstalled) return;
  window.__blackdomainAtgPacketWorkerInstalled = true;

  const SOCKET_ORIGIN = "https://socket.godeebxp.com";
  const HORSE_SOCKET_ORIGIN = "https://socket-lottery.godeebxp.com";
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
  const HORSE_TARGET = { name: "ATG 賽馬", code: "horse" };
  const ALL_TARGETS = [...GAME_TARGETS, HORSE_TARGET];

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
  let horseSocket = null;
  let horsePendingDraw = null;
  let horseLastPacketAt = 0;
  let hostStartedAt = Date.now();
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
        document.title = "BLACKDOMAIN ATG 即時數據作戰中心";
        document.body.innerHTML = `
          <style>
            :root{color-scheme:only dark;--bg:#02050b;--panel:#071526;--line:rgba(63,214,255,.32);--cyan:#39d8ff;--green:#37f3a3;--red:#ff5570;--amber:#ffc64b;--muted:#8ca6bd}
            *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#02050b!important;color:#fff!important;font-family:Inter,"Segoe UI","Noto Sans TC",system-ui,sans-serif}body{overflow-x:hidden}
            body:before{content:"";position:fixed;inset:0;pointer-events:none;background-image:radial-gradient(circle at 12% 0,rgba(0,144,255,.32),transparent 34%),radial-gradient(circle at 92% 100%,rgba(28,240,166,.17),transparent 34%),linear-gradient(rgba(48,170,229,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(48,170,229,.07) 1px,transparent 1px),linear-gradient(145deg,#02050b,#06101e 58%,#02070d);background-size:auto,auto,38px 38px,38px 38px,auto}
            .ops{position:relative;isolation:isolate;min-height:100vh;padding:25px clamp(24px,5vw,72px) 23px;background-image:linear-gradient(135deg,rgba(2,8,16,.93),rgba(3,13,25,.86));color:#fff!important}.ops:after{content:"";position:fixed;z-index:-1;width:min(59vw,690px);aspect-ratio:1;right:-4vw;bottom:-19vw;background:url("https://blackdomain-ai-v3-production.up.railway.app/brand/blackdomain-ai-logo.png") center/contain no-repeat;opacity:.13;filter:saturate(1.2) drop-shadow(0 0 45px rgba(255,190,61,.16));pointer-events:none}.topbar{display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:18px;border-bottom:2px solid rgba(57,216,255,.25)}
            .brand{display:flex;align-items:center;gap:17px}.brand-mark{width:61px;height:61px;display:grid;place-items:center;border:2px solid #e5b54a;border-radius:50%;background:#02050b url("https://blackdomain-ai-v3-production.up.railway.app/brand/blackdomain-ai-logo.png") center/cover no-repeat;box-shadow:0 0 30px rgba(229,181,74,.32),inset 0 0 22px rgba(57,216,255,.12);font-size:0}.eyebrow{margin:0 0 4px;color:var(--cyan)!important;-webkit-text-fill-color:var(--cyan)!important;font-size:11px;font-weight:900;letter-spacing:.3em}.brand h1{margin:0;color:#fff!important;-webkit-text-fill-color:#fff!important;font-size:clamp(27px,3vw,42px);font-weight:900;letter-spacing:.035em;text-shadow:0 0 25px rgba(57,216,255,.22)}.secure{display:flex;align-items:center;gap:10px;padding:12px 17px;border:2px solid rgba(55,243,163,.55);border-radius:10px;background-image:linear-gradient(145deg,rgba(14,84,63,.72),rgba(5,31,28,.88));box-shadow:0 0 24px rgba(55,243,163,.14);color:#7dffc7!important;-webkit-text-fill-color:#7dffc7!important;font-size:12px;font-weight:950;letter-spacing:.1em}.secure i,.dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 13px var(--green);animation:pulse 1.8s ease-in-out infinite}
            .summary{display:grid;grid-template-columns:1.45fr repeat(3,minmax(125px,.55fr));gap:13px;margin:18px 0}.metric{min-height:94px;padding:15px 18px;border:1px solid rgba(57,216,255,.28);border-radius:13px;background-image:linear-gradient(145deg,#0b2137,#061321);box-shadow:inset 0 1px rgba(255,255,255,.06),0 8px 24px rgba(0,0,0,.2)}.metric span{display:block;color:#80a7c1!important;-webkit-text-fill-color:#80a7c1!important;font-size:10px;font-weight:850;letter-spacing:.15em}.metric strong{display:block;margin-top:7px;color:#fff!important;-webkit-text-fill-color:#fff!important;font-size:25px;font-weight:950;font-variant-numeric:tabular-nums}.metric.primary{border-color:rgba(57,216,255,.65);background-image:linear-gradient(135deg,#103d5d,#071a2e);box-shadow:0 0 28px rgba(57,216,255,.12),inset 4px 0 var(--cyan)}.metric.primary strong{color:#76e8ff!important;-webkit-text-fill-color:#76e8ff!important;font-size:29px}.metric small{display:block;margin-top:5px;color:#7d99b1!important;-webkit-text-fill-color:#7d99b1!important;font-size:10px}
            .section-head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin:2px 0 10px}.section-head h2{margin:0;color:#fff!important;-webkit-text-fill-color:#fff!important;font-size:15px;font-weight:900;letter-spacing:.16em}.section-head p{margin:0;color:#7f9bb2!important;-webkit-text-fill-color:#7f9bb2!important;font-size:10px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.game{position:relative;min-height:139px;padding:16px 18px;border:2px solid rgba(57,216,255,.22);border-radius:14px;background-image:linear-gradient(145deg,#0b1d31,#06111e);box-shadow:0 10px 26px rgba(0,0,0,.24),inset 0 1px rgba(255,255,255,.045);overflow:hidden;transition:border-color .25s,box-shadow .25s,transform .25s}.game:before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--cyan);box-shadow:0 0 14px var(--cyan)}.game:after{content:"";position:absolute;right:-35px;bottom:-48px;width:120px;height:120px;border:1px solid rgba(57,216,255,.12);border-radius:50%}.game[data-state="ok"]{border-color:rgba(55,243,163,.62);background-image:linear-gradient(145deg,#0b2c2a,#06191c);box-shadow:0 0 25px rgba(55,243,163,.1),0 10px 25px rgba(0,0,0,.28)}.game[data-state="ok"]:before{background:var(--green);box-shadow:0 0 16px var(--green)}.game[data-state="error"]{border-color:rgba(255,85,112,.65);background-image:linear-gradient(145deg,#35131d,#160b12)}.game[data-state="error"]:before{background:var(--red);box-shadow:0 0 15px var(--red)}.game-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.game-index{color:#6ca7c8!important;-webkit-text-fill-color:#6ca7c8!important;font-size:10px;font-weight:900;letter-spacing:.18em}.game-state{display:flex;align-items:center;gap:7px;color:#a4b7c8!important;-webkit-text-fill-color:#a4b7c8!important;font-size:10px;font-weight:950;letter-spacing:.13em}.game-state .dot{background:#607b92;box-shadow:none;animation:none}.game[data-state="ok"] .game-state{color:#73ffc1!important;-webkit-text-fill-color:#73ffc1!important}.game[data-state="ok"] .dot{background:var(--green);box-shadow:0 0 11px var(--green);animation:pulse 1.8s ease-in-out infinite}.game[data-state="error"] .game-state{color:#ff7e92!important;-webkit-text-fill-color:#ff7e92!important}.game[data-state="error"] .dot{background:var(--red)}.game h3{position:relative;margin:11px 0 2px;color:#fff!important;-webkit-text-fill-color:#fff!important;font-size:27px;font-weight:950;letter-spacing:.035em;text-shadow:0 0 18px rgba(255,255,255,.18)}.game-type{position:relative;display:block;margin-bottom:9px;color:#9fc4dd!important;-webkit-text-fill-color:#9fc4dd!important;font-size:10px;font-weight:800;letter-spacing:.08em}.status{position:relative;color:#58ddff!important;-webkit-text-fill-color:#58ddff!important;font-size:12px;font-weight:800;font-variant-numeric:tabular-nums}.game[data-state="ok"] .status{color:#6dffbd!important;-webkit-text-fill-color:#6dffbd!important}.game[data-state="error"] .status{color:#ff7e92!important;-webkit-text-fill-color:#ff7e92!important}.footer{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:15px;padding-top:14px;border-top:1px solid rgba(57,216,255,.25);color:#8ca6bd!important;-webkit-text-fill-color:#8ca6bd!important;font-size:10px;font-weight:700;letter-spacing:.08em}.footer b{color:#6dffbd!important;-webkit-text-fill-color:#6dffbd!important;font-weight:900}.scanline{position:fixed;left:0;right:0;top:-2px;height:2px;background-image:linear-gradient(90deg,transparent,rgba(57,216,255,.8),transparent);box-shadow:0 0 18px rgba(57,216,255,.55);animation:scan 8s linear infinite;pointer-events:none}@keyframes pulse{50%{opacity:.4;transform:scale(.82)}}@keyframes scan{to{transform:translateY(100vh)}}
            @media(max-width:900px){.summary{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:560px){.ops{padding:22px 14px}.topbar,.footer{align-items:flex-start;flex-direction:column}.summary,.grid{grid-template-columns:1fr}.secure{display:none}}
          </style>
          <main class="ops">
            <div class="scanline"></div>
            <header class="topbar"><div class="brand"><div class="brand-mark">BLACKDOMAIN AI</div><div><p class="eyebrow">ATG 6-GAME LIVE COMMAND</p><h1>ATG 即時封包指揮中心</h1></div></div><div class="secure"><i></i> 全域數據鏈路運作中</div></header>
            <section class="summary">
              <article class="metric primary"><span>核心任務</span><strong>即時封包監控</strong><small>ATG 電子 × 賽馬資料鏈路</small></article>
              <article class="metric"><span>監控節點</span><strong>6 / 6</strong><small>全部節點已掛載</small></article>
              <article class="metric"><span>系統運行</span><strong id="blackdomain-uptime">00:00:00</strong><small>不中斷背景同步</small></article>
              <article class="metric"><span>最近封包</span><strong id="blackdomain-last-packet">等待中</strong><small id="blackdomain-packet-health">建立安全鏈路</small></article>
            </section>
            <div class="section-head"><h2>LIVE DATA NODES</h2><p>封包接收・解析・安全轉送</p></div>
            <section id="blackdomain-packet-status" class="grid">
              ${ALL_TARGETS.map((target, index) => `<article class="game" id="blackdomain-card-${target.code}" data-state="pending"><div class="game-head"><span class="game-index">NODE ${String(index + 1).padStart(2, "0")}</span><span class="game-state"><i class="dot"></i><b id="blackdomain-state-${target.code}">等待連線</b></span></div><h3>${target.name}</h3><span class="game-type">${target.code === "horse" ? "ATG 彩票遊戲・即時開獎資料" : "ATG 電子遊戲・即時 RTP 數據"}</span><div class="status" id="blackdomain-status-${target.code}">等待封包鏈路</div></article>`).join("")}
            </section>
            <footer class="footer"><span><b>● 主機運作中</b>　請保持此分頁開啟，不需要切換遊戲</span><span id="blackdomain-clock">TAIPEI --:--:--</span></footer>
          </main>`;
        hostStartedAt = Date.now();
        const updateClock = () => {
          const elapsed = Math.max(0, Date.now() - hostStartedAt);
          const hours = String(Math.floor(elapsed / 3600000)).padStart(2, "0");
          const minutes = String(Math.floor(elapsed / 60000) % 60).padStart(2, "0");
          const seconds = String(Math.floor(elapsed / 1000) % 60).padStart(2, "0");
          const uptime = document.getElementById("blackdomain-uptime");
          const clock = document.getElementById("blackdomain-clock");
          if (uptime) uptime.textContent = `${hours}:${minutes}:${seconds}`;
          if (clock) clock.textContent = `TAIPEI ${new Date().toLocaleTimeString("zh-TW", { hour12: false })}`;
        };
        updateClock();
        setInterval(updateClock, 1000);
      };
      render();
    }, 75);
  }

  function emit(body) {
    window.dispatchEvent(new CustomEvent("BLACKDOMAIN_ELECTRONIC_RELAY", {
      detail: { ...body, relayMode: "packet-worker" },
    }));
  }

  function emitHorse(body) {
    window.dispatchEvent(new CustomEvent("BLACKDOMAIN_ATG_HORSE_RELAY", {
      detail: { ...body, relayMode: "packet-worker" },
    }));
  }

  function setHostStatus(target, message, kind = "pending") {
    const node = document.getElementById(`blackdomain-status-${target.code}`);
    if (!node) return;
    const clean = String(message || "").replace(/[a-f\d]{24,}/gi, "…").slice(0, 72);
    node.textContent = clean;
    const card = document.getElementById(`blackdomain-card-${target.code}`);
    const state = document.getElementById(`blackdomain-state-${target.code}`);
    if (card) card.dataset.state = kind;
    if (state) state.textContent = kind === "ok" ? "即時同步" : kind === "error" ? "連線異常" : "資料更新中";
    if (kind === "ok") {
      const now = new Date();
      const lastPacket = document.getElementById("blackdomain-last-packet");
      const health = document.getElementById("blackdomain-packet-health");
      if (lastPacket) lastPacket.textContent = now.toLocaleTimeString("zh-TW", { hour12: false });
      if (health) health.textContent = `${target.name} 已安全轉送`;
    }
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
      const metadata = [
        candidate.tableMeta,
        candidate.meta,
        candidate.pagination,
        ...objectCandidates(response).filter((value) => (
          value !== candidate
          && value
          && (value.totalPages != null || value.totalTableCount != null)
        )),
      ].find((value) => value && (
        value.totalPages != null || value.totalTableCount != null
      )) || {};
      const derivedTotalPages = Math.ceil(
        Number(metadata.totalTableCount ?? candidate.totalTableCount) /
        Math.max(1, Number(
          metadata.tablePerPage
          ?? candidate.tablePerPage
          ?? candidate.tables.length,
        )),
      );
      return {
        tables,
        page: Number(
          candidate.currentPage
          ?? candidate.page
          ?? candidate.tableMeta?.currentPage
          ?? metadata.currentPage,
        ) || 1,
        totalPages: Math.min(
          MAX_SOURCE_PAGES,
          Math.max(1, Number(
            candidate.totalPages
            ?? candidate.tableMeta?.totalPages
            ?? metadata.totalPages
            ?? (derivedTotalPages > 0 ? derivedTotalPages : null)
            ?? response?.totalPages,
          ) || 1),
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

  function normalizeHorseResults(results) {
    return (Array.isArray(results) ? results : []).map((item) => ({
      periodId: String(item?.periodId || ""),
      time: Number(item?.time) || null,
      result: Array.isArray(item?.result) ? item.result.map(Number) : [],
    })).filter((item) => item.periodId && item.result.length === 10);
  }

  function markHorsePacket(label) {
    horseLastPacketAt = Date.now();
    setHostStatus(HORSE_TARGET, `${label} ${new Date().toLocaleTimeString("zh-TW", { hour12: false })}`, "ok");
  }

  function startHorseRelay(context) {
    if (horseSocket || stopping) return;
    if (typeof window.io !== "function") {
      setHostStatus(HORSE_TARGET, "Socket.IO 元件未載入", "error");
      return;
    }
    setHostStatus(HORSE_TARGET, "正在連接賽馬資料鏈路…");
    horseSocket = window.io(HORSE_SOCKET_ORIGIN, {
      path: "/socket.io",
      transports: ["websocket"],
      upgrade: false,
      forceNew: true,
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
      timeout: REQUEST_TIMEOUT_MS,
      auth: { token: activeLobbyToken || context.token },
    });
    horseSocket.on("connect", () => {
      setHostStatus(HORSE_TARGET, "已連線，等待即時封包…");
    });
    horseSocket.on("initial", (payload = {}) => {
      const results = normalizeHorseResults(payload.engine?.results);
      if (!results.length) return;
      emitHorse({
        type: "snapshot",
        targetPeriodId: String(payload.engine?.periodId || ""),
        results,
      });
      markHorsePacket(`歷史 ${results.length} 期`);
    });
    horseSocket.on("drawNotify", (payload = {}) => {
      const data = payload.data || {};
      horsePendingDraw = {
        periodId: String(data.periodId || ""),
        nextPeriodId: String(data.nextPeriodId || ""),
        time: Number(data.serverCurrentTime) || Date.now(),
      };
      if (data.nextPeriodId) {
        emitHorse({
          type: "state",
          targetPeriodId: String(data.nextPeriodId),
          currentPeriodId: String(data.periodId || ""),
          time: horsePendingDraw.time,
        });
      }
      markHorsePacket(`期號 ${horsePendingDraw.periodId || "更新"}`);
    });
    horseSocket.on("horseAnime", (payload = {}) => {
      const result = Array.isArray(payload.data?.result) ? payload.data.result.map(Number) : [];
      if (!horsePendingDraw?.periodId || result.length !== 10) return;
      emitHorse({ type: "result", ...horsePendingDraw, result });
      markHorsePacket(`開獎 ${horsePendingDraw.periodId}`);
      horsePendingDraw = null;
    });
    horseSocket.on("connect_error", (error) => {
      setHostStatus(HORSE_TARGET, `重連中：${error?.message || "連線失敗"}`, "error");
    });
    horseSocket.on("disconnect", () => {
      if (!stopping) setHostStatus(HORSE_TARGET, "鏈路中斷，正在自動重連…", "error");
    });
    setInterval(() => {
      if (stopping || !horseSocket) return;
      if (horseLastPacketAt && Date.now() - horseLastPacketAt > 150000) {
        setHostStatus(HORSE_TARGET, "超過兩期未收到封包，重新連線…", "error");
        horseSocket.disconnect();
        horseSocket.connect();
      }
    }, 30000);
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
      startHorseRelay(context);
      console.info("[BLACKDOMAIN Packet] six-game ATG packet relay active");
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
      const message = error?.message || "封包主機啟動失敗";
      GAME_TARGETS.forEach((target) => setHostStatus(target, `啟動失敗：${message}`, "error"));
      window.dispatchEvent(new CustomEvent("BLACKDOMAIN_ELECTRONIC_SESSION_STALE", {
        detail: { reason: "packet-bootstrap-failed" },
      }));
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
    horseSocket?.close();
  });

  if (parsePageContext() && !manualGameCaptureRequested()) {
    installExclusiveRelayHost();
    bootstrap();
  } else if (manualGameCaptureRequested()) {
    console.info("[BLACKDOMAIN Packet] manual game capture mode active");
  } else {
    console.warn("[BLACKDOMAIN Packet] no ATG launch context; packet host not started");
  }

  console.info("[BLACKDOMAIN Packet] six-game packet worker installed");
}());
