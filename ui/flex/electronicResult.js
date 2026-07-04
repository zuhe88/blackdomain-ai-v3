const { bubble, infoLine, metric, note, text, COLORS } = require("./premium");

const SUMMARY_TEXTS = [
  "近期資料已完成更新，目前符合系統篩選條件。",
  "近期資料波動較明顯，建議持續觀察。",
  "目前資料仍在追蹤中，等待下一輪更新。",
  "本輪資料已同步完成，可作為觀察參考。",
  "系統監測到資料變化，建議以保守節奏觀察。",
];

function summary(seed = "") {
  let score = 0;
  for (const char of String(seed)) score = (score + char.charCodeAt(0)) % SUMMARY_TEXTS.length;
  return SUMMARY_TEXTS[score];
}

function electronicRecommendFlex(gameName, room, updateTime, quickReply) {
  return bubble({
    altText: "AI推薦房",
    title: "AI推薦房",
    subtitle: gameName,
    quickReply,
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      metric("推薦房號", room, "AI監控中"),
      infoLine("目前狀態", "AI監控中"),
      infoLine("波動", "偏高"),
      infoLine("活躍度", "提升"),
      infoLine("AI分析摘要", summary(`${gameName}:${room}`)),
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
      metric("分析房號", room, "AI監控中"),
      infoLine("目前狀態", "AI監控中"),
      infoLine("波動", "偏高"),
      infoLine("活躍度", "提升"),
      infoLine("AI監測摘要", summary(`${gameName}:${room}:custom`)),
      infoLine("更新時間", updateTime),
    ],
  });
}

function rankCard(room, index, updateTime) {
  const icons = ["皇冠", "金牌", "銀牌", "銅牌", "徽章"];
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
          text(icons[index] || "排名", { size: "sm", flex: 2, align: "center", color: COLORS.gold, wrap: false }),
          text(`TOP ${index + 1}`, { size: "sm", weight: "bold", flex: 2, color: COLORS.gold, wrap: false }),
          text(room, { size: "xl", weight: "bold", flex: 3, align: "end", color: COLORS.white, wrap: false }),
        ],
      },
      infoLine("房號", room),
      infoLine("AI分析摘要", summary(`${room}:${index}`)),
      infoLine("更新時間", updateTime),
    ],
  };
}

function electronicRankFlex(gameName, rooms, updateTime, quickReply) {
  return bubble({
    altText: "熱門排行榜",
    title: "熱門排行榜",
    subtitle: gameName,
    quickReply,
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      ...rooms.slice(0, 5).map((room, index) => rankCard(room, index, updateTime)),
      note("每30分鐘更新一次"),
    ],
  });
}

module.exports = {
  electronicRecommendFlex,
  electronicRankFlex,
  electronicAnalyzeFlex,
};
