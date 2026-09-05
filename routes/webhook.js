const { line, lineConfig, reply } = require("../services/line");
const { logError } = require("../utils/errorCodes");
const mainMenuFlex = require("../ui/mainMenuFlex");
const welcomeFlex = require("../ui/welcomeFlex");
const electronicMenuFlex = require("../ui/flex/electronicMenu");
const lotteryMenuFlex = require("../ui/flex/lotteryMenu");
const electronic = require("../modules/electronic");
const baccarat = require("../modules/baccarat");
const sports = require("../modules/sports");
const lottery539 = require("../modules/lottery539");
const mb = require("../modules/mb");
const vip = require("../modules/vip");
const official = require("../modules/official");
const { isAdminLineUserId } = require("../config/admin");
const { isLineWebsiteOnlyMode } = require("../config/lineWebsiteMode");
const { clearUser, updateSession } = require("../utils/sessionStore");
const webChannel = require("../services/webChannel");
const { text: textMessage } = require("../services/line");

const HOME_COMMANDS = new Set(["黑域AI", "首頁", "開始", "menu", "選單", "主選單"]);
const CANCEL_COMMANDS = new Set(["取消", "退出", "返回首頁"]);
const VIP_COMMANDS = new Set(["VIP", "vip", "VIP中心", "VIP查詢", "我的VIP", "會員", "查VIP", "會員中心", "綁定", "綁定3A"]);
const ADMIN_COMMANDS = new Set([
  "管理指令",
  "管理員指令",
  "待審核",
  "會員列表",
  "全部開放權限",
  "恢復原權限",
  "開放全部電子遊戲",
  "僅開放賽特2",
]);
const OFFICIAL_WEBSITE_COMMANDS = new Set(["官網", "黑域官網", "🌐 黑域官網"]);
const CONTACT_COMMANDS = new Set(["管理員", "客服", "聯繫管理員", "📞 聯繫管理員"]);
const WELCOME_PREVIEW_COMMANDS = new Set(["歡迎訊息", "測試歡迎訊息"]);

const AI_BROWSE_COMMANDS = new Set([
  "百家樂",
  "百家樂AI",
  "baccarat",
  "🎲 百家樂AI",
  "電子",
  "電子AI",
  "Electronic",
  "electronic",
  "⚡ 電子AI",
  "ATGAI",
  "ATG AI",
  "彩票",
  "彩票AI",
  "🎟️ 彩票AI",
  "體育",
  "體育AI",
  "SPORT",
  "SPORT AI",
  "ATG",
]);

function registerWebhookRoutes(app) {
  app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
    res.status(200).end();
    const events = req.body.events || [];
    const eventGroups = new Map();
    events.forEach((event, index) => {
      const key = event.source?.userId || event.source?.groupId || `event-${index}`;
      const group = eventGroups.get(key) || [];
      group.push(event);
      eventGroups.set(key, group);
    });
    await Promise.allSettled([...eventGroups.values()].map(async (group) => {
      for (const event of group) {
        try {
          await handleEvent(event);
        } catch (err) {
          logError("E008", err);
        }
      }
    }));
  });
}

