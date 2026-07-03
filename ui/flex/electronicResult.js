function electronicRecommendFlex(gameName, room, updateTime, quickReply) {
  return card({
    altText: "AI推薦房",
    title: "AI 推薦房",
    gameName,
    label: "推薦房號",
    value: room,
    note: `更新時間：${updateTime}`,
    quickReply,
  });
}

function electronicAnalyzeFlex(gameName, room, updateTime, quickReply) {
  return card({
    altText: "自選房號分析",
    title: "自選房號分析",
    gameName,
    label: "分析房號",
    value: room,
    note: `AI 已完成分析｜${updateTime}`,
    quickReply,
  });
}

function electronicRankFlex(gameName, rooms, updateTime, quickReply) {
  return {
    type: "flex",
    altText: "熱門房排行",
    quickReply,
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#050505",
        paddingAll: "20px",
        spacing: "md",
        contents: [
          header("熱門房排行", gameName),
          ...rooms.map((room, i) => rankRow(i + 1, room)),
          {
            type: "text",
            text: `更新時間：${updateTime}`,
            size: "xs",
            color: "#777777",
            align: "center",
            margin: "md",
          },
        ],
      },
    },
  };
}

function card({ altText, title, gameName, label, value, note, quickReply }) {
  return {
    type: "flex",
    altText,
    quickReply,
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#050505",
        paddingAll: "20px",
        spacing: "md",
        contents: [
          header(title, gameName),
          {
            type: "box",
            layout: "vertical",
            backgroundColor: "#111111",
            cornerRadius: "14px",
            paddingAll: "18px",
            spacing: "sm",
            contents: [
              {
                type: "text",
                text: label,
                size: "sm",
                color: "#A8A8A8",
                align: "center",
              },
              {
                type: "text",
                text: String(value),
                size: "xxl",
                weight: "bold",
                color: "#D6B46A",
                align: "center",
              },
              {
                type: "text",
                text: note,
                size: "sm",
                color: "#FFFFFF",
                align: "center",
                margin: "md",
              },
            ],
          },
          {
            type: "text",
            text: "BLACKDOMAIN ELECTRONIC AI",
            size: "xs",
            color: "#777777",
            align: "center",
          },
        ],
      },
    },
  };
}

function header(title, gameName) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    contents: [
      {
        type: "text",
        text: "BLACKDOMAIN AI",
        size: "xl",
        weight: "bold",
        color: "#D6B46A",
        align: "center",
      },
      {
        type: "text",
        text: gameName,
        size: "md",
        weight: "bold",
        color: "#FFFFFF",
        align: "center",
      },
      {
        type: "text",
        text: title,
        size: "sm",
        color: "#A8A8A8",
        align: "center",
      },
      {
        type: "separator",
        margin: "lg",
      },
    ],
  };
}

function rankRow(rank, room) {
  return {
    type: "box",
    layout: "horizontal",
    backgroundColor: "#111111",
    cornerRadius: "12px",
    paddingAll: "14px",
    contents: [
      {
        type: "text",
        text: String(rank).padStart(2, "0"),
        size: "md",
        weight: "bold",
        color: "#D6B46A",
        flex: 1,
      },
      {
        type: "text",
        text: String(room),
        size: "lg",
        weight: "bold",
        color: "#FFFFFF",
        align: "end",
        flex: 3,
      },
    ],
  };
}

module.exports = {
  electronicRecommendFlex,
  electronicRankFlex,
  electronicAnalyzeFlex,
};