const { pushStrict, reply } = require("../../services/line");
const {
  baccaratPromptFlex,
  baccaratPlatformFlex,
  baccaratRoomFlex,
  baccaratAnalysisFlex,
} = require("../../ui/flex/baccarat");
const {
  getSession,
  hasActiveSession,
  listActiveSessions,
  resetSession: resetStoredSession,
  setPlatform,
  setRoom,
  setCapital,
  setMaxBet,
  setMode,
  updateAfterRound,
} = require("./session");
const {
  normalizeRoom,
  validateRoom,
  parseMoney,
  validateMaxBet,
  isResult,
  isMode,
  isCancel,
} = require("./utils");
const {
  platformQuickReply,
  modeQuickReply,
  resultQuickReply,
  restartQuickReply,
} = require("./quickReply");
const {
  firstAnalysis,
  nextAnalysis,
  getReason,
  applyResult,
  getTianmenRequirements,
  MIN_TIANMEN_BANKROLL,
} = require("./ai");
const { COMMANDS, MODES, DG_ROOMS, MT_ROOMS } = require("./constants");
const dgSource = require("./dgSource");
const mtSource = require("./mtSource");
const liveSettlementQueues = new Map();
const cancellationBarriers = new Map();
const TERMINAL_FUNDING_REASON_CODES = new Set([
  "INSUFFICIENT_TIANMEN_BANKROLL",
  "INSUFFICIENT_TIANMEN_MAX_BET",
  "INSUFFICIENT_BET_LIMIT",
]);

function roomsForPlatform(platform) {
  const configured = platform === "DG" ? DG_ROOMS : MT_ROOMS;
  const source = platform === "DG" ? dgSource : mtSource;
  const observed = new Set(source.getSnapshot().tables.map((table) => table.room));
  if (!observed.size) return configured;
  return configured.filter((room) => observed.has(room) && source.isRoomFresh(room));
}

function roomIsObservedWhenSourceOnline(platform, room) {
  const source = platform === "DG" ? dgSource : mtSource;
  const observed = new Set(source.getSnapshot().tables.map((table) => table.room));
  return !observed.size || observed.has(room);
}

function roomPrompt(platform) {
  return baccaratRoomFlex(platform, roomsForPlatform(platform));
}

function roomStatsFor(session) {
  const source = session.platform === "DG" ? dgSource : mtSource;
  return source.getRoomStats(session.room);
}

function liveDataIsFresh(session) {
  const source = session.platform === "DG" ? dgSource : mtSource;
  return source.isRoomFresh(session.room);
}

function liveSyncPrompt(session) {
  return baccaratPromptFlex({
    title: `${session.platform} 即時資料同步中`,
    lines: [
      `${session.room} 目前尚未收到新的即時桌況`,
      "系統不會使用上一局或逾時資料產生推薦",
      "收到新資料後才會自動回傳本房分析",
    ],
    quickReply: restartQuickReply(),
  });
}

function waitForFreshLiveData(userId, session) {
  const waiting = {
    ...session,
    history: [],
    lastPrediction: null,
    lastBet: 0,
    lastPredictionMeta: null,
    lastLiveEventKey: null,
    lastLiveGameNo: null,
    lastLiveShoeKey: null,
    lastLiveRoundIndex: null,
    waitingForFreshData: true,
  };
  updateAfterRound(userId, waiting);
  return waiting;
}

function liveResultOptions() {
  return {
    autoResult: true,
    quickReply: restartQuickReply(),
  };
}

function bindLiveCursor(session, record = {}) {
  session.lastLiveEventKey = record.eventKey || null;
  session.lastLiveGameNo = record.gameNo || null;
  session.lastLiveShoeKey = record.shoeKey || null;
  session.lastLiveRoundIndex = Number.isInteger(Number(record.roundIndex))
    ? Number(record.roundIndex)
    : null;
  return session;
}

