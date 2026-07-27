const EventEmitter = require("events");
const { decodeBase64Frame } = require("./dgProto");
const { DG_ROOMS } = require("./constants");

const ALLOWED_COMMANDS = new Set([2, 27, 207, 1002, 1004, 1005]);
const tables = new Map();
const events = new EventEmitter();
events.setMaxListeners(50);
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

function normalizeHistory(roads, scope = "road") {
  const source = Array.isArray(roads) ? roads : [];
  const newestFirst = source.length > 0
    && source.every((road) => !String(road || "").split("#")[0]);
  const chronological = newestFirst ? [...source].reverse() : source;
  return chronological
    .map((road, index) => ({
      gameNo: String(road || "").split("#")[0] || `${scope}:${index + 1}`,
      result: roadResult(road),
    }))
    .filter((record) => record.gameNo && record.result)
    .slice(-200);
}

function mergeTable(incoming) {
  if (!incoming || !Number.isInteger(Number(incoming.tableId))) return false;
  const tableId = Number(incoming.tableId);
  const incomingRoom = roomFromName(incoming.tableName);
  if (incoming.tableName && (!incomingRoom || !DG_ROOMS.includes(incomingRoom))) {
    tables.delete(tableId);
    return false;
  }
  const current = tables.get(tableId) || { tableId, roads: [] };
  const next = {
    ...current,
    ...incoming,
    tableId,
    room: incomingRoom || current.room || null,
    roads: incoming.roads?.length ? [...incoming.roads] : current.roads,
    updatedAt: new Date().toISOString(),
  };
  const previousLatest = current.history?.[current.history.length - 1] || null;
  if (next.room && !DG_ROOMS.includes(next.room)) {
    tables.delete(tableId);
    return false;
  }
  next.history = normalizeHistory(next.roads, next.shoeId || next.tableId);
  tables.set(tableId, next);
  updatedAt = next.updatedAt;
  const latest = next.history[next.history.length - 1] || null;
  if (next.room && previousLatest && latest && latest.gameNo !== previousLatest.gameNo) {
    events.emit("result", {
      room: next.room,
      tableId,
      gameNo: latest.gameNo,
      result: latest.result,
      updatedAt: next.updatedAt,
    });
  }
  return true;
}

function ingestMessage(message = {}) {
  if (!ALLOWED_COMMANDS.has(Number(message.cmd))) return false;

  if ([2, 27, 1002, 1005].includes(Number(message.cmd))) {
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

function getRoomStats(room) {
  const table = getTableByRoom(room);
  const stats = { banker: 0, player: 0, tie: 0, total: 0 };
  if (!table) return stats;
  for (const record of table.history) {
    if (record.result === "莊") stats.banker += 1;
    if (record.result === "閒") stats.player += 1;
    if (record.result === "和") stats.tie += 1;
  }
  stats.total = stats.banker + stats.player + stats.tie;
  return stats;
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

function onResult(listener) {
  events.on("result", listener);
  return () => events.off("result", listener);
}

module.exports = {
  getRoomStats,
  getSnapshot,
  getTableByRoom,
  ingestFrame,
  ingestMessage,
  normalizeHistory,
  onResult,
  resetForTest,
  roadResult,
  roomFromName,
};
