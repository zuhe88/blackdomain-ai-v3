const { reply, quickReply } = require("../../services/line");
const { bubble, infoLine, metric, note, text } = require("../../ui/flex/premium");

const COMMANDS = ["539", "539AI", "📊 539AI", "539預測", "539今日"];

function is539Command(text) {
  return COMMANDS.includes(String(text || "").trim());
}

function lotteryQuickReply() {
  return quickReply([
    { label: "539預測", text: "539預測" },
    { label: "539今日", text: "539今日" },
    { label: "回首頁", text: "首頁" },
  ]);
}

function seededNumbers() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  let seed = Array.from(today).reduce((sum, char) => sum + char.charCodeAt(0), 539);
  const numbers = [];

  while (numbers.length < 5) {
    seed = (seed * 9301 + 49297) % 233280;
    const value = (seed % 39) + 1;
    if (!numbers.includes(value)) numbers.push(value);
  }

  return numbers.sort((a, b) => a - b).map((n) => String(n).padStart(2, "0"));
}

function predictionFlex() {
  const numbers = seededNumbers();

  return bubble({
    altText: "539AI",
    title: "539AI",
    subtitle: "BLACKDOMAIN 539 AI",
    quickReply: lotteryQuickReply(),
    footer: "BLACKDOMAIN 539 AI",
    contents: [
      metric("今日參考號碼", numbers.join("　"), "每日依台北時間更新"),
      infoLine("分析模式", "冷熱號綜合"),
      infoLine("風險提醒", "請量力而為"),
      note("539AI 僅提供娛樂與分析參考，不保證結果。"),
    ],
  });
}

async function handle539Message(event) {
  return reply(event.replyToken, predictionFlex());
}

module.exports = {
  is539Command,
  handle539Message,
};