async function clearAllUserSessions(userId) {
  clearUser(userId);
  if (electronic.resetElectronicSession) electronic.resetElectronicSession(userId);
  if (baccarat.resetBaccaratSession) await baccarat.resetBaccaratSession(userId);
  if (mb.resetMbSession) mb.resetMbSession(userId);
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

function websiteAccessReply(event) {
  const userId = event.source?.userId || "";
  const code = webChannel.issue(userId);
  const base = String(
    process.env.PUBLIC_BASE_URL || "https://blackdomain-ai-v3-production.up.railway.app",
  ).replace(/\/$/, "");
  return reply(event.replyToken, textMessage(
    `黑域AI LINE 分析功能暫時改由網站版提供\n\n網站登入連結（10 分鐘內有效）：\n${base}/portal/login?code=${code}\n\n請點擊連結進入分析中心，請勿轉傳。`,
  ));
}

async function ensureVipOrReply(event, moduleName) {
  const access = await vip.checkVipAccess(event.source.userId || "");
  if (!access.allowed) {
    await reply(event.replyToken, vip.accessDeniedFlex(moduleName));
    return false;
  }

  if (access.user?.account3A || access.isAdmin || access.globalAccess) {
    await vip.logAiUsage({
      lineUserId: event.source.userId || "",
      threeAAccount: access.user?.account3A || (access.isAdmin ? "管理員" : "全線臨時開放"),
      module: moduleName,
    });
  }

  return true;
}

async function replyHome(event) {
  const userId = event.source.userId || "";
  await clearAllUserSessions(userId);
  updateSession("home", userId, {
    currentPage: "首頁",
    currentFeature: null,
    returnTo: "首頁",
  });
  return reply(event.replyToken, mainMenuFlex());
}

async function handleEvent(event) {
  if (event.type === "follow") {
    return reply(event.replyToken, welcomeFlex());
  }

  if (event.type !== "message") return;
  if (event.message.type !== "text") return;

  const text = event.message.text.trim();
  const userId = event.source.userId || "";
  const isWebsiteCommand = String(event.replyToken || "").startsWith("web:");

  if (["網站登入", "網頁登入"].includes(text)) return websiteAccessReply(event);

  const adminLineCommand = isAdminLineUserId(userId) && (
    WELCOME_PREVIEW_COMMANDS.has(text)
    || VIP_COMMANDS.has(text)
    || isAdminCommand(text)
    || electronic.ADMIN_REFRESH_COMMANDS?.has(text)
  );
  const memberUtilityCommand = (
    HOME_COMMANDS.has(text)
    || CANCEL_COMMANDS.has(text)
    || VIP_COMMANDS.has(text)
    || vip.isVipCommand(text)
    || vip.hasActiveVipSession?.(userId)
    || OFFICIAL_WEBSITE_COMMANDS.has(text)
    || CONTACT_COMMANDS.has(text)
    || official.isOfficialCommand(text)
  );
  if (
    isLineWebsiteOnlyMode()
    && !isWebsiteCommand
    && !adminLineCommand
    && !memberUtilityCommand
  ) {
    return websiteAccessReply(event);
  }

  if (WELCOME_PREVIEW_COMMANDS.has(text) && isAdminLineUserId(userId)) {
    return reply(event.replyToken, welcomeFlex());
  }

  if (electronic.ADMIN_REFRESH_COMMANDS?.has(text)) {
    return electronic.handleAdminRefreshCommand(event);
  }

  if (electronic.isStopWatchCommand?.(text)) {
    return electronic.handleElectronicMessage(event);
  }

  if (electronic.isCancelRecommendationCommand?.(text)) {
    return electronic.handleElectronicMessage(event);
  }

  if (
    text === "重新開始"
    && baccarat.hasActiveBaccaratSession
    && baccarat.hasActiveBaccaratSession(userId)
  ) {
    return baccarat.handleBaccaratMessage(event);
  }

  if (HOME_COMMANDS.has(text) || CANCEL_COMMANDS.has(text)) {
    return replyHome(event);
  }

  if (VIP_COMMANDS.has(text) || isAdminCommand(text)) {
    await clearAllUserSessions(userId);
    return vip.handleVipMessage(event);
  }

  if (OFFICIAL_WEBSITE_COMMANDS.has(text) || CONTACT_COMMANDS.has(text) || official.isOfficialCommand(text)) {
    await clearAllUserSessions(userId);
    return official.handleOfficialMessage(event);
  }

  if (AI_BROWSE_COMMANDS.has(text)) {
    await clearAllUserSessions(userId);
  }

  if (vip.hasActiveVipSession && vip.hasActiveVipSession(userId)) {
    return vip.handleVipMessage(event);
  }

  if (["ATG", "ATGAI", "ATG AI", "電子", "電子AI", "Electronic", "electronic", "⚡ 電子AI"].includes(text)) {
    await clearAllUserSessions(userId);
    return reply(event.replyToken, electronicMenuFlex(electronic.isElectronicGameEnabled));
  }

  if (["彩票", "彩票AI", "🎟️ 彩票AI"].includes(text)) {
    await clearAllUserSessions(userId);
    return reply(event.replyToken, lotteryMenuFlex());
  }

  if (baccarat.isBaccaratCommand(text) && ["百家樂", "百家樂AI", "baccarat", "🎲 百家樂AI"].includes(text)) {
    await clearAllUserSessions(userId);
    return baccarat.handleBaccaratMessage(event);
  }

  if (lottery539.is539Command(text) && ["539", "539AI", "今彩539", "🎯 539AI"].includes(text)) {
    await clearAllUserSessions(userId);
    const allowed = await ensureVipOrReply(event, "539");
    if (!allowed) return;
    return lottery539.handle539Message(event);
  }

  if (sports.isSportsCommand(text) && ["體育", "體育AI", "SPORT", "SPORT AI"].includes(text)) {
    await clearAllUserSessions(userId);
    return sports.handleSportsMessage(event);
  }

  if (electronic.hasActiveElectronicSession(userId)) {
    const allowed = await ensureVipOrReply(event, "electronic");
    if (!allowed) return;
    const handled = await electronic.handleElectronicMessage(event);
    if (handled !== false) return handled;
  }

  if (electronic.isElectronicCommand(text)) {
    const allowed = await ensureVipOrReply(event, "electronic");
    if (!allowed) return;
    return electronic.handleElectronicMessage(event);
  }

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

  if (lottery539.is539Command(text)) {
    const allowed = await ensureVipOrReply(event, "539");
    if (!allowed) return;
    return lottery539.handle539Message(event);
  }
  if (mb.hasActiveMbSession(userId) || mb.isMbCommand(text)) {
    const allowed = await ensureVipOrReply(event, "mb");
    if (!allowed) return;
    const handled = await mb.handleMbMessage(event);
    if (handled !== false) return handled;
  }
  if (sports.isSportsCommand(text)) {
    const allowed = await ensureVipOrReply(event, "sports");
    if (!allowed) return;
    return sports.handleSportsMessage(event);
  }
  if (vip.isVipCommand(text)) return vip.handleVipMessage(event);

  return replyHome(event);
}

module.exports = {
  registerWebhookRoutes,
  handleEvent,
  clearAllUserSessions,
};
