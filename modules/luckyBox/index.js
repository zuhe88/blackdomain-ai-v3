const { adminLineUserIds, isAdminLineUserId } = require("../../config/admin");
const { bubble, button, infoLine, metric, note } = require("../../ui/flex/premium");
const { getProfile, push, reply } = require("../../services/line3a");
const {
  findMemberByLineUserId,
  findMemberBy3AAccount,
  createBindRequest,
  updateMemberBy3AAccount,
  updateMemberByLineUserId,
  addLuckyLog,
  listHistory,
} = require("./repository");

const adminOpenSessions = new Map();

const PRIZES = [
  { name: "AI一天", weight: 45 },
  { name: "88", weight: 38 },
  { name: "288", weight: 12 },
  { name: "588", weight: 3 },
  { name: "888", weight: 1.5 },
  { name: "3888", weight: 0.5 },
];

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).replace(/-/g, "/");
}

function plusDays(base, days) {
  const start = base && new Date(base).getTime() > Date.now() ? new Date(base).getTime() : Date.now();
  return new Date(start + Math.max(0, Number(days || 0)) * 86400000).toISOString();
}

function minusDays(base, days) {
  const start = base && new Date(base).getTime() > Date.now() ? new Date(base).getTime() : Date.now();
  return new Date(Math.max(Date.now(), start - Math.max(0, Number(days || 0)) * 86400000)).toISOString();
}

function luckyMenuFlex(member) {
  return bubble({
    altText: "幸運寶箱",
    title: "幸運寶箱",
    subtitle: "3A官方LINE",
    footer: "3A LUCKY BOX",
    contents: [
      metric("鑰匙", String(member.keys || 0), "開啟一次需要2把"),
      infoLine("3A帳號", member.threeAAccount || "未綁定"),
      infoLine("會員狀態", member.status || "未綁定"),
      button("開啟寶箱", "開箱"),
      button("抽獎歷史", "抽獎歷史", "secondary"),
    ],
  });
}

function bindHelpFlex() {
  return bubble({
    altText: "綁定幸運寶箱",
    title: "綁定幸運寶箱",
    subtitle: "3A官方LINE",
    footer: "3A LUCKY BOX",
    contents: [
      metric("請輸入", "綁定 3A帳號 暱稱", "例如：綁定 abc888 小明"),
      note("新會員送2把鑰匙，送出後等待管理員審核。"),
    ],
  });
}

function adminBindFlex({ lineName, threeAAccount, requestTime }) {
  return bubble({
    altText: "新的綁定申請",
    title: "新的綁定申請",
    subtitle: "3A官方LINE",
    footer: "3A LUCKY BOX ADMIN",
    contents: [
      infoLine("LINE名稱", lineName || "未取得"),
      infoLine("3A帳號", threeAAccount),
      infoLine("申請時間", formatDateTime(requestTime)),
      button("✅ 開通會員", `開通 ${threeAAccount}`),
      button("❌ 拒絕", `拒絕 ${threeAAccount}`, "danger"),
    ],
  });
}

async function notifyAdminsBind(member) {
  const message = adminBindFlex({
    lineName: member.lineName,
    threeAAccount: member.threeAAccount,
    requestTime: member.createdAt || new Date().toISOString(),
  });
  await Promise.all(adminLineUserIds().map((adminId) => push(adminId, message)));
}

async function notifyAdminsPrize(member, prize) {
  const message = bubble({
    altText: "幸運寶箱中獎通知",
    title: "幸運寶箱中獎通知",
    subtitle: "3A官方LINE",
    footer: "3A LUCKY BOX ADMIN",
    contents: [
      infoLine("LINE名稱", member.lineName || "未取得"),
      infoLine("3A帳號", member.threeAAccount),
      infoLine("獎項", prize),
      infoLine("時間", formatDateTime(new Date().toISOString())),
    ],
  });
  await Promise.all(adminLineUserIds().map((adminId) => push(adminId, message)));
}

function pickPrize(member, isAdmin) {
  if (!isAdmin && !member.firstOpened) return "AI一天";
  const total = PRIZES.reduce((sum, prize) => sum + prize.weight, 0);
  const roll = Math.random() * total;
  let cursor = 0;
  for (const prize of PRIZES) {
    cursor += prize.weight;
    if (roll <= cursor) return prize.name;
  }
  return "AI一天";
}

async function getLineName(userId) {
  try {
    const profile = await getProfile(userId);
    return profile?.displayName || "未取得";
  } catch (error) {
    return "未取得";
  }
}

async function handleBind(event, parts) {
  const lineUserId = event.source.userId || "";
  const threeAAccount = parts[1];
  const nickname = parts.slice(2).join(" ");
  if (!threeAAccount || !nickname) return reply(event.replyToken, bindHelpFlex());
  const existing = await findMemberByLineUserId(lineUserId);
  if (existing.threeAAccount) return reply(event.replyToken, `您已送出或完成綁定：${existing.threeAAccount}`);
  const lineName = await getLineName(lineUserId);
  const result = await createBindRequest({ lineUserId, lineName, threeAAccount, nickname });
  if (!result.ok) return reply(event.replyToken, result.error || "系統忙碌中，請稍後再試。");
  await notifyAdminsBind(result.member);
  return reply(event.replyToken, "已收到您的綁定申請，請等待管理員審核。");
}

