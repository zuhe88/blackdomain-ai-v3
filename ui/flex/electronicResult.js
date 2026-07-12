const { COLORS, bubble, infoLine, metric, note, text } = require("./premium");

function score(seed = "") {
  let score = 0;
  for (const char of String(seed)) score = (score * 33 + char.charCodeAt(0)) % 1000;
  return score;
}

function entrySignal(seed = "", mode = "recommend") {
  const value = score(seed);
  const isGreen = mode === "green" || (mode === "custom" ? value >= 820 : true);
  return {
    text: isGreen ? "🟢 可進場" : "🔴 暫不進場",
    volatility: isGreen ? "穩定" : "偏高",
    activity: isGreen ? "符合條件" : "未達條件",
  };
}

function electronicRecommendFlex(gameName, room, updateTime, quickReply) {
  const signal = entrySignal(`${gameName}:${room}`, "green");
  return bubble({
    altText: "AI推薦房",
    title: "AI推薦房",
    subtitle: gameName,
    quickReply,
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      metric("推薦房號", room, "AI監測結果"),
      infoLine("目前狀態", "AI監控中"),
      infoLine("進場燈號", signal.text),
      infoLine("資料波動", signal.volatility),
      infoLine("監測結果", signal.activity),
      infoLine("更新時間", updateTime),
      note("每30分鐘刷新一次"),
      note("本分析由 BLACKDOMAIN AI 生成，僅供參考。"),
    ],
  });
}

function electronicAnalyzeFlex(gameName, room, updateTime, quickReply, options = {}) {
  const signal = entrySignal(`${gameName}:${room}:custom`, options.forceGreen ? "green" : "custom");
  return bubble({
    altText: "自選房號分析",
    title: "自選房號分析",
    subtitle: gameName,
    quickReply,
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      metric("分析房號", room, "AI監測結果"),
      infoLine("目前狀態", "AI監控中"),
      infoLine("進場燈號", signal.text),
      infoLine("資料波動", signal.volatility),
      infoLine("監測結果", signal.activity),
      infoLine("更新時間", updateTime),
      note("每30分鐘刷新一次"),
    ],
  });
}

function rankCard(room, index, updateTime) {
  const accent = index === 0 ? COLORS.gold : COLORS.blue;
  const signal = entrySignal(`${room}:${index}`, "green");
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
      infoLine("進場燈號", signal.text),
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
      note("每30分鐘刷新一次"),
    ],
  });
}

module.exports = {
  electronicRecommendFlex,
  electronicRankFlex,
  electronicAnalyzeFlex,
};
