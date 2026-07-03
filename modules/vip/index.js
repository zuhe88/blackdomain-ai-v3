const { lineClient, push, quickReply, reply } = require("../../services/line");
const { adminLineUserIds, isAdminLineUserId } = require("../../config/admin");
const { getSession, updateSession } = require("../../utils/sessionStore");
const { bubble, button, infoLine, metric, note } = require("../../ui/flex/premium");
const { COMMANDS, BIND_COMMANDS, ADMIN_COMMANDS, STATUSES } = require("./constants");
const {
  findVipByLineUserId,
  findVipBy3AAccount,
  normalizeVipRecord,
  normalizeStatus: normalizeDbStatus,
  bind3AAccount,
  openVipBy3AAccount,
  extendVipBy3AAccount,
  cancelVipBy3AAccount,
  listPendingMembers,
  listAllMembers,
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
    { label: "刷新VIP", text: "VIP查詢" },
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

function daysLeft(expiresAt) {
  if (!expiresAt) return "-";
  const diff = new Date(expiresAt).getTime() - Date.now();
  return String(Math.max(0, Math.ceil(diff / 86400000)));
}

function formatDate(expiresAt) {
  if (!expiresAt) return "-";
  return new Date(expiresAt).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" });
}

function normalizeStatus(record) {
  if (!record?.account3A) return STATUSES.UNBOUND;
  const status = normalizeDbStatus(record.status);
  if (status === "永久VIP") return STATUSES.ACTIVE;
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) return STATUSES.EXPIRED;
  if (status === STATUSES.ACTIVE) return STATUSES.ACTIVE;
  if (status === STATUSES.EXPIRED || status === STATUSES.CANCELLED) return STATUSES.EXPIRED;
  if (status === STATUSES.PENDING) return STATUSES.PENDING;
  return STATUSES.PENDING;
}

function hasAiPermission(record) {
  const status = normalizeStatus(record);
  if (!record?.account3A) return false;
  if (String(record.status || "") === "永久VIP") return true;
  if (status !== STATUSES.ACTIVE) return false;
  if (record.aiPermission === false || record.aiPermission === "false") return false;
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) return false;
  return true;
}

function aiPermissionText(status, account3A, isAdmin, record) {
  if (isAdmin) return "無限制";
  if (!account3A) return "尚未綁定3A帳號";
  if (hasAiPermission(record)) return AI_FEATURES;
  if (status === STATUSES.EXPIRED) return "VIP已過期";
  if (status === STATUSES.PENDING) return "等待管理員審核";
  return "尚未開通";
}

async function checkVipAccess(userId) {
  if (isAdminLineUserId(userId)) {
    return { allowed: true, isAdmin: true, record: null };
  }
  const record = normalizeVipRecord(await findVipByLineUserId(userId));
  return {
    allowed: hasAiPermission(record),
    isAdmin: false,
    record,
  };
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
      infoLine("下一步", "請輸入：綁定"),
      note("完成3A帳號綁定後，等待管理員審核開通。"),
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
      metric("請輸入", "您的3A帳號", "例如：abc123"),
      note("LINE userId 僅作為LINE身分識別，不會顯示成會員帳號。"),
    ],
  });
}

function bindSuccessFlex(account3A) {
  return bubble({
    altText: "綁定申請已送出",
    title: "綁定申請已送出",
    subtitle: "BLACKDOMAIN VIP",
    quickReply: vipQuickReply(false),
    footer: "BLACKDOMAIN VIP",
    contents: [
      metric("3A帳號", account3A, "狀態：待審核"),
      infoLine("申請結果", "已收到您的3A帳號綁定申請。"),
      infoLine("下一步", "等待管理員審核。"),
      button("查看VIP中心", "VIP"),
    ],
  });
}

async function notifyAdminsBind({ lineUserId, lineName, account3A }) {
  const message = bubble({
    altText: "新的綁定申請",
    title: "新的綁定申請",
    subtitle: "BLACKDOMAIN ADMIN",
    footer: "BLACKDOMAIN VIP ADMIN",
    contents: [
      infoLine("LINE名稱", lineName || "未取得"),
      infoLine("LINE User ID", lineUserId),
      infoLine("3A帳號", account3A),
      infoLine("狀態", "待審核"),
      button("管理指令", "管理指令"),
    ],
  });
  await Promise.all(adminLineUserIds().map((adminId) => push(adminId, message)));
}

