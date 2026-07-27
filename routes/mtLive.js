const express = require("express");
const mtSource = require("../modules/baccarat/mtSource");
const mtLive = require("../modules/baccarat/mtLive");

function registerMtLiveRoutes(app) {
  app.get("/api/mt/status", (_req, res) => {
    res.json({
      ...mtSource.getSnapshot(),
      live: mtLive.getStatus(),
    });
  });

  app.post("/api/mt/seal", express.text({ limit: "2kb", type: "text/plain" }), async (req, res) => {
    const allowedOrigin = process.env.MT_ORIGIN || "https://gsa.ofalive99.net";
    if (req.get("origin") !== allowedOrigin) {
      return res.status(403).json({ ok: false, error: "Forbidden." });
    }
    res.set("access-control-allow-origin", allowedOrigin);
    const candidate = String(req.body || "").trim();
    if (candidate.length < 16 || candidate.length > 1024 || !await mtLive.validateToken(candidate)) {
      return res.status(400).json({ ok: false, error: "Invalid MT token." });
    }
    try {
      return res.json({ ok: true, sealed: mtLive.sealToken(candidate) });
    } catch (error) {
      return res.status(503).json({ ok: false, error: error.message });
    }
  });
}

module.exports = {
  registerMtLiveRoutes,
};
