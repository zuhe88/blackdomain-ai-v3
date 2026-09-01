const EventEmitter = require("events");
const { MT_ROOMS } = require("./constants");

const tables = new Map();
const events = new EventEmitter();
events.setMaxListeners(50);
let updatedAt = null;
const DEFAULT_FRESHNESS_MS = 15 * 1000;

function freshnessMs() {
  const configured = Number(process.env.MT_DATA_FRESHNESS_MS);
  return Number.isFinite(configured) && configured >= 1000
    ? configured
    : DEFAULT_FRESHNESS_MS;
}

function isTimestampFresh(value, now = Date.now(), maxAgeMs = freshnessMs()) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp)
    && now - timestamp >= 0
    && now - timestamp <= maxAgeMs;
}

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
      roundIndex: index + 1,
    }))
    .filter((record) => record.result)
    .slice(-200);
}

function decorateHistory(history, tableId, shoeKey) {
  return history.map((record, index) => {
    const roundIndex = Number.isInteger(record.roundIndex) ? record.roundIndex : index + 1;
    return {
      ...record,
      shoeKey,
      roundIndex,
      eventKey: `MT:${tableId}:${shoeKey}:${roundIndex}`,
    };
  });
}

function sameHistory(left = [], right = []) {
  return left.length === right.length && left.every((record, index) => (
    record.eventKey === right[index]?.eventKey
    && record.gameNo === right[index]?.gameNo
    && record.result === right[index]?.result
  ));
}

const MAX_RETIRED_SHOE_IDS = 8;
const MAX_RETIRED_HISTORIES = 6;

function sameLogicalRecord(left, right) {
  return left?.result === right?.result;
}

function sameLogicalHistory(left = [], right = []) {
  return left.length === right.length
    && left.every((record, index) => sameLogicalRecord(record, right[index]));
}

function historyStartsWith(history = [], prefix = []) {
  return prefix.length <= history.length
    && prefix.every((record, index) => sameLogicalRecord(record, history[index]));
}

function alignGameNo(record, absoluteRoundIndex) {
  const gameNo = String(record?.gameNo || "");
  const localRoundIndex = Number(record?.roundIndex);
  if (/^\d+$/.test(gameNo) && Number(gameNo) === localRoundIndex) {
    return String(absoluteRoundIndex);
  }
  const scoped = gameNo.match(/^(.*:)(\d+)$/);
  if (scoped && Number(scoped[2]) === localRoundIndex) {
    return `${scoped[1]}${absoluteRoundIndex}`;
  }
  return record?.gameNo;
}

function alignCappedHistory(previousHistory, candidateHistory) {
  if (
    previousHistory.length !== 200
    || candidateHistory.length !== 200
    || !previousHistory.slice(1).every((record, index) => (
      sameLogicalRecord(record, candidateHistory[index])
    ))
  ) {
    return candidateHistory;
  }
  const previousLatest = previousHistory[previousHistory.length - 1];
  const firstRoundIndex = Number(previousLatest?.roundIndex) - 198;
  if (!Number.isInteger(firstRoundIndex) || firstRoundIndex < 1) return candidateHistory;
  return candidateHistory.map((record, index) => {
    const roundIndex = firstRoundIndex + index;
    return {
      ...record,
      gameNo: alignGameNo(record, roundIndex),
      roundIndex,
    };
  });
}

function isCurrentContinuation(previousHistory, candidateHistory) {
  if (!previousHistory.length) return candidateHistory.length > 0;
  if (candidateHistory.length > previousHistory.length) {
    return historyStartsWith(candidateHistory, previousHistory);
  }
  return previousHistory.length === 200
    && candidateHistory.length === 200
    && previousHistory.slice(1).every((record, index) => (
      sameLogicalRecord(record, candidateHistory[index])
    ));
}

function isContinuousAppend(previousHistory, candidateHistory) {
  const latest = candidateHistory[candidateHistory.length - 1];
  if (!previousHistory.length) {
    return candidateHistory.length === 1 && latest?.roundIndex === 1;
  }
  const previousLatest = previousHistory[previousHistory.length - 1];
  return isCurrentContinuation(previousHistory, candidateHistory)
    && latest?.roundIndex === previousLatest?.roundIndex + 1
    && (
      candidateHistory.length === previousHistory.length + 1
      || (candidateHistory.length === 200 && previousHistory.length === 200)
    );
}

