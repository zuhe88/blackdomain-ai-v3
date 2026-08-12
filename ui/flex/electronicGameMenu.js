const { bubble, card } = require("./premium");

function electronicGameMenu(gameName) {
  return bubble({
    altText: `${gameName} 功能選單`,
    title: gameName,
    subtitle: "BLACKDOMAIN ELECTRONIC AI",
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      card("AI推薦房", "依照本輪 AI 監測資料推薦房號", "AI推薦房"),
      card("自選房分析", "輸入房號查看 AI 監測結果", "自選分析"),
      card("返回電子首頁", "重新選擇電子AI遊戲", "電子"),
      card("返回首頁", "回到 BLACKDOMAIN AI 首頁", "首頁"),
    ],
  });
}

module.exports = electronicGameMenu;
