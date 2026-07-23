const { COLORS, text } = require("./premium");
const { moduleImageUrl } = require("../../utils/moduleImage");

function gameCard({ title, subtitle, image, actionText }) {
  return {
    type: "bubble",
    size: "kilo",
    styles: {
      hero: { backgroundColor: COLORS.black },
      body: { backgroundColor: COLORS.black },
      footer: { backgroundColor: COLORS.black },
    },
    hero: {
      type: "image",
      url: moduleImageUrl(image),
      size: "full",
      aspectRatio: "8:9",
      aspectMode: "cover",
      action: { type: "message", text: actionText },
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "16px",
      action: { type: "message", text: actionText },
      contents: [
        text(title, { size: "lg", weight: "bold", color: COLORS.gold, align: "center" }),
        text(subtitle, { size: "sm", color: COLORS.white, align: "center" }),
        { type: "separator", margin: "md", color: COLORS.gold },
        text("點擊卡片進入 AI 分析", { size: "xs", color: COLORS.gray, align: "center" }),
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "10px",
      contents: [text("BLACKDOMAIN ATG AI", { size: "xxs", color: COLORS.muted, align: "center", wrap: false })],
    },
  };
}

function electronicMenuFlex() {
  return {
    type: "flex",
    altText: "ATG AI 遊戲選單",
    contents: {
      type: "carousel",
      contents: [
        gameCard({
          title: "ATG賽馬",
          subtitle: "即時期數、開獎與冠亞季軍推薦",
          image: "atg-horse-hd.webp",
          actionText: "ATG賽馬",
        }),
        gameCard({
          title: "戰神賽特1",
          subtitle: "AI推薦房、熱門排行、自選分析",
          image: "seth1-hd.webp",
          actionText: "戰神賽特1",
        }),
        gameCard({
          title: "戰神賽特2",
          subtitle: "AI推薦房、熱門排行、自選分析",
          image: "seth2-hd.webp",
          actionText: "戰神賽特2",
        }),
        gameCard({
          title: "古神巴風特",
          subtitle: "AI推薦房、熱門排行、自選分析",
          image: "baphomet-hd.webp",
          actionText: "古神巴風特",
        }),
        gameCard({
          title: "虎小妹",
          subtitle: "AI推薦房、熱門排行、自選分析",
          image: "tiger-girl-hd.webp",
          actionText: "虎小妹",
        }),
        gameCard({
          title: "赤三國",
          subtitle: "AI推薦房、熱門排行、自選分析",
          image: "red-three-kingdoms-hd.webp",
          actionText: "赤三國",
        }),
      ],
    },
  };
}

module.exports = electronicMenuFlex;
