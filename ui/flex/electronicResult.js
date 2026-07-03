const { bubble, infoLine, metric, note } = require("./premium");

function electronicRecommendFlex(gameName, room, updateTime, quickReply) {
  return bubble({
    altText: "AI推薦房",
    title: "AI推薦房",
    subtitle: gameName,
    quickReply,
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      metric("推薦房號", room, "依原電子AI週期排序產生"),
      infoLine("推薦原因", "活躍度與監控分數符合AI推薦條件"),
      infoLine("更新時間", updateTime),
      note("BLACKDOMAIN AI 僅提供AI分析與建議。"),
    ],
  });
}

function electronicAnalyzeFlex(gameName, room, updateTime, quickReply) {
  return bubble({
    altText: "自選房號分析",
    title: "自選房號分析",
    subtitle: gameName,
    quickReply,
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      metric("分析房號", room, "AI監控結果"),
      infoLine("活躍度", "AI監控中"),
      infoLine("波動", "AI監控中"),
      infoLine("AI監控", "已納入監控清單"),
      infoLine("建議", "依目前活躍度與波動判斷"),
      infoLine("更新時間", updateTime),
    ],
  });
}

function electronicRankFlex(gameName, rooms, updateTime, quickReply) {
  return bubble({
    altText: "熱門房排行",
    title: "熱門房排行",
    subtitle: gameName,
    quickReply,
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      ...rooms.map((room, index) => infoLine(`TOP${String(index + 1).padStart(2, "0")}`, `${room} 熱度 ${100 - index * 3}`)),
      infoLine("更新時間", updateTime),
    ],
  });
}

module.exports = {
  electronicRecommendFlex,
  electronicRankFlex,
  electronicAnalyzeFlex,
};
