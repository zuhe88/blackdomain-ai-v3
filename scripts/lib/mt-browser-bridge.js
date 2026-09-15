const crypto = require("crypto");

const MAX_BODY_BYTES = 750 * 1024;

function sanitizeTables(value) {
  return Object.values(value || {})
    .filter((table) => table?.table_type === "BAC" || table?.table_type === "BAS")
    .slice(0, 50)
    .map((table) => ({
      table_id: table.table_id,
      table_name: table.table_name,
      table_type: table.table_type,
      game_sn: table.game_sn,
      game_state: table.game_state,
      shoe: table.shoe,
      round: table.round,
      trend: {
        bead_plate2: table.trend?.bead_plate2,
        total_round_banker: table.trend?.total_round_banker,
        total_round_player: table.trend?.total_round_player,
        total_round_tie: table.trend?.total_round_tie,
      },
    }));
}

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createBrowserBridge({ port, getSecret, onTables, onHealth = () => {} }) {
  return async function browserBridge(req, res) {
    if (!["/browser-config", "/browser-ingest", "/browser-health"].includes(req.url)) return false;
    const json = (status, value) => {
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(JSON.stringify(value));
    };
    // A local page may download its pairing configuration; remote sites may not.
    const localOrigin = `http://127.0.0.1:${port}`;
    if (req.headers.host !== `127.0.0.1:${port}`) {
      json(403, { error: "Local host required." });
      return true;
    }
    if (req.url === "/browser-config") {
      if (req.method !== "GET" || (req.headers.origin && req.headers.origin !== localOrigin)
        || req.headers["sec-fetch-site"] === "cross-site") {
        json(403, { error: "Local configuration access only." });
      } else {
        json(200, { endpoint: `${localOrigin}/browser-ingest`, bridgeKey: getSecret() });
      }
      return true;
    }
    if (req.method !== "POST") {
      json(405, { error: "POST required." });
      return true;
    }
    if (!sameSecret(req.headers["x-blackdomain-bridge-key"], getSecret())) {
      json(401, { error: "Bridge pairing required." });
      return true;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          json(413, { error: "Payload too large." });
          return true;
        }
        chunks.push(chunk);
      }
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        json(400, { error: "Invalid JSON." });
        return true;
      }
      if (req.url === "/browser-health") {
        const states = ["receiving", "request_tables", "waiting_after_request", "reload_background", "reload_cooldown", "login_required", "recovery_limit", "foreground_waiting", "local_unavailable", "tab_unavailable"];
        if (!payload || !states.includes(payload.state)) { json(400, { error: "Invalid watchdog state." }); return true; }
        await onHealth({ state: payload.state,
          reloadCount: Number.isInteger(payload.reloadCount) ? Math.max(0, Math.min(2, payload.reloadCount)) : 0,
          lastReloadAt: Number.isFinite(Date.parse(payload.lastReloadAt)) ? new Date(payload.lastReloadAt).toISOString() : null,
          checkedAt: new Date().toISOString(),
        });
        json(200, { ok: true });
        return true;
      }
      if (!payload || !Array.isArray(payload.tables) || payload.tables.length > 50) {
        json(400, { error: "Invalid MT tables." });
        return true;
      }
      const tables = sanitizeTables(payload.tables);
      if (!tables.length) {
        json(400, { error: "No MT baccarat tables." });
        return true;
      }
      const diagnostics = payload.diagnostics && typeof payload.diagnostics === "object" ? {
        version: String(payload.diagnostics.version || "").slice(0, 20),
        capturedAt: Number.isFinite(Date.parse(payload.diagnostics.capturedAt)) ? new Date(payload.diagnostics.capturedAt).toISOString() : null,
        visibility: ["hidden", "visible"].includes(payload.diagnostics.visibility) ? payload.diagnostics.visibility : "unknown",
        pollingActive: payload.diagnostics.pollingActive === true,
        lastRequestAt: Number.isFinite(Date.parse(payload.diagnostics.lastRequestAt)) ? new Date(payload.diagnostics.lastRequestAt).toISOString() : null,
        lastRequestReason: ["timer", "authenticated", "table-event", "socket-event", "visible", "watchdog"].includes(payload.diagnostics.lastRequestReason) ? payload.diagnostics.lastRequestReason : "none",
        requestCount: Number.isSafeInteger(payload.diagnostics.requestCount) && payload.diagnostics.requestCount >= 0 ? payload.diagnostics.requestCount : 0,
      } : null;
      await onTables(tables, diagnostics);
      json(202, { ok: true, forwardedAt: new Date().toISOString() });
    } catch (error) {
      json(502, { error: error.message || "Forwarding failed." });
    }
    return true;
  };
}

module.exports = { createBrowserBridge, sanitizeTables };
