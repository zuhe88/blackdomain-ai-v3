const { reply } = require("../../services/line");
const {
  baccaratPromptFlex,
  baccaratPlatformFlex,
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
const {
  firstAnalysis,
  nextAnalysis,
  getConfidence,
  getReason,
} = require("./ai");
const { COMMANDS, MODES } = require("./constants");

function roomPrompt(platform) {
  return baccaratPromptFlex({
    title: `${platform} 房號選擇`,
    lines: [
      "請輸入房號。",
      "DG範例：DG01 / RB03 / S05",
      "MT範例：MT01 / MT03 / 3A / 13A",
    ],
  });
}

function capitalPrompt() {
  return baccaratPromptFlex({
    title: "請輸入本金",
    lines: ["本金只能輸入正整數。", "範例：1000 / 3000"],
  });
}

function maxBetPrompt(capital) {
  return baccaratPromptFlex({
    title: "請輸入單注上限",
    lines: [`目前本金：${capital}`, "單注上限只能輸入正整數，且不可超過本金。"],
  });
}

async function handleBaccaratMessage(event) {
  const userId = event.source.userId;
  const incomingText = event.message.text.trim();
  const token = event.replyToken;

  if (isCancel(incomingText) || incomingText === "重新開始") {
    resetSession(userId);

    if (incomingText === "重新開始") {
      return reply(token, baccaratPlatformFlex(platformQuickReply()));
    }

    return false;
  }

  if (COMMANDS.includes(incomingText)) {
    resetSession(userId);
    return reply(token, baccaratPlatformFlex(platformQuickReply()));
  }

  const session = getSession(userId);

  if (incomingText === "返回平台") {
    resetSession(userId);
    return reply(token, baccaratPlatformFlex(platformQuickReply()));
  }

  if (incomingText === "返回房號" && session.platform) {
    setStep(userId, "room");
    return reply(token, roomPrompt(session.platform));
  }

  if (session.step === "platform") {
    if (incomingText !== "DG" && incomingText !== "MT") {
      return reply(
        token,
        baccaratPromptFlex({
          title: "請選擇平台",
          lines: ["請選擇 DG 或 MT。"],
          quickReply: platformQuickReply(),
        })
      );
    }

    setPlatform(userId, incomingText);
    return reply(token, roomPrompt(incomingText));
  }

  if (session.step === "room") {
    const room = normalizeRoom(session.platform, incomingText);

    if (!validateRoom(session.platform, room)) {
      return reply(
        token,
        baccaratPromptFlex({
          title: "房號格式不正確",
          lines: [
            `${session.platform} 房號不存在，請重新輸入。`,
            "DG：DG01~DG07 / RB01~RB07 / S01~S07",
            "MT：MT01~MT13 / 3A / 13A",
          ],
        })
      );
    }

    setRoom(userId, room);
    return reply(token, capitalPrompt());
  }

  if (session.step === "capital") {
    const capital = parseMoney(incomingText);

    if (!capital) {
      return reply(
        token,
        baccaratPromptFlex({
          title: "本金格式不正確",
          lines: ["請輸入正整數。", "範例：1000 / 3000"],
        })
      );
    }

    setCapital(userId, capital);
    return reply(token, maxBetPrompt(capital));
  }

  if (session.step === "maxBet") {
    const maxBet = parseMoney(incomingText);

    if (!maxBet) {
      return reply(
        token,
        baccaratPromptFlex({
          title: "單注上限格式不正確",
          lines: ["請輸入正整數。"],
        })
      );
    }

    if (!validateMaxBet(session.capital, maxBet)) {
      return reply(
        token,
        baccaratPromptFlex({
          title: "單注上限不正確",
          lines: ["單注上限不可超過本金，且必須大於 0。"],
        })
      );
    }

    setMaxBet(userId, maxBet);

    return reply(
      token,
      baccaratPromptFlex({
        title: "請選擇模式",
        lines: [`本金：${session.capital}`, `單注上限：${maxBet}`],
        quickReply: modeQuickReply(),
      })
    );
  }

  if (session.step === "mode") {
    if (!isMode(incomingText)) {
      return reply(
        token,
        baccaratPromptFlex({
          title: "請選擇模式",
          lines: [`模式：${MODES.join(" / ")}`],
          quickReply: modeQuickReply(),
        })
      );
    }

    const updated = setMode(userId, incomingText);
    const first = firstAnalysis(updated);

    updateAfterRound(userId, first.session);

    return reply(
      token,
      baccaratAnalysisFlex({
        session: first.session,
        prediction: first.prediction,
        bet: first.bet,
        confidence: getConfidence(first.session),
        reason: getReason(first.session),
        quickReply: resultQuickReply(),
      })
    );
  }

  if (session.step === "playing") {
    if (!isResult(incomingText)) {
      return reply(
        token,
        baccaratPromptFlex({
          title: "請輸入本局結果",
          lines: ["請輸入：過 / 倒 / 和。"],
          quickReply: resultQuickReply(),
        })
      );
    }

    const result = nextAnalysis(session, incomingText);
    updateAfterRound(userId, result.session);

    if (result.session.bankroll <= 0 && result.session.mode !== "自由配注") {
      resetSession(userId);

      return reply(
        token,
        baccaratPromptFlex({
          title: "本金已歸零",
          lines: ["請重新開始分析。"],
          quickReply: restartQuickReply(),
        })
      );
    }

    return reply(
      token,
      baccaratAnalysisFlex({
        session: result.session,
        prediction: result.prediction,
        bet: result.bet,
        confidence: getConfidence(result.session),
        reason: getReason(result.session),
        quickReply: resultQuickReply(),
      })
    );
  }

  return false;
}

function isBaccaratCommand(text) {
  return [
    ...COMMANDS,
    "DG",
    "MT",
    ...MODES,
    "過",
    "倒",
    "和",
    "返回房號",
    "返回平台",
    "返回首頁",
    "重新開始",
  ].includes(text);
}

module.exports = {
  handleBaccaratMessage,
  isBaccaratCommand,
  hasActiveBaccaratSession: hasActiveSession,
};
