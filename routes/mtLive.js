const crypto = require("crypto");
const express = require("express");
const mtSource = require("../modules/baccarat/mtSource");
const mtLive = require("../modules/baccarat/mtLive");

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function configuredRelayKey() {
  return String(process.env.DG_RELAY_KEY || process.env.ATG_RELAY_KEY || "").trim();
}

function validLocalSignature(body, signature) {
  const token = String(process.env.MT_GAME_TOKEN || "").trim();
  if (!token || !signature) return false;
  const expected = crypto.createHmac("sha256", token)
    .update(JSON.stringify(body || {}))
    .digest("hex");
  return secureEqual(expected, signature);
}

function registerMtLiveRoutes(app) {
  app.get("/api/mt/status", (_req, res) => {
    const snapshot = mtSource.getSnapshot();
    res.json({
      source: snapshot.source,
      updatedAt: snapshot.updatedAt,
      tableCount: snapshot.tables.length,
      rooms: snapshot.tables.map((table) => ({
        room: table.room,
        historyCount: table.historyCount,
        updatedAt: table.updatedAt,
        fresh: mtSource.isRoomFresh(table.room),
      })),
      live: mtLive.getStatus(),
    });
  });

  app.post("/api/mt/ingest", express.json({ limit: "750kb" }), (req, res) => {
    if (!configuredRelayKey() && !String(process.env.MT_GAME_TOKEN || "").trim()) {
      return res.status(503).json({ ok: false, error: "MT relay is not configured." });
    }
    const relayKeyAccepted = secureEqual(configuredRelayKey(), req.get("x-dg-relay-key"));
    const localSignatureAccepted = validLocalSignature(req.body, req.get("x-mt-relay-signature"));
    if (!relayKeyAccepted && !localSignatureAccepted) {
      return res.status(401).json({ ok: false, error: "Unauthorized." });
    }
    if (!Array.isArray(req.body?.tables) || req.body.tables.length > 50) {
      return res.status(400).json({ ok: false, error: "Invalid MT payload." });
    }
    if (!mtSource.ingestTables(req.body.tables)) {
      return res.status(400).json({ ok: false, error: "No MT baccarat tables were accepted." });
    }
    return res.status(202).json({ ok: true });
  });
}

module.exports = {
  registerMtLiveRoutes,
};
