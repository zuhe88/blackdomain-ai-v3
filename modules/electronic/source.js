const GAME_NAMES = ["戰神賽特1", "戰神賽特2", "古神巴風特", "虎小妹", "赤三國"];
const LIVE_TTL_MS = 2 * 60 * 1000;
const FULL_SCAN_TTL_MS = 15 * 60 * 1000;
const REFRESH_COOLDOWN_MS = 30 * 1000;
const MIN_READY_TABLES = new Map([
  [GAME_NAMES[0], 1200],
  [GAME_NAMES[1], 3900],
  [GAME_NAMES[2], 900],
  [GAME_NAMES[3], 2900],
  [GAME_NAMES[4], 150],
]);
let refreshSequence = 0;
let refreshRequest = null;
const detailWaiters = new Map();
const games = new Map(GAME_NAMES.map((gameName) => [gameName, {
  gameName,
  relayVersion: null,
  tables: new Map(),
  pendingScan: null,
  updatedAt: null,
    fullScanAt: null,
    dataMode: null,
    sourcePagesCovered: 0,
    sourcePageCount: 0,
  spins: new Map(),
  featureMonitors: new Map(),
}]));

function normalizeStatus(value) {
  return String(value || "").trim();
}

function capturedAtIso(value) {
  let timestamp = Number(value);
  if (Number.isFinite(timestamp) && timestamp > 0 && timestamp < 1e12) timestamp *= 1000;
  if (!Number.isFinite(timestamp) || timestamp <= 0) timestamp = Date.now();
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeTable(table = {}) {
  const number = Number(table.number ?? table.tableNumber ?? table.room ?? table.roomNo);
  const roomId = String(table.roomId ?? table.room_id ?? "").trim();
  if (!Number.isInteger(number) || number < 1 || !roomId) return null;
  const status = normalizeStatus(table.status);
  const detail = table.detail || table;
  const hasDetail = [
    "dayWin", "dayBet", "hourWin", "hourBet", "todayWin", "todayBet", "mgCounts",
    "todayRtp", "todayRate", "todayScoreRate", "hourRtp", "hourRate",
    "dayRtp", "dayRate", "dayScoreRate", "rtp", "scoreRate",
  ]
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
      todayRtp: normalizeRtp(detail.todayRtp ?? detail.todayRate ?? detail.todayScoreRate ?? detail.hourRtp ?? detail.hourRate),
      dayRtp: normalizeRtp(detail.dayRtp ?? detail.dayRate ?? detail.dayScoreRate ?? detail.rtp ?? detail.scoreRate),
      mgCounts: Array.isArray(detail.mgCounts) ? detail.mgCounts.slice(0, 3).map((v) => Number(v) || 0) : [],
    } : null,
    detailUpdatedAt: hasDetail
      ? capturedAtIso(detail.capturedAt ?? table.capturedAt)
      : null,
  };
}

function normalizeRtp(value) {
  const numeric = Number.parseFloat(String(value ?? "").replace("%", ""));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric > 0 && numeric <= 2 ? numeric * 100 : numeric;
}

