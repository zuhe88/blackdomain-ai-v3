const { reply, quickReply } = require("../../services/line");
const { updateSession } = require("../../utils/sessionStore");
const { bubble, card, infoLine, note, text } = require("../../ui/flex/premium");
const { COMMANDS } = require("./constants");
const { NO_DATA_TEXT, loadAvailableMatches } = require("./service");

function isSportsCommand(text) {
  return COMMANDS.includes(String(text || "").trim());
}

function sportsQuickReply() {
  return quickReply([
    { label: "世足AI", text: "世足" },
    { label: "MLB AI", text: "MLB" },
    { label: "NBA", text: "NBA" },
    { label: "返回首頁", text: "首頁" },
  ]);
}

function backQuickReply() {
  return quickReply([
    { label: "返回聯盟", text: "體育" },
    { label: "返回首頁", text: "首頁" },
  ]);
}

function menuFlex() {
  return bubble({
    altText: "體育AI",
    title: "體育AI",
    subtitle: "BLACKDOMAIN SPORTS AI",
    quickReply: sportsQuickReply(),
    footer: "BLACKDOMAIN SPORTS AI",
    contents: [
      text("請選擇分析聯盟", {
        size: "md",
        weight: "bold",
        color: "#D6B46A",
        align: "center",
      }),
      card("⚽ 世足AI", "賽程、近期狀態與AI分析", "世足"),
      card("⚾ MLB AI", "官方賽程、對戰紀錄與AI分析", "MLB"),
      card("🏀 NBA", "官方賽程、戰績與AI分析", "NBA"),
      card("🏠 返回首頁", "回到 BLACKDOMAIN AI 首頁", "首頁"),
    ],
  });
}

function noDataFlex(league) {
  return bubble({
    altText: `${league} 體育AI`,
    title: `${league} AI`,
    subtitle: "BLACKDOMAIN SPORTS AI",
    quickReply: backQuickReply(),
    footer: "BLACKDOMAIN SPORTS AI",
    contents: [
      infoLine("資料狀態", NO_DATA_TEXT),
      infoLine("資料來源", "公開賽程資料"),
      infoLine("更新時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
      note("沒有可分析賽事時，BLACKDOMAIN AI 不產生假預測。"),
    ],
  });
}

function matchAnalysisFlex(league, match) {
  return bubble({
    altText: `${league} AI分析`,
    title: `${league} AI分析`,
    subtitle: "BLACKDOMAIN SPORTS AI",
    quickReply: backQuickReply(),
    footer: "BLACKDOMAIN SPORTS AI",
    contents: [
      infoLine("賽事", `${match.away} VS ${match.home}`),
      infoLine("開賽時間", match.startTime),
      infoLine("對戰紀錄", match.h2h),
      infoLine("AI預測勝方", match.prediction),
      infoLine("讓分方向", match.spread),
      infoLine("大小分", match.total),
      infoLine(league === "MLB" ? "總分推估" : "比分推估", match.score),
      infoLine("信心等級", match.confidence),
      infoLine("更新時間", match.updatedAt),
      note("分析依賽程、近期狀態與公開資料生成，僅供參考。"),
    ],
  });
}

async function replyLeague(event, league) {
  const userId = event.source.userId || "";
  const matches = await loadAvailableMatches(league);
  const analysis = matches[0] || null;

  updateSession("sport", userId, {
    currentPage: `${league} AI`,
    league,
    date: analysis?.date || null,
    match: analysis ? `${analysis.away} VS ${analysis.home}` : null,
    analysis,
    lastUpdated: Date.now(),
  });

  if (!analysis) {
    return reply(event.replyToken, noDataFlex(league));
  }

  return reply(event.replyToken, matchAnalysisFlex(league, analysis));
}

async function handleSportsMessage(event) {
  const textValue = event.message.text.trim();
  const userId = event.source.userId || "";

  if (["體育", "體育AI", "SPORT", "SPORT AI"].includes(textValue)) {
    updateSession("sport", userId, {
      currentPage: "體育AI",
      league: null,
      date: null,
      match: null,
      analysis: null,
      lastUpdated: Date.now(),
    });
    return reply(event.replyToken, menuFlex());
  }

  if (["世足", "世足AI"].includes(textValue)) {
    return replyLeague(event, "世足");
  }

  if (["MLB", "MLB AI"].includes(textValue)) {
    return replyLeague(event, "MLB");
  }

  if (textValue === "NBA") {
    return replyLeague(event, "NBA");
  }

  return false;
}

module.exports = {
  isSportsCommand,
  handleSportsMessage,
};
