const { push, reply } = require("../../services/line");
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
  resetSession,
  setPlatform,
  setRoom,
  setCapital,
  setMaxBet,
  setMode,
  setStep,
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
  restartQuickReply,
} = require("./quickReply");
const { firstAnalysis, nextAnalysis, getReason } = require("./ai");
const { COMMANDS, MODES, DG_ROOMS, MT_ROOMS } = require("./constants");
const dgSource = require("./dgSource");
const mtSource = require("./mtSource");

function roomsForPlatform(platform) {
  return platform === "DG" ? DG_ROOMS : MT_ROOMS;
}

function roomPrompt(platform) {
  return baccaratRoomFlex(platform, roomsForPlatform(platform));
}

function roomStatsFor(session) {
  const source = session.platform === "DG" ? dgSource : mtSource;
  return source.getRoomStats(session.room);
}

function liveResultOptions(session) {
  const source = session.platform === "DG" ? dgSource : mtSource;
  const table = source.getTableByRoom(session.room);
  if (table?.history.length) {
    session.lastLiveGameNo = table.history[table.history.length - 1].gameNo;
  }
  return {
    autoResult: true,
    quickReply: restartQuickReply(),
  };
}

function hydrateLiveHistory(session) {
  const source = session.platform === "DG" ? dgSource : mtSource;
  const table = source.getTableByRoom(session.room);
  if (!table?.history.length) return session;
  session.history = table.history.slice(-50).map((record) => record.result);
  session.lastLiveGameNo = table.history[table.history.length - 1].gameNo;
  return session;
}

async function settleLiveResult(platform, event) {
  const targets = listActiveSessions().filter((session) => (
    session.platform === platform
    && session.room === event.room
    && session.step === "playing"
    && session.lastPrediction
    && session.lastLiveGameNo !== event.gameNo
  ));

  await Promise.all(targets.map(async (session) => {
    const result = nextAnalysis(session, event.result);
    result.session.lastLiveGameNo = event.gameNo;
    updateAfterRound(session.userId, result.session);
    await push(session.userId, baccaratAnalysisFlex({
      session: result.session,
      prediction: result.prediction,
      bet: result.bet,
      reason: getReason(result.session),
      roomStats: roomStatsFor(result.session),
      ...liveResultOptions(result.session),
    }));
  }));
}

dgSource.onResult((event) => {
  settleLiveResult("DG", event).catch((error) => {
    console.error("[DG] Auto settlement failed:", error.message);
  });
});

mtSource.onResult((event) => {
  settleLiveResult("MT", event).catch((error) => {
    console.error("[MT] Auto settlement failed:", error.message);
  });
});

function capitalPrompt() {
  return baccaratPromptFlex({
    title: "請輸入本金",
    lines: ["本金只能輸入整數，不可為 0、負數、小數或文字。", "範例：1000、3000"],
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
    resetSession(userId);
    return reply(token, baccaratPlatformFlex(platformQuickReply()));
  }

  if (value === "重新開始") {
    const platform = hasActiveSession(userId) ? getSession(userId).platform : null;
    resetSession(userId);
    if (!platform) return reply(token, baccaratPlatformFlex(platformQuickReply()));
    setPlatform(userId, platform);
    return reply(token, roomPrompt(platform));
  }

  if (isCancel(value)) {
    resetSession(userId);
    return false;
  }

  if (COMMANDS.includes(value)) {
    resetSession(userId);
    return reply(token, baccaratPlatformFlex(platformQuickReply()));
  }

  const session = getSession(userId);

  if (value === "返回房號" && session.platform) {
    setStep(userId, "room");
    return reply(token, roomPrompt(session.platform));
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
    const updated = setMaxBet(userId, maxBet);
    const first = firstAnalysis(hydrateLiveHistory(updated));
    liveResultOptions(first.session);
    updateAfterRound(userId, first.session);
    return reply(token, baccaratAnalysisFlex({
      session: first.session,
      prediction: first.prediction,
      bet: first.bet,
      reason: getReason(first.session),
      roomStats: roomStatsFor(first.session),
      ...liveResultOptions(first.session),
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
      return reply(token, capitalPrompt());
    }
    const first = firstAnalysis(hydrateLiveHistory(updated));
    liveResultOptions(first.session);
    updateAfterRound(userId, first.session);
    return reply(token, baccaratAnalysisFlex({
      session: first.session,
      prediction: first.prediction,
      bet: first.bet,
      reason: getReason(first.session),
      roomStats: roomStatsFor(first.session),
      ...liveResultOptions(first.session),
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
        title: "請回報本局結果",
        lines: ["請點選或輸入：閒、和、莊。"],
        quickReply: resultQuickReply(),
      }));
    }
    const result = nextAnalysis(session, value);
    updateAfterRound(userId, result.session);
    if (result.session.bankroll <= 0 && result.session.mode !== "自由配注") {
      resetSession(userId);
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
      ...liveResultOptions(result.session),
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

module.exports = {
  handleBaccaratMessage,
  isBaccaratCommand,
  hasActiveBaccaratSession: hasActiveSession,
  resetBaccaratSession: resetSession,
};
