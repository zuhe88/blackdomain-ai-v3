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

const HOME_COMMANDS = ["黑域AI", "首頁", "開始", "menu", "選單", "主選單"];
const CANCEL_COMMANDS = ["取消", "退出", "返回首頁", "重新開始"];
const GLOBAL_VIP_COMMANDS = ["VIP", "VIP中心", "VIP查詢", "查VIP", "我的VIP", "會員", "會員中心", "綁定", "綁定3A"];
const GLOBAL_ADMIN_COMMANDS = ["管理指令", "管理員指令", "待審核", "會員列表"];
const AI_ENTRY_COMMANDS = new Set([
  "百家樂",
  "百家樂AI",
  "baccarat",
  "🎲 百家樂AI",
  "電子",
  "電子AI",
  "Electronic",
  "⚡ 電子AI",
  "戰神賽特1",
  "戰神賽特2",
  "古神巴風特",
  "539",
  "539AI",
  "今彩539",
  "🎯 539AI",
  "AI今日預測",
  "歷史開獎",
  "體育",
  "體育AI",
  "SPORT",
  "SPORT AI",
  "世足",
  "世足AI",
  "MLB",
  "MLB AI",
  "NBA",
]);

function registerWebhookRoutes(app) {
  app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
    res.status(200).end();
    const events = req.body.events || [];
    for (const event of events) {
      try {
        await handleEvent(event);
      } catch (err) {
        logError("E008", err);
      }
    }
  });
}

function clearAllUserSessions(userId) {
  clearUser(userId);
  if (electronic.resetElectronicSession) electronic.resetElectronicSession(userId);
  if (baccarat.resetBaccaratSession) baccarat.resetBaccaratSession(userId);
}

function isAdminCommand(text) {
  return GLOBAL_ADMIN_COMMANDS.includes(text) ||
    text.startsWith("開通 ") ||
    text.startsWith("查會員 ") ||
    text.startsWith("取消VIP ") ||
    text.startsWith("延長VIP ") ||
    text.startsWith("永久VIP ");
}

function moduleNameFromText(text) {
  if (["百家樂", "百家樂AI", "baccarat", "🎲 百家樂AI"].includes(text)) return "百家樂";
  if (["電子", "電子AI", "Electronic", "⚡ 電子AI", "戰神賽特1", "戰神賽特2", "古神巴風特"].includes(text)) return "電子";
  if (["539", "539AI", "今彩539", "🎯 539AI", "AI今日預測", "歷史開獎"].includes(text)) return "539";
  if (["體育", "體育AI", "SPORT", "SPORT AI", "世足", "世足AI", "MLB", "MLB AI", "NBA"].includes(text)) return "SPORTS";
  return "AI";
}

async function ensureVipOrReply(event, moduleName) {
  const access = await vip.checkVipAccess(event.source.userId || "");
  if (!access.allowed) {
    await reply(event.replyToken, vip.accessDeniedFlex());
    return false;
  }
  if (access.user?.account3A || access.isAdmin) {
    await vip.logAiUsage({
      lineUserId: event.source.userId || "",
      threeAAccount: access.user?.account3A || "管理員",
      module: moduleName,
    });
  }
  return true;
}

async function handleEvent(event) {
  if (event.type !== "message") return;
  if (event.message.type !== "text") return;

  const text = event.message.text.trim();
  const replyToken = event.replyToken;
  const userId = event.source.userId;

  if (HOME_COMMANDS.includes(text)) {
    clearAllUserSessions(userId);
    updateSession("home", userId, {
      currentPage: "首頁",
      currentFeature: null,
      returnTo: "首頁",
    });
    return reply(replyToken, mainMenuFlex());
  }

  if (CANCEL_COMMANDS.includes(text)) {
    clearAllUserSessions(userId);
    return reply(replyToken, mainMenuFlex());
  }

  if (GLOBAL_VIP_COMMANDS.includes(text) || isAdminCommand(text)) {
    clearAllUserSessions(userId);
    return vip.handleVipMessage(event);
  }

  if (vip.hasActiveVipSession && vip.hasActiveVipSession(userId)) {
    return vip.handleVipMessage(event);
  }

  if (official.isOfficialCommand(text)) {
    clearAllUserSessions(userId);
    return official.handleOfficialMessage(event);
  }

  if (AI_ENTRY_COMMANDS.has(text)) {
    const allowed = await ensureVipOrReply(event, moduleNameFromText(text));
    if (!allowed) return;
  }

  if (text === "電子" || text === "電子AI" || text === "Electronic" || text === "⚡ 電子AI") {
    return reply(replyToken, electronicMenuFlex());
  }

  if (text === "戰神賽特1" || text === "戰神賽特2" || text === "古神巴風特") {
    electronic.setGameSession(userId, text);
    return reply(replyToken, electronicGameMenu(text));
  }

  if (electronic.hasActiveElectronicSession(userId)) {
    const allowed = await ensureVipOrReply(event, "電子");
    if (!allowed) return;
    const handled = await electronic.handleElectronicMessage(event);
    if (handled !== false) return handled;
  }

  if (electronic.isElectronicCommand(text)) return electronic.handleElectronicMessage(event);

  if (baccarat.hasActiveBaccaratSession(userId)) {
    const allowed = await ensureVipOrReply(event, "百家樂");
    if (!allowed) return;
    const handled = await baccarat.handleBaccaratMessage(event);
    if (handled !== false) return handled;
  }

  if (baccarat.isBaccaratCommand(text)) return baccarat.handleBaccaratMessage(event);
  if (lottery539.is539Command(text)) return lottery539.handle539Message(event);
  if (sports.isSportsCommand(text)) return sports.handleSportsMessage(event);
  if (vip.isVipCommand(text)) return vip.handleVipMessage(event);

  return reply(replyToken, mainMenuFlex());
}

module.exports = {
  registerWebhookRoutes,
  handleEvent,
};
