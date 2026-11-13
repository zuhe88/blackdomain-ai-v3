const crypto = require("node:crypto");
const express = require("express");
const source = require("../modules/baccarat/t9Source");

function registerT9RelayRoutes(app) {
  app.post("/api/t9/ingest", express.json({ limit: "96kb" }), (req, res) => {
    const key = Buffer.from(process.env.T9_RELAY_KEY || "");
    const supplied = Buffer.from(req.get("x-t9-relay-key") || "");
    if (!key.length) return res.sendStatus(503);
    if (key.length !== supplied.length || !crypto.timingSafeEqual(key, supplied)) return res.sendStatus(401);
    if (!source.ingestTables(req.body?.tables)) return res.sendStatus(400);
    return res.sendStatus(202);
  });
}

module.exports = { registerT9RelayRoutes };
