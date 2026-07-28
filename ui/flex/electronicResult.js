const { COLORS, bubble, infoLine, metric, note, text, section } = require("./premium");

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
    volatility: isGreen ? "穩定" : "不穩定",
    activity: isGreen ? "符合條件" : "未達條件",
  };
}

function formatAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-US") : "尚無資料";
}

function formatRate(win, bet) {
  const winnings = Number(win);
  const stake = Number(bet);
  return Number.isFinite(winnings) && Number.isFinite(stake) && stake > 0
    ? `${((winnings / stake) * 100).toFixed(1)}%`
    : "尚無資料";
}

function electronicRecommendFlex(gameName, room, updateTime, quickReply, roomData = null) {
  const signal = entrySignal(`${gameName}:${room}`, "green");
  const detail = roomData?.detail || roomData;
  const recentBet = detail?.todayBet ?? detail?.hourBet;
  const recentWin = detail?.todayWin ?? detail?.hourWin;
  return bubble({
    altText: "AI推薦房",
    title: "AI推薦房",
    subtitle: gameName,
    quickReply,
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      metric("推薦房號", room, "即時空房"),
      section([
        infoLine("房間狀態", roomData ? "🟢 空房" : "等待房況"),
        infoLine("進場燈號", signal.text),
        infoLine("更新時間", updateTime),
      ]),
      ...(detail ? [section([
        text("房間統計", { size: "sm", weight: "bold", color: COLORS.gold, align: "center" }),
        infoLine("近期投注量", formatAmount(recentBet)),
        infoLine("近期回報率", formatRate(recentWin, recentBet)),
        infoLine("當日投注量", formatAmount(detail.dayBet)),
        infoLine("當日回報率", formatRate(detail.dayWin, detail.dayBet)),
      ])] : []),
      note(detail ? "只推薦即時狀態為 Empty 的房間" : "尚未收到即時房表，暫不推薦"),
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
      infoLine("房況狀態", signal.volatility),
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
