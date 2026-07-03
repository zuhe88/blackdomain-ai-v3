const { reply, quickReply } = require("../../services/line");
const { isAdminLineUserId } = require("../../config/admin");
const { bubble, button, infoLine, note, uriButton } = require("../../ui/flex/premium");

const OFFICIAL_WEBSITE_URL = "https://zuhe88.github.io/blackdomain-ai/?utm_source=chatgpt.com";
const ADMIN_LINE_URL = "https://line.me/ti/p/@893jrweh";

const WEBSITE_COMMANDS = ["官網", "黑域官網", "🌐 黑域官網"];
const CONTACT_COMMANDS = ["管理員", "客服", "聯繫管理員", "📞 聯繫管理員"];
const ADMIN_INFO_COMMANDS = [
  "admin",
  "Admin",
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
];

function isOfficialCommand(text) {
  const value = String(text || "").trim();
  return WEBSITE_COMMANDS.includes(value) || CONTACT_COMMANDS.includes(value) || ADMIN_INFO_COMMANDS.includes(value);
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
      infoLine("官方網站", "BLACKDOMAIN AI 官方入口"),
      infoLine("系統定位", "AI智能分析平台"),
      uriButton("開啟黑域官網", OFFICIAL_WEBSITE_URL),
      button("返回首頁", "首頁", "secondary"),
      note("BLACKDOMAIN AI 僅提供AI分析、預測、建議與統計。"),
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
      infoLine("管理員LINE", "@893jrweh"),
      infoLine("聯繫用途", "VIP、AI權限、系統協助"),
      uriButton("加入管理員LINE", ADMIN_LINE_URL),
      button("返回首頁", "首頁", "secondary"),
      note("請透過 BLACKDOMAIN AI 官方管理員窗口聯繫。"),
    ],
  });
}

function adminInfoFlex() {
  return bubble({
    altText: "管理員",
    title: "管理員",
    subtitle: "BLACKDOMAIN AI",
    quickReply: commonQuickReply(),
    footer: "BLACKDOMAIN AI ADMIN",
    contents: [
      infoLine("VIP管理", "請輸入 VIP管理"),
      infoLine("查詢", "查詢VIP 3A帳號"),
      infoLine("開通", "開通VIP 3A帳號 天數"),
      infoLine("延長", "延長VIP 3A帳號 天數"),
      infoLine("取消", "取消VIP 3A帳號"),
      button("VIP管理", "VIP管理"),
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
      infoLine("權限狀態", "無權限使用此功能。"),
      uriButton("聯繫管理員", ADMIN_LINE_URL, "secondary"),
      button("返回首頁", "首頁", "secondary"),
    ],
  });
}

async function handleOfficialMessage(event) {
  const text = event.message.text.trim();

  if (WEBSITE_COMMANDS.includes(text)) {
    return reply(event.replyToken, websiteFlex());
  }

  if (CONTACT_COMMANDS.includes(text)) {
    return reply(event.replyToken, contactFlex());
  }

  if (ADMIN_INFO_COMMANDS.includes(text)) {
    if (!isAdminLineUserId(event.source?.userId)) {
      return reply(event.replyToken, adminDeniedFlex());
    }
    return reply(event.replyToken, adminInfoFlex());
  }

  return false;
}

module.exports = {
  isOfficialCommand,
  handleOfficialMessage,
  OFFICIAL_WEBSITE_URL,
  ADMIN_LINE_URL,
};