function hydrateLiveHistory(session) {
  const source = session.platform === "DG" ? dgSource : mtSource;
  const table = source.getTableByRoom(session.room);
  if (!table?.history.length) return session;
  session.history = table.history.slice(-50).map((record) => record.result);
  return bindLiveCursor(session, table.history[table.history.length - 1]);
}

function cloneSession(session) {
  return {
    ...session,
    history: Array.isArray(session.history) ? [...session.history] : [],
    results: { ...(session.results || {}) },
    lastBetMeta: session.lastBetMeta ? { ...session.lastBetMeta } : null,
    lastPredictionMeta: session.lastPredictionMeta
      ? { ...session.lastPredictionMeta }
      : null,
    lastSettlement: session.lastSettlement ? { ...session.lastSettlement } : null,
    predictionAudit: Array.isArray(session.predictionAudit)
      ? session.predictionAudit.map((record) => ({
        ...record,
        stateBefore: record.stateBefore ? {
          ...record.stateBefore,
          results: { ...(record.stateBefore.results || {}) },
          lastSettlement: record.stateBefore.lastSettlement
            ? { ...record.stateBefore.lastSettlement }
            : null,
        } : null,
      }))
      : [],
  };
}

function hydrateFromLiveEvent(session, event) {
  if (!Array.isArray(event.history) || !event.history.length) {
    return hydrateLiveHistory(session);
  }
  session.history = event.history
    .map((record) => (typeof record === "string" ? record : record?.result))
    .filter((result) => result === "莊" || result === "閒" || result === "和")
    .slice(-50);
  return bindLiveCursor(session, event);
}

function roomStatsFromEvent(event, fallbackSession) {
  if (!Array.isArray(event.history) || !event.history.length) {
    return roomStatsFor(fallbackSession);
  }
  const stats = { banker: 0, player: 0, tie: 0, total: 0 };
  event.history.forEach((record) => {
    const result = typeof record === "string" ? record : record?.result;
    if (result === "莊") stats.banker += 1;
    if (result === "閒") stats.player += 1;
    if (result === "和") stats.tie += 1;
  });
  stats.total = stats.banker + stats.player + stats.tie;
  return stats;
}

function isSameActiveSession(expected) {
  if (!hasActiveSession(expected.userId)) return false;
  const current = getSession(expected.userId);
  return current.sessionEpoch === expected.sessionEpoch
    && current.platform === expected.platform
    && current.room === expected.room
    && current.step === "playing";
}

function isExpectedNextEvent(session, event) {
  if (event.isContinuous !== true) return false;
  if (session.lastLiveEventKey && event.previousEventKey) {
    return session.lastLiveEventKey === event.previousEventKey;
  }
  return Boolean(
    session.lastLiveGameNo
    && event.previousGameNo
    && session.lastLiveGameNo === event.previousGameNo
  );
}

function resyncNotice(reason) {
  if (reason === "shoe_changed") return "新牌靴已同步，未跨靴計算過倒";
  if (reason === "round_gap") return "缺漏局已略過，本次未計算過倒";
  if (reason === "snapshot_recalculated") return "路單修正已同步，既有統計已重新計算";
  if (reason === "snapshot_reset") return "路單修正已同步，舊版統計已安全重置";
  return "最新路單已同步，本次未計算過倒";
}

function captureSettlementState(session) {
  return {
    results: { ...(session.results || {}) },
    bankroll: session.bankroll,
    tianmenLevel: session.tianmenLevel,
    lastSettlement: session.lastSettlement ? { ...session.lastSettlement } : null,
  };
}

function restoreSettlementState(session, state = {}) {
  session.results = { ...(state.results || {}) };
  session.bankroll = state.bankroll;
  session.tianmenLevel = state.tianmenLevel;
  session.lastSettlement = state.lastSettlement ? { ...state.lastSettlement } : null;
  return session;
}

