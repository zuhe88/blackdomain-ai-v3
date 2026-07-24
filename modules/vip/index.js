const { lineClient, push, pushStrict, quickReply, reply } = require("../../services/line");
const { adminLineUserIds, isAdminLineUserId } = require("../../config/admin");
const { getSession, updateSession } = require("../../utils/sessionStore");
const { bubble, button, infoLine, metric, note, text } = require("../../ui/flex/premium");
const { COMMANDS, BIND_COMMANDS, ADMIN_COMMANDS, STATUSES } = require("./constants");
const { validateAccount3A } = require("./validator");
const {
  STATUS,
  findVipUserByLineUserId,
  findVipUserBy3AAccount,
  findActiveRequestByLineUserId,
  findActiveRequestBy3AAccount,
  submitVipRequest,
  approveVip,
  extendVip,
  reduceVip,
  cancelVip,
  listPendingRequests,
  listVipUsers,
  logAiUsage,
  normalizeAccount3A,
} = require("./repository");

const AI_FEATURES = "百家樂AI / ATG AI / 彩票AI / 體育AI";

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

function formatDate(value, permanent = false) {
  if (!value) return permanent ? "永久" : "—";
  return new Date(value).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" });
}

function formatDateTime(value, permanent = false) {
  if (!value) return permanent ? "永久" : "—";
  return new Date(value)
    .toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(/-/g, "/");
}

function daysLeft(value, permanent = false) {
  if (!value) return permanent ? "永久" : "—";
  const diff = new Date(value).getTime() - Date.now();
  return String(Math.max(0, Math.ceil(diff / 86400000)));
}

async function pushVipUpdateOrError(user, message) {
  if (!user?.lineUserId) {
    return { ok: false, error: "找不到此會員的 LINE User ID，無法推送通知。" };
  }
  try {
    await pushStrict(user.lineUserId, message);
    return { ok: true };
  } catch (error) {
    console.error("[VIP push failed]", {
      lineUserId: user.lineUserId,
      account3A: user.account3A,
      error: error?.message || error,
    });
    return {
      ok: false,
      error: "會員資料已更新，但 LINE 通知推送失敗，請確認 line_user_id 是否正確或 LINE Bot 是否有權限推送。",
    };
  }
}

function vipUpdateFlex({ title, status, account3A, daysText, expiresAt, remainText, noteText }) {
  return bubble({
    altText: title,
    title,
    subtitle: "BLACKDOMAIN VIP",
    quickReply: vipQuickReply(false),
    footer: "BLACKDOMAIN VIP",
    contents: [
      metric("會員狀態", status, "黑域AI會員通知"),
      infoLine("3A帳號", account3A || "未綁定"),
      infoLine("異動天數", daysText || "—"),
      infoLine("目前到期", expiresAt || "—"),
      infoLine("剩餘天數", remainText || "—"),
      note(noteText || "請輸入「黑域AI」開始使用。"),
      button("開啟黑域AI", "黑域AI"),
    ],
  });
}

async function notifyVipOpened(user, days, permanent = false) {
  const numericDays = Number(days);
  if (!permanent && (!Number.isFinite(numericDays) || numericDays <= 0)) {
    return pushVipUpdateOrError(
      user,
      vipUpdateFlex({
        title: "黑域AI綁定已審核",
        status: "已綁定",
        account3A: user.account3A,
        daysText: "+0天",
        expiresAt: "—",
        remainText: "—",
        noteText: "AI權限尚未開通，請聯絡管理員。",
      })
    );
  }

  return pushVipUpdateOrError(
    user,
    vipUpdateFlex({
      title: "黑域AI會員已更新",
      status: "已開通",
      account3A: user.account3A,
      daysText: permanent ? "永久" : `+${days}天`,
      expiresAt: formatDateTime(user.expiresAt, permanent),
      remainText: `${daysLeft(user.expiresAt, permanent)}${permanent ? "" : "天"}`,
      noteText: "請輸入「黑域AI」開始使用。",
    })
  );
}

async function notifyVipReduced(user, days) {
  return pushVipUpdateOrError(
    user,
    vipUpdateFlex({
      title: "黑域AI會員天數已調整",
      status: "已調整",
      account3A: user.account3A,
      daysText: `-${days}天`,
      expiresAt: formatDateTime(user.expiresAt),
      remainText: `${daysLeft(user.expiresAt)}天`,
      noteText: "會員期限已同步更新。",
    })
  );
}

