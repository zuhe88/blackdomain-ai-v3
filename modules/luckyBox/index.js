const { adminLineUserIds, isAdminLineUserId } = require("../../config/admin");
const { getProfile, push, reply } = require("../../services/line3a");
const { text } = require("../../ui/flex/premium");
const {
  DEFAULT_SPIN_PROBABILITY,
  findMemberByLineUserId,
  findMemberBy3AAccount,
  createBindRequest,
  updateMemberBy3AAccount,
  updateMemberByLineUserId,
  addLuckyLog,
  listHistory,
  listPendingMembers,
  listMembers,
  listLogs,
  getSpinProbability,
  setSpinProbability,
  grantBlackdomainAiAccessOneDay,
} = require("./repository");

const BLACKDOMAIN_LINE_URL = "https://line.me/ti/p/@391wiftp";
const DEFAULT_BASE_URL = "https://blackdomain-ai-v3-production.up.railway.app";
const adminOpenSessions = new Map();

const WHEEL_SEGMENTS = [
  "AI權限1天",
  "88",
  "AI權限1天",
  "888",
  "88",
  "AI權限1天",
  "88",
  "888",
  "AI權限1天",
  "88",
  "AI權限1天",
  "2888",
];

function baseUrl() {
  const raw = process.env.PUBLIC_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN || DEFAULT_BASE_URL;
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, "") : `https://${raw.replace(/\/+$/, "")}`;
}

function boxUrl() {
  return `${baseUrl()}/box`;
}

function formatDateTime(value) {
  if (!value) return "—";
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

function plusDays(base, days) {
  const start = base && new Date(base).getTime() > Date.now() ? new Date(base).getTime() : Date.now();
  return new Date(start + Math.max(0, Number(days || 0)) * 86400000).toISOString();
}

function minusDays(base, days) {
  const start = base && new Date(base).getTime() > Date.now() ? new Date(base).getTime() : Date.now();
  return new Date(Math.max(Date.now(), start - Math.max(0, Number(days || 0)) * 86400000)).toISOString();
}

function isVipActive(member) {
  if (member?.isAdmin) return true;
  if (!member?.vipExpiresAt) return false;
  return new Date(member.vipExpiresAt).getTime() > Date.now();
}

function vipStatus(member) {
  if (member?.isAdmin) return "管理員";
  if (!member?.threeAAccount) return "尚未綁定";
  if (member.status === "pending") return "審核中";
  if (member.status === "rejected") return "已拒絕";
  return isVipActive(member) ? "已開通" : "未開通";
}

function vipExpiresText(member) {
  if (member?.isAdmin) return "永久";
  return isVipActive(member) ? formatDateTime(member.vipExpiresAt) : "—";
}

function flex({ altText, title, subtitle = "3A VIP CLUB", contents = [], footer = "3A MEMBER CENTER" }) {
  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble",
      size: "mega",
      styles: {
        body: { backgroundColor: "#070605" },
        footer: { backgroundColor: "#070605" },
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        spacing: "md",
        contents: [
          {
            type: "box",
            layout: "vertical",
            paddingAll: "16px",
            cornerRadius: "16px",
            backgroundColor: "#17120C",
            borderColor: "#D7B46A",
            borderWidth: "1px",
            contents: [
              text("3A VIP CLUB", { size: "sm", weight: "bold", color: "#F0D99B", align: "center" }),
              text(title, { size: "xxl", weight: "bold", color: "#FFFFFF", align: "center" }),
              text(subtitle, { size: "xs", color: "#B9AA88", align: "center" }),
            ],
          },
          ...contents,
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: [text(footer, { size: "xs", color: "#8F7A52", align: "center", wrap: false })],
      },
    },
  };
}

function info(label, value) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    contents: [
      text(label, { size: "sm", color: "#B9AA88", flex: 2 }),
      text(String(value || "—"), { size: "sm", color: "#FFFFFF", align: "end", flex: 4 }),
    ],
  };
}

