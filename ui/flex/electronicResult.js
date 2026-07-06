const { COLORS, bubble, infoLine, metric, note, text } = require("./premium");

const SUMMARY_TEXTS = [
  "近期資料已完成更新，目前符合系統篩選條件。",
  "近期資料波動較明顯，建議持續觀察。",
  "本輪資料仍在追蹤中，等待下一輪更新。",
  "AI即時更新完成，目前資料節奏較集中。",
  "系統已完成房號監測，建議依照風險控管操作。",
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
      metric("推薦房號", room, "AI監測結果"),
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
      metric("分析房號", room, "AI監測結果"),
      infoLine("目前狀態", "AI監控中"),
      infoLine("波動", "偏高"),
      infoLine("活躍度", "提升"),
      infoLine("AI分析摘要", summary(`${gameName}:${room}:custom`)),
      infoLine("更新時間", updateTime),
    ],
  });
}

function rankCard(room, index, updateTime) {
  const accent = index === 0 ? COLORS.gold : COLORS.blue;
  return {
    type: "box",
    layout: "vertical",
    margin: "sm",
    paddingAll: "14px",
    cornerRadius: "18px",
    backgroundColor: index === 0 ? "#171814" : COLORS.panel,
    borderColor: index === 0 ? COLORS.gold : "#6D5728",
    borderWidth: "1px",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          text(`TOP ${index + 1}`, { size: "sm", weight: "bold", flex: 2, color: accent, wrap: false }),
          text(`房號：${room}`, { size: "lg", weight: "bold", flex: 4, align: "end", color: COLORS.white, wrap: false }),
        ],
      },
      infoLine("AI分析摘要", summary(`${room}:${index}`)),
      infoLine("更新時間", updateTime),
    ],
  };
}

function electronicRankFlex(gameName, rooms, updateTime, quickReply) {
  return bubble({
    altText: "熱門排行",
    title: "熱門排行",
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
