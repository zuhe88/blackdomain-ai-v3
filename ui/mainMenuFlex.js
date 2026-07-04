const { COLORS, bubble, button, text } = require("./flex/premium");

function statusTile(label, value, accent = COLORS.blue) {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    paddingAll: "12px",
    cornerRadius: "16px",
    backgroundColor: "#0D1520",
    borderColor: "#163854",
    borderWidth: "1px",
    contents: [
      text(label, { size: "xxs", color: COLORS.gray, align: "center" }),
      text(value, { size: "md", weight: "bold", color: accent, align: "center" }),
    ],
  };
}

function featureButton(title, subtitle, actionText, accent = COLORS.blue) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    margin: "sm",
    paddingAll: "14px",
    cornerRadius: "18px",
    backgroundColor: "#0D1520",
    borderColor: "#163854",
    borderWidth: "1px",
    action: { type: "message", text: actionText },
    contents: [
      {
        type: "box",
        layout: "vertical",
        width: "8px",
        cornerRadius: "8px",
        backgroundColor: accent,
        contents: [],
      },
      {
        type: "box",
        layout: "vertical",
        flex: 1,
        spacing: "xs",
        contents: [
          text(title, { size: "md", weight: "bold", color: COLORS.white }),
          text(subtitle, { size: "xs", color: COLORS.gray }),
        ],
      },
    ],
  };
}

function featureGrid() {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    contents: [
      featureButton("百家樂AI", "AI分析、配注紀錄、結果追蹤", "百家樂", COLORS.blue),
      featureButton("電子AI", "推薦房、熱門排行、自選分析", "電子", "#5DD6FF"),
      featureButton("體育AI", "世足、MLB、NBA 賽前分析", "體育", "#6E8BFF"),
      featureButton("539AI", "今日分析與歷史開獎", "539", COLORS.gold),
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          button("VIP中心", "VIP", "secondary"),
          button("黑域官網", "黑域官網", "secondary"),
        ],
      },
      button("聯繫管理員", "聯繫管理員", "secondary"),
    ],
  };
}

function mainMenuFlex() {
  return bubble({
    altText: "黑域AI 智能分析平台",
    title: "黑域AI 智能分析平台",
    subtitle: "AI系統運行中",
    footer: "黑域AI 智能分析平台",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          statusTile("系統狀態", "運行中"),
          statusTile("資料狀態", "已同步", COLORS.gold),
          statusTile("分析模式", "即時"),
        ],
      },
      {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        margin: "md",
        paddingAll: "14px",
        cornerRadius: "18px",
        backgroundColor: "#08111B",
        borderColor: "#173A57",
        borderWidth: "1px",
        contents: [
          text("AI分析摘要", { size: "sm", weight: "bold", color: COLORS.blueSoft }),
          text("目前資料同步完成，系統持續監測各項分析模組。", { size: "sm", color: COLORS.white }),
        ],
      },
      featureGrid(),
    ],
  });
}

module.exports = mainMenuFlex;