function appendPredictionAudit(session, event, issued = {}, stateBefore = null) {
  const previous = Array.isArray(session.predictionAudit) ? session.predictionAudit : [];
  session.predictionAudit = [...previous, {
    platform: session.platform,
    room: session.room,
    eventKey: event.eventKey || null,
    shoeKey: event.shoeKey || null,
    roundIndex: Number(event.roundIndex) || null,
    prediction: issued.prediction || null,
    bet: Number(issued.bet) || 0,
    modelVersion: issued.meta?.modelVersion || null,
    confidence: Number(issued.meta?.confidence) || null,
    actual: event.result,
    verdict: session.lastSettlement?.verdict || null,
    stateBefore: stateBefore ? {
      ...stateBefore,
      results: { ...(stateBefore.results || {}) },
      lastSettlement: stateBefore.lastSettlement
        ? { ...stateBefore.lastSettlement }
        : null,
    } : null,
    settledAt: event.updatedAt || new Date().toISOString(),
  }].slice(-100);
  return session;
}

function reconcileReplacement(session, event) {
  const replacementFromRoundIndex = Number(event.replacementFromRoundIndex);
  const replacedShoeKey = String(event.replacedShoeKey || "");
  if (
    event.resyncReason !== "snapshot_replaced"
    || !Number.isInteger(replacementFromRoundIndex)
    || !replacedShoeKey
  ) return null;

  const audits = Array.isArray(session.predictionAudit) ? session.predictionAudit : [];
  const generationAudits = audits.filter((record) => (
    record.platform === session.platform
    && record.room === session.room
    && record.shoeKey === replacedShoeKey
  ));
  if (!generationAudits.length) return null;
  const affected = generationAudits.filter((record) => (
    Number(record.roundIndex) >= replacementFromRoundIndex
  ));

  const firstState = affected[0]?.stateBefore;
  if (affected.length && !firstState) {
    session.results = { pass: 0, fail: 0, tie: 0, observe: 0 };
    session.bankroll = session.mode === "自由配注" ? null : session.startBankroll;
    session.tianmenLevel = 1;
    session.lastSettlement = null;
    session.predictionAudit = [];
    return "snapshot_reset";
  }

  if (affected.length) restoreSettlementState(session, firstState);
  const replacementRecords = new Map(
    (Array.isArray(event.history) ? event.history : [])
      .filter((record) => Number.isInteger(Number(record?.roundIndex)))
      .map((record) => [Number(record.roundIndex), record]),
  );
  const affectedSet = new Set(affected);
  const generationSet = new Set(generationAudits);
  const reconciledAt = event.updatedAt || new Date().toISOString();
  const nextAudit = [];
  for (const record of audits) {
    if (!generationSet.has(record)) {
      nextAudit.push(record);
      continue;
    }
    const replacement = replacementRecords.get(Number(record.roundIndex));
    if (!affectedSet.has(record)) {
      if (!replacement) {
        nextAudit.push(record);
        continue;
      }
      nextAudit.push({
        ...record,
        eventKey: replacement.eventKey || record.eventKey,
        shoeKey: replacement.shoeKey || event.shoeKey || record.shoeKey,
        reconciledAt,
      });
      continue;
    }
    if (!replacement) continue;
    const stateBefore = captureSettlementState(session);
    session.lastPrediction = record.prediction;
    session.lastBet = Number(record.bet) || 0;
    session.lastPredictionMeta = {
      modelVersion: record.modelVersion || null,
      confidence: Number(record.confidence) || null,
    };
    applyResult(session, replacement.result);
    nextAudit.push({
      ...record,
      eventKey: replacement.eventKey || record.eventKey,
      shoeKey: replacement.shoeKey || event.shoeKey || record.shoeKey,
      actual: replacement.result,
      verdict: session.lastSettlement?.verdict || null,
      stateBefore,
      reconciledAt,
    });
  }
  session.predictionAudit = nextAudit.slice(-100);
  return "snapshot_recalculated";
}

