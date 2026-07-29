(function () {
  "use strict";

  const STORAGE_KEY = "blackdomainElectronicRelayKey";
  let relayKey = "";
  let lastRefreshId = "";
  let watchSyncInFlight = false;

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
      if (response?.ok) return;
      if (response?.status === 401) {
        console.warn("[BLACKDOMAIN Electronic] relay key rejected");
        return;
      }
    } catch {
      // Retry transient extension/background failures below.
    }
    if (attempt < 5) {
      setTimeout(() => send(body, attempt + 1), Math.min(30000, 1000 * (2 ** attempt)));
    }
  }

  window.addEventListener("BLACKDOMAIN_ELECTRONIC_RELAY", (event) => {
    const body = event.detail;
    if (!body || !["tables", "updates", "detail", "spin"].includes(body.type)) return;
    send(body);
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
  setInterval(syncWatchRooms, 1000);

  chrome.storage.local.set({ blackdomainElectronicContentLoadedAt: Date.now() });

  console.info("[BLACKDOMAIN Electronic] ATG relay active");
}());