function vipButton(label, actionText, style = "primary") {
  const color = style === "secondary" ? "#241E16" : style === "danger" ? "#8F2F2F" : "#B8924A";
  return {
    type: "box",
    layout: "vertical",
    margin: "sm",
    paddingAll: "13px",
    cornerRadius: "14px",
    backgroundColor: color,
    action: { type: "message", text: actionText },
    contents: [text(label, { size: "sm", weight: "bold", color: "#FFFFFF", align: "center" })],
  };
}

function uriButton(label, uri, style = "primary") {
  const color = style === "secondary" ? "#241E16" : "#B8924A";
  return {
    type: "box",
    layout: "vertical",
    margin: "sm",
    paddingAll: "13px",
    cornerRadius: "14px",
    backgroundColor: color,
    action: { type: "uri", uri },
    contents: [text(label, { size: "sm", weight: "bold", color: "#FFFFFF", align: "center" })],
  };
}

function memberCenterFlex(member = {}) {
  return flex({
    altText: "3A會員中心",
    title: "會員中心",
    contents: [
      info("LINE名稱", member.lineName || "未取得"),
      info("3A帳號", member.threeAAccount || "未綁定"),
      info("帳號狀態", vipStatus(member)),
      info("VIP到期", vipExpiresText(member)),
      info("目前鑰匙", member.keys || 0),
      vipButton("我的VIP", "我的VIP"),
      vipButton("幸運轉盤", "幸運轉盤"),
      vipButton("抽獎紀錄", "抽獎紀錄", "secondary"),
      vipButton("活動公告", "活動公告", "secondary"),
      vipButton("我的鑰匙", "我的鑰匙", "secondary"),
      uriButton("黑域AI", BLACKDOMAIN_LINE_URL, "secondary"),
    ],
  });
}

function bindHelpFlex() {
  return flex({
    altText: "3A帳號綁定",
    title: "會員綁定",
    contents: [
      info("綁定格式", "綁定 3A帳號 暱稱"),
      info("範例", "綁定 abc888 小黑"),
      info("審核狀態", "送出後等待管理員審核"),
    ],
  });
}

function spinIntroFlex(member = {}) {
  if (!member.threeAAccount) return bindHelpFlex();
  return flex({
    altText: "幸運轉盤",
    title: "幸運轉盤",
    contents: [
      info("3A帳號", member.threeAAccount),
      info("VIP狀態", vipStatus(member)),
      info("目前鑰匙", member.keys || 0),
      info("可抽次數", Math.floor((member.keys || 0) / 2)),
      uriButton("立即抽獎", boxUrl()),
      vipButton("抽獎紀錄", "抽獎紀錄", "secondary"),
      vipButton("活動公告", "活動公告", "secondary"),
    ],
  });
}

function activityFlex() {
  return flex({
    altText: "活動公告",
    title: "活動公告",
    contents: [
      info("新會員加入", "立即獲得2把鑰匙"),
      info("邀請好友", "成功邀請好友加入即可獲得4把鑰匙"),
      info("儲值回饋", "每儲值1000元可獲得1把鑰匙"),
      info("抽獎規則", "每2把鑰匙可抽一次幸運轉盤"),
      info("轉盤獎項", "AI權限1天、88、888、2888"),
      text("活動內容依官方公告為準。", { size: "xs", color: "#B9AA88", align: "center" }),
    ],
  });
}

function probabilityFlex(probability = DEFAULT_SPIN_PROBABILITY) {
  return flex({
    altText: "機率設定",
    title: "機率設定",
    subtitle: "3A VIP ADMIN",
    contents: [
      info("AI權限1天", `${probability["AI權限1天"]}%`),
      info("88", `${probability["88"]}%`),
      info("888", `${probability["888"]}%`),
      info("2888", `${probability["2888"]}%`),
      text("總和必須等於100%。2888建議低於1%。修改後立即生效。", { size: "xs", color: "#B9AA88", wrap: true }),
    ],
    footer: "3A VIP ADMIN",
  });
}

