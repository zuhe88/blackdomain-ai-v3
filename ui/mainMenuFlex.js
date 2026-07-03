const { bubble, card } = require("./flex/premium");

function mainMenuFlex() {
  return bubble({
    altText: "BLACKDOMAIN AI V3",
    title: "BLACKDOMAIN AI V3",
    subtitle: "AI智能分析平台",
    footer: "BLACKDOMAIN AI ENGINE",
    contents: [
      card("🎲 百家樂AI", "AI分析 / AI配注 / AI統計", "百家樂"),
      card("⚡ 電子AI", "電子遊戲活躍房 AI 分析", "電子"),
      card("⚽ 體育AI", "世足 / MLB / NBA AI 分析", "體育"),
      card("🎯 539AI", "今彩539 AI 分析", "539"),
      card("👑 VIP中心", "AI權限與期限查詢", "VIP"),
      card("🌐 黑域官網", "BLACKDOMAIN AI 官方入口", "黑域官網"),
      card("📞 聯繫管理員", "聯繫 BLACKDOMAIN AI 管理員", "聯繫管理員"),
    ],
  });
}

module.exports = mainMenuFlex;
