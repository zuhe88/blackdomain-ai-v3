const { bubble, infoLine, metric, note, text, COLORS } = require("./premium");

function electronicRecommendFlex(gameName, room, updateTime, quickReply) {
  return bubble({
    altText: "AI推薦房",
    title: "AI推薦房",
    subtitle: gameName,
    quickReply,
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      metric("推薦房號", room, "BLACKDOMAIN AI 即時監控"),
      infoLine("目前狀態", "AI監控中"),
      infoLine("波動", "偏高"),
      infoLine("活躍度", "提升"),
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
      infoLine("目前狀態", "AI監控中"),
      infoLine("波動", "偏高"),
      infoLine("活躍度", "提升"),
      infoLine("建議", "可列入觀察名單，請依自身節奏操作"),
      infoLine("更新時間", updateTime),
    ],
  });
}

function rankCard(room, index) {
  const medals = ["👑", "🥇", "🥈", "🥉", "◆"];
  return {
    type: "box",
    layout: "vertical",
    margin: "md",
    paddingAll: "14px",
    cornerRadius: "14px",
    backgroundColor: index === 0 ? "#211A08" : COLORS.panel,
    borderColor: COLORS.goldDark,
    borderWidth: "1px",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        spacing: "md",
        contents: [
          text(medals[index] || "◆", { size: "lg", flex: 1, align: "center", color: COLORS.gold, wrap: false }),
          text(`TOP ${index + 1}`, { size: "sm", weight: "bold", flex: 2, color: COLORS.gold, wrap: false }),
          text(room, { size: "xl", weight: "bold", flex: 3, align: "end", color: COLORS.white, wrap: false }),
        ],
      },
      infoLine("目前狀態", "AI監控中"),
      infoLine("波動", index <= 1 ? "偏高" : "穩定偏高"),
      infoLine("活躍度", "提升"),
    ],
  };
}

function electronicRankFlex(gameName, rooms, updateTime, quickReply) {
  return bubble({
    altText: "熱門房排行",
    title: "熱門房排行",
    subtitle: gameName,
    quickReply,
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      ...rooms.slice(0, 5).map((room, index) => rankCard(room, index)),
      infoLine("更新時間", updateTime),
      note("每30分鐘更新一次"),
    ],
  });
}

module.exports = {
  electronicRecommendFlex,
  electronicRankFlex,
  electronicAnalyzeFlex,
};