async function deliverLiveAnalysis(originalSession, analysis, event, notice = null) {
  if (!isSameActiveSession(originalSession)) return false;
  const message = baccaratAnalysisFlex({
    session: analysis.session,
    prediction: analysis.prediction,
    bet: analysis.bet,
    reason: getReason(analysis.session),
    roomStats: roomStatsFromEvent(event, analysis.session),
    notice,
    ...liveResultOptions(),
  });
  await pushStrict(originalSession.userId, message);
  if (!isSameActiveSession(originalSession)) return false;
  updateAfterRound(originalSession.userId, analysis.session);
  return true;
}

function hasTerminalFundingIssue(analysis) {
  return TERMINAL_FUNDING_REASON_CODES.has(
    String(analysis?.session?.lastPredictionMeta?.reasonCode || ""),
  );
}

function fundingStopFlex(analysis) {
  const session = analysis.session;
  const bankroll = Number(session.bankroll || 0).toLocaleString("en-US");
  return baccaratPromptFlex({
    title: "資金條件不足，已停止分析",
    lines: [
      getReason(session),
      `目前本金：${bankroll}`,
      "本房自動分析已結束，不會繼續回傳觀望。",
      "請重新選擇百家樂並設定足夠本金與單注上限。",
    ],
    quickReply: restartQuickReply(),
  });
}

async function deliverLiveDecision(originalSession, analysis, event, notice = null) {
  if (!hasTerminalFundingIssue(analysis)) {
    return deliverLiveAnalysis(originalSession, analysis, event, notice);
  }
  if (!isSameActiveSession(originalSession)) return false;
  await pushStrict(originalSession.userId, fundingStopFlex(analysis));
  if (!isSameActiveSession(originalSession)) return false;
  await resetStoredSession(originalSession.userId);
  return true;
}

async function settleLiveResult(platform, event, targetIdentity = null) {
  const targets = listActiveSessions().filter((session) => (
    (
      !targetIdentity
      || (
        session.userId === targetIdentity.userId
        && session.sessionEpoch === targetIdentity.sessionEpoch
      )
    )
    &&
    session.platform === platform
    && session.room === event.room
    && session.step === "playing"
    && (session.lastPrediction || session.waitingForFreshData)
    && (!event.eventKey || session.lastLiveEventKey !== event.eventKey)
  ));

  const deliveries = await Promise.allSettled(targets.map(async (session) => {
    const candidate = cloneSession(session);
    if (candidate.waitingForFreshData) {
      candidate.waitingForFreshData = false;
      const analysis = firstAnalysis(hydrateFromLiveEvent(candidate, event));
      return deliverLiveDecision(session, analysis, event);
    }
    if (!isExpectedNextEvent(session, event)) {
      const reconciliation = reconcileReplacement(candidate, event);
      const analysis = firstAnalysis(hydrateFromLiveEvent(candidate, event));
      return deliverLiveDecision(
        session,
        analysis,
        event,
        resyncNotice(reconciliation || event.resyncReason),
      );
    }

    const issued = {
      prediction: candidate.lastPrediction,
      bet: candidate.lastBet,
      meta: candidate.lastPredictionMeta,
    };
    const stateBefore = captureSettlementState(candidate);
    const analysis = nextAnalysis(candidate, event.result);
    appendPredictionAudit(analysis.session, event, issued, stateBefore);
    bindLiveCursor(analysis.session, event);
    return deliverLiveDecision(session, analysis, event);
  }));
  deliveries
    .filter((delivery) => delivery.status === "rejected")
    .forEach((delivery) => {
      console.error("[Baccarat] Live analysis delivery failed:", delivery.reason?.message || delivery.reason);
    });
  return deliveries.filter((delivery) => delivery.status === "fulfilled" && delivery.value).length;
}

