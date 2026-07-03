const { reply, quickReply } = require("../../services/line");
const { updateSession } = require("../../utils/sessionStore");
const { bubble, card, infoLine, note, text } = require("../../ui/flex/premium");

const MENU_COMMANDS = ["體育", "體育AI", "SPORT", "SPORT AI", "世足", "世足AI", "MLB", "MLB AI", "NBA"];

function isSportsCommand(text) {
  return MENU_COMMANDS.includes(String(text || "").trim());
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
      text("請選擇分析項目", {
        size: "md",
        weight: "bold",
        color: "#D6B46A",
        align: "center",
      }),
      card("⚽ 世足AI", "可分析日期與賽事列表", "世足"),
      card("⚾ MLB AI", "可分析日期與賽事列表", "MLB"),
      card("返回首頁", "回到 BLACKDOMAIN AI 首頁", "首頁"),
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
      infoLine("資料狀態", "目前尚無可分析賽事"),
      infoLine("時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
      note("若後續接入正式賽事資料，將依原本 AI 預測邏輯顯示分析結果。"),
    ],
  });
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
    updateSession("sport", userId, {
      currentPage: "世足AI",
      league: "世足",
      analysis: "目前尚無可分析賽事",
      lastUpdated: Date.now(),
    });
    return reply(event.replyToken, noDataFlex("世足"));
  }

  if (["MLB", "MLB AI"].includes(textValue)) {
    updateSession("sport", userId, {
      currentPage: "MLB AI",
      league: "MLB",
      analysis: "目前尚無可分析賽事",
      lastUpdated: Date.now(),
    });
    return reply(event.replyToken, noDataFlex("MLB"));
  }

  if (textValue === "NBA") {
    updateSession("sport", userId, {
      currentPage: "NBA",
      league: "NBA",
      analysis: "目前尚無可分析賽事",
      lastUpdated: Date.now(),
    });
    return reply(event.replyToken, noDataFlex("NBA"));
  }

  return false;
}

module.exports = {
  isSportsCommand,
  handleSportsMessage,
};
