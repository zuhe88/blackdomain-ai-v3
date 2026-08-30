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

function formatRate(win, bet) {
  const winnings = Number(win);
  const stake = Number(bet);
  return Number.isFinite(winnings) && Number.isFinite(stake) && stake > 0
    ? `${((winnings / stake) * 100).toFixed(2)}%`
    : "尚無資料";
}

function displayRtp(value, win, bet) {
  const direct = Number(value);
  return value != null && value !== "" && Number.isFinite(direct) && direct >= 0
    ? `${direct.toFixed(2)}%`
    : formatRate(win, bet);
}

function formatAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    : "尚未取得";
}

function betVolumeRatio(detail = {}) {
  const todayBet = Number(detail.todayBet ?? detail.hourBet);
  const monthBet = Number(detail.dayBet);
  return Number.isFinite(todayBet) && todayBet >= 0 && Number.isFinite(monthBet) && monthBet > 0
    ? `${((todayBet / monthBet) * 100).toFixed(2)}%`
    : "尚無資料";
}

function statCell(label, value, color = COLORS.white, options = {}) {
  return {
    type: "box",
    layout: "vertical",
    flex: options.flex || 1,
    spacing: "xs",
    contents: [
      text(label, {
        size: options.labelSize || "xs",
        color: COLORS.muted,
        align: "center",
        wrap: false,
      }),
      text(value, { size: "sm", weight: "bold", color, align: "center", wrap: false }),
    ],
  };
}

function rtpConfidence(detail = {}) {
  const todayBet = Number(detail.todayBet ?? detail.hourBet) || 0;
  const monthBet = Number(detail.dayBet) || 0;
  const sample = todayBet + (monthBet / 30);
  if (sample >= 1000000) return { label: "高", color: COLORS.green };
  if (sample >= 100000) return { label: "中", color: COLORS.gold };
  return { label: "低", color: COLORS.muted };
}

function rtpSummary(detail = {}) {
  const confidence = rtpConfidence(detail);
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    paddingAll: "12px",
    cornerRadius: "14px",
    backgroundColor: "#11100E",
    borderColor: "#4C3C1E",
    borderWidth: "1px",
    contents: [
      statCell("今日得分率", displayRtp(
        detail.todayRtp,
        detail.todayWin ?? detail.hourWin,
        detail.todayBet ?? detail.hourBet,
      ), COLORS.green, { flex: 11, labelSize: "xxs" }),
      statCell(
        "近30天得分率",
        displayRtp(detail.dayRtp, detail.dayWin, detail.dayBet),
        COLORS.gold,
        { flex: 14, labelSize: "xxs" },
      ),
      statCell("可信度", confidence.label, confidence.color, { flex: 7, labelSize: "xxs" }),
    ],
  };
}

function betSummary(detail = {}, gameName = "") {
  const cells = [
    statCell("今日總下注額", formatAmount(detail.todayBet ?? detail.hourBet), COLORS.green),
    statCell("近30天總下注額", formatAmount(detail.dayBet), COLORS.gold),
  ];
  if (gameName === "戰神賽特2") {
    cells.push(statCell("下注占比", betVolumeRatio(detail), COLORS.blue, { labelSize: "xxs" }));
  }
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    paddingAll: "12px",
    cornerRadius: "14px",
    backgroundColor: "#11100E",
    borderColor: "#4C3C1E",
    borderWidth: "1px",
    contents: cells,
  };
}

function electronicRecommendFlex(gameName, room, updateTime, quickReply, roomData = null, options = {}) {
  const signal = entrySignal(`${gameName}:${room}`, "green");
  const detail = roomData?.detail || null;
  return bubble({
    altText: "AI推薦房",
    title: "AI推薦房",
    subtitle: gameName,
    quickReply,
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      metric("推薦房號", room, options.requiresRoomConfirmation ? "房況請確認" : "即時空房"),
      section([
        infoLine("房間狀態", roomData ? "🟢 空房" : (
          options.requiresRoomConfirmation ? "請進房確認" : "等待房況"
        )),
        infoLine("進場燈號", signal.text),
        infoLine("更新時間", updateTime),
      ]),
      ...(detail ? [section([
        text("RTP 評估", { size: "sm", weight: "bold", color: COLORS.gold, align: "center" }),
        rtpSummary(detail),
        betSummary(detail, gameName),
        text(gameName === "戰神賽特2"
          ? "下注占比＝今日下注量 ÷ 近30天下注量｜30天得分率須為 85～95%"
          : "依今日與近30天房間統計換算", {
          size: "xxs",
          color: COLORS.muted,
          align: "center",
          wrap: true,
        }),
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

function electronicFeatureResultFlex(gameName, room, winnings, quickReply, options = {}) {
  const amount = Number(winnings).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const estimated = options.estimated === true;
  const amountLabel = estimated ? "房間派彩差額（估算）" : "本次開獎金額（精確）";
  const message = {
    type: "flex",
    altText: `${gameName} 房號 ${room} ${amountLabel} ${amount}`,
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
          infoLine(amountLabel, amount),
          ...(estimated ? [note("此數字來自全房累計派彩變化，僅供判斷特色遊戲已觸發，不代表單一玩家實際派彩。")]: []),
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