function queueLiveResult(platform, event) {
  const targets = listActiveSessions().filter((session) => (
    session.platform === platform
    && session.room === event.room
    && session.step === "playing"
    && (session.lastPrediction || session.waitingForFreshData)
    && (!event.eventKey || session.lastLiveEventKey !== event.eventKey)
  ));
  const queuedDeliveries = targets.map((target) => {
    const targetIdentity = {
      userId: target.userId,
      sessionEpoch: target.sessionEpoch,
    };
    const key = `${platform}:${event.room || event.tableId || "unknown"}:${target.userId}:${target.sessionEpoch}`;
    const previous = liveSettlementQueues.get(key) || Promise.resolve();
    const queued = previous
      .catch(() => {})
      .then(() => settleLiveResult(platform, event, targetIdentity));
    liveSettlementQueues.set(key, queued);
    const clear = () => {
      if (liveSettlementQueues.get(key) === queued) liveSettlementQueues.delete(key);
    };
    queued.then(clear, clear);
    return queued;
  });
  return Promise.allSettled(queuedDeliveries);
}

async function resetBaccaratSession(userId) {
  const active = listActiveSessions().find((session) => session.userId === userId);
  const epoch = active?.sessionEpoch || null;
  const existingBarrier = cancellationBarriers.get(userId);
  const deliveryQueues = epoch
    ? [...liveSettlementQueues.entries()]
      .filter(([key]) => key.endsWith(`:${userId}:${epoch}`))
      .map(([, queue]) => queue)
    : [];
  const barriers = [
    ...(existingBarrier ? [existingBarrier] : []),
    ...deliveryQueues,
  ];
  const deliveryBarrier = barriers.length
    ? Promise.allSettled(barriers)
    : Promise.resolve([]);
  if (barriers.length) {
    cancellationBarriers.set(userId, deliveryBarrier);
    deliveryBarrier.then(() => {
      if (cancellationBarriers.get(userId) === deliveryBarrier) {
        cancellationBarriers.delete(userId);
      }
    });
  }
  const persistence = resetStoredSession(userId);
  const [persistenceResult] = await Promise.allSettled([
    persistence,
    deliveryBarrier,
  ]);
  if (persistenceResult.status === "rejected") throw persistenceResult.reason;
  return persistenceResult.value;
}

dgSource.onResult((event) => {
  queueLiveResult("DG", event).catch((error) => {
    console.error("[DG] Auto settlement failed:", error.message);
  });
});

mtSource.onResult((event) => {
  queueLiveResult("MT", event).catch((error) => {
    console.error("[MT] Auto settlement failed:", error.message);
  });
});

function capitalPrompt(mode = "") {
  const tianmenLines = mode === "天門"
    ? [`天門五關最低本金：${MIN_TIANMEN_BANKROLL.toLocaleString("en-US")}`, "本金不足時不會開始推薦，請重新設定足夠本金。"]
    : [];
  return baccaratPromptFlex({
    title: "請輸入本金",
    lines: [
      ...tianmenLines,
      "本金只能輸入整數，不可為 0、負數、小數或文字。",
      mode === "天門" ? "範例：5700、10000" : "範例：1000、3000",
    ],
  });
}

function maxBetPrompt(capital) {
  return baccaratPromptFlex({
    title: "請輸入單注上限",
    lines: [`目前本金：${capital}`, "單注上限只能輸入整數，AI建議金額不會超過此上限。"],
  });
}

function modePrompt(session) {
  return baccaratPromptFlex({
    title: "請選擇分析模式",
    lines: [
      `平台／房號：${session.platform} ${session.room}`,
      `模式：${MODES.join("、")}`,
      "自由配注可直接開始，不需輸入本金與單注上限。",
    ],
    quickReply: modeQuickReply(),
  });
}

