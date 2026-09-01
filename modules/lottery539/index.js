const { reply, quickReply } = require("../../services/line");
const { updateSession } = require("../../utils/sessionStore");
const { bubble, card, infoLine, note, text, COLORS } = require("../../ui/flex/premium");
const { buildAnalysis, formatDate, targetDate } = require("./service");

const COMMANDS = ["539", "539AI", "今彩539", "🎯 539AI", "AI今日預測", "重新分析"];

function is539Command(text) {
  return COMMANDS.includes(String(text || "").trim());
}

function lotteryQuickReply() {
  return quickReply([
    { label: "重新分析", text: "重新分析" },
    { label: "返回首頁", text: "首頁" },
  ]);
}

function menuQuickReply() {
  return quickReply([
    { label: "AI今日預測", text: "AI今日預測" },
    { label: "返回首頁", text: "首頁" },
  ]);
}

function menuFlex() {
  return bubble({
    altText: "539AI",
    title: "539AI",
    subtitle: "BLACKDOMAIN 539 AI",
    quickReply: menuQuickReply(),
    footer: "BLACKDOMAIN 539 AI",
    contents: [
      card("🔥 AI今日預測", "整合今日號碼、熱號與冷號分析", "AI今日預測"),
      card("🏠 返回首頁", "回到 BLACKDOMAIN AI 首頁", "首頁"),
    ],
  });
}

function predictionPanel(analysis, hasHistory) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "md",
    paddingAll: "18px",
    backgroundColor: "#171511",
    cornerRadius: "20px",
    borderColor: "#8B6F2C",
    borderWidth: "1px",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        alignItems: "center",
        contents: [
          text("AI預測", { size: "sm", weight: "bold", color: COLORS.gold, flex: 1, wrap: false }),
          {
            type: "box",
            layout: "vertical",
            flex: 0,
            paddingStart: "10px",
            paddingEnd: "10px",
            paddingTop: "5px",
            paddingBottom: "5px",
            backgroundColor: "#2A2112",
            cornerRadius: "12px",
            contents: [text(analysis.date, { size: "xxs", color: COLORS.blueSoft, wrap: false })],
          },
        ],
      },
      text(hasHistory ? analysis.prediction.join("  ") : "資料不足", {
        size: hasHistory ? "xxl" : "xl",
        weight: "bold",
        color: COLORS.white,
        align: "center",
        adjustMode: "shrink-to-fit",
        wrap: false,
      }),
      text(hasHistory ? "AI 精選組合・號碼範圍 01—39" : "等待歷史資料更新", {
        size: "xxs",
        color: COLORS.muted,
        align: "center",
      }),
    ],
  };
}

function trendRow(label, values, color, backgroundColor) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    paddingAll: "11px",
    backgroundColor,
    cornerRadius: "12px",
    alignItems: "center",
    contents: [
      text(label, { size: "xs", weight: "bold", color, flex: 2, wrap: false }),
      text(values.join(" · "), {
        size: "sm",
        weight: "bold",
        color: COLORS.white,
        align: "end",
        flex: 5,
        adjustMode: "shrink-to-fit",
        wrap: false,
      }),
    ],
  };
}

function trendPanel(analysis) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    paddingAll: "14px",
    backgroundColor: "#11100E",
    cornerRadius: "18px",
    borderColor: "#4C3C1E",
    borderWidth: "1px",
    contents: [
      text("趨勢參考", { size: "xs", weight: "bold", color: COLORS.gold }),
      trendRow("熱號", analysis.hot, COLORS.gold, "#201A0F"),
      trendRow("冷號", analysis.cold, "#7FC8FF", "#101A21"),
    ],
  };
}

function recentDrawPanel(record) {
  if (!record) return null;
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    paddingAll: "14px",
    backgroundColor: "#11100E",
    cornerRadius: "18px",
    borderColor: "#4C3C1E",
    borderWidth: "1px",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [
          text("近期開獎 1", { size: "xs", weight: "bold", color: COLORS.gold, flex: 1, wrap: false }),
          text(record.date, { size: "xxs", color: COLORS.muted, align: "end", flex: 1, wrap: false }),
        ],
      },
      text(record.numbers.join("  ·  "), {
        size: "md",
        weight: "bold",
        color: COLORS.gray,
        align: "center",
        adjustMode: "shrink-to-fit",
        wrap: false,
      }),
      text("最近一期開獎結果", { size: "xxs", color: COLORS.muted, align: "center" }),
    ],
  };
}

function analysisFlex(title, analysis) {
  const hasHistory = analysis.source !== "missing-history";
  const recentDraw = hasHistory ? recentDrawPanel(analysis.recentHistory[0]) : null;
  return bubble({
    altText: "539AI",
    title,
    subtitle: "BLACKDOMAIN 539 AI",
    quickReply: lotteryQuickReply(),
    footer: "BLACKDOMAIN 539 AI",
    contents: [
      predictionPanel(analysis, hasHistory),
      ...(hasHistory
        ? [
            trendPanel(analysis),
            ...(recentDraw ? [recentDraw] : []),
          ]
        : [infoLine("資料狀態", analysis.summary)]),
      text(`最後更新 ${analysis.updatedAt}`, { size: "xxs", color: COLORS.muted, align: "center" }),
      note("本分析由 BLACKDOMAIN AI 生成，僅供娛樂參考。"),
    ],
  });
}

async function handle539Message(event) {
  const text = event.message.text.trim();
  const userId = event.source.userId || "";

  if (["539", "539AI", "今彩539", "🎯 539AI"].includes(text)) {
    updateSession("539", userId, {
      currentPage: "539AI",
      date: formatDate(targetDate()),
      lastUpdated: Date.now(),
    });
    return reply(event.replyToken, menuFlex());
  }

  const analysis = await buildAnalysis(text);
  updateSession("539", userId, {
    currentPage: "AI今日預測",
    date: analysis.date,
    prediction: analysis.prediction,
    hot: analysis.hot,
    cold: analysis.cold,
    lastUpdated: Date.now(),
  });
  return reply(event.replyToken, analysisFlex("AI今日預測", analysis));
}

module.exports = {
  is539Command,
  handle539Message,
};
