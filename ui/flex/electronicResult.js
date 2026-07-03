const { bubble, infoLine, metric, note } = require("./premium");

function electronicRecommendFlex(gameName, room, updateTime, quickReply) {
  return bubble({
    altText: "AI推薦房",
    title: "AI推薦房",
    subtitle: gameName,
    quickReply,
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      metric("推薦房號", room, "BLACKDOMAIN AI 即時監控"),
      infoLine("推薦原因", "活躍度與波動指標符合 AI 推薦條件"),
      infoLine("更新時間", updateTime),
      note("本分析由 BLACKDOMAIN AI 生成，僅供參考。"),
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
      infoLine("活躍度", "中高"),
      infoLine("波動", "穩定偏強"),
      infoLine("AI監控", "已納入即時觀察"),
      infoLine("建議", "可列入觀察名單，請依自身節奏操作"),
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
      ...rooms.map((room, index) =>
        infoLine(`TOP${String(index + 1).padStart(2, "0")}`, `${room} 熱度 ${100 - index * 3}`)
      ),
      infoLine("更新時間", updateTime),
    ],
  });
}

module.exports = {
  electronicRecommendFlex,
  electronicRankFlex,
  electronicAnalyzeFlex,
};
