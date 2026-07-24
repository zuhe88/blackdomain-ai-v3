const { quickReply } = require("../../services/line");
const { moduleImageUrl } = require("../../utils/moduleImage");
const { COLORS, card, infoLine, note, section, text } = require("../../ui/flex/premium");

const MARBLE_COLORS = {
  1: "#D4B719",
  2: "#5AAAC8",
  3: "#8C9294",
  4: "#D95D30",
  5: "#10959A",
  6: "#8A49C9",
  7: "#3D51AC",
  8: "#D84B58",
  9: "#A98355",
  10: "#2D9958",
};

function baseBubble(hero, bodyContents, quickReplyData = null) {
  const contents = {
    type: "bubble",
    size: "mega",
    styles: {
      hero: { backgroundColor: COLORS.black },
      body: { backgroundColor: COLORS.black },
      footer: { backgroundColor: COLORS.black },
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "18px",
      contents: bodyContents,
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "10px",
      contents: [
        text("BLACKDOMAIN MB AI", {
          size: "xxs",
          color: COLORS.muted,
          align: "center",
          wrap: false,
        }),
      ],
    },
  };
  if (hero) contents.hero = hero;
  const message = {
    type: "flex",
    altText: "MB彈珠AI",
    contents,
  };
  if (quickReplyData) message.quickReply = quickReplyData;
  return message;
}

function heroImage() {
  return {
    type: "image",
    url: moduleImageUrl("mb-marble-hd.webp"),
    size: "full",
    aspectRatio: "8:9",
    aspectMode: "cover",
  };
}

function trackButton(track) {
  return {
    type: "box",
    layout: "horizontal",
    paddingAll: "13px",
    cornerRadius: "16px",
    backgroundColor: COLORS.glass,
    borderColor: "#6D5728",
    borderWidth: "1px",
    action: { type: "message", text: `MB ${track.name}` },
    contents: [
      {
        type: "box",
        layout: "vertical",
        flex: 1,
        spacing: "xs",
        contents: [
          text(track.name, { size: "md", weight: "bold", color: COLORS.white }),
          text(`${track.latestPeriodId || "等待同步"} · ${track.historyCount}期`, {
            size: "xs",
            color: COLORS.muted,
          }),
        ],
      },
      text("›", { size: "xxl", color: COLORS.gold, align: "end", flex: 0 }),
    ],
  };
}

function menuQuickReply() {
  return quickReply([
    { label: "賭城", text: "MB 賭城賽車" },
    { label: "雪地", text: "MB 雪地賽車" },
    { label: "運動", text: "MB 運動賽車" },
    { label: "海洋", text: "MB 海洋賽車" },
    { label: "返回首頁", text: "返回首頁" },
  ]);
}

function mbMenuFlex(snapshot) {
  return baseBubble(heroImage(), [
    text("MB彈珠AI", { size: "xl", weight: "bold", color: COLORS.gold, align: "center" }),
    text("獨立四賽道即時資料", { size: "sm", color: COLORS.gray, align: "center" }),
    ...snapshot.tracks.map(trackButton),
    note("選擇賽道查看最新期數與最近 3 場前三名。"),
  ], menuQuickReply());
}

function recordRow(record) {
  const values = record.result.slice(0, 3);
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    paddingAll: "11px",
    cornerRadius: "13px",
    backgroundColor: "#11100E",
    borderColor: "#4C3C1E",
    borderWidth: "1px",
    contents: [
      text(`${record.periodId}期`, { size: "xs", weight: "bold", color: COLORS.gold }),
      text(`冠軍 ${values[0]}　亞軍 ${values[1]}　第三名 ${values[2]}`, {
        size: "sm",
        weight: "bold",
        color: COLORS.white,
      }),
      text(`冠亞和 ${record.sum || values[0] + values[1]} · ${record.overUnder === "OVER" ? "大" : "小"} · ${record.oddEven === "ODD" ? "單" : "雙"}`, {
        size: "xs",
        color: COLORS.gray,
      }),
    ],
  };
}

