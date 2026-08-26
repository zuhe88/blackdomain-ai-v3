(function () {
  "use strict";

  const STORAGE_KEY = "blackdomainElectronicRelayKey";
  let relayKey = "";
  let lastRefreshId = "";
  let watchSyncInFlight = false;
  let lastGameDataAt = 0;
  let autoEnterTimer = null;
  const AUTO_REOPEN_PARAM = "blackdomain_reopen";

  function stopAutoEnter() {
    if (autoEnterTimer) window.clearInterval(autoEnterTimer);
    autoEnterTimer = null;
  }

  function isRecoveredSethLaunch() {
    try {
      const current = new URL(window.location.href);
      if (current.searchParams.get(AUTO_REOPEN_PARAM)) return true;
      const rawLobbyUrl = current.searchParams.get("goback_url");
      if (!rawLobbyUrl) return false;
      const lobby = new URL(rawLobbyUrl);
      return Boolean(lobby.searchParams.get(AUTO_REOPEN_PARAM));
    } catch {
      return false;
    }
  }

  function autoEnterAtgGame() {
    if (!window.location.pathname.includes("/game/") || !isRecoveredSethLaunch()) return;
    const startedAt = Date.now();
    let clickInFlight = false;
    let lastClickAt = 0;
    autoEnterTimer = window.setInterval(async () => {
      const now = Date.now();
      const elapsed = now - startedAt;
      if (elapsed > 120000) {
        stopAutoEnter();
        return;
      }
      if (elapsed < 5000 || clickInFlight || now - lastClickAt < 8000) return;
      const canvas = [...document.querySelectorAll("canvas")]
        .filter((item) => {
          const rect = item.getBoundingClientRect();
          return rect.width > 200 && rect.height > 150;
        })
        .sort((left, right) => (
          right.getBoundingClientRect().width * right.getBoundingClientRect().height
          - left.getBoundingClientRect().width * left.getBoundingClientRect().height
        ))[0];
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height * 0.92;
      clickInFlight = true;
      try {
        const response = await chrome.runtime.sendMessage({
          type: "BLACKDOMAIN_ATG_ENTRY_CLICK",
          x: clientX,
          y: clientY,
        }).catch(() => null);
        if (response?.ok) lastClickAt = Date.now();
      } finally {
        clickInFlight = false;
      }
    }, 2500);
  }

  async function autoReopenSeth2() {
    const params = new URLSearchParams(window.location.search);
    let gameId = String(params.get(AUTO_REOPEN_PARAM) || "").trim();
    if (!gameId) {
      const saved = await chrome.storage.local.get("blackdomainAtgNextGameId");
      gameId = String(saved.blackdomainAtgNextGameId || "").trim();
      if (gameId) await chrome.storage.local.remove("blackdomainAtgNextGameId");
    }
    if (!gameId) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const image = document.querySelector(
        `img[src*="/egames/${CSS.escape(gameId)}/"], img[alt*="戰神賽特2"], img[alt*="賽特2"], img[src*="golden-seth"]`,
      );
      const container = image?.closest('.card, [class*="card"], li, article, [role="button"]');
      const button = container?.querySelector('button, a, [role="button"]')
        || image?.closest('button, a, [role="button"]')
        || image;
      if (!button && attempts < 60) return;
      window.clearInterval(timer);
      if (!button) return;
      button.click();
    }, 500);
  }

  function rememberRecoveryLobby() {
    try {
      const current = new URL(window.location.href);
      const rawLobbyUrl = current.searchParams.get("goback_url");
      if (!rawLobbyUrl) return;
      const lobby = new URL(rawLobbyUrl);
      if (lobby.hostname !== current.hostname || !lobby.pathname.includes("/egames/lobby/game/")) return;
      chrome.storage.local.set({ blackdomainAtgRecoveryLobbyUrl: lobby.href });
    } catch {
      // The watchdog can still recover from the current URL when available.
    }
  }

  function sendHeartbeat() {
    chrome.runtime.sendMessage({
      type: "BLACKDOMAIN_RELAY_HEARTBEAT",
      kind: "electronic",
      dataAt: lastGameDataAt,
    }).catch(() => {});
  }

  async function getRelayKey() {
    if (relayKey) return relayKey;
    const saved = await chrome.storage.local.get([STORAGE_KEY, "blackdomainMbRelayKey"]);
    relayKey = String(saved[STORAGE_KEY] || saved.blackdomainMbRelayKey || "").trim();
    if (relayKey && !saved[STORAGE_KEY]) await chrome.storage.local.set({ [STORAGE_KEY]: relayKey });
    if (!relayKey) {
      relayKey = String(window.prompt("請貼上 BLACKDOMAIN ATG 連線密鑰") || "").trim();
      if (relayKey) await chrome.storage.local.set({ [STORAGE_KEY]: relayKey });
    }
    return relayKey;
  }

  async function send(body, attempt = 0) {
    const key = await getRelayKey();
    if (!key) {
      console.warn("[BLACKDOMAIN Electronic] missing relay key");
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: "BLACKDOMAIN_ELECTRONIC_FORWARD",
        key,
        body,
      });
      if (response?.ok) return true;
      if (response?.status === 401) {
        console.warn("[BLACKDOMAIN Electronic] relay key rejected");
        return false;
      }
    } catch {
      // Retry transient extension/background failures below.
    }
    if (attempt < 5) {
      await new Promise((resolve) => {
        setTimeout(resolve, Math.min(30000, 1000 * (2 ** attempt)));
      });
      return send(body, attempt + 1);
    }
    return false;
  }

  window.addEventListener("BLACKDOMAIN_ELECTRONIC_RELAY", async (event) => {
    const body = event.detail;
    if (!body || !["tables", "updates", "detail", "spin"].includes(body.type)) return;
    body.relayVersion = chrome.runtime.getManifest().version;
    lastGameDataAt = Date.now();
    await send(body);
  });

  window.addEventListener("BLACKDOMAIN_ELECTRONIC_SESSION_STALE", (event) => {
    chrome.runtime.sendMessage({
      type: "BLACKDOMAIN_ATG_SESSION_STALE",
      reason: event.detail?.reason || "unknown",
      recoveryLobbyUrl: event.detail?.recoveryLobbyUrl || "",
    }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "BLACKDOMAIN_RELAY_PING" || message.kind !== "electronic") return false;
    syncWatchRooms();
    sendHeartbeat();
    sendResponse({ ok: true, dataAt: lastGameDataAt });
    return false;
  });

  async function syncWatchRooms() {
    if (watchSyncInFlight) return;
    watchSyncInFlight = true;
    try {
      const key = await getRelayKey();
      if (!key) return;
      const response = await chrome.runtime.sendMessage({
        type: "BLACKDOMAIN_ELECTRONIC_WATCHES",
        key,
      });
      if (response?.ok && Array.isArray(response.data?.rooms)) {
        window.dispatchEvent(new CustomEvent("BLACKDOMAIN_ELECTRONIC_WATCH_ROOMS", {
          detail: { rooms: response.data.rooms },
        }));
        const refresh = response.data?.refresh;
        if (refresh?.id && !refresh.completedAt && refresh.id !== lastRefreshId) {
          lastRefreshId = refresh.id;
          window.dispatchEvent(new CustomEvent("BLACKDOMAIN_ELECTRONIC_FORCE_REFRESH", {
            detail: refresh,
          }));
        }
      }
    } catch {
      // The next interval retries transient extension/background failures.
    } finally {
      watchSyncInFlight = false;
    }
  }

  syncWatchRooms();
  rememberRecoveryLobby();
  autoReopenSeth2();
  autoEnterAtgGame();
  setInterval(syncWatchRooms, 2000);
  sendHeartbeat();
  setInterval(sendHeartbeat, 30000);

  chrome.storage.local.set({ blackdomainElectronicContentLoadedAt: Date.now() });

  console.info("[BLACKDOMAIN Electronic] ATG relay active");
}());
