function gameBubble(imageUrl, gameName) {
  return {
    type: "bubble",
    size: "mega",
    hero: {
      type: "image",
      url: imageUrl,
      size: "full",
      aspectRatio: "16:9",
      aspectMode: "cover",
      action: {
        type: "message",
        label: gameName,
        text: gameName,
      },
    },
    body: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#050505",
      paddingAll: "14px",
      contents: [
        {
          type: "text",
          text: "⚡ 立即開始 AI 選房",
          align: "center",
          weight: "bold",
          size: "lg",
          color: "#FFD700",
          action: {
            type: "message",
            label: gameName,
            text: gameName,
          },
        },
      ],
    },
  };
}

function electronicMenuFlex() {
  return {
    type: "flex",
    altText: "電子AI",
    contents: {
      type: "carousel",
      contents: [
        gameBubble(
          "https://blackdomain-ai-v3-production.up.railway.app/images/electronic/seth1.png",
          "戰神賽特1"
        ),
        gameBubble(
          "https://blackdomain-ai-v3-production.up.railway.app/images/electronic/seth2.png",
          "戰神賽特2"
        ),
        gameBubble(
          "https://blackdomain-ai-v3-production.up.railway.app/images/electronic/baphomet.png",
          "古神巴風特"
        ),
      ],
    },
  };
}

module.exports = electronicMenuFlex;