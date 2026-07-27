const EventEmitter = require("events");
const { MT_ROOMS } = require("./constants");

const tables = new Map();
const events = new EventEmitter();
events.setMaxListeners(50);
let updatedAt = null;

function roomFromName(value) {
  const normalized = String(value || "").toUpperCase().replace(/\s+/g, "");
  const explicit = normalized.match(/\bMT(13A|3A|\d{1,2})\b/);
  const code = explicit?.[1] || normalized.match(/(?:^|[^0-9])(13A|3A|\d{1,2})(?:[^0-9A-Z]|$)/)?.[1];
  if (!code) return null;
  const room = code.endsWith("A") ? `MT${code}` : `MT${code.padStart(2, "0")}`;
  return MT_ROOMS.includes(room) ? room : null;
}

function beadResult(value) {
  const code = String(value || "").slice(-1);
  if (code === "1") return "閒";
  if (code === "2") return "莊";
  if (code === "3") return "和";
  return null;
}

function normalizeHistory(beadPlate, shoe = "shoe") {
  if (!beadPlate) return [];
  const cells = String(beadPlate)
    .split("#")
    .flatMap((column) => column.match(/.{1,2}/g) || []);
  return cells
    .map((cell, index) => ({
      gameNo: `${shoe}:${index + 1}`,
      result: beadResult(cell),
    }))
    .filter((record) => record.result)
    .slice(-200);
}

function mergeTable(incoming) {
  const tableId = String(incoming?.table_id ?? incoming?.tableId ?? "").trim();
  if (!tableId) return false;
  const tableType = String(incoming.table_type ?? incoming.tableType ?? "").toUpperCase();
  if (tableType && !["BAC", "BAS"].includes(tableType)) {
    tables.delete(tableId);
    return false;
  }

  const incomingRoom = roomFromName(incoming.table_name ?? incoming.tableName);
  const current = tables.get(tableId) || { tableId, history: [] };
  const room = incomingRoom || current.room || null;
  if (!room || !MT_ROOMS.includes(room)) {
    tables.delete(tableId);
    return false;
  }

  const trend = incoming.trend || current.trend || {};
  const shoe = incoming.shoe ?? incoming.shoe_id ?? current.shoe ?? "shoe";
  const history = normalizeHistory(trend.bead_plate2 ?? trend.bead_plate, shoe);
  const next = {
    ...current,
    ...incoming,
    tableId,
    room,
    tableType: tableType || current.tableType || null,
    tableName: incoming.table_name ?? incoming.tableName ?? current.tableName ?? null,
    shoe,
    trend,
    history,
    updatedAt: new Date().toISOString(),
  };
  const previousLatest = current.history?.[current.history.length - 1] || null;
  const latest = history[history.length - 1] || null;
  tables.set(tableId, next);
  updatedAt = next.updatedAt;

  if (latest && (!previousLatest || latest.gameNo !== previousLatest.gameNo)) {
    events.emit("result", {
      room,
      tableId,
      gameNo: latest.gameNo,
      result: latest.result,
      updatedAt: next.updatedAt,
    });
  }
  return true;
}

function ingestTables(value) {
  const source = Array.isArray(value) ? value : Object.values(value || {});
  return source.reduce((accepted, table) => mergeTable(table) || accepted, false);
}

function ingestMessage(message = {}) {
  const action = typeof message.action === "string" ? message.action : message.action?.name;
  if (action !== "/api/v1/gametype/*/game/*/room/*/tables") return false;
  return ingestTables(message.msg?.tables);
}

function getTableByRoom(room) {
  const normalized = String(room || "").toUpperCase();
  const table = [...tables.values()].find((item) => item.room === normalized);
  return table ? {
    ...table,
    trend: { ...table.trend },
    history: table.history.map((record) => ({ ...record })),
  } : null;
}

function getRoomStats(room) {
  const table = getTableByRoom(room);
  const fallback = { banker: 0, player: 0, tie: 0, total: 0 };
  if (!table) return fallback;
  const banker = Number(table.trend.total_round_banker);
  const player = Number(table.trend.total_round_player);
  const tie = Number(table.trend.total_round_tie);
  if ([banker, player, tie].every(Number.isFinite)) {
    return { banker, player, tie, total: banker + player + tie };
  }
  for (const record of table.history) {
    if (record.result === "莊") fallback.banker += 1;
    if (record.result === "閒") fallback.player += 1;
    if (record.result === "和") fallback.tie += 1;
  }
  fallback.total = fallback.banker + fallback.player + fallback.tie;
  return fallback;
}

function getSnapshot() {
  return {
    source: tables.size ? "live" : "unavailable",
    updatedAt,
    tables: [...tables.values()]
      .sort((left, right) => left.room.localeCompare(right.room, "en", { numeric: true }))
      .map((table) => ({
        tableId: table.tableId,
        room: table.room,
        tableName: table.tableName,
        tableType: table.tableType,
        shoe: table.shoe,
        gameSn: table.game_sn || null,
        gameState: table.game_state || null,
        historyCount: table.history.length,
        latest: table.history[table.history.length - 1] || null,
        updatedAt: table.updatedAt,
      })),
  };
}

function onResult(listener) {
  events.on("result", listener);
  return () => events.off("result", listener);
}

function resetForTest() {
  tables.clear();
  updatedAt = null;
}

module.exports = {
  beadResult,
  getRoomStats,
  getSnapshot,
  getTableByRoom,
  ingestMessage,
  ingestTables,
  normalizeHistory,
  onResult,
  resetForTest,
  roomFromName,
};
