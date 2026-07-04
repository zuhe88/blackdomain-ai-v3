const { reply } = require("../../services/line");
const {
  baccaratPromptFlex,
  baccaratPlatformFlex,
  baccaratRoomFlex,
  baccaratAnalysisFlex,
} = require("../../ui/flex/baccarat");
const {
  getSession,
  hasActiveSession,
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
  resultQuickReply,
  restartQuickReply,
} = require("./quickReply");
const { firstAnalysis, nextAnalysis, getReason } = require("./ai");
const { COMMANDS, MODES, DG_ROOMS, MT_ROOMS } = require("./constants");

function roomsForPlatform(platform) {
  return platform === "DG" ? DG_ROOMS : MT_ROOMS;
}

function roomPrompt(platform) {
  return baccaratRoomFlex(platform, roomsForPlatform(platform));
}

function capitalPrompt() {
  return baccaratPromptFlex({
    title: "請輸入本金",
    lines: ["本金只能輸入整數，不可為 0、負數、小數或文字。", "範例：1000、3000"],
  });
}

function maxBetPrompt(capital) {
  return baccaratPromptFlex({
    title: "請輸入單注上限",
    lines: [`目前本金：${capital}`, "單注上限只能輸入整數，AI下注不會超過此金額。"],
  });
}

function modePrompt(session) {
  return baccaratPromptFlex({
    title: "請選擇模式",
    lines: [`本金：${session.capital}`, `單注上限：${session.maxBet}`, `模式：${MODES.join("、")}`],
    quickReply: modeQuickReply(),
  });
}

async function handleBaccaratMessage(event) {
  const userId = event.source.userId;
  const incomingText = event.message.text.trim();
  const token = event.replyToken;

  if (isCancel(incomingText)) {
    resetSession(userId);
    return false;
  }

  if (COMMANDS.includes(incomingText)) {
    resetSession(userId);
    return reply(token, baccaratPlatformFlex(platformQuickReply()));
  }

  const session = getSession(userId);

  if (incomingText === "重新開始") {
    resetSession(userId);
    return reply(token, baccaratPlatformFlex(platformQuickReply()));
  }

  if (incomingText === "返回房號" && session.platform) {
    setStep(userId, "room");
    return reply(token, roomPrompt(session.platform));
  }

  if (session.step === "platform") {
    const platform = incomingText.toUpperCase();
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
    const room = normalizeRoom(session.platform, incomingText);
    if (!validateRoom(session.platform, room)) {
      return reply(token, baccaratPromptFlex({
        title: "房號格式不正確",
        lines: ["房號格式不正確，請選擇下方按鈕或輸入正確房號。"],
      }));
    }
    setRoom(userId, room);
    return reply(token, capitalPrompt());
  }

  if (session.step === "capital") {
    const capital = parseMoney(incomingText);
    if (!capital) {
      return reply(token, baccaratPromptFlex({
        title: "本金格式不正確",
        lines: ["請輸入整數本金。", "範例：1000、3000"],
      }));
    }
    setCapital(userId, capital);
    return reply(token, maxBetPrompt(capital));
  }

  if (session.step === "maxBet") {
    const maxBet = parseMoney(incomingText);
    if (!maxBet) {
      return reply(token, baccaratPromptFlex({
        title: "單注上限格式不正確",
        lines: ["請輸入整數單注上限。"],
      }));
    }
    if (!validateMaxBet(session.capital, maxBet)) {
      return reply(token, baccaratPromptFlex({
        title: "單注上限不正確",
        lines: ["單注上限不可超過本金，且必須大於 0。"],
      }));
    }
    const updated = setMaxBet(userId, maxBet);
    return reply(token, modePrompt(updated));
  }

  if (session.step === "mode") {
    if (!isMode(incomingText)) {
      return reply(token, baccaratPromptFlex({
        title: "請選擇模式",
        lines: [`可用模式：${MODES.join("、")}`],
        quickReply: modeQuickReply(),
      }));
    }
    const updated = setMode(userId, incomingText);
    const first = firstAnalysis(updated);
    updateAfterRound(userId, first.session);
    return reply(token, baccaratAnalysisFlex({
      session: first.session,
      prediction: first.prediction,
      bet: first.bet,
      reason: getReason(first.session),
      quickReply: resultQuickReply(),
    }));
  }

  if (session.step === "playing") {
    if (!isResult(incomingText)) {
      return reply(token, baccaratPromptFlex({
        title: "請回報本局結果",
        lines: ["請選擇或輸入：閒、和、莊。"],
        quickReply: resultQuickReply(),
      }));
    }
    const result = nextAnalysis(session, incomingText);
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
      quickReply: resultQuickReply(),
    }));
  }

  return false;
}

function isBaccaratCommand(text) {
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
  ].includes(String(text || "").trim());
}

module.exports = {
  handleBaccaratMessage,
  isBaccaratCommand,
  hasActiveBaccaratSession: hasActiveSession,
  resetBaccaratSession: resetSession,
};
