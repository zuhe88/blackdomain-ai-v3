const crypto = require("crypto");
const express = require("express");
const electronicSource = require("../modules/electronic/source");
const electronic = require("../modules/electronic");

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function registerElectronicRelayRoutes(app) {
  app.get("/api/electronic/status", (_req, res) => res.json({ games: electronicSource.getSnapshot() }));
  app.get("/api/electronic/watch-rooms", async (req, res) => {
    const key = String(process.env.ATG_RELAY_KEY || "").trim();
    if (!key) return res.status(503).json({ ok: false, error: "Electronic relay is not configured." });
    if (!secureEqual(key, req.get("x-atg-relay-key") || req.get("x-electronic-relay-key"))) return res.status(401).json({ ok: false, error: "Unauthorized." });
    return res.json({
      ok: true,
      rooms: await electronic.getActiveWatchRooms(),
      refresh: electronicSource.getRefreshRequest(),
    });
  });
  app.post("/api/electronic/ingest", express.json({ limit: "250kb" }), async (req, res) => {
    const key = String(process.env.ATG_RELAY_KEY || "").trim();
    if (!key) return res.status(503).json({ ok: false, error: "Electronic relay is not configured." });
    if (!secureEqual(key, req.get("x-atg-relay-key") || req.get("x-electronic-relay-key"))) return res.status(401).json({ ok: false, error: "Unauthorized." });
    const body = req.body || {};
    const accepted = body.type === "tables"
      ? electronicSource.ingestTables(body)
      : body.type === "updates"
        ? electronicSource.ingestUpdates(body)
      : body.type === "detail"
        ? electronicSource.ingestDetail(body)
        : body.type === "spin" && electronicSource.ingestSpin(body);
    if (!accepted) return res.status(400).json({ ok: false, error: "Invalid electronic payload." });
    if (body.type === "tables" && body.scanComplete === true) {
      const completedRefresh = electronicSource.markRefreshGameComplete(body.gameName, body.refreshId);
      if (completedRefresh) await electronic.notifyAdminRefreshComplete(completedRefresh);
      setImmediate(() => {
        electronic.handleElectronicDataReady(body.gameName).catch((error) => {
          console.error("[Electronic] Automatic recommendation failed:", error.message);
        });
      });
    }
    if (body.type === "spin") await electronic.handleElectronicSpin(body);
    if (body.type === "detail" && accepted.feature) {
      electronicSource.ingestSpin(accepted.feature);
      await electronic.handleElectronicSpin(accepted.feature);
    }
    return res.status(202).json({ ok: true });
  });
}

module.exports = { registerElectronicRelayRoutes };