function ingestTables(payload = {}) {
  const gameName = String(payload.gameName || "").trim();
  const state = games.get(gameName);
  if (!state || !Array.isArray(payload.tables)) return false;
  if (payload.relayVersion) state.relayVersion = String(payload.relayVersion);
  const sourcePagesCovered = Number(payload.sourcePagesCovered);
  const sourcePageCount = Number(payload.sourcePageCount);
  if (Number.isInteger(sourcePagesCovered) && sourcePagesCovered >= 0) {
    state.sourcePagesCovered = sourcePagesCovered;
  }
  if (Number.isInteger(sourcePageCount) && sourcePageCount > 0) {
    state.sourcePageCount = sourcePageCount;
  }
  const scanId = String(payload.scanId || "").trim();
  let next = new Map(state.tables);
  if (scanId) {
    if (state.pendingScan?.id !== scanId) {
      state.pendingScan = {
        id: scanId,
        tables: new Map(),
        pages: new Set(),
        totalPages: null,
        completionSignaled: false,
        emptyOnly: payload.emptyOnly === true,
      };
    }
    next = state.pendingScan.tables;
  }
  payload.tables.forEach((raw) => {
    const table = normalizeTable(raw);
    if (table) {
      // Once an empty-room scan has established the authoritative pool, live
      // page snapshots must not reintroduce occupied/locked rooms.  They are
      // still useful as status deltas: remove a room when it becomes non-empty
      // and add/update it when it is empty again.
      const emptyOnlyMode = scanId
        ? state.pendingScan.emptyOnly
        : state.dataMode === "empty-only";
      if (emptyOnlyMode && table.status !== "Empty") {
        next.delete(table.roomId);
        return;
      }
      const existing = state.tables.get(table.roomId);
      if (!table.detail && existing?.detail) {
        table.detail = existing.detail;
        table.detailUpdatedAt = existing.detailUpdatedAt || null;
      }
      next.set(table.roomId, table);
    }
  });
  if (!scanId && !next.size) return false;
  if (scanId) {
    const page = Number(payload.page);
    const declaredTotalPages = Number(payload.totalPages);
    if (Number.isInteger(page) && page > 0) state.pendingScan.pages.add(page);
    if (Number.isInteger(declaredTotalPages) && declaredTotalPages > 0) {
      state.pendingScan.totalPages = declaredTotalPages;
    } else if (payload.scanComplete === true && Number.isInteger(page) && page > 0) {
      state.pendingScan.totalPages = page;
    }
    if (payload.scanComplete === true) state.pendingScan.completionSignaled = true;
    if (payload.emptyOnly !== true) state.pendingScan.emptyOnly = false;
  }
  const scanPagesComplete = scanId
    && state.pendingScan.completionSignaled
    && Number.isInteger(state.pendingScan.totalPages)
    && state.pendingScan.totalPages > 0
    && Array.from(
      { length: state.pendingScan.totalPages },
      (_unused, index) => index + 1,
    ).every((page) => state.pendingScan.pages.has(page));
  if (scanPagesComplete) {
    state.tables = new Map(next);
    state.dataMode = state.pendingScan.emptyOnly ? "empty-only" : "all-rooms";
    state.pendingScan = null;
    state.fullScanAt = new Date().toISOString();
  } else if (!scanId) {
    state.tables = next;
  }
  state.updatedAt = new Date().toISOString();
  return {
    accepted: true,
    scanCompleted: Boolean(scanPagesComplete),
    scanId: scanId || null,
  };
}

function ingestDetail(payload = {}) {
  const state = games.get(String(payload.gameName || ""));
  const detail = payload.detail;
  if (!state || !detail?.roomId) return false;
  const existing = state.tables.get(String(detail.roomId));
  // A recommended empty room disappears from the authoritative empty-room
  // pool as soon as the player enters it.  The relay must still be allowed to
  // submit detail samples for that occupied room so feature monitoring can
  // observe the mgCounts transition and payout.  Do not add the occupied room
  // back to the recommendation pool; keep its monitoring state separately.
  const normalized = normalizeTable({ ...(existing || {}), ...detail, detail });
  if (!normalized) return false;
  if (existing || normalized.status === "Empty") {
    state.tables.set(normalized.roomId, normalized);
  }
  state.updatedAt = new Date().toISOString();
  const waiterKey = `${state.gameName}:${normalized.number}`;
  const waiters = detailWaiters.get(waiterKey);
  if (waiters?.size) {
    detailWaiters.delete(waiterKey);
    waiters.forEach((waiter) => {
      clearTimeout(waiter.timer);
      waiter.resolve({
        ...normalized,
        detail: normalized.detail && {
          ...normalized.detail,
          mgCounts: [...normalized.detail.mgCounts],
        },
      });
    });
  }
  const now = Number(detail.capturedAt || payload.capturedAt) || Date.now();
  const currentDetail = normalized.detail;
  const previous = state.featureMonitors.get(normalized.roomId);
  const currentCounts = currentDetail?.mgCounts || [];
  const previousCounts = previous?.detail?.mgCounts || [];
  const featureReset = normalized.status === "Full"
    && previousCounts[0] > 0
    && currentCounts[0] === 0
    && currentCounts[1] === previousCounts[0]
    && currentCounts[2] === previousCounts[1];
  let pending = previous?.pending || null;
  let feature = null;
  if (featureReset) {
    const baselineWin = Number(previous.detail.todayWin) || 0;
    const baselineBet = Number(previous.detail.todayBet) || 0;
    const currentWin = Number(currentDetail.todayWin) || 0;
    const currentBet = Number(currentDetail.todayBet) || 0;
    const immediateWinnings = currentWin - baselineWin;
    const immediateStake = currentBet - baselineBet;
    if (immediateWinnings > 1e-7 && immediateStake >= -1e-7) {
      feature = {
        type: "spin",
        gameName: state.gameName,
        roomId: normalized.roomId,
        roomNumber: normalized.number,
        spinId: `room-monitor:${normalized.roomId}:${now}`,
        totalWinnings: immediateWinnings,
        totalStake: Math.max(0, immediateStake),
        currentView: 0,
        totalViews: 0,
        action: "roomFeature",
        featureTrigger: "room-monitor",
        capturedAt: now,
      };
      pending = null;
    } else {
      pending = {
        startedAt: now,
        baselineWin,
        baselineBet,
      };
    }
  } else if (pending) {
    const currentWin = Number(currentDetail?.todayWin) || 0;
    const winnings = currentWin - pending.baselineWin;
    const stake = (Number(currentDetail?.todayBet) || 0) - pending.baselineBet;
    if (winnings > 1e-7 && stake >= -1e-7) {
      feature = {
        type: "spin",
        gameName: state.gameName,
        roomId: normalized.roomId,
        roomNumber: normalized.number,
        spinId: `room-monitor:${normalized.roomId}:${pending.startedAt}`,
        totalWinnings: winnings,
        totalStake: Math.max(0, stake),
        currentView: 0,
        totalViews: 0,
        action: "roomFeature",
        featureTrigger: "room-monitor",
        capturedAt: now,
      };
      pending = null;
    }
  }
  state.featureMonitors.set(normalized.roomId, {
    status: normalized.status,
    detail: currentDetail && { ...currentDetail, mgCounts: [...currentCounts] },
    capturedAt: now,
    pending,
  });
  return { accepted: true, feature };
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
    relayVersion: state.relayVersion,
    roomId: payload.roomId ? String(payload.roomId) : null,
    roomNumber: Number(payload.roomNumber) || null,
    totalWinnings: Number(payload.totalWinnings) || 0,
    totalStake: Number(payload.totalStake) || 0,
    currentView: Number(payload.currentView) || 0,
    totalViews: Number(payload.totalViews) || 0,
    action: payload.action || null,
    featureTrigger: payload.featureTrigger || null,
    capturedAt: payload.capturedAt || Date.now(),
  });
  if (state.spins.size > 100) state.spins.delete(state.spins.keys().next().value);
  return true;
}

