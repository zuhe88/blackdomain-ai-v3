const { quickReply } = require("../../services/line");
const { bubble, card, infoLine, note, section, text } = require("../../ui/flex/premium");

function atgQuickReply() {
  return quickReply([
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
  if (analysis.source === "live") return `即時資料 · ${analysis.historyCount}期`;
  if (analysis.source === "seed") return `歷史樣本 · ${analysis.historyCount}期`;
  return `資料不足 · ${analysis.historyCount}期`;
}

function recentResultLine(record) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    paddingAll: "9px",
    backgroundColor: "#11100E",
    cornerRadius: "12px",
    borderColor: "#4C3C1E",
    borderWidth: "1px",
    contents: [
      text(record.periodId, { size: "xs", color: "#F0D58A", weight: "bold", wrap: false }),
      text(record.result.join("-"), { size: "sm", color: "#FFFFFF", wrap: false }),
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

  const firstHalf = analysis.rows.slice(0, 5).map((row) => infoLine(row.label, row.picks.join("、")));
  const secondHalf = analysis.rows.slice(5).map((row) => infoLine(row.label, row.picks.join("、")));
  const recentResults = [
    text("最近 3 場開獎", { size: "sm", weight: "bold", color: "#D4AF37" }),
    ...analysis.recentResults.map(recentResultLine),
  ];
  const targetPeriod = analysis.source === "seed"
    ? "等待即時同步"
    : (analysis.targetPeriodId || "下一期");

  return bubble({
    altText: `ATG賽馬AI ${analysis.count}碼`,
    title: `ATG賽馬AI · ${analysis.count}碼`,
    subtitle: "冠軍至第十名定位推薦",
    quickReply: atgQuickReply(),
    footer: "BLACKDOMAIN ATG AI",
    contents: [
      infoLine("預測期號", targetPeriod),
      infoLine("分析資料", sourceLabel(analysis)),
      section(recentResults),
      section(firstHalf),
      section(secondHalf),
      note("依近期頻率、名次鄰近度、遺漏與轉移趨勢分析；僅供娛樂參考，不保證中獎。"),
    ],
  });
}

module.exports = {
  atgQuickReply,
  atgMenuFlex,
  atgAnalysisFlex,
};
