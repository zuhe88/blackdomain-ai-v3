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
    altText: `${platform} 房間選擇`,
    title: `${platform} 房間選擇`,
    subtitle: "BLACKDOMAIN 百家樂AI",
    quickReply,
    footer: "BLACKDOMAIN BACCARAT AI",
    contents: [
      text("請選擇下方房間按鈕，或手動輸入正確房號。", { size: "sm", color: COLORS.white, align: "center" }),
      ...chunk(rooms, 3).map((row) => ({
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          ...row.map(roomButton),
          ...Array.from({ length: 3 - row.length }, () => ({ type: "box", layout: "vertical", flex: 1, contents: [] })),
        ],
      })),
      note("手動輸入支援 rb01、RB01、s01、S01、mt3a、MT13A 等格式。"),
    ],
  });
}

function resultActionButton(label, color) {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    height: "64px",
    paddingAll: "14px",
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
    margin: "lg",
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

function baccaratAnalysisFlex({ session, prediction, bet, reason = "BLACKDOMAIN AI 分析完成", quickReply }) {
  const history = session.history.length ? session.history.join(" ") : "目前尚無紀錄";
  const profit = session.mode === "自由配注" ? "-" : Math.round((session.bankroll - session.startBankroll) * 100) / 100;
  const betText = session.mode === "自由配注" ? "玩家自行配注" : String(bet);
  const results = {
    player: session.results.player || 0,
    tie: session.results.tie || 0,
    banker: session.results.banker || 0,
  };

  return bubble({
    altText: "百家樂AI 分析結果",
    title: "AI分析結果",
    subtitle: `${session.platform} ${session.room}`,
    quickReply,
    footer: "BLACKDOMAIN BACCARAT AI",
    contents: [
      metric("建議", prediction, session.mode),
      metric("建議金額", betText, "依單注上限與目前本金計算"),
      infoLine("目前狀態", "AI監控中"),
      infoLine("AI分析摘要", reason),
      infoLine("單注上限", String(session.maxBet)),
      infoLine("目前本金", session.mode === "自由配注" ? "-" : String(session.bankroll)),
      infoLine("目前獲利", String(profit)),
      infoLine("莊", String(results.banker)),
      infoLine("閒", String(results.player)),
      infoLine("和", String(results.tie)),
      infoLine("更新時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
      resultActionPanel(),
      note(`目前紀錄：${history}`),
    ],
  });
}

module.exports = {
  baccaratPromptFlex,
  baccaratPlatformFlex,
  baccaratRoomFlex,
  baccaratAnalysisFlex,
};
