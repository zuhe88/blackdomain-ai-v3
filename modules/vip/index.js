const { reply, quickReply } = require("../../services/line");
const { bubble, card, infoLine, metric, note } = require("../../ui/flex/premium");

const COMMANDS = ["VIP", "VIP查詢", "👑 VIP查詢", "VIP會員", "會員中心"];

function isVipCommand(text) {
  return COMMANDS.includes(String(text || "").trim());
}

function vipQuickReply() {
  return quickReply([
    { label: "VIP查詢", text: "VIP查詢" },
    { label: "幸運盒", text: "幸運盒" },
    { label: "回首頁", text: "首頁" },
  ]);
}

function vipFlex(userId) {
  const maskedId = userId ? `${userId.slice(0, 4)}••••${userId.slice(-4)}` : "訪客";

  return bubble({
    altText: "VIP查詢",
    title: "VIP查詢",
    subtitle: "BLACKDOMAIN VIP",
    quickReply: vipQuickReply(),
    footer: "BLACKDOMAIN VIP",
    contents: [
      metric("會員狀態", "可使用", "已完成系統連線檢查"),
      infoLine("使用者", maskedId),
      infoLine("百家樂AI", "開放"),
      infoLine("電子AI", "開放"),
      infoLine("539AI", "開放"),
      infoLine("體育AI", "開放"),
      card("幸運盒", "VIP 專屬機率抽取", "幸運盒"),
      note("若需綁定真實 VIP 等級，可接入既有 Supabase 資料，不需變更資料表結構。"),
    ],
  });
}

async function handleVipMessage(event) {
  return reply(event.replyToken, vipFlex(event.source.userId || ""));
}

module.exports = {
  isVipCommand,
  handleVipMessage,
};
