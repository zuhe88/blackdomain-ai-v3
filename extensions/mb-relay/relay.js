(function () {
  "use strict";

  const STORAGE_KEY = "blackdomainMbRelayKey";
  let relayKey = "";
  let keyPromise;
  let lastGameDataAt = 0;

  function sendHeartbeat() {
    chrome.runtime.sendMessage({
      type: "BLACKDOMAIN_RELAY_HEARTBEAT",
      kind: "mb",
      dataAt: lastGameDataAt,
    }).catch(() => {});
  }

  async function ensureRelayKey() {
    if (relayKey) return relayKey;
    if (keyPromise) return keyPromise;
    keyPromise = (async () => {
      const saved = await chrome.storage.local.get(STORAGE_KEY);
      const existing = String(saved[STORAGE_KEY] || "").trim();
      if (existing) {
        relayKey = existing;
        return relayKey;
      }
      const value = window.prompt("請貼上 BLACKDOMAIN MB 連線密鑰");
      relayKey = String(value || "").trim();
      if (relayKey) await chrome.storage.local.set({ [STORAGE_KEY]: relayKey });
      return relayKey;
    })().finally(() => {
      keyPromise = null;
    });
    return keyPromise;
  }

  async function send(body, attempt = 0) {
    const key = await ensureRelayKey();
    if (!key) return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "BLACKDOMAIN_MB_FORWARD",
        key,
        body,
      });
      if (response?.ok) {
        console.info("[BLACKDOMAIN MB] forwarded", body.type, body.event || "");
        return;
      }
      if (response?.status === 401) {
        relayKey = "";
        await chrome.storage.local.remove(STORAGE_KEY);
        console.warn("[BLACKDOMAIN MB] relay key rejected");
        return;
      }
    } catch {
      // Retry transient connection failures below.
    }
    if (attempt < 5) {
      setTimeout(() => send(body, attempt + 1), Math.min(30000, 1000 * (2 ** attempt)));
    }
  }

  window.addEventListener("BLACKDOMAIN_MB_RELAY", (event) => {
    const body = event.detail;
    if (!body || !["roadmap", "socket"].includes(body.type)) return;
    if (body.type === "socket") lastGameDataAt = Date.now();
    send(body);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "BLACKDOMAIN_RELAY_PING" || message.kind !== "mb") return false;
    window.dispatchEvent(new CustomEvent("BLACKDOMAIN_MB_RELAY_READY"));
    sendHeartbeat();
    sendResponse({ ok: true, dataAt: lastGameDataAt });
    return false;
  });

  setTimeout(async () => {
    await ensureRelayKey();
    window.dispatchEvent(new CustomEvent("BLACKDOMAIN_MB_RELAY_READY"));
  }, 1000);

  sendHeartbeat();
  setInterval(sendHeartbeat, 30000);

  console.info("[BLACKDOMAIN MB] 3A relay extension active");
}());
