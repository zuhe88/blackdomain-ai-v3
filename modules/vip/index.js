const { reply, quickReply } = require("../../services/line");
const { isAdminLineUserId } = require("../../config/admin");
const { updateSession } = require("../../utils/sessionStore");
const { bubble, button, infoLine, metric, note } = require("../../ui/flex/premium");
const {
  COMMANDS,
  STATUSES,
} = require("./constants");
const {
  findVipByLineUserId,
  findVipBy3AAccount,
  normalizeVipRecord,
  openVipBy3AAccount,
  extendVipBy3AAccount,
  cancelVipBy3AAccount,
} = require("./repository");

const ADMIN_COMMANDS = ["開通VIP", "延長VIP", "取消VIP", "查詢VIP", "VIP管理"];
const AI_FEATURES = "百家樂AI / 電子AI / 體育AI / 539AI";

function isVipCommand(text) {
  const value = String(text || "").trim();
  return COMMANDS.includes(value) || ADMIN_COMMANDS.some((cmd) => value === cmd || value.startsWith(`${cmd} `));
}

function vipQuickReply(isAdmin = false) {
  const items = [
    { label: "刷新VIP", text: "VIP查詢" },
    { label: "聯繫管理員", text: "聯繫管理員" },
    { label: "返回首頁", text: "首頁" },
  ];

  if (isAdmin) {
    items.unshift({ label: "VIP管理", text: "VIP管理" });
  }

  return quickReply(items);
}

function adminQuickReply() {
  return quickReply([
    { label: "VIP中心", text: "VIP" },
    { label: "查詢VIP", text: "查詢VIP" },
    { label: "返回首頁", text: "首頁" },
  ]);
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

  const raw = String(record.status || "").trim();
  const expiresAt = record.expiresAt;
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return STATUSES.EXPIRED;
  if (raw === STATUSES.ACTIVE || raw === "active" || raw === "VIP" || raw === "已開通") return STATUSES.ACTIVE;
  if (raw === STATUSES.EXPIRED || raw === "expired" || raw === "已過期") return STATUSES.EXPIRED;
  if (raw === STATUSES.PENDING || raw === "pending" || raw === "待審核") return STATUSES.PENDING;
  return STATUSES.PENDING;
}

function aiPermission(status, account3A, isAdmin) {
  if (isAdmin) return "無限制";
  if (!account3A) return "尚未綁定3A帳號";
  if (status === STATUSES.ACTIVE) return AI_FEATURES;
  if (status === STATUSES.EXPIRED) return "VIP已過期";
  return "尚未開通";
}

async function loadVip(userId) {
  try {
    return normalizeVipRecord(await findVipByLineUserId(userId));
  } catch (err) {
    console.error("VIP_QUERY_ERROR:", err.message);
  }

  return normalizeVipRecord(null);
}

