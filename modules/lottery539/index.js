const { reply, quickReply } = require("../../services/line");
const { updateSession } = require("../../utils/sessionStore");
const { bubble, button, card, infoLine, metric, note } = require("../../ui/flex/premium");
const { buildAnalysis, formatDate, loadHistory, targetDate } = require("./service");

const COMMANDS = ["539", "539AI", "今彩539", "🎯 539AI", "AI今日預測", "歷史開獎", "重新分析"];

function is539Command(text) {
  return COMMANDS.includes(String(text || "").trim());
}

function lotteryQuickReply() {
  return quickReply([
    { label: "重新分析", text: "重新分析" },
    { label: "歷史開獎", text: "歷史開獎" },
    { label: "返回首頁", text: "首頁" },
  ]);
}

function menuQuickReply() {
  return quickReply([
    { label: "AI今日預測", text: "AI今日預測" },
    { label: "歷史開獎", text: "歷史開獎" },
    { label: "返回首頁", text: "首頁" },
  ]);
}

function menuFlex() {
  return bubble({
    altText: "539AI",
    title: "539AI",
    subtitle: "BLACKDOMAIN 539 AI",
    quickReply: menuQuickReply(),
    footer: "BLACKDOMAIN 539 AI",
    contents: [
      card("🔥 AI今日預測", "保留熱號、冷號、穩定號完整分析", "AI今日預測"),
      card("📊 歷史開獎", "查詢台灣539最新歷史開獎資料", "歷史開獎"),
      card("🏠 返回首頁", "回到 BLACKDOMAIN AI 首頁", "首頁"),
    ],
  });
}

function analysisFlex(title, offset) {
  const analysis = buildAnalysis(offset);

  return bubble({
    altText: "539AI",
    title,
    subtitle: "BLACKDOMAIN 539 AI",
    quickReply: lotteryQuickReply(),
    footer: "BLACKDOMAIN 539 AI",
    contents: [
      infoLine("預測日期", analysis.date),
      metric("AI預測", analysis.prediction.join("、"), "號碼範圍 01 ~ 39"),
      infoLine("熱號", analysis.hot.join("、")),
      infoLine("冷號", analysis.cold.join("、")),
      infoLine("穩定號", analysis.stable.join("、")),
      infoLine("更新時間", analysis.updatedAt),
      note("本分析由 BLACKDOMAIN AI 生成，僅供娛樂參考。"),
    ],
  });
}

async function historyFlex() {
  const history = await loadHistory();
  const contents = history.ok
    ? [
        infoLine("最新期別", history.date),
        metric("開獎號碼", history.numbers.join("、"), "台灣539歷史開獎"),
        infoLine("更新時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
      ]
    : [
        infoLine("歷史開獎", history.message),
        infoLine("更新時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
      ];

  return bubble({
    altText: "539AI 歷史開獎",
    title: "歷史開獎",
    subtitle: "BLACKDOMAIN 539 AI",
    quickReply: lotteryQuickReply(),
    footer: "BLACKDOMAIN 539 AI",
    contents: [
      ...contents,
      button("AI今日預測", "AI今日預測"),
      button("返回首頁", "首頁", "secondary"),
    ],
  });
}

async function handle539Message(event) {
  const text = event.message.text.trim();
  const userId = event.source.userId || "";

  if (["539", "539AI", "今彩539", "🎯 539AI"].includes(text)) {
    updateSession("539", userId, {
      currentPage: "539AI",
      date: formatDate(targetDate()),
      lastUpdated: Date.now(),
    });
    return reply(event.replyToken, menuFlex());
  }

  if (text === "歷史開獎") {
    updateSession("539", userId, {
      currentPage: "歷史開獎",
      date: formatDate(targetDate()),
      lastUpdated: Date.now(),
    });
    return reply(event.replyToken, await historyFlex());
  }

  const analysis = buildAnalysis(text);
  updateSession("539", userId, {
    currentPage: "AI今日預測",
    date: analysis.date,
    prediction: analysis.prediction,
    hot: analysis.hot,
    cold: analysis.cold,
    stable: analysis.stable,
    lastUpdated: Date.now(),
  });
  return reply(event.replyToken, analysisFlex("AI今日預測", text));
}

module.exports = {
  is539Command,
  handle539Message,
};
