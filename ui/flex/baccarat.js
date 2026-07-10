const { bubble, infoLine, metric, note, text, COLORS } = require("./premium");
const { moduleImageUrl } = require("../../utils/moduleImage");

function baccaratPromptFlex({ title, lines = [], quickReply }) {
  return bubble({
    altText: title,
    title,
    subtitle: "BLACKDOMAIN 百家樂AI",
    quickReply,
    footer: "BLACKDOMAIN BACCARAT AI",
    contents: lines.map((line) => text(line, { size: "sm", color: COLORS.white, align: "center" })),
  });
}

function platformImageBubble(actionText, title, imageName) {
  return {
    type: "bubble",
    size: "kilo",
    styles: {
      hero: { backgroundColor: COLORS.black },
      body: { backgroundColor: COLORS.black },
      footer: { backgroundColor: COLORS.black },
    },
    hero: {
      type: "image",
      url: moduleImageUrl(imageName),
      size: "full",
      aspectRatio: "8:9",
      aspectMode: "cover",
      action: { type: "message", text: actionText },
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "16px",
      action: { type: "message", text: actionText },
      contents: [
        text(title, { size: "lg", weight: "bold", color: COLORS.gold, align: "center" }),
        text("點擊平台進入房間選擇", { size: "sm", color: COLORS.white, align: "center" }),
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "10px",
      contents: [text("BLACKDOMAIN BACCARAT AI", { size: "xxs", color: COLORS.muted, align: "center", wrap: false })],
    },
  };
}

function baccaratPlatformFlex(quickReply) {
  return {
    type: "flex",
    altText: "百家樂AI",
    quickReply,
    contents: {
      type: "carousel",
      contents: [
        platformImageBubble("DG", "DG 百家樂AI", "dg.png"),
        platformImageBubble("MT", "MT 百家樂AI", "mt.png"),
      ],
    },
  };
}

function roomButton(room) {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    paddingAll: "10px",
    backgroundColor: COLORS.panel,
    cornerRadius: "10px",
    action: { type: "message", text: room },
    contents: [text(room, { size: "sm", weight: "bold", color: COLORS.gold, align: "center", wrap: false })],
  };
}

function chunk(list, size) {
  const rows = [];
  for (let i = 0; i < list.length; i += size) rows.push(list.slice(i, i + size));
  return rows;
}

function baccaratRoomFlex(platform, rooms, quickReply) {
  return bubble({
    altText: `${platform} 房號選擇`,
    title: `${platform} 房號選擇`,
    subtitle: "BLACKDOMAIN 百家樂AI",
    quickReply,
    footer: "BLACKDOMAIN BACCARAT AI",
    contents: [
      text("請選擇下方房號，也可以直接輸入正確房號。", { size: "sm", color: COLORS.white, align: "center" }),
      ...chunk(rooms, 3).map((row) => ({
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          ...row.map(roomButton),
          ...Array.from({ length: 3 - row.length }, () => ({ type: "box", layout: "vertical", flex: 1, contents: [] })),
        ],
      })),
      note("支援手動輸入，例如 rb01、RB01、s01、MT3A、MT13A。"),
    ],
  });
}

function resultActionButton(label, color) {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    height: "54px",
    paddingAll: "12px",
    backgroundColor: color,
    cornerRadius: "14px",
    justifyContent: "center",
    action: { type: "message", text: label },
    contents: [text(label, { size: "xl", weight: "bold", color: COLORS.white, align: "center", wrap: false })],
  };
}

function resultActionPanel() {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    margin: "md",
    contents: [
      text("請回報本局結果", { size: "sm", weight: "bold", color: COLORS.gold, align: "center" }),
      {
        type: "box",
        layout: "horizontal",
        spacing: "md",
        contents: [
          resultActionButton("閒", "#1F5FBF"),
          resultActionButton("和", "#8F6B24"),
          resultActionButton("莊", "#B03030"),
        ],
      },
    ],
  };
}

function baccaratAnalysisFlex({ session, prediction, bet, reason = "BLACKDOMAIN AI 已完成分析", quickReply }) {
  const profit = session.mode === "自由配注" ? "-" : Math.round((session.bankroll - session.startBankroll) * 100) / 100;
  const betText = session.mode === "自由配注" ? "自由配注不建議下注" : String(bet);
  const results = {
    pass: session.results.pass || 0,
    fail: session.results.fail || 0,
    tie: session.results.tie || 0,
  };

  return bubble({
    altText: "百家樂AI 分析結果",
    title: "AI分析結果",
    subtitle: `${session.platform} ${session.room}`,
    quickReply,
    footer: "BLACKDOMAIN BACCARAT AI",
    contents: [
      metric("建議", prediction, session.mode),
      metric("建議下注", betText, `上限 ${session.maxBet}`),
      infoLine("目前本金", session.mode === "自由配注" ? String(session.capital || session.startBankroll || "-") : String(session.bankroll)),
      infoLine("目前獲利", String(profit)),
      infoLine("紀錄", `過 ${results.pass}　倒 ${results.fail}　和 ${results.tie}`),
      infoLine("更新時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
      resultActionPanel(),
    ],
  });
}

module.exports = {
  baccaratPromptFlex,
  baccaratPlatformFlex,
  baccaratRoomFlex,
  baccaratAnalysisFlex,
};