async function openVipForMember(account, days, adminId) {
  const member = await findMemberBy3AAccount(account);
  if (!member.threeAAccount) return { ok: false, message: "查無3A帳號" };
  const expiresAt = plusDays(member.vipExpiresAt, days);
  const result = await updateMemberBy3AAccount(account, { status: "approved", vip_expires_at: expiresAt });
  if (!result.ok) return { ok: false, message: result.error };
  await push(member.lineUserId, `🎉 VIP 已成功開通\nVIP期限：${days} 天\n到期時間：${formatDateTime(expiresAt)}\n重新進入黑域AI即可使用全部VIP功能。`);
  return { ok: true, message: `已開通 ${account} ${days} 天`, member: result.member, adminId };
}

async function handleAdmin(event, text) {
  const adminId = event.source.userId || "";
  if (!isAdminLineUserId(adminId)) return false;

  if (/^\d+$/.test(text) && adminOpenSessions.has(adminId)) {
    const account = adminOpenSessions.get(adminId);
    adminOpenSessions.delete(adminId);
    const result = await openVipForMember(account, Number(text), adminId);
    return reply(event.replyToken, result.message);
  }

  const [command, account, value] = text.split(/\s+/).filter(Boolean);
  if (command === "開通" && account && !value) {
    adminOpenSessions.set(adminId, account);
    return reply(event.replyToken, `請輸入開通天數，例如：30`);
  }
  if (command === "開通" && account && value) {
    const result = await openVipForMember(account, Number(value), adminId);
    return reply(event.replyToken, result.message);
  }
  if (command === "增加" && account && value) {
    const member = await findMemberBy3AAccount(account);
    if (!member.threeAAccount) return reply(event.replyToken, "查無3A帳號");
    const expiresAt = plusDays(member.vipExpiresAt, Number(value));
    const result = await updateMemberBy3AAccount(account, { vip_expires_at: expiresAt });
    if (!result.ok) return reply(event.replyToken, result.error);
    await push(member.lineUserId, `VIP 已增加\n增加：${value} 天\n新的到期時間：${formatDateTime(expiresAt)}`);
    return reply(event.replyToken, `已增加 ${account} ${value} 天`);
  }
  if (command === "減少" && account && value) {
    const member = await findMemberBy3AAccount(account);
    if (!member.threeAAccount) return reply(event.replyToken, "查無3A帳號");
    const expiresAt = minusDays(member.vipExpiresAt, Number(value));
    const result = await updateMemberBy3AAccount(account, { vip_expires_at: expiresAt });
    if (!result.ok) return reply(event.replyToken, result.error);
    await push(member.lineUserId, `VIP期限已調整\n減少：${value} 天\n目前到期：${formatDateTime(expiresAt)}`);
    return reply(event.replyToken, `已減少 ${account} ${value} 天`);
  }
  if (command === "刪除" && account) {
    const member = await findMemberBy3AAccount(account);
    if (!member.threeAAccount) return reply(event.replyToken, "查無3A帳號");
    const result = await updateMemberBy3AAccount(account, { status: "approved", vip_expires_at: new Date().toISOString() });
    if (!result.ok) return reply(event.replyToken, result.error);
    await push(member.lineUserId, "您的VIP已取消。\n如需重新使用請聯絡管理員。");
    return reply(event.replyToken, `已刪除 ${account} VIP`);
  }
  if (command === "拒絕" && account) {
    const result = await updateMemberBy3AAccount(account, { status: "rejected" });
    return reply(event.replyToken, result.ok ? `已拒絕 ${account}` : result.error);
  }
  return false;
}

async function handleOpenBox(event) {
  const lineUserId = event.source.userId || "";
  const isAdmin = isAdminLineUserId(lineUserId);
  const member = await findMemberByLineUserId(lineUserId);
  if (!member.threeAAccount) return reply(event.replyToken, bindHelpFlex());
  if (member.status !== "approved") return reply(event.replyToken, "會員尚未開通，請等待管理員審核。");
  if (!isAdmin && member.keys < 2) return reply(event.replyToken, "鑰匙不足，開啟一次需要2把鑰匙。");
  const prize = pickPrize(member, isAdmin);
  const nextKeys = isAdmin ? member.keys : member.keys - 2;
  await updateMemberByLineUserId(lineUserId, { keys: nextKeys, first_opened: true });
  await addLuckyLog({ lineUserId, threeAAccount: member.threeAAccount, prize, isAdminTest: isAdmin });
  await notifyAdminsPrize(member, prize);
  return reply(event.replyToken, `恭喜獲得：${prize}`);
}

async function handleHistory(event) {
  const rows = await listHistory(event.source.userId || "");
  if (!rows.length) return reply(event.replyToken, "目前尚無抽獎歷史。");
  return reply(event.replyToken, rows.map((row) => `${formatDateTime(row.created_at)}｜${row.prize}`).join("\n"));
}

async function handleLuckyBoxEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;
  const text = event.message.text.trim();
  const adminResult = await handleAdmin(event, text);
  if (adminResult !== false) return adminResult;
  if (text.startsWith("綁定 ")) return handleBind(event, text.split(/\s+/));
  if (text === "幸運寶箱" || text === "寶箱") {
    const member = await findMemberByLineUserId(event.source.userId || "");
    if (!member.threeAAccount) return reply(event.replyToken, bindHelpFlex());
    return reply(event.replyToken, luckyMenuFlex(member));
  }
  if (text === "開箱" || text === "開啟寶箱") return handleOpenBox(event);
  if (text === "抽獎歷史") return handleHistory(event);
  return reply(event.replyToken, luckyMenuFlex(await findMemberByLineUserId(event.source.userId || "")));
}

module.exports = {
  handleLuckyBoxEvent,
};
