const { reply, quickReply } = require("../../services/line");
const { updateSession } = require("../../utils/sessionStore");
const { bubble, button, infoLine, metric, note } = require("../../ui/flex/premium");
const { findVipByLineUserId } = require("./repository");

const COMMANDS = ["VIP", "vip", "VIP查詢", "我的VIP", "會員", "VIP中心", "👑 VIP中心"];
const VALID_STATUS = ["已開通", "未開通", "已到期", "待審核"];

function isVipCommand(text) {
  return COMMANDS.includes(String(text || "").trim());
}

function vipQuickReply() {
  return quickReply([
    { label: "刷新VIP", text: "VIP查詢" },
    { label: "聯繫管理員", text: "聯繫管理員" },
    { label: "返回首頁", text: "首頁" },
  ]);
}

function normalizeStatus(value) {
  return VALID_STATUS.includes(value) ? value : "待審核";
}

function daysLeft(expiresAt) {
  if (!expiresAt) return "-";
  const diff = new Date(expiresAt).getTime() - Date.now();
  return String(Math.max(0, Math.ceil(diff / 86400000)));
}

async function loadVip(userId) {
  try {
    return await findVipByLineUserId(userId);
  } catch (err) {
    console.error("VIP_QUERY_ERROR:", err.message);
  }

  return null;
}

function vipFlex(userId, record) {
  const status = normalizeStatus(record?.vip_status || record?.status || record?.vipStatus || "待審核");
  const expiresAt = record?.vip_expires_at || record?.expires_at || record?.vip_expire_at || record?.vip_end_at || null;
  const displayName = record?.display_name || record?.line_name || record?.name || "未綁定";
  const maskedId = userId ? `${userId.slice(0, 4)}••••${userId.slice(-4)}` : "訪客";

  return bubble({
    altText: "VIP中心",
    title: "VIP中心",
    subtitle: "BLACKDOMAIN VIP",
    quickReply: vipQuickReply(),
    footer: "BLACKDOMAIN VIP",
    contents: [
      metric("VIP狀態", status, "AI權限依原本系統限制判定"),
      infoLine("LINE名稱", displayName),
      infoLine("會員ID", maskedId),
      infoLine("到期日期", expiresAt ? new Date(expiresAt).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }) : "-"),
      infoLine("剩餘天數", daysLeft(expiresAt)),
      infoLine("AI權限", status === "已開通" ? "百家樂AI / 電子AI / 體育AI / 539AI" : "依系統限制"),
      infoLine("最後更新時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
      button("聯繫管理員", "聯繫管理員"),
      button("返回首頁", "首頁", "secondary"),
      note("VIP資料來源為 Supabase；未查到資料時顯示待審核，不變更任何資料表或欄位。"),
    ],
  });
}

async function handleVipMessage(event) {
  const userId = event.source.userId || "";
  const record = await loadVip(userId);
  const status = normalizeStatus(record?.vip_status || record?.status || record?.vipStatus || "待審核");
  const expiresAt = record?.vip_expires_at || record?.expires_at || record?.vip_expire_at || record?.vip_end_at || null;
  updateSession("vip", userId, {
    vipStatus: status,
    aiPermission: status === "已開通" ? "百家樂AI / 電子AI / 體育AI / 539AI" : "依系統限制",
    expiresAt,
    daysLeft: daysLeft(expiresAt),
  });
  return reply(event.replyToken, vipFlex(userId, record));
}

module.exports = {
  isVipCommand,
  handleVipMessage,
};