function adminVipFlex(userId) {
  return bubble({
    altText: "VIP中心",
    title: "VIP中心",
    subtitle: "BLACKDOMAIN VIP",
    quickReply: vipQuickReply(true),
    footer: "BLACKDOMAIN VIP",
    contents: [
      metric("VIP狀態", STATUSES.ADMIN, "管理員帳號"),
      infoLine("LINE名稱", "未取得"),
      infoLine("3A帳號", "管理員"),
      infoLine("LINE身分識別", userId || "未取得"),
      infoLine("到期日期", "永久"),
      infoLine("剩餘天數", "永久"),
      infoLine("AI權限", "無限制"),
      infoLine("最後更新時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
      button("VIP管理", "VIP管理"),
      button("返回首頁", "首頁", "secondary"),
      note("管理員可用 3A帳號 查詢、開通、延長或取消 VIP。"),
    ],
  });
}

function vipFlex(userId, vipRecord, isAdmin = false) {
  if (isAdmin) return adminVipFlex(userId);

  const status = normalizeStatus(vipRecord);
  const account3A = vipRecord.account3A || "未綁定";
  const lineName = vipRecord.lineName || "未取得";
  const expiresAtText = status === STATUSES.ACTIVE || status === STATUSES.EXPIRED ? formatDate(vipRecord.expiresAt) : "-";
  const daysText = status === STATUSES.ACTIVE || status === STATUSES.EXPIRED ? daysLeft(vipRecord.expiresAt) : "-";

  return bubble({
    altText: "VIP中心",
    title: "VIP中心",
    subtitle: "BLACKDOMAIN VIP",
    quickReply: vipQuickReply(false),
    footer: "BLACKDOMAIN VIP",
    contents: [
      metric("VIP狀態", status, "AI權限綁定3A帳號判定"),
      infoLine("LINE名稱", lineName),
      infoLine("3A帳號", account3A),
      infoLine("到期日期", expiresAtText),
      infoLine("剩餘天數", daysText),
      infoLine("AI權限", aiPermission(status, vipRecord.account3A, false)),
      infoLine("最後更新時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
      button("聯繫管理員", "聯繫管理員"),
      button("返回首頁", "首頁", "secondary"),
      note("LINE userId 僅作為 LINE 身分識別，不作為3A帳號或開通依據。"),
    ],
  });
}

function adminHelpFlex() {
  return bubble({
    altText: "VIP管理",
    title: "VIP管理",
    subtitle: "BLACKDOMAIN ADMIN",
    quickReply: adminQuickReply(),
    footer: "BLACKDOMAIN VIP ADMIN",
    contents: [
      infoLine("查詢", "查詢VIP 3A帳號"),
      infoLine("開通", "開通VIP 3A帳號 天數"),
      infoLine("延長", "延長VIP 3A帳號 天數"),
      infoLine("取消", "取消VIP 3A帳號"),
      note("所有 VIP 操作以 3A帳號 為主，LINE userId 只作身分對應。"),
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
      metric("執行結果", success ? "完成" : "未完成", success ? "管理員操作" : "請確認輸入或資料"),
      ...lines.map(([label, value]) => infoLine(label, value)),
      button("VIP管理", "VIP管理", "secondary"),
    ],
  });
}

function parseAdminCommand(text) {
  const parts = String(text || "").trim().split(/\s+/).filter(Boolean);
  return {
    command: parts[0],
    account3A: parts[1],
    days: parts[2] ? parseInt(parts[2], 10) : null,
    lineUserId: parts[3] || null,
  };
}

async function handleAdminCommand(event) {
  const userId = event.source.userId || "";
  const text = event.message.text.trim();

  if (!isAdminLineUserId(userId)) {
    return reply(
      event.replyToken,
      adminResultFlex("權限不足", [["狀態", "無權限使用此功能。"]], false)
    );
  }

  if (text === "VIP管理") {
    return reply(event.replyToken, adminHelpFlex());
  }

  const { command, account3A, days, lineUserId } = parseAdminCommand(text);
  if (!account3A) {
    return reply(event.replyToken, adminHelpFlex());
  }

  if (command === "查詢VIP") {
    const result = normalizeVipRecord(await findVipBy3AAccount(account3A));
    const status = normalizeStatus(result);
    return reply(
      event.replyToken,
      adminResultFlex("VIP查詢", [
        ["3A帳號", result.account3A || account3A],
        ["VIP狀態", status],
        ["LINE userId", result.lineUserId || "未綁定"],
        ["LINE名稱", result.lineName || "未取得"],
        ["到期日期", result.expiresAt ? formatDate(result.expiresAt) : "-"],
        ["剩餘天數", result.expiresAt ? daysLeft(result.expiresAt) : "-"],
      ])
    );
  }

  if (command === "開通VIP") {
    const result = await openVipBy3AAccount({
      account3A,
      days: Number.isFinite(days) ? days : 30,
      lineUserId,
    });
    return reply(
      event.replyToken,
      adminResultFlex("開通VIP", [
        ["3A帳號", account3A],
        ["天數", String(Number.isFinite(days) ? days : 30)],
        ["LINE userId", lineUserId || "未指定"],
        ["狀態", result.ok ? "已開通" : result.error || "開通失敗"],
      ], result.ok)
    );
  }

  if (command === "延長VIP") {
    const result = await extendVipBy3AAccount(account3A, Number.isFinite(days) ? days : 30);
    return reply(
      event.replyToken,
      adminResultFlex("延長VIP", [
        ["3A帳號", account3A],
        ["增加天數", String(Number.isFinite(days) ? days : 30)],
        ["狀態", result.ok ? "已延長" : result.error || "延長失敗"],
      ], result.ok)
    );
  }

  if (command === "取消VIP") {
    const result = await cancelVipBy3AAccount(account3A);
    return reply(
      event.replyToken,
      adminResultFlex("取消VIP", [
        ["3A帳號", account3A],
        ["狀態", result.ok ? "已取消" : result.error || "取消失敗"],
      ], result.ok)
    );
  }

  return reply(event.replyToken, adminHelpFlex());
}

async function handleVipMessage(event) {
  const userId = event.source.userId || "";
  const text = event.message.text.trim();

  if (ADMIN_COMMANDS.some((cmd) => text === cmd || text.startsWith(`${cmd} `))) {
    return handleAdminCommand(event);
  }

  const isAdmin = isAdminLineUserId(userId);
  const record = isAdmin ? normalizeVipRecord(null) : await loadVip(userId);
  const status = isAdmin ? STATUSES.ADMIN : normalizeStatus(record);
  const account3A = isAdmin ? "管理員" : record.account3A;
  const permission = aiPermission(status, account3A, isAdmin);

  updateSession("vip", userId, {
    vipStatus: status,
    account3A: account3A || "未綁定",
    aiPermission: permission,
    expiresAt: isAdmin ? "永久" : record.expiresAt || null,
    daysLeft: isAdmin ? "永久" : daysLeft(record.expiresAt),
  });

  return reply(event.replyToken, vipFlex(userId, record, isAdmin));
}

module.exports = {
  isVipCommand,
  handleVipMessage,
  aiPermission,
};