function adminCommandsText() {
  return [
    "管理員功能",
    "開通 3A帳號 天數",
    "增加 3A帳號 天數",
    "減少 3A帳號 天數",
    "刪除 3A帳號",
    "查詢 3A帳號",
    "補鑰匙 3A帳號 數量",
    "扣鑰匙 3A帳號 數量",
    "待審",
    "會員列表",
    "統計",
    "群發 內容",
    "公告 內容",
    "重設轉盤 3A帳號",
    "機率設定",
    "設定機率 AI 45 88 45 888 9 2888 1",
    "管理員測試",
  ].join("\n");
}

function historyFlex(rows) {
  if (!rows.length) {
    return flex({
      altText: "抽獎紀錄",
      title: "抽獎紀錄",
      contents: [text("目前尚無抽獎紀錄。", { size: "md", color: "#FFFFFF", align: "center" })],
    });
  }
  return flex({
    altText: "抽獎紀錄",
    title: "抽獎紀錄",
    contents: rows.slice(0, 20).map((row, index) =>
      info(`#${index + 1}`, `${formatDateTime(row.createdAt)}｜${row.threeAAccount || "—"}｜${row.prize}`)
    ),
  });
}

function adminBindFlex(member) {
  return flex({
    altText: "新的綁定申請",
    title: "新的綁定申請",
    subtitle: "3A VIP ADMIN",
    contents: [
      info("LINE名稱", member.lineName || "未取得"),
      info("3A帳號", member.threeAAccount),
      info("申請時間", formatDateTime(member.createdAt)),
      vipButton("開通會員", `開通 ${member.threeAAccount}`),
      vipButton("拒絕", `拒絕 ${member.threeAAccount}`, "danger"),
    ],
    footer: "3A VIP ADMIN",
  });
}

async function notifyAdminsBind(member) {
  await Promise.all(adminLineUserIds().map((adminId) => push(adminId, adminBindFlex(member))));
}

async function notifyAdminsPrize(member, prize, isAdminTest) {
  const message = flex({
    altText: "幸運轉盤中獎通知",
    title: "中獎通知",
    subtitle: "3A VIP ADMIN",
    contents: [
      info("LINE名稱", member.lineName || "未取得"),
      info("3A帳號", member.threeAAccount),
      info("獎項", prize),
      info("類型", isAdminTest ? "管理員測試" : "會員抽獎"),
      info("時間", formatDateTime(new Date().toISOString())),
    ],
    footer: "3A VIP ADMIN",
  });
  await Promise.all(adminLineUserIds().map((adminId) => push(adminId, message)));
}

async function getLineName(userId) {
  const profile = await getProfile(userId);
  return profile?.displayName || "未取得";
}

function pickPrizeByProbability(probability) {
  const total = Object.values(probability).reduce((sum, value) => sum + Number(value || 0), 0);
  const roll = Math.random() * total;
  let cursor = 0;
  for (const prize of ["AI權限1天", "88", "888", "2888"]) {
    cursor += Number(probability[prize] || 0);
    if (roll <= cursor) return prize;
  }
  return "AI權限1天";
}

function parseProbabilityCommand(value) {
  const parts = String(value || "").trim().split(/\s+/).slice(1);
  if (parts.length !== 8) return null;
  const aliases = { AI: "AI權限1天", "AI權限1天": "AI權限1天", 88: "88", 888: "888", 2888: "2888" };
  const result = {};
  for (let i = 0; i < parts.length; i += 2) {
    const key = aliases[parts[i]];
    const number = Number(parts[i + 1]);
    if (!key || !Number.isFinite(number) || number < 0 || number > 100) return null;
    result[key] = number;
  }
  if (!["AI權限1天", "88", "888", "2888"].every((key) => Object.prototype.hasOwnProperty.call(result, key))) return null;
  const total = Object.values(result).reduce((sum, number) => sum + number, 0);
  if (total !== 100) return { error: "sum" };
  return result;
}

