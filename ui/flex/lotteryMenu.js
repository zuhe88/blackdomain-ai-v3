const { COLORS, text } = require("./premium");
const { moduleImageUrl } = require("../../utils/moduleImage");

function gameCard({ title, subtitle, image, actionText, maintenance = false }) {
  const cardAction = { type: "message", text: actionText };
  const bodyContents = maintenance
    ? [
        {
          type: "box",
          layout: "vertical",
          paddingAll: "8px",
          backgroundColor: "#6B2020",
          cornerRadius: "12px",
          borderColor: "#D65A5A",
          borderWidth: "1px",
          contents: [
            text("系統維護中", {
              size: "md",
              weight: "bold",
              color: COLORS.white,
              align: "center",
            }),
          ],
        },
        text(title, { size: "lg", weight: "bold", color: COLORS.gray, align: "center" }),
        text(subtitle, { size: "sm", color: COLORS.muted, align: "center" }),
        { type: "separator", margin: "md", color: "#6B2020" },
        text("服務暫停開放・完成後將重新上線", {
          size: "xs",
          color: COLORS.red,
          weight: "bold",
          align: "center",
        }),
      ]
    : [
        text(title, { size: "lg", weight: "bold", color: COLORS.gold, align: "center" }),
        text(subtitle, { size: "sm", color: COLORS.white, align: "center" }),
        { type: "separator", margin: "md", color: COLORS.gold },
        text("點擊卡片進入 AI 分析", { size: "xs", color: COLORS.gray, align: "center" }),
      ];

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
      action: cardAction,
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "16px",
      backgroundColor: maintenance ? "#151010" : COLORS.black,
      action: cardAction,
      contents: bodyContents,
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
          title: "ATG賽馬 AI",
          subtitle: "目前暫停服務，系統維護完成後開放",
          image: "atg-horse-hd.webp",
          actionText: "ATG賽馬 維護中",
          maintenance: true,
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
