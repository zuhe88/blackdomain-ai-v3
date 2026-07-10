const { reply, quickReply } = require("../../services/line");
const { updateSession } = require("../../utils/sessionStore");
const { bubble, card, infoLine, metric, note } = require("../../ui/flex/premium");
const { buildAnalysis, formatDate, targetDate } = require("./service");

const COMMANDS = ["539", "539AI", "今彩539", "🎯 539AI", "AI今日預測", "重新分析"];

function is539Command(text) {
  return COMMANDS.includes(String(text || "").trim());
}

function lotteryQuickReply() {
  return quickReply([
    { label: "重新分析", text: "重新分析" },
    { label: "返回首頁", text: "首頁" },
  ]);
}

function menuQuickReply() {
  return quickReply([
    { label: "AI今日預測", text: "AI今日預測" },
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
      card("🔥 AI今日預測", "整合今日號碼、熱號與冷號分析", "AI今日預測"),
      card("🏠 返回首頁", "回到 BLACKDOMAIN AI 首頁", "首頁"),
    ],
  });
}

function analysisFlex(title, analysis) {
  const hasHistory = analysis.source !== "missing-history";
  return bubble({
    altText: "539AI",
    title,
    subtitle: "BLACKDOMAIN 539 AI",
    quickReply: lotteryQuickReply(),
    footer: "BLACKDOMAIN 539 AI",
    contents: [
      infoLine("預測日期", analysis.date),
      metric("AI預測", hasHistory ? analysis.prediction.join("、") : "資料不足", hasHistory ? "號碼範圍 01 ~ 39" : "等待歷史資料更新"),
      ...(hasHistory
        ? [
            infoLine("熱號", analysis.hot.join("、")),
            infoLine("冷號", analysis.cold.join("、")),
            infoLine("資料來源", analysis.source === "gpt" ? "歷史資料 + GPT分析" : "歷史資料統計分析"),
          ]
        : [infoLine("資料狀態", analysis.summary)]),
      infoLine("更新時間", analysis.updatedAt),
      note("本分析由 BLACKDOMAIN AI 生成，僅供娛樂參考。"),
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

  const analysis = await buildAnalysis(text);
  updateSession("539", userId, {
    currentPage: "AI今日預測",
    date: analysis.date,
    prediction: analysis.prediction,
    hot: analysis.hot,
    cold: analysis.cold,
    lastUpdated: Date.now(),
  });
  return reply(event.replyToken, analysisFlex("AI今日預測", analysis));
}

module.exports = {
  is539Command,
  handle539Message,
};
