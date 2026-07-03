const { lineClient, push, quickReply, reply } = require("../../services/line");
const { adminLineUserIds, isAdminLineUserId } = require("../../config/admin");
const { getSession, updateSession } = require("../../utils/sessionStore");
const { bubble, button, infoLine, metric, note } = require("../../ui/flex/premium");
const { COMMANDS, BIND_COMMANDS, ADMIN_COMMANDS, STATUSES } = require("./constants");
const {
  STATUS,
  findVipUserByLineUserId,
  findVipUserBy3AAccount,
  findActiveRequestByLineUserId,
  findActiveRequestBy3AAccount,
  submitVipRequest,
  approveVip,
  extendVip,
  cancelVip,
  listPendingRequests,
  listVipUsers,
  logAiUsage,
} = require("./repository");

const AI_FEATURES = "百家樂AI / 電子AI / 體育AI / 539AI";

function isVipCommand(text) {
  const value = String(text || "").trim();
  return (
    COMMANDS.includes(value) ||
    BIND_COMMANDS.includes(value) ||
    ADMIN_COMMANDS.some((cmd) => value === cmd || value.startsWith(`${cmd} `))
  );
}

function hasActiveVipSession(userId) {
  const session = getSession("vip", userId) || {};
  return Boolean(session.binding3A);
}

function vipQuickReply(isAdmin = false) {
  const items = [
    { label: "刷新VIP", text: "VIP" },
    { label: "綁定3A", text: "綁定" },
    { label: "返回首頁", text: "首頁" },
  ];
  if (isAdmin) items.unshift({ label: "管理指令", text: "管理指令" });
  return quickReply(items);
}

function adminQuickReply() {
  return quickReply([
    { label: "待審核", text: "待審核" },
    { label: "會員列表", text: "會員列表" },
    { label: "VIP中心", text: "VIP" },
  ]);
}

async function getLineName(userId) {
  try {
    if (!userId || !lineClient.getProfile) return "未取得";
    const profile = await lineClient.getProfile(userId);
    return profile?.displayName || "未取得";
  } catch (error) {
    return "未取得";
  }
}

function formatDate(value) {
  if (!value) return "永久";
  return new Date(value).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" });
}

function daysLeft(value) {
  if (!value) return "永久";
  const diff = new Date(value).getTime() - Date.now();
  return String(Math.max(0, Math.ceil(diff / 86400000)));
}

function vipStatusText(user) {
  if (!user?.account3A) return STATUSES.UNBOUND;
  if (user.vipStatus === STATUS.CANCELLED) return STATUSES.CANCELLED;
  if (user.vipStatus === STATUS.APPROVED && user.expiresAt && new Date(user.expiresAt).getTime() <= Date.now()) return STATUSES.EXPIRED;
  if (user.vipStatus === STATUS.APPROVED) return STATUSES.ACTIVE;
  return STATUSES.PENDING;
}

function hasAiPermission(user) {
  if (!user?.account3A) return false;
  if (user.isAdmin) return true;
  if (user.vipStatus !== STATUS.APPROVED) return false;
  if (user.aiPermission !== true) return false;
  if (!user.expiresAt) return true;
  return new Date(user.expiresAt).getTime() > Date.now();
}

async function checkVipAccess(userId) {
  if (isAdminLineUserId(userId)) return { allowed: true, isAdmin: true, user: null };
  const user = await findVipUserByLineUserId(userId);
  return { allowed: hasAiPermission(user), isAdmin: false, user };
}

function simpleFlex({ title, subtitle = "BLACKDOMAIN VIP", rows = [], quickReply: qr = vipQuickReply(false), footer = "BLACKDOMAIN VIP" }) {
  return bubble({
    altText: title,
    title,
    subtitle,
    quickReply: qr,
    footer,
    contents: rows.map(([label, value]) => infoLine(label, value)),
  });
}

function accessDeniedFlex() {
  return bubble({
    altText: "尚未開通黑域AI",
    title: "尚未開通黑域AI",
    subtitle: "BLACKDOMAIN VIP",
    quickReply: vipQuickReply(false),
    footer: "BLACKDOMAIN VIP",
    contents: [
      metric("AI權限", "尚未開通", "請先完成3A帳號綁定"),
      infoLine("請輸入", "綁定"),
      note("完成綁定後，等待管理員審核開通。"),
    ],
  });
}

