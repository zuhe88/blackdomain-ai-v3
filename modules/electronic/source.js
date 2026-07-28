const GAME_NAMES = ["戰神賽特1", "戰神賽特2"];
const LIVE_TTL_MS = 2 * 60 * 1000;
const games = new Map(GAME_NAMES.map((gameName) => [gameName, {
  gameName,
  tables: new Map(),
  pendingScan: null,
  updatedAt: null,
  spins: new Map(),
}]));

function normalizeStatus(value) {
  return String(value || "").trim();
}

function normalizeTable(table = {}) {
  const number = Number(table.number ?? table.tableNumber ?? table.room ?? table.roomNo);
  const roomId = String(table.roomId ?? table.room_id ?? "").trim();
  if (!Number.isInteger(number) || number < 1 || !roomId) return null;
  const status = normalizeStatus(table.status);
  const detail = table.detail || table;
  const hasDetail = ["dayWin", "dayBet", "hourWin", "hourBet", "todayWin", "todayBet", "mgCounts"]
    .some((key) => detail?.[key] != null);
  return {
    roomId,
    number,
    status,
    occupied: status ? status !== "Empty" : table.occupied === true,
    detail: hasDetail ? {
      dayWin: Number(detail.dayWin) || 0,
      dayBet: Number(detail.dayBet) || 0,
      hourWin: Number(detail.hourWin) || 0,
      hourBet: Number(detail.hourBet) || 0,
      todayWin: Number(detail.todayWin) || 0,
      todayBet: Number(detail.todayBet) || 0,
      mgCounts: Array.isArray(detail.mgCounts) ? detail.mgCounts.slice(0, 3).map((v) => Number(v) || 0) : [],
    } : null,
  };
}

function ingestTables(payload = {}) {
  const gameName = String(payload.gameName || "").trim();
  const state = games.get(gameName);
  if (!state || !Array.isArray(payload.tables)) return false;
  const scanId = String(payload.scanId || "").trim();
  let next = new Map(state.tables);
  if (scanId) {
    if (state.pendingScan?.id !== scanId) state.pendingScan = { id: scanId, tables: new Map() };
    next = state.pendingScan.tables;
  }
  payload.tables.forEach((raw) => {
    const table = normalizeTable(raw);
    if (table) next.set(table.roomId, table);
  });
  if (!scanId && !next.size) return false;
  if (scanId && payload.scanComplete === true) {
    state.tables = new Map(next);
    state.pendingScan = null;
  } else if (!scanId) {
    state.tables = next;
  }
  state.updatedAt = new Date().toISOString();
  return true;
}

function ingestDetail(payload = {}) {
  const state = games.get(String(payload.gameName || ""));
  const detail = payload.detail;
  if (!state || !detail?.roomId) return false;
  const existing = state.tables.get(String(detail.roomId));
  if (!existing) return false;
  const normalized = normalizeTable({ ...existing, ...detail, detail });
  if (!normalized) return false;
  state.tables.set(normalized.roomId, normalized);
  state.updatedAt = new Date().toISOString();
  return true;
}

function ingestUpdates(payload = {}) {
  const state = games.get(String(payload.gameName || ""));
  if (!state || !Array.isArray(payload.updates)) return false;
  let accepted = 0;
  payload.updates.forEach((update) => {
    const roomId = String(update?.roomId || "");
    const table = state.tables.get(roomId);
    const status = normalizeStatus(update?.status);
    if (!table || !status) return;
    table.status = status;
    table.occupied = status !== "Empty";
    accepted += 1;
  });
  if (!accepted) return false;
  state.updatedAt = new Date().toISOString();
  return true;
}

function ingestSpin(payload = {}) {
  const state = games.get(String(payload.gameName || ""));
  if (!state || !payload.spinId) return false;
  state.spins.set(String(payload.spinId), {
    gameName: state.gameName,
    roomId: payload.roomId ? String(payload.roomId) : null,
    roomNumber: Number(payload.roomNumber) || null,
    totalWinnings: Number(payload.totalWinnings) || 0,
    totalStake: Number(payload.totalStake) || 0,
    currentView: Number(payload.currentView) || 0,
    totalViews: Number(payload.totalViews) || 0,
    capturedAt: payload.capturedAt || Date.now(),
  });
  if (state.spins.size > 100) state.spins.delete(state.spins.keys().next().value);
  return true;
}

function getGame(gameName) {
  const state = games.get(String(gameName || ""));
  if (!state) return null;
  const tables = [...state.tables.values()].map((table) => ({ ...table, detail: table.detail && { ...table.detail, mgCounts: [...table.detail.mgCounts] } }));
  return { gameName: state.gameName, updatedAt: state.updatedAt, tables };
}

function getEmptyRooms(gameName) {
  const snapshot = getGame(gameName);
  if (!snapshot?.updatedAt || Date.now() - new Date(snapshot.updatedAt).getTime() > LIVE_TTL_MS) return [];
  return snapshot.tables.filter((table) => table.status === "Empty" && table.occupied !== true);
}

function getSnapshot() {
  return GAME_NAMES.map((gameName) => getGame(gameName));
}

function resetForTest() {
  games.forEach((state) => {
    state.tables = new Map();
    state.pendingScan = null;
    state.spins = new Map();
    state.updatedAt = null;
  });
}

const SUPPORTED_GAMES = new Set(GAME_NAMES);

module.exports = { GAME_NAMES, SUPPORTED_GAMES, ingestTables, ingestUpdates, ingestDetail, ingestSpin, getGame, getEmptyRooms, getSnapshot, normalizeTable, resetForTest };
