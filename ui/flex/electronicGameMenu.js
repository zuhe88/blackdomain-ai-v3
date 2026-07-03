function electronicGameMenu(gameName) {
  return {
    type: "flex",
    altText: `${gameName} 功能選單`,
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
        spacing: "md",
        paddingAll: "20px",
        contents: [
          {
            type: "text",
            text: "BLACKDOMAIN AI",
            weight: "bold",
            size: "xl",
            color: "#D6B46A",
            align: "center",
          },
          {
            type: "text",
            text: gameName,
            weight: "bold",
            size: "xxl",
            color: "#FFFFFF",
            align: "center",
            margin: "sm",
          },
          {
            type: "separator",
            margin: "lg",
            color: "#D6B46A",
          },
          menuCard("🤖 AI推薦房", "AI 即時推薦房號", "AI推薦房"),
          menuCard("🔥 熱門房排行", "每 30 分鐘更新排行", "熱門房排行"),
          menuCard("🔍 自選房號分析", "輸入房號進行分析", "自選房號分析"),
          menuCard("⬅ 返回電子AI", "回到電子遊戲選單", "電子"),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "14px",
        contents: [
          {
            type: "text",
            text: "BLACKDOMAIN AI ELECTRONIC ENGINE",
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

module.exports = electronicGameMenu;