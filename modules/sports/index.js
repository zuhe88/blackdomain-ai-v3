const { reply, push, quickReply } = require("../../services/line");
const { updateSession } = require("../../utils/sessionStore");
const { bubble, carousel, infoLine, metric, note, text, COLORS } = require("../../ui/flex/premium");
const { moduleImageUrl } = require("../../utils/moduleImage");
const { COMMANDS } = require("./constants");
const { NO_DATA_TEXT, loadAvailableMatches } = require("./service");

function isSportsCommand(input) {
  return COMMANDS.includes(String(input || "").trim());
}

function sportsQuickReply() {
  return quickReply([
    { label: "CPBL AI", text: "CPBL" },
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

function leagueImageBubble({ title, subtitle, image, actionText }) {
  return {
    type: "bubble",
    size: "kilo",
    styles: {
      hero: { backgroundColor: COLORS.black },
      body: { backgroundColor: COLORS.black },
      footer: { backgroundColor: COLORS.black },
    },
    hero: {
      type: "image",
      url: moduleImageUrl(image),
      size: "full",
      aspectRatio: "8:9",
      aspectMode: "cover",
      action: { type: "message", text: actionText },
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "16px",
      action: { type: "message", text: actionText },
      contents: [
        text(title, { size: "lg", weight: "bold", color: COLORS.gold, align: "center" }),
        text(subtitle, { size: "sm", color: COLORS.white, align: "center" }),
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "10px",
      contents: [text("BLACKDOMAIN SPORTS AI", { size: "xxs", color: COLORS.muted, align: "center", wrap: false })],
    },
  };
}

function menuFlex() {
  const message = carousel("體育AI", [
    leagueImageBubble({ title: "CPBL AI", subtitle: "中華職棒賽程、戰績與賽前分析", image: "mlb.png", actionText: "CPBL" }),
    leagueImageBubble({ title: "MLB AI", subtitle: "賽前分析、勝方與大小分", image: "mlb.png", actionText: "MLB" }),
    leagueImageBubble({ title: "NBA", subtitle: "賽前分析、勝方與節奏判斷", image: "nba.png", actionText: "NBA" }),
  ]);
  message.quickReply = sportsQuickReply();
  return message;
}

function noDataFlex(league) {
  return bubble({
    altText: `${league} 體育AI`,
    title: `${league} AI`,
    subtitle: "BLACKDOMAIN SPORTS AI",
    quickReply: backQuickReply(),
    footer: "BLACKDOMAIN SPORTS AI",
    contents: [
      infoLine("賽事狀態", NO_DATA_TEXT),
      infoLine("更新時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
      note("BLACKDOMAIN AI 會持續追蹤可分析賽事。"),
    ],
  });
}

function pointsBox(points = []) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    backgroundColor: COLORS.panel,
    cornerRadius: "14px",
    paddingAll: "14px",
    contents: [
      text("分析重點", { size: "sm", weight: "bold", color: COLORS.gold }),
      ...points.slice(0, 6).map((point) => text(`• ${point}`, { size: "sm", color: COLORS.white, wrap: true })),
    ],
  };
}

function matchBubble(league, match, index, total) {
  return bubble({
    altText: `${league} AI分析`,
    title: `${league} AI分析`,
    subtitle: `第 ${index + 1} / ${total} 場`,
    quickReply: backQuickReply(),
    footer: "BLACKDOMAIN SPORTS AI",
    contents: [
      infoLine("賽事", `${match.home} VS ${match.away}`),
      infoLine("開賽時間", match.startTime),
      ...(match.teamData?.venue ? [infoLine("比賽場地", match.teamData.venue)] : []),
      metric("AI預測勝方", match.prediction, "賽前分析"),
      metric("預測比分", match.score, "主隊在前"),
      infoLine("讓分建議", match.spread),
      infoLine("大小分建議", match.total),
      infoLine("總進球", match.totalGoals || match.score),
      infoLine("半場預測", match.halfTime || "上半場節奏觀察"),
      pointsBox(match.points),
    ],
  }).contents;
}

function matchesFlex(league, matches) {
  const bubbles = matches.map((match, index) => matchBubble(league, match, index, matches.length));
  const message = carousel(`${league} AI分析`, bubbles);
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
    match: first ? `${first.home} VS ${first.away}` : null,
    analysis: first,
    matches,
    lastUpdated: Date.now(),
  });

  if (!first) return reply(event.replyToken, noDataFlex(league));
  return reply(event.replyToken, matchesFlex(league, matches));
}

async function pushLeagueAfterLoading(event, league) {
  const userId = event.source.userId || "";
  await reply(event.replyToken, "AI分析中，請稍候。\nAI預測勝方、比分、讓分與大小分正在整理。");
  const matches = await loadAvailableMatches(league);
  const first = matches[0] || null;

  updateSession("sport", userId, {
    currentPage: `${league} AI`,
    league,
    date: first?.date || null,
    match: first ? `${first.home} VS ${first.away}` : null,
    analysis: first,
    matches,
    lastUpdated: Date.now(),
  });

  if (!first) return push(userId, noDataFlex(league));
  return push(userId, matchesFlex(league, matches));
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

  if (["CPBL", "CPBL AI", "中華職棒", "中職"].includes(value)) return pushLeagueAfterLoading(event, "CPBL");
  if (["MLB", "MLB AI"].includes(value)) return pushLeagueAfterLoading(event, "MLB");
  if (value === "NBA") return pushLeagueAfterLoading(event, "NBA");

  return false;
}

module.exports = {
  isSportsCommand,
  handleSportsMessage,
};
