(function () {
  "use strict";

  const STORAGE_KEY = "blackdomainElectronicRelayKey";
  let relayKey = "";

  async function getRelayKey() {
    if (relayKey) return relayKey;
    const saved = await chrome.storage.local.get(STORAGE_KEY);
    relayKey = String(saved[STORAGE_KEY] || "").trim();
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
    if (!body || !["tables", "detail", "spin"].includes(body.type)) return;
    send(body);
  });

  console.info("[BLACKDOMAIN Electronic] ATG relay active");
}());
