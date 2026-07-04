const { bubble, card } = require("./premium");

function electronicGameMenu(gameName) {
  return bubble({
    altText: `${gameName} 功能選單`,
    title: gameName,
    subtitle: "BLACKDOMAIN ELECTRONIC AI",
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      card("AI推薦房", "推薦房號 / 推薦原因 / 更新時間", "AI推薦房"),
      card("熱門排行", "TOP5 熱門房排行", "熱門排行"),
      card("自選分析", "活躍度 / 波動 / AI監控 / 建議", "自選分析"),
      card("返回電子首頁", "重新選擇電子遊戲", "電子"),
      card("返回首頁", "回到 BLACKDOMAIN AI 首頁", "首頁"),
    ],
  });
}

module.exports = electronicGameMenu;
