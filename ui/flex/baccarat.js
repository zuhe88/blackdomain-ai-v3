const { bubble, card, infoLine, metric, note, text } = require("./premium");

function baccaratPromptFlex({ title, lines = [], quickReply }) {
  return bubble({
    altText: title,
    title,
    subtitle: "BLACKDOMAIN 百家樂AI",
    quickReply,
    footer: "BLACKDOMAIN BACCARAT AI",
    contents: lines.map((line) =>
      text(line, {
        size: "sm",
        color: "#FFFFFF",
        align: "center",
      })
    ),
  });
}

function baccaratPlatformFlex(quickReply) {
  return bubble({
    altText: "百家樂AI",
    title: "百家樂AI",
    subtitle: "BLACKDOMAIN AI",
    quickReply,
    footer: "BLACKDOMAIN BACCARAT AI",
    contents: [
      text("請選擇平台", {
        size: "md",
        weight: "bold",
        color: "#D6B46A",
        align: "center",
      }),
      card("DG", "真人百家樂平台", "DG"),
      card("MT", "真人百家樂平台", "MT"),
    ],
  });
}

function baccaratAnalysisFlex({ session, prediction, bet, confidence = "觀察中", reason = "依目前資料產生 AI 建議。", quickReply }) {
  const history = session.history.length ? session.history.join(" ") : "尚未輸入牌路";
  const profit =
    session.mode === "自由配注"
      ? "-"
      : Math.round((session.bankroll - session.startBankroll) * 100) / 100;
  const betText = session.mode === "自由配注" ? "自行控注" : String(bet);

  return bubble({
    altText: "百家樂AI 分析",
    title: "AI 建議",
    subtitle: `${session.platform}｜${session.room}`,
    quickReply,
    footer: "BLACKDOMAIN BACCARAT AI",
    contents: [
      metric("預測", prediction, session.mode),
      metric("建議下注", betText, "請依照自身風險控管操作"),
      infoLine("信心值", confidence),
      infoLine("建議原因", reason),
      infoLine("單注上限", String(session.maxBet)),
      infoLine("目前本金", session.mode === "自由配注" ? "-" : String(session.bankroll)),
      infoLine("目前獲利", String(profit)),
      infoLine("過", String(session.results.win)),
      infoLine("倒", String(session.results.lose)),
      infoLine("和", String(session.results.tie)),
      infoLine("更新時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
      note(`目前牌路：${history}`),
    ],
  });
}

module.exports = {
  baccaratPromptFlex,
  baccaratPlatformFlex,
  baccaratAnalysisFlex,
};