function bindPromptFlex() {
  return bubble({
    altText: "綁定3A帳號",
    title: "綁定3A帳號",
    subtitle: "BLACKDOMAIN VIP",
    quickReply: quickReply([{ label: "取消", text: "取消" }]),
    footer: "BLACKDOMAIN VIP",
    contents: [
      metric("請輸入", "您的3A帳號", "範例：abc123"),
      note("LINE User ID 只作為身分識別，不會顯示為會員ID。"),
    ],
  });
}

function bindSuccessFlex(account3A) {
  return bubble({
    altText: "已收到綁定申請",
    title: "已收到綁定申請",
    subtitle: "BLACKDOMAIN VIP",
    quickReply: vipQuickReply(false),
    footer: "BLACKDOMAIN VIP",
    contents: [
      metric("3A帳號", account3A, "狀態：待審核"),
      infoLine("申請結果", "已收到您的3A帳號綁定申請。"),
      infoLine("下一步", "請等待管理員審核。"),
      button("查看VIP中心", "VIP"),
    ],
  });
}

function alreadyBoundFlex(account3A) {
  return simpleFlex({
    title: "已綁定3A帳號",
    rows: [
      ["狀態", "您已綁定 3A帳號"],
      ["3A帳號", account3A || "未取得"],
      ["提醒", "如需更換帳號，請聯繫管理員。"],
    ],
  });
}

function pendingBindFlex(account3A) {
  return simpleFlex({
    title: "綁定申請待審核",
    rows: [
      ["狀態", "您已有綁定申請待審核。"],
      ["3A帳號", account3A || "未取得"],
      ["提醒", "請等待管理員審核。"],
    ],
  });
}

function accountTakenFlex() {
  return simpleFlex({
    title: "3A帳號無法申請",
    rows: [["提醒", "此 3A帳號已被綁定或申請中，請聯繫管理員確認。"]],
  });
}

async function notifyAdminsBind({ lineUserId, lineName, account3A }) {
  const message = simpleFlex({
    title: "新的綁定申請",
    subtitle: "BLACKDOMAIN ADMIN",
    footer: "BLACKDOMAIN VIP ADMIN",
    quickReply: adminQuickReply(),
    rows: [
      ["LINE名稱", lineName || "未取得"],
      ["LINE User ID", lineUserId],
      ["3A帳號", account3A],
      ["狀態", "待審核"],
    ],
  });
  await Promise.all(adminLineUserIds().map((adminId) => push(adminId, message)));
}

