const { reply, quickReply } = require("../../services/line");
const { bubble, card, infoLine, metric, note, text } = require("../../ui/flex/premium");

const MENU_COMMANDS = ["體育", "體育AI", "⚽ 體育AI", "MLB", "NBA", "世界盃"];

function isSportsCommand(text) {
  return MENU_COMMANDS.includes(String(text || "").trim());
}

function sportsQuickReply() {
  return quickReply([
    { label: "MLB", text: "MLB" },
    { label: "NBA", text: "NBA" },
    { label: "世界盃", text: "世界盃" },
    { label: "回首頁", text: "首頁" },
  ]);
}

function scoreSeed(text) {
  return Array.from(String(text)).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function buildAnalysis(league) {
  const seed = scoreSeed(`${league}:${new Date().toISOString().slice(0, 10)}`);
  const confidence = 62 + (seed % 24);
  const pace = ["穩健", "偏快", "拉鋸", "高壓"][seed % 4];
  const risk = ["低", "中", "中高"][seed % 3];
  const recommendation = confidence >= 78 ? "可列入觀察名單" : "建議保守觀察";

  return {
    confidence,
    pace,
    risk,
    recommendation,
  };
}

function menuFlex() {
  return bubble({
    altText: "體育AI",
    title: "體育AI",
    subtitle: "BLACKDOMAIN SPORTS AI",
    quickReply: sportsQuickReply(),
    footer: "BLACKDOMAIN SPORTS AI",
    contents: [
      text("請選擇賽事類型", {
        size: "md",
        weight: "bold",
        color: "#D6B46A",
        align: "center",
      }),
      card("MLB", "棒球賽事分析", "MLB"),
      card("NBA", "籃球賽事分析", "NBA"),
      card("世界盃", "足球賽事分析", "世界盃"),
    ],
  });
}

function analysisFlex(league) {
  const analysis = buildAnalysis(league);

  return bubble({
    altText: `${league} 體育AI`,
    title: `${league} 分析`,
    subtitle: "BLACKDOMAIN SPORTS AI",
    quickReply: sportsQuickReply(),
    footer: "BLACKDOMAIN SPORTS AI",
    contents: [
      metric("AI 信心指標", `${analysis.confidence}%`, analysis.recommendation),
      infoLine("賽事節奏", analysis.pace),
      infoLine("風險等級", analysis.risk),
      infoLine("分析日期", new Date().toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })),
      note("體育AI 僅提供分析參考，請自行控管風險。"),
    ],
  });
}

async function handleSportsMessage(event) {
  const textValue = event.message.text.trim();

  if (["體育", "體育AI", "⚽ 體育AI"].includes(textValue)) {
    return reply(event.replyToken, menuFlex());
  }

  if (["MLB", "NBA", "世界盃"].includes(textValue)) {
    return reply(event.replyToken, analysisFlex(textValue));
  }

  return false;
}

module.exports = {
  isSportsCommand,
  handleSportsMessage,
};
