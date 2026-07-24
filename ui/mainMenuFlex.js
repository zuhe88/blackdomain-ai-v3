const { COLORS, bubble, text } = require("./flex/premium");

function badge(label, color = COLORS.blueSoft) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "xs",
    paddingTop: "6px",
    paddingBottom: "6px",
    paddingStart: "9px",
    paddingEnd: "9px",
    cornerRadius: "999px",
    backgroundColor: "#11100E",
    borderColor: "#5C4823",
    borderWidth: "1px",
    contents: [
      text("●", { size: "xxs", color, flex: 0, wrap: false }),
      text(label, { size: "xxs", color: COLORS.gray, flex: 0, wrap: false }),
    ],
  };
}

function featureRow({ icon, title, subtitle, actionText, accent = COLORS.blueSoft }) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    paddingAll: "14px",
    cornerRadius: "16px",
    backgroundColor: "#11100E",
    borderColor: "#5C4823",
    borderWidth: "1px",
    action: { type: "message", text: actionText },
    contents: [
      {
        type: "box",
        layout: "vertical",
        width: "38px",
        height: "38px",
        cornerRadius: "13px",
        backgroundColor: "#171511",
        borderColor: "#6D5728",
        borderWidth: "1px",
        justifyContent: "center",
        contents: [text(icon, { size: "lg", align: "center", wrap: false })],
      },
      {
        type: "box",
        layout: "vertical",
        flex: 1,
        spacing: "xs",
        contents: [
          text(title, { size: "md", weight: "bold", color: COLORS.white }),
          text(subtitle, { size: "xs", color: COLORS.muted }),
        ],
      },
      {
        type: "box",
        layout: "vertical",
        width: "22px",
        justifyContent: "center",
        contents: [text("›", { size: "xl", color: accent, align: "end", wrap: false })],
      },
    ],
  };
}

function utilityRow() {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    margin: "sm",
    contents: [
      featureRow({ icon: "👑", title: "VIP中心", subtitle: "查看權限、狀態與到期資訊", actionText: "VIP", accent: COLORS.gold }),
      featureRow({ icon: "🌐", title: "黑域官網", subtitle: "前往官方網站與服務入口", actionText: "黑域官網", accent: COLORS.blueSoft }),
      featureRow({ icon: "📞", title: "聯繫管理員", subtitle: "需要協助時可聯繫管理窗口", actionText: "聯繫管理員", accent: COLORS.gray }),
    ],
  };
}

function mainMenuFlex() {
  return bubble({
    altText: "黑域AI",
    title: "黑域AI",
    subtitle: "AI 即時分析中心",
    footer: "黑域AI",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [badge("運行中", COLORS.green), badge("已同步", COLORS.gold), badge("即時分析", COLORS.gold)],
      },
      {
        type: "box",
        layout: "vertical",
        spacing: "xs",
        margin: "sm",
        paddingAll: "14px",
        cornerRadius: "16px",
        backgroundColor: "#0F0E0C",
        borderColor: "#5C4823",
        borderWidth: "1px",
        contents: [
          text("AI分析摘要", { size: "sm", weight: "bold", color: COLORS.white }),
          text("資料同步完成，系統正在持續監測各項分析模組。", { size: "xs", color: COLORS.muted }),
        ],
      },
      {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          featureRow({ icon: "🎲", title: "百家樂AI", subtitle: "配注分析、結果紀錄與本金追蹤", actionText: "百家樂" }),
          featureRow({ icon: "🏇", title: "ATG AI", subtitle: "電子遊戲與 ATG 賽馬分析", actionText: "ATG", accent: COLORS.gold }),
          featureRow({ icon: "🎱", title: "MB彈珠AI", subtitle: "獨立四賽道即時開獎資料", actionText: "MB彈珠", accent: COLORS.gold }),
          featureRow({ icon: "⚾", title: "體育AI", subtitle: "CPBL、MLB、NBA 賽前分析", actionText: "體育" }),
          featureRow({ icon: "🎯", title: "539AI", subtitle: "今日號碼、熱號與冷號分析", actionText: "539", accent: COLORS.gold }),
        ],
      },
      utilityRow(),
    ],
  });
}

module.exports = mainMenuFlex;