async function handleBaccaratMessage(event) {
  const userId = event.source.userId;
  const value = event.message.text.trim();
  const token = event.replyToken;

  if (value === "返回首頁") {
    await resetBaccaratSession(userId);
    return false;
  }

  if (value === "重新開始") {
    const platform = hasActiveSession(userId) ? getSession(userId).platform : null;
    await resetBaccaratSession(userId);
    if (!platform) return reply(token, baccaratPlatformFlex(platformQuickReply()));
    setPlatform(userId, platform);
    return reply(token, roomPrompt(platform));
  }

  if (isCancel(value)) {
    await resetBaccaratSession(userId);
    return false;
  }

  if (COMMANDS.includes(value)) {
    await resetBaccaratSession(userId);
    return reply(token, baccaratPlatformFlex(platformQuickReply()));
  }

  const session = getSession(userId);

  if (value === "返回房號" && session.platform) {
    const platform = session.platform;
    await resetBaccaratSession(userId);
    setPlatform(userId, platform);
    return reply(token, roomPrompt(platform));
  }

  if (session.step === "platform") {
    const platform = value.toUpperCase();
    if (platform !== "DG" && platform !== "MT") {
      return reply(token, baccaratPromptFlex({
        title: "請選擇平台",
        lines: ["請選擇 DG 或 MT。"],
        quickReply: platformQuickReply(),
      }));
    }
    setPlatform(userId, platform);
    return reply(token, roomPrompt(platform));
  }

  if (session.step === "room") {
    const room = normalizeRoom(session.platform, value);
    if (!validateRoom(session.platform, room)) {
      return reply(token, baccaratPromptFlex({
        title: "房號格式不正確",
        lines: ["房號格式不正確，請選擇下方按鈕或輸入正確房號。"],
      }));
    }
    if (!roomIsObservedWhenSourceOnline(session.platform, room)) {
      return reply(token, baccaratPromptFlex({
        title: "此房目前沒有即時資料",
        lines: [
          `${session.platform} ${room} 目前未出現在即時桌況中`,
          "系統不會讓您進入無資料房間或使用舊資料推薦",
          "請返回房號並選擇目前可用房間",
        ],
        quickReply: restartQuickReply(),
      }));
    }
    const updated = setRoom(userId, room);
    return reply(token, modePrompt(updated));
  }

  if (session.step === "capital") {
    const capital = parseMoney(value);
    if (!capital) {
      return reply(token, baccaratPromptFlex({
        title: "本金格式不正確",
        lines: ["請輸入正整數本金。", "範例：1000、3000"],
      }));
    }
    if (session.mode === "天門" && capital < MIN_TIANMEN_BANKROLL) {
      const shortage = MIN_TIANMEN_BANKROLL - capital;
      return reply(token, baccaratPromptFlex({
        title: "天門本金不足",
        lines: [
          `天門五關最低本金：${MIN_TIANMEN_BANKROLL.toLocaleString("en-US")}`,
          `目前本金：${capital.toLocaleString("en-US")}，尚差 ${shortage.toLocaleString("en-US")}`,
          "本金不足時不會產生推薦，請重新輸入本金。",
        ],
      }));
    }
    setCapital(userId, capital);
    return reply(token, maxBetPrompt(capital));
  }

  if (session.step === "maxBet") {
    const maxBet = parseMoney(value);
    if (!maxBet) {
      return reply(token, baccaratPromptFlex({
        title: "單注上限格式不正確",
        lines: ["請輸入正整數單注上限。"],
      }));
    }
    if (!validateMaxBet(session.capital, maxBet)) {
      return reply(token, baccaratPromptFlex({
        title: "單注上限不正確",
        lines: ["單注上限不可超過本金，且必須大於 0。"],
      }));
    }
    if (session.mode === "天門") {
      const requirements = getTianmenRequirements(session.capital);
      if (maxBet < requirements.requiredMaxBet) {
        return reply(token, baccaratPromptFlex({
          title: "天門單注上限不足",
          lines: [
            `依目前本金，單注上限至少需為 ${requirements.requiredMaxBet.toLocaleString("en-US")}`,
            `目前設定：${maxBet.toLocaleString("en-US")}`,
            "此門檻用於完整執行天門五關，請重新輸入單注上限。",
          ],
        }));
      }
    }
    const updated = setMaxBet(userId, maxBet);
    if (!liveDataIsFresh(updated)) {
      const waiting = waitForFreshLiveData(userId, updated);
      return reply(token, liveSyncPrompt(waiting));
    }
    const first = firstAnalysis(hydrateLiveHistory(updated));
    first.session.waitingForFreshData = false;
    updateAfterRound(userId, first.session);
    return reply(token, baccaratAnalysisFlex({
      session: first.session,
      prediction: first.prediction,
      bet: first.bet,
      reason: getReason(first.session),
      roomStats: roomStatsFor(first.session),
      ...liveResultOptions(),
    }));
  }

  if (session.step === "mode") {
    if (!isMode(value)) {
      return reply(token, baccaratPromptFlex({
        title: "請選擇分析模式",
        lines: [`可用模式：${MODES.join("、")}`],
        quickReply: modeQuickReply(),
      }));
    }
    const updated = setMode(userId, value);
    if (updated.mode !== "自由配注") {
      return reply(token, capitalPrompt(updated.mode));
    }
    if (!liveDataIsFresh(updated)) {
      const waiting = waitForFreshLiveData(userId, updated);
      return reply(token, liveSyncPrompt(waiting));
    }
    const first = firstAnalysis(hydrateLiveHistory(updated));
    first.session.waitingForFreshData = false;
    updateAfterRound(userId, first.session);
    return reply(token, baccaratAnalysisFlex({
      session: first.session,
      prediction: first.prediction,
      bet: first.bet,
      reason: getReason(first.session),
      roomStats: roomStatsFor(first.session),
      ...liveResultOptions(),
    }));
  }

  if (session.step === "playing") {
    if (["DG", "MT"].includes(session.platform) && isResult(value)) {
      return reply(token, baccaratPromptFlex({
        title: `${session.platform} 已啟用自動結算`,
        lines: ["不需要自行回報莊、閒或和，系統會依此房即時開獎自動更新。"],
        quickReply: restartQuickReply(),
      }));
    }
    if (!isResult(value)) {
      return reply(token, baccaratPromptFlex({
        title: "本房自動結算中",
        lines: ["AI 會自動同步開獎，無需手動輸入；請使用下方按鈕操作。"],
        quickReply: resultQuickReply(),
      }));
    }
    const result = nextAnalysis(session, value);
    if (hasTerminalFundingIssue(result)) {
      await resetBaccaratSession(userId);
      return reply(token, fundingStopFlex(result));
    }
    updateAfterRound(userId, result.session);
    if (result.session.bankroll <= 0 && result.session.mode !== "自由配注") {
      await resetBaccaratSession(userId);
      return reply(token, baccaratPromptFlex({
        title: "本金已歸零",
        lines: ["請重新開始並輸入新的本金。"],
        quickReply: restartQuickReply(),
      }));
    }
    return reply(token, baccaratAnalysisFlex({
      session: result.session,
      prediction: result.prediction,
      bet: result.bet,
      reason: getReason(result.session),
      roomStats: roomStatsFor(result.session),
      ...liveResultOptions(),
    }));
  }

  return false;
}

function isBaccaratCommand(value) {
  return [
    ...COMMANDS,
    "DG",
    "MT",
    ...DG_ROOMS,
    ...MT_ROOMS,
    ...MODES,
    "閒",
    "和",
    "莊",
    "重新開始",
    "返回房號",
    "返回首頁",
  ].includes(String(value || "").trim());
}

function activeBaccaratPlatform(userId) {
  return hasActiveSession(userId) ? getSession(userId).platform : null;
}

module.exports = {
  handleBaccaratMessage,
  isBaccaratCommand,
  hasActiveBaccaratSession: hasActiveSession,
  activeBaccaratPlatform,
  resetBaccaratSession,
};
