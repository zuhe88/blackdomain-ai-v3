const { bubble, card } = require("./premium");

function electronicMenuFlex() {
  return bubble({
    altText: "電子AI",
    title: "電子AI",
    subtitle: "BLACKDOMAIN ELECTRONIC AI",
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      card("🎰 戰神賽特1", "選擇戰神賽特1分析", "戰神賽特1"),
      card("🎰 戰神賽特2", "選擇戰神賽特2分析", "戰神賽特2"),
      card("👹 古神巴風特", "選擇古神巴風特分析", "古神巴風特"),
      card("🏠 返回首頁", "回到 BLACKDOMAIN AI 首頁", "首頁"),
    ],
  });
}

module.exports = electronicMenuFlex;