async function bindMember(event, parts) {
  const lineUserId = event.source.userId || "";
  const threeAAccount = parts[1];
  const nickname = parts.slice(2).join(" ");
  if (!threeAAccount || !nickname) return reply(event.replyToken, bindHelpFlex());
  const existing = await findMemberByLineUserId(lineUserId);
  if (existing.threeAAccount) {
    return reply(event.replyToken, `您已綁定 3A帳號：${existing.threeAAccount}\n如需更換帳號，請聯繫管理員。`);
  }
  const accountOwner = await findMemberBy3AAccount(threeAAccount);
  if (accountOwner.threeAAccount) {
    return reply(event.replyToken, "此 3A帳號已被綁定或申請中，請聯繫管理員確認。");
  }
  const lineName = await getLineName(lineUserId);
  const result = await createBindRequest({ lineUserId, lineName, threeAAccount, nickname });
  if (!result.ok) return reply(event.replyToken, result.error || "系統忙碌中，請稍後再試。");
  await notifyAdminsBind(result.member);
  return reply(event.replyToken, "已收到您的3A帳號綁定申請。\n等待管理員審核。");
}

async function openVipForMember(account, days) {
  const member = await findMemberBy3AAccount(account);
  if (!member.threeAAccount) return { ok: false, message: "查無3A帳號" };
  const expiresAt = days === "永久" ? "9999-12-31T15:59:59.000Z" : plusDays(member.vipExpiresAt, days);
  const result = await updateMemberBy3AAccount(account, { status: "approved", vip_expires_at: expiresAt });
  if (!result.ok) return { ok: false, message: result.error };
  await push(
    member.lineUserId,
    `VIP 已成功開通\nVIP期限：${days === "永久" ? "永久" : `${days} 天`}\n到期時間：${days === "永久" ? "永久" : formatDateTime(expiresAt)}\n重新進入黑域AI即可使用全部VIP功能。`
  );
  return { ok: true, message: `已開通 ${account} ${days === "永久" ? "永久VIP" : `${days}天`}` };
}

async function changeKeys(account, amount) {
  const member = await findMemberBy3AAccount(account);
  if (!member.threeAAccount) return { ok: false, message: "查無3A帳號" };
  const keys = Math.max(0, member.keys + amount);
  const result = await updateMemberBy3AAccount(account, { keys });
  return { ok: result.ok, message: result.ok ? `已更新 ${account} 鑰匙：${keys}` : result.error };
}

