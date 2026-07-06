const { bubble, card } = require("./premium");

function electronicGameMenu(gameName) {
  return bubble({
    altText: `${gameName} 功能選單`,
    title: gameName,
    subtitle: "BLACKDOMAIN ELECTRONIC AI",
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      card("AI推薦房", "依照本輪 AI 監測資料推薦房號", "AI推薦房"),
      card("熱門排行", "TOP5 房號分析排行", "熱門排行"),
      card("自選分析", "輸入房號進行活躍度與波動分析", "自選分析"),
      card("返回電子首頁", "重新選擇電子AI遊戲", "電子"),
      card("返回首頁", "回到 BLACKDOMAIN AI 首頁", "首頁"),
    ],
  });
}

module.exports = electronicGameMenu;
