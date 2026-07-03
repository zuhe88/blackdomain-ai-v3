const { reply, quickReply } = require("../../services/line");
const { updateSession } = require("../../utils/sessionStore");
const { bubble, card, carousel, infoLine, metric, note, text } = require("../../ui/flex/premium");
const { COMMANDS } = require("./constants");
const { NO_DATA_TEXT, loadAvailableMatches } = require("./service");

function isSportsCommand(input) {
  return COMMANDS.includes(String(input || "").trim());
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
      card("⚽ 世足AI", "賽程、勝方、比分與賽前分析", "世足"),
      card("⚾ MLB AI", "官方賽程、戰績與賽前分析", "MLB"),
      card("🏀 NBA", "官方賽程、戰績與賽前分析", "NBA"),
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
      infoLine("更新時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
      note("沒有可分析賽事時，BLACKDOMAIN AI 不產生假預測。"),
    ],
  });
}

function analysisPoints(match) {
  if (Array.isArray(match.points) && match.points.length >= 4) return match.points;
  return [
    `• AI預估 ${match.prediction} 方向較值得關注`,
    `• 近期狀態顯示 ${match.prediction} 具備較佳勝出條件`,
    `• 比賽節奏預估偏向 ${match.total}`,
    `• 讓分建議可參考 ${match.spread}`,
    `• 建議比分 ${match.score}`,
  ];
}

function matchBubble(league, match, index, total) {
  return bubble({
    altText: `${league} AI分析`,
    title: `${league} AI分析`,
    subtitle: `第 ${index + 1} / ${total} 場`,
    quickReply: backQuickReply(),
    footer: "BLACKDOMAIN SPORTS AI",
    contents: [
      infoLine("賽事", `${match.away} VS ${match.home}`),
      infoLine("開賽時間", match.startTime),
      metric("AI預測勝方", match.prediction, "勝方"),
      metric("預測比分", match.score, "比分"),
      infoLine("AI信心", match.stars || "★★★☆☆"),
      infoLine("讓分建議", match.spread),
      infoLine("大小分建議", match.total),
      infoLine("總進球", match.totalGoals || match.score),
      infoLine("半場預測", match.halfTime || "半場平手機率較高"),
      note(["分析重點", ...analysisPoints(match)].join("\n")),
    ],
  }).contents;
}

function matchesFlex(league, matches) {
  const bubbles = matches.map((match, index) => matchBubble(league, match, index, matches.length));
  const message = carousel(`${league} AI賽前分析`, bubbles);
  message.quickReply = backQuickReply();
  return message;
}

async function replyLeague(event, league) {
  const userId = event.source.userId || "";
  const matches = await loadAvailableMatches(league);
  const first = matches[0] || null;

  updateSession("sport", userId, {
    currentPage: `${league} AI`,
    league,
    date: first?.date || null,
    match: first ? `${first.away} VS ${first.home}` : null,
    analysis: first,
    matches,
    lastUpdated: Date.now(),
  });

  if (!first) return reply(event.replyToken, noDataFlex(league));
  return reply(event.replyToken, matchesFlex(league, matches));
}

async function handleSportsMessage(event) {
  const value = event.message.text.trim();
  const userId = event.source.userId || "";

  if (["體育", "體育AI", "SPORT", "SPORT AI"].includes(value)) {
    updateSession("sport", userId, {
      currentPage: "體育AI",
      league: null,
      date: null,
      match: null,
      analysis: null,
      matches: [],
      lastUpdated: Date.now(),
    });
    return reply(event.replyToken, menuFlex());
  }

  if (["世足", "世足AI"].includes(value)) return replyLeague(event, "世足");
  if (["MLB", "MLB AI"].includes(value)) return replyLeague(event, "MLB");
  if (value === "NBA") return replyLeague(event, "NBA");

  return false;
}

module.exports = {
  isSportsCommand,
  handleSportsMessage,
};
