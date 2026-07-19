const { line, lineConfig, reply } = require("../services/line");
const { logError } = require("../utils/errorCodes");
const mainMenuFlex = require("../ui/mainMenuFlex");
const electronicMenuFlex = require("../ui/flex/electronicMenu");
const electronic = require("../modules/electronic");
const baccarat = require("../modules/baccarat");
const sports = require("../modules/sports");
const lottery539 = require("../modules/lottery539");
const vip = require("../modules/vip");
const official = require("../modules/official");
const { clearUser, updateSession } = require("../utils/sessionStore");

const HOME_COMMANDS = new Set(["黑域AI", "首頁", "開始", "menu", "選單", "主選單"]);
const CANCEL_COMMANDS = new Set(["取消", "退出", "返回首頁"]);
const VIP_COMMANDS = new Set(["VIP", "vip", "VIP中心", "VIP查詢", "我的VIP", "會員", "查VIP", "會員中心", "綁定", "綁定3A"]);
const ADMIN_COMMANDS = new Set(["管理指令", "管理員指令", "待審核", "會員列表"]);
const OFFICIAL_WEBSITE_COMMANDS = new Set(["官網", "黑域官網", "🌐 黑域官網"]);
const CONTACT_COMMANDS = new Set(["管理員", "客服", "聯繫管理員", "📞 聯繫管理員"]);

const AI_ENTRY_COMMANDS = new Set([
  "百家樂",
  "百家樂AI",
  "baccarat",
  "🎲 百家樂AI",
  "電子",
  "電子AI",
  "Electronic",
  "electronic",
  "⚡ 電子AI",
  "戰神賽特1",
  "戰神賽特2",
  "古神巴風特",
  "虎小妹",
  "赤三國",
  "539",
  "539AI",
  "今彩539",
  "🎯 539AI",
  "AI今日預測",
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
  return (
    ADMIN_COMMANDS.has(text) ||
    text.startsWith("開通 ") ||
    text.startsWith("查會員 ") ||
    text.startsWith("取消VIP ") ||
    text.startsWith("延長VIP ") ||
    text.startsWith("永久VIP ")
  );
}

function moduleNameFromText(text) {
  if (["百家樂", "百家樂AI", "baccarat", "🎲 百家樂AI"].includes(text)) return "baccarat";
  if (["電子", "電子AI", "Electronic", "electronic", "⚡ 電子AI", "戰神賽特1", "戰神賽特2", "古神巴風特", "虎小妹", "赤三國"].includes(text)) return "electronic";
  if (["539", "539AI", "今彩539", "🎯 539AI", "AI今日預測"].includes(text)) return "539";
  if (["體育", "體育AI", "SPORT", "SPORT AI", "世足", "世足AI", "MLB", "MLB AI", "NBA"].includes(text)) return "sports";
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

async function replyHome(event) {
  const userId = event.source.userId || "";
  clearAllUserSessions(userId);
  updateSession("home", userId, {
    currentPage: "首頁",
    currentFeature: null,
    returnTo: "首頁",
  });
  return reply(event.replyToken, mainMenuFlex());
}

async function handleEvent(event) {
  if (event.type !== "message") return;
  if (event.message.type !== "text") return;

  const text = event.message.text.trim();
  const userId = event.source.userId || "";

  if (text === "重新開始" && baccarat.hasActiveBaccaratSession && baccarat.hasActiveBaccaratSession(userId)) {
    return baccarat.handleBaccaratMessage(event);
  }

  if (HOME_COMMANDS.has(text) || CANCEL_COMMANDS.has(text)) {
    return replyHome(event);
  }

  if (VIP_COMMANDS.has(text) || isAdminCommand(text)) {
    clearAllUserSessions(userId);
    return vip.handleVipMessage(event);
  }

  if (OFFICIAL_WEBSITE_COMMANDS.has(text) || CONTACT_COMMANDS.has(text) || official.isOfficialCommand(text)) {
    clearAllUserSessions(userId);
    return official.handleOfficialMessage(event);
  }

  if (AI_ENTRY_COMMANDS.has(text)) {
    clearAllUserSessions(userId);
    const allowed = await ensureVipOrReply(event, moduleNameFromText(text));
    if (!allowed) return;
  }

  if (vip.hasActiveVipSession && vip.hasActiveVipSession(userId)) {
    return vip.handleVipMessage(event);
  }

  if (["電子", "電子AI", "Electronic", "electronic", "⚡ 電子AI"].includes(text)) {
    clearAllUserSessions(userId);
    return reply(event.replyToken, electronicMenuFlex());
  }

  if (baccarat.isBaccaratCommand(text) && ["百家樂", "百家樂AI", "baccarat", "🎲 百家樂AI"].includes(text)) {
    clearAllUserSessions(userId);
    return baccarat.handleBaccaratMessage(event);
  }

  if (lottery539.is539Command(text) && ["539", "539AI", "今彩539", "🎯 539AI"].includes(text)) {
    clearAllUserSessions(userId);
    return lottery539.handle539Message(event);
  }

  if (sports.isSportsCommand(text) && ["體育", "體育AI", "SPORT", "SPORT AI"].includes(text)) {
    clearAllUserSessions(userId);
    return sports.handleSportsMessage(event);
  }

  if (electronic.hasActiveElectronicSession(userId)) {
    const allowed = await ensureVipOrReply(event, "electronic");
    if (!allowed) return;
    const handled = await electronic.handleElectronicMessage(event);
    if (handled !== false) return handled;
  }

  if (electronic.isElectronicCommand(text)) return electronic.handleElectronicMessage(event);

  if (baccarat.hasActiveBaccaratSession(userId)) {
    const allowed = await ensureVipOrReply(event, "baccarat");
    if (!allowed) return;
    const handled = await baccarat.handleBaccaratMessage(event);
    if (handled !== false) return handled;
  }

  if (baccarat.isBaccaratCommand(text)) {
    const allowed = await ensureVipOrReply(event, "baccarat");
    if (!allowed) return;
    return baccarat.handleBaccaratMessage(event);
  }

  if (lottery539.is539Command(text)) return lottery539.handle539Message(event);
  if (sports.isSportsCommand(text)) return sports.handleSportsMessage(event);
  if (vip.isVipCommand(text)) return vip.handleVipMessage(event);

  return replyHome(event);
}

module.exports = {
  registerWebhookRoutes,
  handleEvent,
};