function firstReplacementRound(previousHistory, candidateHistory) {
  const sharedLength = Math.min(previousHistory.length, candidateHistory.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (!sameLogicalRecord(previousHistory[index], candidateHistory[index])) {
      return Number(candidateHistory[index]?.roundIndex)
        || Number(previousHistory[index]?.roundIndex)
        || index + 1;
    }
  }
  return Number(candidateHistory[sharedLength]?.roundIndex)
    || Number(previousHistory[sharedLength]?.roundIndex)
    || sharedLength + 1;
}

function historyTokens(history = []) {
  return history.map((record) => record.result);
}

function tokensStartWith(history = [], prefix = []) {
  return prefix.length <= history.length
    && prefix.every((token, index) => token === history[index]);
}

function matchesRetiredHistory(
  candidateHistory,
  currentHistory,
  retiredHistories = [],
  rejectCurrentContinuation = true,
) {
  const candidateTokens = historyTokens(candidateHistory);
  const continuesCurrent = isCurrentContinuation(currentHistory, candidateHistory);
  if (continuesCurrent && !rejectCurrentContinuation) return false;
  return retiredHistories.some((retired) => (
    tokensStartWith(candidateTokens, retired.tokens)
    || (!continuesCurrent && tokensStartWith(retired.tokens, candidateTokens))
  ));
}

function addBoundedUnique(items, value, limit) {
  if (!value) return [...items].slice(-limit);
  return [...items.filter((item) => item !== value), value].slice(-limit);
}

function retireCurrentState(current) {
  let retiredShoeBaseIds = [...(current.retiredShoeBaseIds || [])];
  let retiredHistories = (current.retiredHistories || []).map((entry) => ({
    ...entry,
    tokens: [...entry.tokens],
  }));
  retiredShoeBaseIds = addBoundedUnique(
    retiredShoeBaseIds,
    current.explicitShoeId
      || (current.shoe != null && current.shoe !== "shoe" ? String(current.shoe) : null),
    MAX_RETIRED_SHOE_IDS,
  );
  const tokens = historyTokens(current.history || []);
  if (tokens.length) {
    const fingerprint = `${tokens.length}:${tokens.join("\u001e")}`;
    retiredHistories = [
      ...retiredHistories.filter((entry) => entry.fingerprint !== fingerprint),
      {
        shoeBaseKey: current.shoeBaseKey || null,
        shoeGeneration: Number(current.shoeGeneration || 0),
        fingerprint,
        tokens: [...tokens],
      },
    ].slice(-MAX_RETIRED_HISTORIES);
  }
  return { retiredShoeBaseIds, retiredHistories };
}

function roundMarker(value) {
  const marker = Number(value);
  return Number.isInteger(marker) && marker >= 0 ? marker : null;
}

function isCappedRollback(previousHistory, candidateHistory) {
  if (previousHistory.length !== 200 || candidateHistory.length !== 200) return false;
  for (let shift = 1; shift <= 20; shift += 1) {
    const overlap = 200 - shift;
    if (candidateHistory.slice(shift).every((record, index) => (
      sameLogicalRecord(record, previousHistory[index])
    )) && overlap >= 180) return true;
  }
  return false;
}

function confirmsPendingImplicitReset(pending, candidateHistory, incomingRoundMarker) {
  if (!pending || incomingRoundMarker == null || incomingRoundMarker > 5) return false;
  if (
    pending.roundMarker == null
    || incomingRoundMarker <= pending.roundMarker
    || candidateHistory.length <= pending.history.length
  ) return false;
  return historyStartsWith(candidateHistory, pending.history);
}

function isLikelyImplicitShoeReset(
  previousHistory,
  candidateHistory,
  previousRoundMarker,
  incomingRoundMarker,
) {
  const isShortReset = previousHistory.length >= 10
    && candidateHistory.length > 0
    && candidateHistory.length <= 5
    && candidateHistory.length < previousHistory.length;
  if (!isShortReset) return false;
  const sourceRoundReset = previousRoundMarker >= 10
    && incomingRoundMarker != null
    && incomingRoundMarker <= 5
    && incomingRoundMarker < previousRoundMarker;
  return sourceRoundReset || !historyStartsWith(previousHistory, candidateHistory);
}

