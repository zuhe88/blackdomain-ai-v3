const { quickReply } = require("../../services/line");
const { bubble, card, infoLine, note, section, text } = require("../../ui/flex/premium");

const HORSE_COLORS = {
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

function atgQuickReply() {
  return quickReply([
    { label: "立即刷新", text: "ATG 即時刷新" },
    { label: "3碼", text: "ATG 3碼" },
    { label: "4碼", text: "ATG 4碼" },
    { label: "5碼", text: "ATG 5碼" },
    { label: "6碼", text: "ATG 6碼" },
    { label: "返回首頁", text: "首頁" },
  ]);
}

function atgMenuFlex() {
  return bubble({
    altText: "ATG賽馬AI",
    title: "ATG賽馬AI",
    subtitle: "第一名至第十名定位分析",
    quickReply: atgQuickReply(),
    footer: "BLACKDOMAIN ATG AI",
    contents: [
      card("精準 3碼", "每個名次推薦 3 匹馬，選號最集中", "ATG 3碼"),
      card("平衡 4碼", "兼顧集中度與涵蓋範圍", "ATG 4碼"),
      card("主流 5碼", "常見定位包牌打法", "ATG 5碼"),
      card("穩健 6碼", "最高涵蓋範圍，系統上限 6碼", "ATG 6碼"),
    ],
  });
}

function sourceLabel(analysis) {
  if (isLiveStale(analysis)) return `即時中斷 · ${analysis.historyCount}期`;
  if (analysis.source === "live" || analysis.source === "relay") return `即時資料 · ${analysis.historyCount}期`;
  if (analysis.source === "seed") return `離線樣本 · ${analysis.historyCount}期`;
  return `資料不足 · ${analysis.historyCount}期`;
}

function isLiveStale(analysis) {
  if (!["live", "relay"].includes(analysis.source) || !analysis.updatedAt) return false;
  const updatedAt = new Date(analysis.updatedAt).getTime();
  return Number.isFinite(updatedAt) && Date.now() - updatedAt > 3 * 60 * 1000;
}

function syncTimeLabel(value) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未同步";
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

function resultTimeLabel(value) {
  if (!value) return "--/-- --:--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--/-- --:--:--";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace(/\//g, "/");
}

function horseBadge(number, compact = false) {
  const value = Number(number);
  const size = compact ? "20px" : "25px";
  return {
    type: "box",
    layout: "vertical",
    width: size,
    height: size,
    cornerRadius: compact ? "5px" : "7px",
    backgroundColor: HORSE_COLORS[value] || "#5B6164",
    justifyContent: "center",
    contents: [
      text(value, {
        size: value === 10 || compact ? "xxs" : "xs",
        weight: "bold",
        color: "#FFFFFF",
        align: "center",
        gravity: "center",
        wrap: false,
      }),
    ],
  };
}

function horseNumberRow(numbers, compact = false) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "xs",
    contents: numbers.map((number) => horseBadge(number, compact)),
  };
}

function recentResultLine(record) {
  const sum = Number(record.result[0]) + Number(record.result[1]);
  const size = sum > 11 ? "大" : sum < 11 ? "小" : "和";
  const parity = sum % 2 === 0 ? "雙" : "單";
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    paddingAll: "10px",
    backgroundColor: "#11100E",
    cornerRadius: "12px",
    borderColor: "#4C3C1E",
    borderWidth: "1px",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [
          text(resultTimeLabel(record.time), { size: "xxs", color: "#9B927E", flex: 4, wrap: false }),
          text(`${record.periodId} 期`, { size: "xxs", color: "#F0D58A", weight: "bold", align: "end", flex: 4, wrap: false }),
        ],
      },
      horseNumberRow(record.result, true),
      text(`冠亞和值：${sum} / ${size} / ${parity}`, { size: "xxs", color: "#D8D3C8", wrap: false }),
    ],
  };
}

function predictionRow(row) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    paddingAll: "10px",
    backgroundColor: "#11100E",
    cornerRadius: "12px",
    borderColor: "#4C3C1E",
    borderWidth: "1px",
    alignItems: "center",
    contents: [
      text(row.label, { size: "sm", color: "#F0D58A", weight: "bold", flex: 2, wrap: false }),
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        flex: 6,
        justifyContent: "flex-end",
        contents: row.picks.map((number) => horseBadge(number)),
      },
    ],
  };
}

function atgAnalysisFlex(analysis) {
  if (!analysis.available) {
    return bubble({
      altText: "ATG賽馬AI資料不足",
      title: "ATG賽馬AI",
      subtitle: "第一名至第十名定位分析",
      quickReply: atgQuickReply(),
      footer: "BLACKDOMAIN ATG AI",
      contents: [
        infoLine("資料狀態", sourceLabel(analysis)),
        infoLine("最低需求", "至少 20 期完整排名"),
        note("請設定合法的 ATG 即時資料來源後再分析。"),
      ],
    });
  }

  const firstHalf = [
    text("冠軍 ～ 五名", { size: "sm", weight: "bold", color: "#D4AF37" }),
    ...analysis.rows.slice(0, 5).map(predictionRow),
  ];
  const secondHalf = [
    text("六名 ～ 十名", { size: "sm", weight: "bold", color: "#D4AF37" }),
    ...analysis.rows.slice(5).map(predictionRow),
  ];
  const recentResults = [
    text("最近 3 場開獎", { size: "sm", weight: "bold", color: "#D4AF37" }),
    ...analysis.recentResults.map(recentResultLine),
  ];
  const targetPeriod = isLiveStale(analysis)
    ? "等待重新同步"
    : analysis.source === "seed" || analysis.source === "unavailable"
      ? "等待瀏覽器轉送"
      : (analysis.targetPeriodId || "下一期");

  return [
    bubble({
      altText: `ATG賽馬AI ${analysis.count}碼即時資料`,
      title: `ATG賽馬AI · ${analysis.count}碼`,
      subtitle: "即時期號與最近三場",
      footer: "BLACKDOMAIN ATG AI",
      contents: [
        infoLine("預測期號", targetPeriod),
        infoLine(analysis.source === "seed" ? "樣本時間" : "最後同步", syncTimeLabel(analysis.updatedAt)),
        section(recentResults),
      ],
    }),
    bubble({
      altText: `ATG賽馬AI ${analysis.count}碼冠軍至五名`,
      title: `ATG賽馬AI · ${analysis.count}碼`,
      subtitle: "冠軍至五名定位推薦",
      footer: "BLACKDOMAIN ATG AI",
      contents: [section(firstHalf)],
    }),
    bubble({
      altText: `ATG賽馬AI ${analysis.count}碼六名至十名`,
      title: `ATG賽馬AI · ${analysis.count}碼`,
      subtitle: "六名至十名定位推薦",
      quickReply: atgQuickReply(),
      footer: "BLACKDOMAIN ATG AI",
      contents: [
        section(secondHalf),
        note("依近期頻率、名次鄰近度、遺漏與轉移趨勢分析；僅供娛樂參考，不保證中獎。"),
      ],
    }),
  ];
}

module.exports = {
  atgQuickReply,
  atgMenuFlex,
  atgAnalysisFlex,
};