function getGame(gameName) {
  const state = games.get(String(gameName || ""));
  if (!state) return null;
  const tables = [...state.tables.values()].map((table) => ({ ...table, detail: table.detail && { ...table.detail, mgCounts: [...table.detail.mgCounts] } }));
  return {
    gameName: state.gameName,
    updatedAt: state.updatedAt,
    fullScanAt: state.fullScanAt,
    dataMode: state.dataMode,
    sourcePagesCovered: state.sourcePagesCovered,
    sourcePageCount: state.sourcePageCount,
    tables,
    recentSpins: [...state.spins.values()].slice(-5),
  };
}

function getEmptyRooms(gameName) {
  const snapshot = getGame(gameName);
  if (!hasReadyData(gameName)) return [];
  return snapshot.tables.filter((table) => table.status === "Empty" && table.occupied !== true);
}

function hasFreshData(gameName) {
  const state = games.get(String(gameName || ""));
  return Boolean(
    state?.updatedAt
    && Date.now() - new Date(state.updatedAt).getTime() <= LIVE_TTL_MS
  );
}

function hasFreshRoomDetail(room, now = Date.now(), maxAgeMs = LIVE_TTL_MS) {
  const timestamp = Date.parse(room?.detailUpdatedAt || "");
  return Boolean(
    room?.detail
    && Number.isFinite(timestamp)
    && now - timestamp >= 0
    && now - timestamp <= maxAgeMs
  );
}

function hasReadyData(gameName) {
  const state = games.get(String(gameName || ""));
  if (!state || !hasFreshData(gameName)) return false;
  const fullScanIsFresh = state.fullScanAt
    && Date.now() - new Date(state.fullScanAt).getTime() <= FULL_SCAN_TTL_MS;
  const minimumTables = state.dataMode === "empty-only"
    ? 1
    : MIN_READY_TABLES.get(state.gameName) || Number.POSITIVE_INFINITY;
  // Quick recommendations intentionally publish three freshly scanned source
  // pages as an immediately usable empty-room pool. Background batches keep
  // refreshing different random subsets of the eight source pages.
  return Boolean(fullScanIsFresh && state.tables.size >= minimumTables);
}

