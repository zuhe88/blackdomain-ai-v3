function electronicMenuFlex() {
  return {
    type: "flex",
    altText: "電子AI",
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
            text: "ELECTRONIC AI",
            weight: "bold",
            size: "xxl",
            color: "#D6B46A",
            align: "center",
          },
          {
            type: "text",
            text: "黑域電子分析系統",
            size: "sm",
            color: "#A8A8A8",
            align: "center",
          },
          {
            type: "separator",
            margin: "lg",
          },
          gameCard("戰神賽特1", "房號 001 ~ 1300", "戰神賽特1"),
          gameCard("戰神賽特2", "房號 0001 ~ 4000", "戰神賽特2"),
          gameCard("古神巴風特", "房號 001 ~ 1000", "古神巴風特"),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
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

function gameCard(title, subtitle, text) {
  return {
    type: "box",
    layout: "vertical",
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
      },
    ],
  };
}

module.exports = electronicMenuFlex;