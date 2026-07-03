const { reply, textMessage } = require("../../services/line");

const {
  getSession,
  resetSession,
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
} = require("./ai");

async function handleBaccaratMessage(event) {
  const userId = event.source.userId;
  const text = event.message.text.trim();
  const token = event.replyToken;

  if (isCancel(text) || text === "結束分析") {
    resetSession(userId);

    return reply(
      token,
      textMessage(
        `━━━━━━━━━━━━━━━━━━━━

⚡ BLACKDOMAIN AI

百家樂分析已結束。

━━━━━━━━━━━━━━━━━━━━`,
        restartQuickReply()
      )
    );
  }

  if (text === "百家樂" || text === "百家樂AI" || text === "🤖 百家樂AI") {
    resetSession(userId);

    return reply(
      token,
      textMessage(
        `━━━━━━━━━━━━━━━━━━━━

⚡ BLACKDOMAIN AI

🤖 百家樂AI

━━━━━━━━━━━━━━━━━━━━

請選擇平台

━━━━━━━━━━━━━━━━━━━━`,
        platformQuickReply()
      )
    );
  }

  const session = getSession(userId);

  if (session.step === "platform") {
    if (text !== "DG" && text !== "MT") {
      return reply(
        token,
        textMessage("請選擇平台：DG 或 MT", platformQuickReply())
      );
    }

    setPlatform(userId, text);

    return reply(
      token,
      textMessage(
        `━━━━━━━━━━━━━━━━━━━━

⚡ BLACKDOMAIN AI

${text} 真人百家樂

━━━━━━━━━━━━━━━━━━━━

請輸入房號

DG範例：
01 / RB03 / S05

MT範例：
01 / 03 / 3A / 13A

━━━━━━━━━━━━━━━━━━━━`
      )
    );
  }

  if (session.step === "room") {
    const room = normalizeRoom(session.platform, text);

    if (!validateRoom(session.platform, room)) {
      return reply(
        token,
        textMessage(
          `❌ 房號格式錯誤

${session.platform} 可用房號：

DG：
01~07
RB01~RB07
S01~S07

MT：
01~13
3A
13A`
        )
      );
    }

    setRoom(userId, room);

    return reply(
      token,
      textMessage(
        `━━━━━━━━━━━━━━━━━━━━

⚡ BLACKDOMAIN AI

${session.platform}｜${room}

━━━━━━━━━━━━━━━━━━━━

請輸入本金

例如：
3000
3000.5
3,000

━━━━━━━━━━━━━━━━━━━━`
      )
    );
  }

  if (session.step === "capital") {
    const capital = parseMoney(text);

    if (!capital) {
      return reply(
        token,
        textMessage(
          `❌ 本金格式錯誤

請輸入數字

例如：
3000
3000.5
3,000`
        )
      );
    }

    setCapital(userId, capital);

    return reply(
      token,
      textMessage(
        `━━━━━━━━━━━━━━━━━━━━

⚡ BLACKDOMAIN AI

目前本金：
${capital}

━━━━━━━━━━━━━━━━━━━━

請輸入單柱上限

例如：
500
500.5

━━━━━━━━━━━━━━━━━━━━`
      )
    );
  }

  if (session.step === "maxBet") {
    const maxBet = parseMoney(text);

    if (!maxBet) {
      return reply(
        token,
        textMessage("❌ 單柱上限格式錯誤，請輸入數字。")
      );
    }

    if (!validateMaxBet(session.capital, maxBet)) {
      return reply(
        token,
        textMessage("❌ 單柱上限不可大於本金，也不可小於或等於 0。")
      );
    }

    setMaxBet(userId, maxBet);

    return reply(
      token,
      textMessage(
        `━━━━━━━━━━━━━━━━━━━━

⚡ BLACKDOMAIN AI

本金：
${session.capital}

單柱上限：
${maxBet}

━━━━━━━━━━━━━━━━━━━━

請選擇模式

━━━━━━━━━━━━━━━━━━━━`,
        modeQuickReply()
      )
    );
  }

  if (session.step === "mode") {
    if (!isMode(text)) {
      return reply(
        token,
        textMessage("請選擇模式：AI配注 / 天門 / 自由配注", modeQuickReply())
      );
    }

    const updated = setMode(userId, text);
    const first = firstAnalysis(updated);

    updateAfterRound(userId, first.session);

    return reply(
      token,
      textMessage(formatAnalysis(first.session, first.prediction, first.bet), resultQuickReply())
    );
  }

  if (session.step === "playing") {
    if (!isResult(text)) {
      return reply(
        token,
        textMessage("請輸入：莊 / 閒 / 和", resultQuickReply())
      );
    }

    const result = nextAnalysis(session, text);
    updateAfterRound(userId, result.session);

    if (result.session.bankroll <= 0 && result.session.mode !== "自由配注") {
      resetSession(userId);

      return reply(
        token,
        textMessage(
          `━━━━━━━━━━━━━━━━━━━━

⚠️ BLACKDOMAIN AI

資金已歸零，分析停止。

━━━━━━━━━━━━━━━━━━━━`,
          restartQuickReply()
        )
      );
    }

    return reply(
      token,
      textMessage(formatAnalysis(result.session, result.prediction, result.bet), resultQuickReply())
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
    "🤖 百家樂AI",
    "DG",
    "MT",
    "AI配注",
    "天門",
    "自由配注",
    "莊",
    "閒",
    "和",
    "取消",
    "結束分析",
  ].includes(text);
}

module.exports = {
  handleBaccaratMessage,
  isBaccaratCommand,
};