async function handleAdmin(event, value) {
  const adminId = event.source.userId || "";
  if (value === "管理員測試") {
    if (isAdminLineUserId(adminId)) {
      return reply(event.replyToken, `✅ 管理員驗證成功\n目前帳號：3A官方LINE\nLINE UID：${adminId}\n權限：管理員`);
    }
    return reply(event.replyToken, `❌ 您不是管理員\nLINE UID：${adminId}`);
  }
  if (!isAdminLineUserId(adminId)) return false;
  if (value === "管理指令") return reply(event.replyToken, adminCommandsText());
  if (value === "機率設定") return reply(event.replyToken, probabilityFlex(await getSpinProbability()));
  if (value.startsWith("設定機率 ")) {
    const probability = parseProbabilityCommand(value);
    if (probability?.error === "sum") return reply(event.replyToken, "設定失敗\n機率總和必須等於100");
    if (!probability) return reply(event.replyToken, "設定失敗\n請確認格式：\n設定機率 AI 45 88 45 888 9 2888 1");
    const result = await setSpinProbability(probability, adminId);
    if (!result.ok) return reply(event.replyToken, `設定失敗\n${result.error}`);
    return reply(event.replyToken, probabilityFlex(result.value));
  }
  if (/^\d+$/.test(value) && adminOpenSessions.has(adminId)) {
    const account = adminOpenSessions.get(adminId);
    adminOpenSessions.delete(adminId);
    const result = await openVipForMember(account, Number(value));
    return reply(event.replyToken, result.message);
  }
  const [command, account, amount] = value.split(/\s+/).filter(Boolean);
  if (command === "開通" && account && !amount) {
    adminOpenSessions.set(adminId, account);
    return reply(event.replyToken, "請輸入開通天數，例如：30");
  }
  if (command === "開通" && account && amount) return reply(event.replyToken, (await openVipForMember(account, amount === "永久" ? "永久" : Number(amount))).message);
  if (command === "增加" && account && amount) {
    const member = await findMemberBy3AAccount(account);
    if (!member.threeAAccount) return reply(event.replyToken, "查無3A帳號");
    const expiresAt = plusDays(member.vipExpiresAt, Number(amount));
    const result = await updateMemberBy3AAccount(account, { status: "approved", vip_expires_at: expiresAt });
    if (!result.ok) return reply(event.replyToken, result.error);
    await push(member.lineUserId, `VIP 已增加\n增加：${amount} 天\n新的到期時間：${formatDateTime(expiresAt)}`);
    return reply(event.replyToken, `已增加 ${account} ${amount} 天`);
  }
  if (command === "減少" && account && amount) {
    const member = await findMemberBy3AAccount(account);
    if (!member.threeAAccount) return reply(event.replyToken, "查無3A帳號");
    const expiresAt = minusDays(member.vipExpiresAt, Number(amount));
    const result = await updateMemberBy3AAccount(account, { vip_expires_at: expiresAt });
    if (!result.ok) return reply(event.replyToken, result.error);
    await push(member.lineUserId, `VIP期限已調整\n減少：${amount} 天\n目前到期：${formatDateTime(expiresAt)}`);
    return reply(event.replyToken, `已減少 ${account} ${amount} 天`);
  }
  if (command === "刪除" && account) {
    const member = await findMemberBy3AAccount(account);
    if (!member.threeAAccount) return reply(event.replyToken, "查無3A帳號");
    const result = await updateMemberBy3AAccount(account, { vip_expires_at: new Date().toISOString() });
    if (!result.ok) return reply(event.replyToken, result.error);
    await push(member.lineUserId, "您的VIP已取消。\n如需重新使用請聯絡管理員。");
    return reply(event.replyToken, `已刪除 ${account} VIP`);
  }
  if ((command === "查詢" || command === "查會員") && account) return reply(event.replyToken, memberCenterFlex(await findMemberBy3AAccount(account)));
  if (command === "補鑰匙" && account && amount) return reply(event.replyToken, (await changeKeys(account, Math.max(0, Number(amount)))).message);
  if (command === "扣鑰匙" && account && amount) return reply(event.replyToken, (await changeKeys(account, -Math.max(0, Number(amount)))).message);
  if (command === "拒絕" && account) {
    const result = await updateMemberBy3AAccount(account, { status: "rejected" });
    return reply(event.replyToken, result.ok ? `已拒絕 ${account}` : result.error);
  }
  if (command === "待審") {
    const pending = await listPendingMembers();
    return reply(event.replyToken, pending.length ? pending.map((m) => `${m.threeAAccount}｜${m.lineName || "未取得"}`).join("\n") : "目前沒有待審會員。");
  }
  if (command === "會員列表") {
    const members = await listMembers();
    if (!members.length) return reply(event.replyToken, "目前沒有會員資料。");
    return reply(event.replyToken, members.slice(0, 30).map((m) => `${m.threeAAccount || "未綁定"}｜${m.lineName || "未取得"}｜${vipStatus(m)}`).join("\n"));
  }
  if (command === "統計") {
    const members = await listMembers();
    const logs = await listLogs();
    return reply(event.replyToken, `會員總數：${members.length}\n抽獎紀錄：${logs.length}\n待審：${members.filter((m) => m.status === "pending").length}`);
  }
  if (command === "群發" || command === "公告") {
    const content = value.slice(command.length).trim();
    if (!content) return reply(event.replyToken, `${command}內容不可空白。`);
    const targets = (await listMembers()).map((member) => member.lineUserId).filter(Boolean);
    await Promise.all(targets.map((target) => push(target, content)));
    return reply(event.replyToken, `${command}完成，共推送 ${targets.length} 位會員。`);
  }
  if (command === "重設轉盤" && account) {
    const result = await updateMemberBy3AAccount(account, { first_opened: false });
    return reply(event.replyToken, result.ok ? `已重設 ${account} 轉盤狀態` : result.error);
  }
  return false;
}

