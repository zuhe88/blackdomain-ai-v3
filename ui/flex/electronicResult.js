const { COLORS, bubble, button, infoLine, metric, note, text, section } = require("./premium");

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
  return Number.isFinite(number)
    ? number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "尚無資料";
}

function formatRate(win, bet) {
  const winnings = Number(win);
  const stake = Number(bet);
  return Number.isFinite(winnings) && Number.isFinite(stake) && stake > 0
    ? `${((winnings / stake) * 100).toFixed(2)}%`
    : "尚無資料";
}

function statCell(label, value, color = COLORS.white) {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    spacing: "xs",
    contents: [
      text(label, { size: "xs", color: COLORS.muted, align: "center", wrap: false }),
      text(value, { size: "sm", weight: "bold", color, align: "center", wrap: false }),
    ],
  };
}

function periodStats(title, bet, win, accent = COLORS.gold) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    paddingAll: "12px",
    cornerRadius: "14px",
    backgroundColor: "#11100E",
    borderColor: "#4C3C1E",
    borderWidth: "1px",
    contents: [
      text(title, { size: "sm", weight: "bold", color: accent, align: "center", wrap: false }),
      {
        type: "separator",
        color: "#4C3C1E",
      },
      {
        type: "box",
        layout: "horizontal",
        spacing: "md",
        contents: [
          statCell("總下注額", formatAmount(bet)),
          statCell("得分率", formatRate(win, bet), accent),
        ],
      },
    ],
  };
}

function electronicRecommendFlex(gameName, room, updateTime, quickReply, roomData = null) {
  const signal = entrySignal(`${gameName}:${room}`, "green");
  const detail = roomData?.detail || null;
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
        periodStats("今日", detail.todayBet ?? detail.hourBet, detail.todayWin ?? detail.hourWin, COLORS.green),
        periodStats("近30天", detail.dayBet, detail.dayWin, COLORS.gold),
      ])] : []),
      note("本分析由 BLACKDOMAIN AI 生成，僅供參考。"),
      button("結束該房間", `結束房間監控 ${gameName} ${room}`, "danger"),
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

function electronicFeatureResultFlex(gameName, room, winnings, quickReply) {
  const amount = Number(winnings).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const message = {
    type: "flex",
    altText: `${gameName} 房號 ${room} 本次開獎金額 ${amount}`,
    contents: {
      type: "bubble",
      size: "kilo",
      styles: {
        body: { backgroundColor: COLORS.black },
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        paddingAll: "18px",
        contents: [
          text(gameName, { size: "xl", weight: "bold", color: COLORS.gold, align: "center" }),
          infoLine("房號", room),
          infoLine("本次開獎金額", amount),
        ],
      },
    },
  };
  if (quickReply) message.quickReply = quickReply;
  return message;
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
  electronicFeatureResultFlex,
};
