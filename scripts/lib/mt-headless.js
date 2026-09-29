const { sanitizeTables } = require("./mt-browser-bridge");
const MT_ORIGIN = "https://gsa.ofalive99.net";

function launchUrl(token) {
  if (typeof token !== "string" || token.trim().length < 16) throw new Error("MT_LOGIN_REQUIRED");
  const url = new URL(MT_ORIGIN);
  url.searchParams.set("token", token.trim());
  url.searchParams.set("lang", "zhtw");
  return url.href;
}

// A single in-flight request plus the newest waiting capture; never replay a snapshot.
function createForwarder({ send, now = Date.now, onSuccess = () => {}, onError = () => {}, freshnessMs = 15000 }) {
  let pending = null;
  let running = null;
  let closed = false;
  async function drain() {
    while (pending && !closed) {
      const packet = pending;
      pending = null;
      const age = now() - Date.parse(packet.diagnostics?.capturedAt);
      if (!(age >= 0 && age < freshnessMs)) continue;
      try { await send(packet); if (!closed) onSuccess(packet); }
      catch { if (!closed) onError(); }
    }
  }
  return {
    enqueue(packet) {
      if (closed || !Array.isArray(packet?.tables) || packet.tables.length > 50) return Promise.resolve();
      const tables = sanitizeTables(packet.tables);
      if (!tables.length) return Promise.resolve();
      pending = { tables, diagnostics: { ...packet.diagnostics, browserMode: "headless" } };
      if (!running) running = drain().finally(() => { running = null; });
      return running;
    },
    async close() { closed = true; pending = null; await running; },
  };
}

module.exports = { MT_ORIGIN, launchUrl, createForwarder };
