const { line, lineConfig, reply } = require("../services/line");
const { logError } = require("../utils/errorCodes");
const mainMenuFlex = require("../ui/mainMenuFlex");
const electronicMenuFlex = require("../ui/flex/electronicMenu");
const electronicGameMenu = require("../ui/flex/electronicGameMenu");
const electronic = require("../modules/electronic");
const baccarat = require("../modules/baccarat");
const sports = require("../modules/sports");
const lottery539 = require("../modules/lottery539");
const vip = require("../modules/vip");
const official = require("../modules/official");
const { clearUser, updateSession } = require("../utils/sessionStore");

function registerWebhookRoutes(app) {
  app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
    res.status(200).end();

    const events = req.body.events || [];

    for (const event of events) {
  try {
    console.log("LINE USER ID =", event.source?.userId);
    await handleEvent(event);
  } catch (err) {
    logError("E008", err);
  }
}D
  });
}

async function handleEvent(event) {
  if (event.type !== "message") return;
  if (event.message.type !== "text") return;

  const text = event.message.text.trim();
  const replyToken = event.replyToken;
  const userId = event.source.userId;

  if (["黑域AI", "首頁", "開始", "menu", "選單"].includes(text)) {
    updateSession("home", userId, {
      currentPage: "首頁",
      currentFeature: null,
      returnTo: "首頁",
    });
    return reply(replyToken, mainMenuFlex());
  }

  if (text === "重新開始" || text === "返回首頁") {
    clearUser(userId);
    return reply(replyToken, mainMenuFlex());
  }

  if (text === "電子" || text === "電子AI" || text === "Electronic" || text === "⚡ 電子AI") {
    return reply(replyToken, electronicMenuFlex());
  }

  if (text === "戰神賽特1" || text === "戰神賽特2" || text === "古神巴風特") {
    electronic.setGameSession(userId, text);
    return reply(replyToken, electronicGameMenu(text));
  }

  if (electronic.hasActiveElectronicSession(userId)) {
    const handled = await electronic.handleElectronicMessage(event);
    if (handled !== false) return handled;
  }

  if (electronic.isElectronicCommand(text)) {
    return electronic.handleElectronicMessage(event);
  }

  if (baccarat.hasActiveBaccaratSession(userId)) {
    const handled = await baccarat.handleBaccaratMessage(event);
    if (handled !== false) return handled;
  }

  if (baccarat.isBaccaratCommand(text)) {
    return baccarat.handleBaccaratMessage(event);
  }

  if (lottery539.is539Command(text)) {
    return lottery539.handle539Message(event);
  }

  if (sports.isSportsCommand(text)) {
    return sports.handleSportsMessage(event);
  }

  if (vip.isVipCommand(text)) {
    return vip.handleVipMessage(event);
  }

  if (official.isOfficialCommand(text)) {
    return official.handleOfficialMessage(event);
  }

  return reply(replyToken, mainMenuFlex());
}

module.exports = {
  registerWebhookRoutes,
  handleEvent,
};