function vipCenterFlex(userId, record, isAdmin = false) {
  if (isAdmin) {
    return bubble({
      altText: "VIP中心",
      title: "VIP中心",
      subtitle: "BLACKDOMAIN VIP",
      quickReply: vipQuickReply(true),
      footer: "BLACKDOMAIN VIP",
      contents: [
        metric("VIP狀態", "管理員", "永久VIP"),
        infoLine("LINE名稱", record?.lineName || "未取得"),
        infoLine("3A帳號", "管理員"),
        infoLine("AI權限", "無限制"),
        infoLine("到期日期", "永久"),
        infoLine("剩餘天數", "永久"),
        infoLine("最後更新時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
        button("管理指令", "管理指令"),
      ],
    });
  }

  const status = normalizeStatus(record);
  const account3A = record.account3A || "未綁定";
  const lineName = record.lineName || "未取得";
  const permission = aiPermissionText(status, record.account3A, false, record);
  const permanent = String(record.status || "") === "永久VIP";

  return bubble({
    altText: "VIP中心",
    title: "VIP中心",
    subtitle: "BLACKDOMAIN VIP",
    quickReply: vipQuickReply(false),
    footer: "BLACKDOMAIN VIP",
    contents: [
      metric("VIP狀態", status, "3A帳號綁定判定"),
      infoLine("LINE名稱", lineName),
      infoLine("3A帳號", account3A),
      infoLine("AI權限", permission),
      infoLine("到期日期", permanent ? "永久" : formatDate(record.expiresAt)),
      infoLine("剩餘天數", permanent ? "永久" : daysLeft(record.expiresAt)),
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

function adminResultFlex(title, lines, success = true) {
  return bubble({
    altText: title,
    title,
    subtitle: "BLACKDOMAIN VIP ADMIN",
    quickReply: adminQuickReply(),
    footer: "BLACKDOMAIN VIP ADMIN",
    contents: [
      metric("執行結果", success ? "完成" : "未完成", success ? "管理員操作" : "請確認資料"),
      ...lines.map(([label, value]) => infoLine(label, value)),
      button("管理指令", "管理指令", "secondary"),
    ],
  });
}

function memberLines(members) {
  if (!members.length) return [["資料", "目前沒有資料"]];
  return members.slice(0, 10).map((member, index) => [
    `#${index + 1}`,
    `${member.account3A || "未綁定"} / ${normalizeStatus(member)} / ${member.lineName || "未取得"}`,
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

  if (command === "待審核") {
    const pending = await listPendingMembers();
    return reply(event.replyToken, adminResultFlex("待審核", memberLines(pending), true));
  }

  if (command === "會員列表") {
    const members = await listAllMembers();
    return reply(event.replyToken, adminResultFlex("會員列表", memberLines(members), true));
  }

  if (!account3A) return reply(event.replyToken, adminHelpFlex());

  if (command === "查會員") {
    const record = normalizeVipRecord(await findVipBy3AAccount(account3A));
    return reply(event.replyToken, adminResultFlex("查會員", [
      ["LINE名稱", record.lineName || "未取得"],
      ["3A帳號", record.account3A || account3A],
      ["VIP狀態", normalizeStatus(record)],
      ["到期", String(record.status || "") === "永久VIP" ? "永久" : formatDate(record.expiresAt)],
      ["AI權限", hasAiPermission(record) ? "已開通" : "未開通"],
      ["LINE User ID", record.lineUserId || "未綁定"],
    ]));
  }

  if (command === "開通") {
    const permanent = value === "永久";
    const days = permanent ? 36500 : parseInt(value || "30", 10);
    const result = await openVipBy3AAccount({ account3A, days, permanent });
    return reply(event.replyToken, adminResultFlex("開通VIP", [
      ["3A帳號", account3A],
      ["期限", permanent ? "永久" : `${days}天`],
      ["狀態", result.ok ? "已開通" : result.error || "失敗"],
    ], result.ok));
  }

  if (command === "永久VIP") {
    const result = await openVipBy3AAccount({ account3A, permanent: true });
    return reply(event.replyToken, adminResultFlex("永久VIP", [
      ["3A帳號", account3A],
      ["狀態", result.ok ? "已設為永久VIP" : result.error || "失敗"],
    ], result.ok));
  }

  if (command === "延長VIP") {
    const days = parseInt(value || "30", 10);
    const result = await extendVipBy3AAccount(account3A, days);
    return reply(event.replyToken, adminResultFlex("延長VIP", [
      ["3A帳號", account3A],
      ["增加天數", `${days}天`],
      ["狀態", result.ok ? "已延長" : result.error || "失敗"],
    ], result.ok));
  }

  if (command === "取消VIP") {
    const result = await cancelVipBy3AAccount(account3A);
    return reply(event.replyToken, adminResultFlex("取消VIP", [
      ["3A帳號", account3A],
      ["狀態", result.ok ? "已取消" : result.error || "失敗"],
    ], result.ok));
  }

  return reply(event.replyToken, adminHelpFlex());
}

async function handleBindInput(event) {
  const userId = event.source.userId || "";
  const account3A = event.message.text.trim();
  const lineName = await getLineName(userId);
  const result = await bind3AAccount({ lineUserId: userId, lineName, account3A });
  await notifyAdminsBind({ lineUserId: userId, lineName, account3A });
  updateSession("vip", userId, {
    binding3A: false,
    account3A,
    vipStatus: STATUSES.PENDING,
    aiPermission: false,
    lastUpdated: Date.now(),
  });
  return reply(event.replyToken, bindSuccessFlex(account3A, result.ok));
}

async function handleVipMessage(event) {
  const userId = event.source.userId || "";
  const text = event.message.text.trim();
  const session = getSession("vip", userId) || {};

  if (ADMIN_COMMANDS.some((cmd) => text === cmd || text.startsWith(`${cmd} `))) {
    return handleAdminCommand(event);
  }

  if (BIND_COMMANDS.includes(text)) {
    updateSession("vip", userId, { binding3A: true, lastUpdated: Date.now() });
    return reply(event.replyToken, bindPromptFlex());
  }

  if (session.binding3A) {
    return handleBindInput(event);
  }

  const isAdmin = isAdminLineUserId(userId);
  const record = isAdmin
    ? { lineName: await getLineName(userId) }
    : normalizeVipRecord(await findVipByLineUserId(userId));
  const status = isAdmin ? STATUSES.ADMIN : normalizeStatus(record);
  const permission = aiPermissionText(status, record.account3A, isAdmin, record);

  updateSession("vip", userId, {
    vipStatus: status,
    account3A: isAdmin ? "管理員" : record.account3A || "未綁定",
    aiPermission: permission,
    expiresAt: isAdmin ? "永久" : record.expiresAt || null,
    daysLeft: isAdmin ? "永久" : daysLeft(record.expiresAt),
    lastUpdated: Date.now(),
  });

  return reply(event.replyToken, vipCenterFlex(userId, record, isAdmin));
}

module.exports = {
  isVipCommand,
  hasActiveVipSession,
  handleVipMessage,
  checkVipAccess,
  accessDeniedFlex,
};
