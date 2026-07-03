function gameBubble(imageUrl, gameName) {
  return {
    type: "bubble",
    hero: {
      type: "image",
      url: imageUrl,
      size: "full",
      aspectRatio: "16:9",
      aspectMode: "cover",
      action: {
        type: "message",
        text: gameName,
      },
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