function emitResultEvent(
  next,
  previousHistory,
  hadCurrent,
  transitionReason = null,
  transitionMeta = {},
) {
  const history = next.history.map((record) => ({ ...record }));
  const latest = history[history.length - 1] || null;
  if (!latest || sameHistory(previousHistory, history)) return;

  const previousLatest = previousHistory[previousHistory.length - 1] || null;
  const isContinuous = hadCurrent
    && !transitionReason
    && isContinuousAppend(previousHistory, history);
  let resyncReason = null;
  if (!isContinuous) {
    if (!hadCurrent) resyncReason = "initial_snapshot";
    else if (transitionReason) resyncReason = transitionReason;
    else if (previousLatest && latest.roundIndex > previousLatest.roundIndex + 1) {
      resyncReason = "round_gap";
    } else if (!previousLatest && latest.roundIndex > 1) {
      resyncReason = "round_gap";
    } else {
      resyncReason = "snapshot_replaced";
    }
  }

  events.emit("result", {
    room: next.room,
    tableId: next.tableId,
    gameNo: latest.gameNo,
    result: latest.result,
    updatedAt: next.updatedAt,
    eventKey: latest.eventKey,
    shoeKey: latest.shoeKey,
    roundIndex: latest.roundIndex,
    previousGameNo: previousLatest?.gameNo || null,
    previousEventKey: previousLatest?.eventKey || null,
    isContinuous,
    resyncReason,
    replacementFromRoundIndex: transitionMeta.replacementFromRoundIndex || null,
    replacedShoeKey: transitionMeta.replacedShoeKey || null,
    history,
  });
}

