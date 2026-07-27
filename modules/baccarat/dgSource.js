const { decodeBase64Frame } = require("./dgProto");

const ALLOWED_COMMANDS = new Set([207, 1002, 1004, 1005]);
const tables = new Map();
let updatedAt = null;

function roomFromName(value) {
  const match = String(value || "").toUpperCase().match(/\b(RB\d{2}|S\d{2})\b/);
  return match ? match[1] : null;
}

function roadResult(value) {
  const parts = String(value || "").split("#");
  const code = Number(parts[1]);
  if (code >= 1 && code <= 4) return "莊";
  if (code >= 5 && code <= 8) return "閒";
  if (code >= 9 && code <= 13) return "和";
  return null;
}

function normalizeHistory(roads) {
  return (Array.isArray(roads) ? roads : [])
    .map((road) => ({
      gameNo: String(road || "").split("#")[0] || null,
      result: roadResult(road),
    }))
    .filter((record) => record.gameNo && record.result)
    .slice(-200);
}

function mergeTable(incoming) {
  if (!incoming || !Number.isInteger(Number(incoming.tableId))) return false;
  const tableId = Number(incoming.tableId);
  const current = tables.get(tableId) || { tableId, roads: [] };
  const next = {
    ...current,
    ...incoming,
    tableId,
    room: roomFromName(incoming.tableName) || current.room || null,
    roads: incoming.roads?.length ? [...incoming.roads] : current.roads,
    updatedAt: new Date().toISOString(),
  };
  next.history = normalizeHistory(next.roads);
  tables.set(tableId, next);
  updatedAt = next.updatedAt;
  return true;
}

function ingestMessage(message = {}) {
  if (!ALLOWED_COMMANDS.has(Number(message.cmd))) return false;

  if (Number(message.cmd) === 1002 || Number(message.cmd) === 1005) {
    return (message.table || []).reduce((accepted, table) => mergeTable(table) || accepted, false);
  }

  if (Number(message.cmd) === 1004) {
    return mergeTable({ tableId: message.tableId, roads: message.list || [] });
  }

  let accepted = false;
  for (const update of message.lobbyPush || []) {
    accepted = mergeTable(update) || accepted;
  }
  return accepted;
}

function ingestFrame(value) {
  try {
    return ingestMessage(decodeBase64Frame(value));
  } catch {
    return false;
  }
}

function getTableByRoom(room) {
  const normalized = String(room || "").toUpperCase();
  const table = [...tables.values()].find((item) => item.room === normalized);
  return table ? {
    ...table,
    roads: [...table.roads],
    history: table.history.map((record) => ({ ...record })),
  } : null;
}

function getSnapshot() {
  const items = [...tables.values()]
    .filter((table) => table.room)
    .sort((left, right) => left.room.localeCompare(right.room, "en", { numeric: true }))
    .map((table) => ({
      tableId: table.tableId,
      room: table.room,
      tableName: table.tableName || null,
      shoeId: table.shoeId || null,
      playId: table.playId || null,
      state: table.state ?? null,
      countDown: table.countDown ?? null,
      result: table.result || null,
      gameNo: table.gameNo || null,
      historyCount: table.history.length,
      latest: table.history[table.history.length - 1] || null,
      updatedAt: table.updatedAt,
    }));
  return {
    source: items.length ? "relay" : "unavailable",
    updatedAt,
    tables: items,
  };
}

function resetForTest() {
  tables.clear();
  updatedAt = null;
}

module.exports = {
  getSnapshot,
  getTableByRoom,
  ingestFrame,
  ingestMessage,
  normalizeHistory,
  resetForTest,
  roadResult,
  roomFromName,
};
