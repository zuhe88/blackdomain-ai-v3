const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const source = require("../modules/baccarat/abSource");
const { normalizeTable, normalizeSpecialTable } = require("../modules/baccarat/abProtocol");

function registerAbRelayRoutes(app) {
  const specialTables = new Map();
  app.get("/api/ab/status", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.vary("Accept");
    if (req.accepts(["json", "html"]) === "html") {
      return res.sendFile(path.join(__dirname, "..", "public", "ab-status.html"));
    }
    const { tables, updatedAt } = source.getSnapshot();
    const rooms = tables.map(({ room, historyCount, updatedAt }) => ({
      room, historyCount, updatedAt, fresh: source.isRoomFresh(room),
    }));
    const games = [...specialTables.values()].map((table) => ({
      ...table,
      fresh: source.isTimestampFresh(table.updatedAt),
    }));
    res.json({ source: rooms.some((room) => room.fresh) ? "browser-relay" : "unavailable",
      updatedAt, tableCount: rooms.length, rooms, games });
  });

  app.post("/api/ab/ingest", express.json({ limit: "350kb" }), (req, res) => {
    const expected = Buffer.from(process.env.AB_RELAY_KEY || "");
    const actual = Buffer.from(req.get("x-ab-relay-key") || "");
    if (!expected.length) return res.status(503).json({ error: "AB relay is not configured." });
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return res.status(401).json({ error: "Unauthorized." });
    }
    const incoming = req.body?.tables;
    if (!Array.isArray(incoming) || !incoming.length || incoming.length > 50) {
      return res.status(400).json({ error: "Invalid AB payload." });
    }
    const tables = incoming.map((table) => table && typeof table === "object"
      ? normalizeTable(table) || normalizeSpecialTable(table)
      : null);
    if (tables.includes(null) || new Set(tables.map((table) => table.tableId)).size !== tables.length) {
      return res.status(400).json({ error: "Invalid AB tables." });
    }
    source.ingestTables(tables.filter((table) => !table.game));
    const updatedAt = new Date().toISOString();
    for (const table of tables.filter((item) => item.game)) {
      specialTables.set(table.room, { ...table, updatedAt });
    }
    return res.status(202).json({ ok: true });
  });
}

module.exports = { registerAbRelayRoutes };