function vipCenterFlex(user, isAdmin = false) {
  if (isAdmin) {
    return bubble({
      altText: "VIP中心",
      title: "VIP中心",
      subtitle: "BLACKDOMAIN VIP",
      quickReply: vipQuickReply(true),
      footer: "BLACKDOMAIN VIP",
      contents: [
        metric("VIP狀態", "管理員", "永久VIP"),
        infoLine("LINE名稱", user?.lineName || "未取得"),
        infoLine("3A帳號", "管理員"),
        infoLine("AI權限", "無限制"),
        infoLine("到期日期", "永久"),
        infoLine("剩餘天數", "永久"),
        infoLine("最後更新時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
        button("管理指令", "管理指令"),
      ],
    });
  }

  const status = vipStatusText(user);
  const permission = hasAiPermission(user) ? AI_FEATURES : user.account3A ? "尚未開通" : "尚未綁定3A帳號";

  return bubble({
    altText: "VIP中心",
    title: "VIP中心",
    subtitle: "BLACKDOMAIN VIP",
    quickReply: vipQuickReply(false),
    footer: "BLACKDOMAIN VIP",
    contents: [
      metric("VIP狀態", status, "3A帳號綁定與AI權限"),
      infoLine("LINE名稱", user.lineName || "未取得"),
      infoLine("3A帳號", user.account3A || "未綁定"),
      infoLine("AI權限", permission),
      infoLine("到期日期", formatDate(user.expiresAt)),
      infoLine("剩餘天數", daysLeft(user.expiresAt)),
      infoLine("最後更新時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
      button("綁定3A帳號", "綁定"),
      button("聯繫管理員", "聯繫管理員", "secondary"),
    ],
  });
}

function adminHelpFlex() {
  return bubble({
    altText: "管理員功能",
    title: "管理員功能",
    subtitle: "BLACKDOMAIN ADMIN",
    quickReply: adminQuickReply(),
    footer: "BLACKDOMAIN VIP ADMIN",
    contents: [
      infoLine("待審核", "列出所有 pending"),
      infoLine("查會員", "查會員 abc123"),
      infoLine("開通", "開通 abc123 30 / 開通 abc123 永久"),
      infoLine("取消VIP", "取消VIP abc123"),
      infoLine("延長VIP", "延長VIP abc123 30"),
      infoLine("永久VIP", "永久VIP abc123"),
      infoLine("會員列表", "列出所有會員"),
    ],
  });
}

function adminResultFlex(title, rows, success = true) {
  return bubble({
    altText: title,
    title,
    subtitle: "BLACKDOMAIN VIP ADMIN",
    quickReply: adminQuickReply(),
    footer: "BLACKDOMAIN VIP ADMIN",
    contents: [
      metric("處理結果", success ? "完成" : "未完成", success ? "管理員操作完成" : "請確認資料"),
      ...rows.map(([label, value]) => infoLine(label, value)),
      button("管理指令", "管理指令", "secondary"),
    ],
  });
}

function memberRows(members) {
  if (!members.length) return [["資料", "目前沒有資料"]];
  return members.slice(0, 10).map((member, index) => [
    `#${index + 1}`,
    `${member.account3A || "未綁定"} / ${vipStatusText(member)} / ${member.lineName || "未取得"}`,
  ]);
}

async function handleAdminCommand(event) {
  const userId = event.source.userId || "";
  const text = event.message.text.trim();
  if (!isAdminLineUserId(userId)) {
    return reply(event.replyToken, adminResultFlex("權限不足", [["狀態", "無權限使用此功能。"]], false));
  }

  if (text === "管理指令" || text === "管理員指令") return reply(event.replyToken, adminHelpFlex());

  const [command, account3A, value] = text.split(/\s+/).filter(Boolean);
  if (command === "待審核") return reply(event.replyToken, adminResultFlex("待審核", memberRows(await listPendingRequests())));
  if (command === "會員列表") return reply(event.replyToken, adminResultFlex("會員列表", memberRows(await listVipUsers())));
  if (!account3A) return reply(event.replyToken, adminHelpFlex());

  if (command === "查會員") {
    const user = await findVipUserBy3AAccount(account3A);
    return reply(event.replyToken, adminResultFlex("查會員", [
      ["LINE名稱", user.lineName || "未取得"],
      ["3A帳號", user.account3A || account3A],
      ["VIP狀態", vipStatusText(user)],
      ["AI權限", hasAiPermission(user) ? "已開通" : "尚未開通"],
      ["到期", formatDate(user.expiresAt)],
      ["剩餘天數", daysLeft(user.expiresAt)],
      ["LINE User ID", user.lineUserId || "未綁定"],
    ]));
  }

  if (command === "開通") {
    const permanent = value === "永久";
    const days = permanent ? 36500 : parseInt(value || "30", 10);
    const result = await approveVip({ account3A, days, permanent, adminLineUserId: userId });
    return reply(event.replyToken, adminResultFlex("開通VIP", [
      ["3A帳號", account3A],
      ["天數", permanent ? "永久" : `${days}天`],
      ["狀態", result.ok ? "已開通" : result.error || "失敗"],
    ], result.ok));
  }

  if (command === "永久VIP") {
    const result = await approveVip({ account3A, permanent: true, adminLineUserId: userId });
    return reply(event.replyToken, adminResultFlex("永久VIP", [
      ["3A帳號", account3A],
      ["狀態", result.ok ? "已設為永久VIP" : result.error || "失敗"],
    ], result.ok));
  }

  if (command === "延長VIP") {
    const days = parseInt(value || "30", 10);
    const result = await extendVip(account3A, days, userId);
    return reply(event.replyToken, adminResultFlex("延長VIP", [
      ["3A帳號", account3A],
      ["增加天數", `${days}天`],
      ["狀態", result.ok ? "已延長" : result.error || "失敗"],
    ], result.ok));
  }

  if (command === "取消VIP") {
    const result = await cancelVip(account3A, userId);
    return reply(event.replyToken, adminResultFlex("取消VIP", [
      ["3A帳號", account3A],
      ["狀態", result.ok ? "已取消" : result.error || "失敗"],
    ], result.ok));
  }

  return reply(event.replyToken, adminHelpFlex());
}

async function handleBindCommand(event) {
  const lineUserId = event.source.userId || "";
  const existingUser = await findVipUserByLineUserId(lineUserId);
  if (existingUser.account3A) {
    updateSession("vip", lineUserId, { binding3A: false, lastUpdated: Date.now() });
    return reply(event.replyToken, alreadyBoundFlex(existingUser.account3A));
  }

  const existingRequest = await findActiveRequestByLineUserId(lineUserId);
  if (existingRequest?.status === STATUS.PENDING) {
    updateSession("vip", lineUserId, { binding3A: false, lastUpdated: Date.now() });
    return reply(event.replyToken, pendingBindFlex(existingRequest.account3A));
  }
  if (existingRequest?.status === STATUS.APPROVED) {
    updateSession("vip", lineUserId, { binding3A: false, lastUpdated: Date.now() });
    return reply(event.replyToken, alreadyBoundFlex(existingRequest.account3A));
  }

  updateSession("vip", lineUserId, { binding3A: true, lastUpdated: Date.now() });
  return reply(event.replyToken, bindPromptFlex());
}

async function handleBindInput(event) {
  const lineUserId = event.source.userId || "";
  const account3A = event.message.text.trim();

  const accountUser = await findVipUserBy3AAccount(account3A);
  if (accountUser.account3A) {
    updateSession("vip", lineUserId, { binding3A: false, lastUpdated: Date.now() });
    return reply(event.replyToken, accountTakenFlex());
  }

  const accountRequest = await findActiveRequestBy3AAccount(account3A);
  if (accountRequest) {
    updateSession("vip", lineUserId, { binding3A: false, lastUpdated: Date.now() });
    return reply(event.replyToken, accountTakenFlex());
  }

  const lineName = await getLineName(lineUserId);
  const result = await submitVipRequest({ lineUserId, lineName, account3A });
  updateSession("vip", lineUserId, { binding3A: false, account3A, vipStatus: STATUS.PENDING, lastUpdated: Date.now() });

  if (!result.ok) {
    if (result.code === "LINE_ALREADY_BOUND") return reply(event.replyToken, alreadyBoundFlex(result.user?.account3A || result.request?.account3A));
    if (result.code === "LINE_PENDING") return reply(event.replyToken, pendingBindFlex(result.request?.account3A));
    if (result.code === "ACCOUNT_TAKEN" || result.code === "DUPLICATE") return reply(event.replyToken, accountTakenFlex());
    return reply(event.replyToken, simpleFlex({ title: "綁定失敗", rows: [["原因", result.error || "系統忙碌中，請稍後再試。"]] }));
  }

  await notifyAdminsBind({ lineUserId, lineName, account3A });
  return reply(event.replyToken, bindSuccessFlex(account3A));
}

async function handleVipMessage(event) {
  const lineUserId = event.source.userId || "";
  const text = event.message.text.trim();
  const session = getSession("vip", lineUserId) || {};

  if (ADMIN_COMMANDS.some((cmd) => text === cmd || text.startsWith(`${cmd} `))) return handleAdminCommand(event);
  if (BIND_COMMANDS.includes(text)) return handleBindCommand(event);
  if (session.binding3A) return handleBindInput(event);

  const isAdmin = isAdminLineUserId(lineUserId);
  const user = isAdmin
    ? { lineName: await getLineName(lineUserId), account3A: "管理員", vipStatus: STATUS.APPROVED, aiPermission: true, expiresAt: null, isAdmin: true }
    : await findVipUserByLineUserId(lineUserId);

  updateSession("vip", lineUserId, {
    vipStatus: isAdmin ? "管理員" : vipStatusText(user),
    account3A: isAdmin ? "管理員" : user.account3A || "未綁定",
    aiPermission: isAdmin ? "無限制" : hasAiPermission(user),
    expiresAt: isAdmin ? "永久" : user.expiresAt || null,
    daysLeft: isAdmin ? "永久" : daysLeft(user.expiresAt),
    lastUpdated: Date.now(),
  });

  return reply(event.replyToken, vipCenterFlex(user, isAdmin));
}

module.exports = {
  isVipCommand,
  hasActiveVipSession,
  handleVipMessage,
  checkVipAccess,
  accessDeniedFlex,
  logAiUsage,
};