async function openBoxByLineUserId(lineUserId) {
  const isAdmin = isAdminLineUserId(lineUserId);
  const member = await findMemberByLineUserId(lineUserId);
  if (!member.threeAAccount) return { ok: false, code: "UNBOUND", message: "尚未綁定3A帳號" };
  if (member.status !== "approved") return { ok: false, code: "PENDING", message: "綁定審核中" };
  if (!isAdmin && member.keys < 2) return { ok: false, code: "NO_KEYS", message: "鑰匙不足" };
  const prize = !isAdmin && !member.firstOpened ? "AI權限1天" : pickPrizeByProbability(await getSpinProbability());
  const nextKeys = isAdmin ? member.keys : member.keys - 2;
  const update = await updateMemberByLineUserId(lineUserId, { keys: nextKeys, first_opened: true });
  if (!update.ok) return { ok: false, code: "UPDATE_FAILED", message: update.error };
  const log = await addLuckyLog({ lineUserId, threeAAccount: member.threeAAccount, prize, isAdminTest: isAdmin });
  if (!log.ok) return { ok: false, code: "LOG_FAILED", message: log.error };
  if (prize === "AI權限1天") {
    await grantBlackdomainAiAccessOneDay({ ...member, lineUserId });
  }
  await push(lineUserId, `幸運轉盤抽獎完成\n獎項：${prize}\n時間：${formatDateTime(new Date().toISOString())}`);
  await notifyAdminsPrize(member, prize, isAdmin);
  return { ok: true, prize, keys: nextKeys, member: { ...member, keys: nextKeys }, isAdminTest: isAdmin };
}

async function handleHistory(event) {
  return reply(event.replyToken, historyFlex(await listHistory(event.source.userId || "", 20)));
}

async function handleLuckyBoxEvent(event) {
  if (event.type !== "message" && event.type !== "postback" && event.type !== "follow") return;
  if (event.type === "follow") return reply(event.replyToken, memberCenterFlex(await findMemberByLineUserId(event.source.userId || "")));
  if (event.type === "message" && event.message.type !== "text") return reply(event.replyToken, "目前僅支援文字指令，請輸入：選單");
  const value = event.type === "postback" ? String(event.postback?.data || "") : event.message.text.trim();
  const adminResult = await handleAdmin(event, value);
  if (adminResult !== false) return adminResult;
  if (value.startsWith("綁定 ")) return bindMember(event, value.split(/\s+/));
  if (value === "綁定") return reply(event.replyToken, bindHelpFlex());
  if (value === "選單" || value === "開始") return reply(event.replyToken, memberCenterFlex(await findMemberByLineUserId(event.source.userId || "")));
  if (value === "我的VIP") return reply(event.replyToken, memberCenterFlex(await findMemberByLineUserId(event.source.userId || "")));
  if (value === "我的鑰匙") {
    const member = await findMemberByLineUserId(event.source.userId || "");
    return reply(event.replyToken, `目前鑰匙數量：${member.keys || 0}`);
  }
  if (value === "幸運轉盤") return reply(event.replyToken, spinIntroFlex(await findMemberByLineUserId(event.source.userId || "")));
  if (value === "活動公告") return reply(event.replyToken, activityFlex());
  if (value === "抽獎紀錄") return handleHistory(event);
  return reply(event.replyToken, memberCenterFlex(await findMemberByLineUserId(event.source.userId || "")));
}

module.exports = {
  BLACKDOMAIN_LINE_URL,
  WHEEL_SEGMENTS,
  activityFlex,
  boxUrl,
  formatDateTime,
  handleLuckyBoxEvent,
  memberCenterFlex,
  openBoxByLineUserId,
  probabilityFlex,
};