function mergeTable(incoming) {
  const tableId = String(incoming?.table_id ?? incoming?.tableId ?? "").trim();
  if (!tableId) return false;
  const storedCurrent = tables.get(tableId);
  const hadCurrent = Boolean(
    storedCurrent
    && isTimestampFresh(storedCurrent.updatedAt, Date.now(), freshnessMs()),
  );
  const tableType = String(incoming.table_type ?? incoming.tableType ?? "").toUpperCase();
  if (tableType && !["BAC", "BAS"].includes(tableType)) {
    tables.delete(tableId);
    return false;
  }

  const incomingRoom = roomFromName(incoming.table_name ?? incoming.tableName);
  const current = hadCurrent ? storedCurrent : { tableId, history: [] };
  const previousHistory = current.history || [];
  const room = incomingRoom || current.room || null;
  if (!room || !MT_ROOMS.includes(room)) {
    tables.delete(tableId);
    return false;
  }

  const incomingShoe = incoming.shoe ?? incoming.shoe_id;
  const incomingExplicitShoeId = incomingShoe != null ? String(incomingShoe) : null;
  const currentExplicitShoeId = current.explicitShoeId || null;
  const retiredShoeBaseIds = [...(current.retiredShoeBaseIds || [])];
  const retiredHistories = (current.retiredHistories || []).map((entry) => ({
    ...entry,
    tokens: [...entry.tokens],
  }));
  if (
    incomingExplicitShoeId
    && currentExplicitShoeId
    && incomingExplicitShoeId !== currentExplicitShoeId
    && retiredShoeBaseIds.includes(incomingExplicitShoeId)
  ) {
    return false;
  }
  const explicitShoeChanged = Boolean(
    incomingExplicitShoeId
    && currentExplicitShoeId
    && incomingExplicitShoeId !== currentExplicitShoeId
  );
  const shoe = incomingShoe ?? current.shoe ?? "shoe";
  const incomingTrend = incoming.trend;
  const hasRoadSnapshot = incomingTrend != null
    && (
      Object.prototype.hasOwnProperty.call(incomingTrend, "bead_plate2")
      || Object.prototype.hasOwnProperty.call(incomingTrend, "bead_plate")
    );
  const trend = explicitShoeChanged
    ? incomingTrend || {}
    : incomingTrend || current.trend || {};
  const rawHistory = hasRoadSnapshot || explicitShoeChanged
    ? normalizeHistory(
      trend.bead_plate2 ?? trend.bead_plate,
      explicitShoeChanged ? String(shoe) : current.shoeBaseKey || String(shoe),
    )
    : previousHistory.map((record) => ({ ...record }));
  const candidateHistory = alignCappedHistory(previousHistory, rawHistory);
  const incomingRoundMarker = roundMarker(incoming.round);
  const previousRoundMarker = roundMarker(current.sourceRoundMarker);
  const sourceRoundAdvanced = incomingRoundMarker != null
    && previousRoundMarker != null
    && incomingRoundMarker > previousRoundMarker;
  const sourceRoundRegressed = incomingRoundMarker != null
    && previousRoundMarker != null
    && incomingRoundMarker < previousRoundMarker;
  const previousLatestRoundIndex = Number(
    previousHistory[previousHistory.length - 1]?.roundIndex,
  );
  const candidateLatestRoundIndex = Number(
    candidateHistory[candidateHistory.length - 1]?.roundIndex,
  );
  const sourceConfirmedRoundAdvance = sourceRoundAdvanced
    && Number.isInteger(previousLatestRoundIndex)
    && Number.isInteger(candidateLatestRoundIndex)
    && candidateLatestRoundIndex > previousLatestRoundIndex;
  const shortResetCandidate = previousHistory.length >= 10
    && candidateHistory.length > 0
    && candidateHistory.length <= 5
    && candidateHistory.length < previousHistory.length;
  const sourceRoundReset = shortResetCandidate
    && previousRoundMarker >= 10
    && incomingRoundMarker != null
    && incomingRoundMarker < previousRoundMarker;
  const matchingCurrentPrefix = shortResetCandidate
    && historyStartsWith(previousHistory, candidateHistory);
  const pendingResetConfirmed = confirmsPendingImplicitReset(
    current.pendingImplicitReset,
    candidateHistory,
    incomingRoundMarker,
  );
  const emptyResetConfirmed = current.emptyResetPending === true
    && shortResetCandidate;
  const ambiguousMatchingReset = !explicitShoeChanged
    && hasRoadSnapshot
    && sourceRoundReset
    && matchingCurrentPrefix
    && !emptyResetConfirmed
    && !pendingResetConfirmed;
  const implicitShoeReset = !explicitShoeChanged
    && hasRoadSnapshot
    && (
      emptyResetConfirmed
      || pendingResetConfirmed
      || isLikelyImplicitShoeReset(
        previousHistory,
        candidateHistory,
        previousRoundMarker,
        incomingRoundMarker,
      )
    );
  if (ambiguousMatchingReset) {
    const next = {
      ...current,
      ...incoming,
      tableId,
      room,
      tableType: tableType || current.tableType || null,
      tableName: incoming.table_name ?? incoming.tableName ?? current.tableName ?? null,
      shoe,
      trend: current.trend || {},
      explicitShoeId: incomingExplicitShoeId || currentExplicitShoeId,
      pendingImplicitReset: {
        roundMarker: incomingRoundMarker,
        history: candidateHistory.map((record) => ({ ...record })),
      },
      sourceRoundMarker: previousRoundMarker,
      updatedAt: new Date().toISOString(),
    };
    tables.set(tableId, next);
    updatedAt = next.updatedAt;
    return true;
  }
  if (
    hadCurrent
    && !explicitShoeChanged
    && hasRoadSnapshot
    && previousHistory.length >= 10
    && candidateHistory.length === 0
  ) {
    const next = {
      ...current,
      ...incoming,
      tableId,
      room,
      tableType: tableType || current.tableType || null,
      tableName: incoming.table_name ?? incoming.tableName ?? current.tableName ?? null,
      shoe,
      trend: current.trend || {},
      explicitShoeId: incomingExplicitShoeId || currentExplicitShoeId,
      emptyResetPending: true,
      sourceRoundMarker: incomingRoundMarker ?? previousRoundMarker,
      updatedAt: new Date().toISOString(),
    };
    tables.set(tableId, next);
    updatedAt = next.updatedAt;
    return true;
  }
  if (
    hadCurrent
    && !explicitShoeChanged
    && !implicitShoeReset
    && hasRoadSnapshot
    && sourceRoundRegressed
  ) {
    return false;
  }
  if (
    hadCurrent
    && !explicitShoeChanged
    && !implicitShoeReset
    && hasRoadSnapshot
    && sameLogicalHistory(previousHistory, candidateHistory)
    && !sourceConfirmedRoundAdvance
  ) {
    const next = {
      ...current,
      ...incoming,
      tableId,
      room,
      tableType: tableType || current.tableType || null,
      tableName: incoming.table_name ?? incoming.tableName ?? current.tableName ?? null,
      shoe,
      trend,
      explicitShoeId: incomingExplicitShoeId || currentExplicitShoeId,
      emptyResetPending: false,
      pendingImplicitReset: null,
      sourceRoundMarker: incomingRoundMarker ?? previousRoundMarker,
      updatedAt: new Date().toISOString(),
    };
    tables.set(tableId, next);
    updatedAt = next.updatedAt;
    return true;
  }
  if (
    hadCurrent
    && !explicitShoeChanged
    && !implicitShoeReset
    && hasRoadSnapshot
    && !sourceConfirmedRoundAdvance
    && isCappedRollback(previousHistory, candidateHistory)
  ) {
    return false;
  }
  if (
    hasRoadSnapshot
    && !explicitShoeChanged
    && matchesRetiredHistory(
      candidateHistory,
      previousHistory,
      retiredHistories,
      !currentExplicitShoeId,
    )
  ) {
    return false;
  }

  let transitionReason = explicitShoeChanged || implicitShoeReset ? "shoe_changed" : null;
  if (!transitionReason && hasRoadSnapshot && previousHistory.length) {
    if (!candidateHistory.length || candidateHistory.length < previousHistory.length) {
      return false;
    }
    if (!isCurrentContinuation(previousHistory, candidateHistory)) {
      transitionReason = "snapshot_replaced";
    }
  }
  const startsNewGeneration = Boolean(transitionReason);
  const replacementFromRoundIndex = transitionReason === "snapshot_replaced"
    ? firstReplacementRound(previousHistory, candidateHistory)
    : null;
  const shoeGeneration = Number(current.shoeGeneration || 0)
    + (hadCurrent && startsNewGeneration ? 1 : 0);
  const shoeBaseKey = explicitShoeChanged
    ? String(shoe)
    : current.shoeBaseKey || String(shoe);
  const shoeKey = `${shoeBaseKey}:g${shoeGeneration}`;
  const history = hasRoadSnapshot || startsNewGeneration
    ? decorateHistory(candidateHistory, tableId, shoeKey)
    : candidateHistory;
  const retired = startsNewGeneration ? retireCurrentState(current) : {
    retiredShoeBaseIds,
    retiredHistories,
  };
  const eventTransitionReason = transitionReason || (
    history.length ? current.pendingResyncReason || null : null
  );
  const next = {
    ...current,
    ...incoming,
    tableId,
    room,
    tableType: tableType || current.tableType || null,
    tableName: incoming.table_name ?? incoming.tableName ?? current.tableName ?? null,
    shoe,
    shoeBaseKey,
    shoeGeneration,
    shoeKey,
    explicitShoeId: incomingExplicitShoeId || currentExplicitShoeId,
    retiredShoeBaseIds: [...retired.retiredShoeBaseIds],
    retiredHistories: retired.retiredHistories.map((entry) => ({
      ...entry,
      tokens: [...entry.tokens],
    })),
    sourceRoundMarker: startsNewGeneration
      ? incomingRoundMarker
      : incomingRoundMarker ?? previousRoundMarker,
    emptyResetPending: false,
    pendingImplicitReset: null,
    pendingResyncReason: history.length
      ? null
      : transitionReason || current.pendingResyncReason || null,
    trend,
    history,
    updatedAt: new Date().toISOString(),
  };
  tables.set(tableId, next);
  updatedAt = next.updatedAt;

  emitResultEvent(next, previousHistory, hadCurrent, eventTransitionReason, {
    replacementFromRoundIndex,
    replacedShoeKey: replacementFromRoundIndex ? current.shoeKey || null : null,
  });
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
  const table = [...tables.values()]
    .filter((item) => item.room === normalized)
    .sort((left, right) => (
      Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0)
      || right.history.length - left.history.length
    ))[0];
  return table ? {
    ...table,
    trend: { ...table.trend },
    history: table.history.map((record) => ({ ...record })),
    retiredShoeBaseIds: [...(table.retiredShoeBaseIds || [])],
    retiredHistories: (table.retiredHistories || []).map((entry) => ({
      ...entry,
      tokens: [...entry.tokens],
    })),
  } : null;
}

function isRoomFresh(room, now = Date.now(), maxAgeMs = freshnessMs()) {
  const table = getTableByRoom(room);
  return Boolean(
    table
    && table.history.length
    && isTimestampFresh(updatedAt, now, maxAgeMs)
    && isTimestampFresh(table.updatedAt, now, maxAgeMs)
  );
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
        latestEventKey: table.history[table.history.length - 1]?.eventKey || null,
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
  isRoomFresh,
  isTimestampFresh,
  normalizeHistory,
  onResult,
  resetForTest,
  roomFromName,
};
