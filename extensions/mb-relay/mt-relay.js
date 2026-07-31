(function () {
  "use strict";

  const STORAGE_KEYS = ["blackdomainElectronicRelayKey", "blackdomainMbRelayKey"];
  let relayKey = "";

  async function getRelayKey() {
    if (relayKey) return relayKey;
    const saved = await chrome.storage.local.get(STORAGE_KEYS);
    relayKey = String(
      saved.blackdomainElectronicRelayKey || saved.blackdomainMbRelayKey || "",
    ).trim();
    return relayKey;
  }

  async function forward(body, attempt = 0) {
    const key = await getRelayKey();
    if (!key || body?.type !== "tables" || !Array.isArray(body.tables)) return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "BLACKDOMAIN_MT_FORWARD",
        key,
        body,
      });
      if (response?.ok || response?.status === 401) return;
    } catch {
      // Retry transient extension/background failures below.
    }
    if (attempt < 5) {
      setTimeout(() => forward(body, attempt + 1), Math.min(30000, 1000 * (2 ** attempt)));
    }
  }

  window.addEventListener("BLACKDOMAIN_MT_RELAY", (event) => {
    forward(event.detail);
  });

  chrome.storage.local.set({ blackdomainMtContentLoadedAt: Date.now() });
  console.info("[BLACKDOMAIN MT] relay active");
}());