async function notifyVipCancelled(user) {
  return pushVipUpdateOrError(
    user,
    vipUpdateFlex({
      title: "黑域AI會員權限已關閉",
      status: "已關閉",
      account3A: user.account3A,
      daysText: "—",
      expiresAt: "—",
      remainText: "—",
      noteText: "如需重新開通，請聯絡管理員。",
    })
  );
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

function invalidAccountFlex(error) {
  return bubble({
    altText: "3A帳號格式不正確",
    title: "帳號格式不正確",
    subtitle: "BLACKDOMAIN VIP",
    quickReply: quickReply([{ label: "取消", text: "取消" }]),
    footer: "BLACKDOMAIN VIP",
    contents: [
      metric("正確格式", "半形英文與數字", "可使用純英文、純數字或英文加數字"),
      infoLine("範例", "abc123"),
      note(error),
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

function clipboardButton(label, clipboardText) {
  return {
    type: "box",
    layout: "vertical",
    margin: "sm",
    paddingAll: "12px",
    backgroundColor: "#0F0E0C",
    cornerRadius: "18px",
    borderColor: "#D4AF37",
    borderWidth: "1px",
    action: { type: "clipboard", label, clipboardText },
    contents: [text(label, { size: "sm", weight: "bold", color: "#FFFFFF", align: "center" })],
  };
}

async function notifyAdminsBind({ lineUserId, lineName, account3A }) {
  const message = bubble({
    altText: "新的綁定申請",
    title: "新的綁定申請",
    subtitle: "BLACKDOMAIN ADMIN",
    footer: "BLACKDOMAIN VIP ADMIN",
    quickReply: adminQuickReply(),
    contents: [
      infoLine("LINE名稱", lineName || "未取得"),
      infoLine("LINE User ID", lineUserId),
      infoLine("3A帳號", account3A),
      infoLine("狀態", "待審核"),
      clipboardButton("複製綁定格式", `綁定 ${account3A}`),
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
  const isPermanentVip = user.account3A && user.vipStatus === STATUS.APPROVED && user.aiPermission === true && !user.expiresAt;

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
      infoLine("到期日期", formatDate(user.expiresAt, isPermanentVip)),
      infoLine("剩餘天數", daysLeft(user.expiresAt, isPermanentVip)),
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
      infoLine("扣天數", "扣天數 abc123 10"),
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

  const [command, rawAccount3A, value] = text.split(/\s+/).filter(Boolean);
  const account3A = normalizeAccount3A(rawAccount3A);
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
      ["到期", formatDate(user.expiresAt, user.vipStatus === STATUS.APPROVED && !user.expiresAt)],
      ["剩餘天數", daysLeft(user.expiresAt, user.vipStatus === STATUS.APPROVED && !user.expiresAt)],
      ["LINE User ID", user.lineUserId || "未綁定"],
    ]));
  }

  if (command === "開通") {
    const permanent = value === "永久";
    const days = permanent ? 36500 : parseInt(value ?? "30", 10);
    if (!permanent && (!Number.isFinite(days) || days < 0)) {
      return reply(event.replyToken, adminResultFlex("開通VIP", [
        ["3A帳號", account3A],
        ["狀態", "天數格式不正確"],
      ], false));
    }
    const result = await approveVip({ account3A, days, permanent, adminLineUserId: userId });
    let notifyResult = { ok: true };
    if (result.ok) notifyResult = await notifyVipOpened(result.user, days, permanent);
    return reply(event.replyToken, adminResultFlex("開通VIP", [
      ["3A帳號", account3A],
      ["天數", permanent ? "永久" : `${days}天`],
      ["狀態", result.ok && notifyResult.ok ? (days === 0 && !permanent ? "已審核綁定，AI權限未開通" : "已開通並通知會員") : result.error || notifyResult.error || "失敗"],
    ], result.ok && notifyResult.ok));
  }

  if (command === "永久VIP") {
    const result = await approveVip({ account3A, permanent: true, adminLineUserId: userId });
    let notifyResult = { ok: true };
    if (result.ok) notifyResult = await notifyVipOpened(result.user, "永久", true);
    return reply(event.replyToken, adminResultFlex("永久VIP", [
      ["3A帳號", account3A],
      ["狀態", result.ok && notifyResult.ok ? "已設為永久VIP並通知會員" : result.error || notifyResult.error || "失敗"],
    ], result.ok && notifyResult.ok));
  }

  if (command === "延長VIP") {
    const days = parseInt(value || "30", 10);
    const result = await extendVip(account3A, days, userId);
    let notifyResult = { ok: true };
    if (result.ok) notifyResult = await notifyVipOpened(result.user, days, false);
    return reply(event.replyToken, adminResultFlex("延長VIP", [
      ["3A帳號", account3A],
      ["增加天數", `${days}天`],
      ["狀態", result.ok && notifyResult.ok ? "已延長並通知會員" : result.error || notifyResult.error || "失敗"],
    ], result.ok && notifyResult.ok));
  }

  if (command === "扣天數" || command === "減少VIP") {
    const days = parseInt(value || "1", 10);
    const result = await reduceVip(account3A, days, userId);
    let notifyResult = { ok: true };
    if (result.ok) notifyResult = await notifyVipReduced(result.user, days);
    return reply(event.replyToken, adminResultFlex("扣天數", [
      ["3A帳號", account3A],
      ["扣除天數", `${days}天`],
      ["狀態", result.ok && notifyResult.ok ? "已調整並通知會員" : result.error || notifyResult.error || "失敗"],
    ], result.ok && notifyResult.ok));
  }

  if (command === "取消VIP") {
    const result = await cancelVip(account3A, userId);
    let notifyResult = { ok: true };
    if (result.ok) notifyResult = await notifyVipCancelled(result.user);
    return reply(event.replyToken, adminResultFlex("取消VIP", [
      ["3A帳號", account3A],
      ["狀態", result.ok && notifyResult.ok ? "已取消並通知會員" : result.error || notifyResult.error || "失敗"],
    ], result.ok && notifyResult.ok));
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
  const validation = validateAccount3A(event.message.text);
  if (!validation.ok) {
    updateSession("vip", lineUserId, { binding3A: true, lastUpdated: Date.now() });
    return reply(event.replyToken, invalidAccountFlex(validation.error));
  }
  const account3A = validation.value;

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
    if (result.code === "INVALID_ACCOUNT") {
      updateSession("vip", lineUserId, { binding3A: true, lastUpdated: Date.now() });
      return reply(event.replyToken, invalidAccountFlex(result.error));
    }
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
