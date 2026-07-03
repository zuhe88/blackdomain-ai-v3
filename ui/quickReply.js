function createQuickReply(items = []) {
  return {
    items: items.map((item) => ({
      type: "action",
      action: {
        type: "message",
        label: item.label,
        text: item.text,
      },
      ...(isHttpsUrl(item.imageUrl) ? { imageUrl: item.imageUrl } : {}),
    })),
  };
}

function isHttpsUrl(value) {
  return /^https:\/\//i.test(String(value || ""));
}

// 電子AI 遊戲選單
function electronicGames() {
  return createQuickReply([
    {
      label: "戰神賽特1",
      text: "戰神賽特1",
      imageUrl: process.env.IMG_SET1,
    },
    {
      label: "戰神賽特2",
      text: "戰神賽特2",
      imageUrl: process.env.IMG_SET2,
    },
    {
      label: "古神巴風特",
      text: "古神巴風特",
      imageUrl: process.env.IMG_BAPHOMET,
    },
  ]);
}

// 電子AI 功能
function electronicMenu() {
  return createQuickReply([
    {
      label: "🤖 AI推薦房",
      text: "AI推薦房",
    },
    {
      label: "🔥 熱門房排行",
      text: "熱門房排行",
    },
    {
      label: "🔍 自選房號分析",
      text: "自選房號分析",
    },
  ]);
}

// AI推薦房後
function electronicRecommend() {
  return createQuickReply([
    {
      label: "🔄 換一間",
      text: "換一間",
    },
    {
      label: "🔍 自選房號分析",
      text: "自選房號分析",
    },
    {
      label: "⬅️ 返回功能",
      text: "返回電子功能",
    },
  ]);
}

// 熱門排行後
function electronicRank() {
  return createQuickReply([
    {
      label: "🤖 AI推薦房",
      text: "AI推薦房",
    },
    {
      label: "🔍 自選房號分析",
      text: "自選房號分析",
    },
    {
      label: "⬅️ 返回功能",
      text: "返回電子功能",
    },
  ]);
}

// 自選分析後
function electronicAnalyze() {
  return createQuickReply([
    {
      label: "🤖 AI推薦房",
      text: "AI推薦房",
    },
    {
      label: "🔍 再分析",
      text: "自選房號分析",
    },
    {
      label: "⬅️ 返回功能",
      text: "返回電子功能",
    },
  ]);
}

module.exports = {
  createQuickReply,
  electronicGames,
  electronicMenu,
  electronicRecommend,
  electronicRank,
  electronicAnalyze,
};
