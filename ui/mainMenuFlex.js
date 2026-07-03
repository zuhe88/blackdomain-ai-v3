function mainMenuFlex() {
  return {
    type: "flex",
    altText: "BLACKDOMAIN AI V3",
    contents: {
      type: "bubble",
      size: "mega",
      styles: {
        body: { backgroundColor: "#050505" },
        footer: { backgroundColor: "#050505" },
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "BLACKDOMAIN AI V3",
            weight: "bold",
            size: "xxl",
            color: "#D6B46A",
            align: "center",
          },
          {
            type: "text",
            text: "請選擇功能",
            size: "sm",
            color: "#A8A8A8",
            align: "center",
          },
          {
            type: "separator",
            margin: "lg",
            color: "#D6B46A",
          },
          menuCard("🤖 百家樂AI", "DG / MT 真人百家樂分析", "百家樂"),
          menuCard("🎰 電子AI", "戰神賽特與古神巴風特房號分析", "電子"),
          menuCard("📊 539AI", "539 AI 分析服務", "539"),
          menuCard("⚽ 體育AI", "體育賽事 AI 分析", "體育"),
          menuCard("👑 VIP查詢", "VIP 專屬查詢服務", "VIP查詢"),
          menuCard("幸運盒", "VIP 機率抽取與開盒結果", "幸運盒"),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "14px",
        contents: [
          {
            type: "text",
            text: "BLACKDOMAIN AI ENGINE",
            size: "xs",
            color: "#777777",
            align: "center",
          },
        ],
      },
    },
  };
}

function menuCard(title, subtitle, text) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    margin: "md",
    paddingAll: "14px",
    backgroundColor: "#111111",
    cornerRadius: "14px",
    action: {
      type: "message",
      text,
    },
    contents: [
      {
        type: "text",
        text: title,
        weight: "bold",
        size: "md",
        color: "#FFFFFF",
      },
      {
        type: "text",
        text: subtitle,
        size: "xs",
        color: "#A8A8A8",
        wrap: true,
      },
    ],
  };
}

module.exports = mainMenuFlex;
