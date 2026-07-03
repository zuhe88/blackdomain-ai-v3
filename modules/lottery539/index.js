const { reply, quickReply } = require("../../services/line");
const { updateSession } = require("../../utils/sessionStore");
const { bubble, button, card, infoLine, metric, note } = require("../../ui/flex/premium");
const { buildAnalysis, formatDate, targetDate } = require("./service");

const COMMANDS = [
  "539",
  "539AI",
  "今彩539",
  "🎯 539AI",
  "🔥 AI今日預測",
  "📈 熱號分析",
  "📉 冷號分析",
  "⭐ 穩定號分析",
  "📊 歷史開獎",
  "重新分析",
  "歷史開獎",
];

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
    { label: "AI今日預測", text: "🔥 AI今日預測" },
    { label: "熱號分析", text: "📈 熱號分析" },
    { label: "冷號分析", text: "📉 冷號分析" },
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
      card("🔥 AI今日預測", "預測日期依 20:20 規則切換", "🔥 AI今日預測"),
      card("📈 熱號分析", "顯示 AI 熱號分析", "📈 熱號分析"),
      card("📉 冷號分析", "顯示 AI 冷號分析", "📉 冷號分析"),
      card("⭐ 穩定號分析", "顯示 AI 穩定號分析", "⭐ 穩定號分析"),
      card("📊 歷史開獎", "查詢最近歷史資料", "📊 歷史開獎"),
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
      metric("AI預測", analysis.prediction.join("　"), "號碼範圍 01 ~ 39"),
      infoLine("熱號", analysis.hot.join("　")),
      infoLine("冷號", analysis.cold.join("　")),
      infoLine("穩定號", analysis.stable.join("　")),
      infoLine("更新時間", analysis.updatedAt),
      note("本分析由 BLACKDOMAIN AI 生成，僅供娛樂參考。"),
    ],
  });
}

function historyFlex() {
  return bubble({
    altText: "539AI 歷史開獎",
    title: "歷史開獎",
    subtitle: "BLACKDOMAIN 539 AI",
    quickReply: lotteryQuickReply(),
    footer: "BLACKDOMAIN 539 AI",
    contents: [
      infoLine("歷史資料", "目前尚無歷史資料"),
      button("重新分析", "重新分析"),
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

  if (["📊 歷史開獎", "歷史開獎"].includes(text)) {
    updateSession("539", userId, {
      currentPage: "歷史開獎",
      date: formatDate(targetDate()),
      lastUpdated: Date.now(),
    });
    return reply(event.replyToken, historyFlex());
  }

  const titleMap = {
    "🔥 AI今日預測": "AI今日預測",
    "重新分析": "AI今日預測",
    "📈 熱號分析": "熱號分析",
    "📉 冷號分析": "冷號分析",
    "⭐ 穩定號分析": "穩定號分析",
  };

  const title = titleMap[text] || "AI今日預測";
  const analysis = buildAnalysis(text);
  updateSession("539", userId, {
    currentPage: title,
    date: analysis.date,
    prediction: analysis.prediction,
    hot: analysis.hot,
    cold: analysis.cold,
    stable: analysis.stable,
    lastUpdated: Date.now(),
  });
  return reply(event.replyToken, analysisFlex(title, text));
}

module.exports = {
  is539Command,
  handle539Message,
};
