const { reply, quickReply } = require("../../services/line");
const { bubble, button, infoLine, note } = require("../../ui/flex/premium");

function isOfficialCommand(text) {
  return [
    "黑域官網",
    "官網",
    "🌐 黑域官網",
    "聯繫管理員",
    "客服",
    "管理員",
    "admin",
    "Admin",
    "開通VIP",
    "延長VIP",
    "取消VIP",
    "查詢VIP",
    "使用者",
    "Session",
    "Log",
    "發送公告",
    "維護公告",
    "更新公告",
    "刷新AI",
    "查看AI狀態",
    "查看Railway",
    "查看Supabase",
    "查看Version",
  ].includes(String(text || "").trim());
}

function commonQuickReply() {
  return quickReply([
    { label: "返回首頁", text: "首頁" },
    { label: "聯繫管理員", text: "聯繫管理員" },
  ]);
}

function websiteFlex() {
  return bubble({
    altText: "黑域官網",
    title: "黑域官網",
    subtitle: "BLACKDOMAIN AI",
    quickReply: commonQuickReply(),
    footer: "BLACKDOMAIN AI",
    contents: [
      infoLine("官網狀態", "請聯繫管理員取得官方網址"),
      infoLine("網址", "請聯繫管理員設定官方網址"),
      button("返回首頁", "首頁", "secondary"),
      note("黑域官網僅作為 BLACKDOMAIN AI 官方入口。"),
    ],
  });
}

function contactFlex() {
  return bubble({
    altText: "聯繫管理員",
    title: "聯繫管理員",
    subtitle: "BLACKDOMAIN AI",
    quickReply: commonQuickReply(),
    footer: "BLACKDOMAIN AI",
    contents: [
      infoLine("聯繫方式", "請透過 BLACKDOMAIN AI 官方管理員聯繫。"),
      button("返回首頁", "首頁", "secondary"),
      note("此入口僅處理 BLACKDOMAIN AI 相關事項。"),
    ],
  });
}

function adminDeniedFlex() {
  return bubble({
    altText: "管理員",
    title: "管理員",
    subtitle: "BLACKDOMAIN AI",
    quickReply: commonQuickReply(),
    footer: "BLACKDOMAIN AI ADMIN",
    contents: [
      infoLine("權限狀態", "無權限使用此功能"),
      button("返回首頁", "首頁", "secondary"),
    ],
  });
}

async function handleOfficialMessage(event) {
  const text = event.message.text.trim();

  if (["黑域官網", "官網", "🌐 黑域官網"].includes(text)) {
    return reply(event.replyToken, websiteFlex());
  }

  if (
    [
      "管理員",
      "admin",
      "Admin",
      "開通VIP",
      "延長VIP",
      "取消VIP",
      "查詢VIP",
      "使用者",
      "Session",
      "Log",
      "發送公告",
      "維護公告",
      "更新公告",
      "刷新AI",
      "查看AI狀態",
      "查看Railway",
      "查看Supabase",
      "查看Version",
    ].includes(text)
  ) {
    return reply(event.replyToken, adminDeniedFlex());
  }

  return reply(event.replyToken, contactFlex());
}

module.exports = {
  isOfficialCommand,
  handleOfficialMessage,
};
