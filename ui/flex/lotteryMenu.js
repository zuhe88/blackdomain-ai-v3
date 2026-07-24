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
      contents: [
        text("BLACKDOMAIN LOTTERY AI", {
          size: "xxs",
          color: COLORS.muted,
          align: "center",
          wrap: false,
        }),
      ],
    },
  };
}

function lotteryMenuFlex() {
  return {
    type: "flex",
    altText: "彩票AI 遊戲選單",
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
          title: "MB彈珠",
          subtitle: "四條賽道即時開獎與定位推薦",
          image: "mb-marble-hd.webp",
          actionText: "MB彈珠",
        }),
        gameCard({
          title: "今彩539",
          subtitle: "今日號碼、熱號與冷號分析",
          image: "lottery539-hd.webp",
          actionText: "539",
        }),
      ],
    },
  };
}

module.exports = lotteryMenuFlex;
