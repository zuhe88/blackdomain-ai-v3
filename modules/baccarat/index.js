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

async function handleBaccaratMessage(event) {
  const userId = event.source.userId;
  const text = event.message.text.trim();
  const token = event.replyToken;

  if (isCancel(text) || text === "結束分析") {
    resetSession(userId);

    return reply(
      token,
      baccaratPromptFlex({
        title: "百家樂分析已結束",
        lines: ["請重新開始或回首頁。"],
        quickReply: restartQuickReply(),
      })
    );
  }

  if (text === "百家樂" || text === "百家樂AI" || text === "baccarat" || text === "🤖 百家樂AI" || text === "🎲 百家樂AI") {
    resetSession(userId);

    return reply(
      token,
      baccaratPlatformFlex(platformQuickReply())
    );
  }

  const session = getSession(userId);

  if (text === "返回平台") {
    resetSession(userId);
    return reply(token, baccaratPlatformFlex(platformQuickReply()));
  }

  if (text === "返回房號" && session.platform) {
    setStep(userId, "room");
    return reply(
      token,
      baccaratPromptFlex({
        title: `${session.platform} 真人百家樂`,
        lines: ["請重新輸入房號", "DG範例：DG01 / RB03 / S05", "MT範例：MT01 / MT03 / 3A / 13A"],
      })
    );
  }

  if (session.step === "platform") {
    if (text !== "DG" && text !== "MT") {
      return reply(
        token,
        baccaratPromptFlex({
          title: "請選擇平台",
          lines: ["請選擇平台：DG 或 MT"],
          quickReply: platformQuickReply(),
        })
      );
    }

    setPlatform(userId, text);

    return reply(
      token,
      baccaratPromptFlex({
        title: `${text} 真人百家樂`,
        lines: ["請輸入房號", "DG範例：DG01 / RB03 / S05", "MT範例：MT01 / MT03 / 3A / 13A"],
      })
    );
  }

  if (session.step === "room") {
    const room = normalizeRoom(session.platform, text);

    if (!validateRoom(session.platform, room)) {
      return reply(
        token,
        baccaratPromptFlex({
          title: "房號格式錯誤",
          lines: [`${session.platform} 可用房號：`, "DG：DG01~DG07 / RB01~RB07 / S01~S07", "MT：MT01~MT13 / 3A / 13A"],
        })
      );
    }

    setRoom(userId, room);

    return reply(
      token,
      baccaratPromptFlex({
        title: `${session.platform}｜${room}`,
        lines: ["請輸入本金", "例如：3000 / 3,000"],
      })
    );
  }

  if (session.step === "capital") {
    const capital = parseMoney(text);

    if (!capital) {
      return reply(
        token,
        baccaratPromptFlex({
          title: "本金格式錯誤",
          lines: ["請輸入整數", "例如：3000 / 3,000"],
        })
      );
    }

    setCapital(userId, capital);

    return reply(
      token,
      baccaratPromptFlex({
        title: "目前本金",
        lines: [String(capital), "請輸入單注上限", "例如：500"],
      })
    );
  }

  if (session.step === "maxBet") {
    const maxBet = parseMoney(text);

    if (!maxBet) {
      return reply(
        token,
        baccaratPromptFlex({
          title: "單柱上限格式錯誤",
          lines: ["請輸入整數。"],
        })
      );
    }

    if (!validateMaxBet(session.capital, maxBet)) {
      return reply(
        token,
        baccaratPromptFlex({
          title: "單柱上限錯誤",
          lines: ["單柱上限不可大於本金，也不可小於或等於 0。"],
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
    if (!isMode(text)) {
      return reply(
        token,
        baccaratPromptFlex({
          title: "請選擇模式",
          lines: ["請選擇模式：AI配注 / 天門 / 自由配注"],
          quickReply: modeQuickReply(),
        })
      );
    }

    const updated = setMode(userId, text);
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
    if (!isResult(text)) {
      return reply(
        token,
        baccaratPromptFlex({
          title: "請輸入開局結果",
          lines: ["請輸入：過 / 倒 / 和"],
          quickReply: resultQuickReply(),
        })
      );
    }

    const result = nextAnalysis(session, text);
    updateAfterRound(userId, result.session);

    if (result.session.bankroll <= 0 && result.session.mode !== "自由配注") {
      resetSession(userId);

      return reply(
        token,
        baccaratPromptFlex({
          title: "資金已歸零",
          lines: ["分析停止。"],
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

function formatAnalysis(session, prediction, bet) {
  const history = session.history.length
    ? session.history.join(" ")
    : "尚未輸入牌路";

  const profit =
    session.mode === "自由配注"
      ? "-"
      : Math.round((session.bankroll - session.startBankroll) * 100) / 100;

  return `━━━━━━━━━━━━━━━━━━━━

⚡ BLACKDOMAIN AI

${session.platform}｜${session.room}

━━━━━━━━━━━━━━━━━━━━

AI 建議

👉 ${prediction}

${
  session.mode === "自由配注"
    ? "自由配注模式：請自行控注"
    : `建議下注：${bet}`
}

━━━━━━━━━━━━━━━━━━━━

模式：
${session.mode}

目前本金：
${session.mode === "自由配注" ? "-" : session.bankroll}

目前獲利：
${profit}

━━━━━━━━━━━━━━━━━━━━

過：${session.results.win}
倒：${session.results.lose}
和：${session.results.tie}

━━━━━━━━━━━━━━━━━━━━

目前牌路：

${history}

━━━━━━━━━━━━━━━━━━━━`;
}

function isBaccaratCommand(text) {
  return [
    "百家樂",
    "百家樂AI",
    "baccarat",
    "🤖 百家樂AI",
    "🎲 百家樂AI",
    "DG",
    "MT",
    "AI配注",
    "天門",
    "自由配注",
    "過",
    "倒",
    "和",
    "返回房號",
    "返回平台",
    "取消",
    "結束分析",
  ].includes(text);
}

module.exports = {
  handleBaccaratMessage,
  isBaccaratCommand,
  hasActiveBaccaratSession: hasActiveSession,
};