function analysisQuickReply(track, count = null) {
  return quickReply([
    { label: "立即刷新", text: count ? `MB ${track.name} ${count}碼` : `MB ${track.name}` },
    { label: "3碼", text: `MB ${track.name} 3碼` },
    { label: "4碼", text: `MB ${track.name} 4碼` },
    { label: "5碼", text: `MB ${track.name} 5碼` },
    { label: "6碼", text: `MB ${track.name} 6碼` },
    { label: "切換賽道", text: "MB彈珠" },
  ]);
}

function mbTrackFlex(track) {
  const contents = [
    text(`MB彈珠 · ${track.name}`, {
      size: "xl",
      weight: "bold",
      color: COLORS.gold,
      align: "center",
    }),
    text("冠軍、亞軍、第三名定位推薦", { size: "sm", color: COLORS.gray, align: "center" }),
    infoLine("目前狀態", track.state),
    infoLine("預測期數", track.targetPeriodId || "等待同步"),
    infoLine("歷史資料", `${track.historyCount}期`),
    card("精準 3碼", "每個名次推薦 3 顆彈珠，選號最集中", `MB ${track.name} 3碼`),
    card("平衡 4碼", "兼顧集中度與涵蓋範圍", `MB ${track.name} 4碼`),
    card("主流 5碼", "常見定位包牌模式", `MB ${track.name} 5碼`),
    card("穩健 6碼", "最高涵蓋範圍，系統上限 6碼", `MB ${track.name} 6碼`),
    note("四條賽道使用各自獨立歷史樣本，不與 ATG 混用。"),
  ];
  return baseBubble(null, contents, analysisQuickReply(track));
}

function numberChip(number) {
  return {
    type: "box",
    layout: "vertical",
    width: "32px",
    height: "32px",
    cornerRadius: "16px",
    backgroundColor: MARBLE_COLORS[number] || "#5B554C",
    justifyContent: "center",
    contents: [
      text(number, { size: "sm", weight: "bold", color: COLORS.white, align: "center", wrap: false }),
    ],
  };
}

function predictionRow(row) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    paddingAll: "11px",
    cornerRadius: "13px",
    backgroundColor: "#11100E",
    borderColor: "#4C3C1E",
    borderWidth: "1px",
    contents: [
      text(`${row.label}推薦`, { size: "sm", weight: "bold", color: COLORS.gold }),
      {
        type: "box",
        layout: "horizontal",
        spacing: "xs",
        contents: row.picks.map(numberChip),
      },
    ],
  };
}

function syncTime(value) {
  if (!value) return "等待同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "等待同步";
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function mbAnalysisFlex(analysis, track) {
  const stale = analysis.updatedAt && Date.now() - new Date(analysis.updatedAt).getTime() > 180000;
  if (!analysis.available) {
    return baseBubble(null, [
      text(`MB彈珠 · ${track.name}`, { size: "xl", weight: "bold", color: COLORS.gold, align: "center" }),
      infoLine("歷史資料", `${analysis.historyCount}期`),
      note("至少需要 20 期資料才能產生定位推薦，請保持 MB 遊戲頁與轉送器開啟。"),
    ], analysisQuickReply(track, analysis.count));
  }

  return baseBubble(null, [
    text(`MB彈珠 · ${track.name} · ${analysis.count}碼`, {
      size: "xl",
      weight: "bold",
      color: COLORS.gold,
      align: "center",
    }),
    text("冠軍、亞軍、第三名定位推薦", { size: "sm", color: COLORS.gray, align: "center" }),
    infoLine("預測期數", analysis.targetPeriodId || "等待下一期"),
    infoLine("分析資料", `${analysis.historyCount}期`),
    infoLine("最後同步", `${syncTime(analysis.updatedAt)}${stale ? " · 已逾時" : ""}`),
    section([
      text("AI 定位推薦", { size: "sm", weight: "bold", color: COLORS.gold }),
      ...analysis.rows.map(predictionRow),
    ]),
    section([
      text("最近 3 場開獎", { size: "sm", weight: "bold", color: COLORS.gold }),
      ...analysis.recentResults.map(recordRow),
    ]),
    note("統計推薦僅供分析參考，不保證結果。"),
  ], analysisQuickReply(track, analysis.count));
}

module.exports = {
  mbAnalysisFlex,
  mbMenuFlex,
  mbTrackFlex,
};
