const { bubble, card } = require("./premium");

function electronicMenuFlex() {
  return bubble({
    altText: "電子AI",
    title: "電子AI",
    subtitle: "BLACKDOMAIN ELECTRONIC AI",
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      card("🎰 戰神賽特1", "房號 001 ~ 1300", "戰神賽特1"),
      card("🎰 戰神賽特2", "房號 0001 ~ 4000", "戰神賽特2"),
      card("👹 古神巴風特", "房號 001 ~ 1000", "古神巴風特"),
      card("返回首頁", "回到 BLACKDOMAIN AI 首頁", "首頁"),
    ],
  });
}

module.exports = electronicMenuFlex;