function getSnapshot() {
  return GAME_NAMES.map((gameName) => getGame(gameName));
}

function waitForRoomDetail(gameName, roomNumber, timeoutMs = 10000) {
  const state = games.get(String(gameName || ""));
  const number = Number(roomNumber);
  if (!state || !Number.isInteger(number)) return Promise.resolve(null);
  const waiterKey = `${state.gameName}:${number}`;
  return new Promise((resolve) => {
    const waiters = detailWaiters.get(waiterKey) || new Set();
    const waiter = {
      resolve,
      timer: setTimeout(() => {
        waiters.delete(waiter);
        if (!waiters.size) detailWaiters.delete(waiterKey);
        resolve(null);
      }, Math.max(1, Number(timeoutMs) || 10000)),
    };
    waiters.add(waiter);
    detailWaiters.set(waiterKey, waiters);
  });
}

function requestFullRefresh(requestedBy = "") {
  if (refreshRequest) {
    const elapsed = Date.now() - Date.parse(refreshRequest.requestedAt);
    if (elapsed < REFRESH_COOLDOWN_MS) {
      return {
        ...getRefreshRequest(),
        accepted: false,
        retryAfterSeconds: Math.max(1, Math.ceil((REFRESH_COOLDOWN_MS - elapsed) / 1000)),
      };
    }
  }
  refreshSequence += 1;
  refreshRequest = {
    id: `${Date.now()}-${refreshSequence}`,
    requestedAt: new Date().toISOString(),
    requestedBy: String(requestedBy || ""),
    completedGames: [],
    completedAt: null,
  };
  return { ...getRefreshRequest(), accepted: true, retryAfterSeconds: 0 };
}

function getRefreshRequest() {
  return refreshRequest ? {
    id: refreshRequest.id,
    requestedAt: refreshRequest.requestedAt,
    completedGames: [...refreshRequest.completedGames],
    completedAt: refreshRequest.completedAt,
  } : null;
}

function markRefreshGameComplete(gameName, refreshId) {
  if (
    !refreshRequest
    || refreshRequest.id !== String(refreshId || "")
    || !GAME_NAMES.includes(gameName)
    || refreshRequest.completedAt
  ) return null;
  if (!refreshRequest.completedGames.includes(gameName)) refreshRequest.completedGames.push(gameName);
  if (refreshRequest.completedGames.length < GAME_NAMES.length) return null;
  refreshRequest.completedAt = new Date().toISOString();
  return {
    ...getRefreshRequest(),
    requestedBy: refreshRequest.requestedBy,
  };
}

function setMinimumReadyTablesForTest(gameName, minimum) {
  if (!games.has(gameName) || !Number.isInteger(minimum) || minimum < 1) return false;
  MIN_READY_TABLES.set(gameName, minimum);
  return true;
}

function invalidateSession() {
  detailWaiters.forEach((waiters) => waiters.forEach((waiter) => {
    clearTimeout(waiter.timer);
    waiter.resolve(null);
  }));
  detailWaiters.clear();
  games.forEach((state) => {
    state.updatedAt = null;
    state.fullScanAt = null;
    state.pendingScan = null;
    state.tables.forEach((table) => {
      table.detailUpdatedAt = null;
    });
  });
  return true;
}

function resetForTest() {
  detailWaiters.forEach((waiters) => waiters.forEach((waiter) => {
    clearTimeout(waiter.timer);
    waiter.resolve(null);
  }));
  detailWaiters.clear();
  games.forEach((state) => {
    state.tables = new Map();
    state.pendingScan = null;
    state.spins = new Map();
    state.featureMonitors = new Map();
    state.updatedAt = null;
    state.fullScanAt = null;
    state.dataMode = null;
    state.relayVersion = null;
    state.sourcePagesCovered = 0;
    state.sourcePageCount = 0;
  });
  refreshRequest = null;
  refreshSequence = 0;
}

const SUPPORTED_GAMES = new Set(GAME_NAMES);

module.exports = {
  GAME_NAMES,
  SUPPORTED_GAMES,
  ingestTables,
  ingestUpdates,
  ingestDetail,
  ingestSpin,
  getGame,
  getEmptyRooms,
  hasFreshData,
  hasFreshRoomDetail,
  hasReadyData,
  getSnapshot,
  waitForRoomDetail,
  requestFullRefresh,
  getRefreshRequest,
  markRefreshGameComplete,
  invalidateSession,
  setMinimumReadyTablesForTest,
  normalizeTable,
  resetForTest,
};
