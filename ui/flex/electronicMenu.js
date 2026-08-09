const { COLORS, text } = require("./premium");
const { moduleImageUrl } = require("../../utils/moduleImage");

function gameCard({ title, subtitle, image, actionText, unavailable = false }) {
  const action = unavailable ? undefined : { type: "message", text: actionText };
  const bodyContents = unavailable
    ? [
        {
          type: "box",
          layout: "vertical",
          paddingAll: "8px",
          backgroundColor: "#6B2020",
          cornerRadius: "12px",
          borderColor: "#D65A5A",
          borderWidth: "1px",
          contents: [text("暫未開放", {
            size: "md",
            weight: "bold",
            color: COLORS.white,
            align: "center",
          })],
        },
        text(title, { size: "lg", weight: "bold", color: COLORS.gray, align: "center" }),
        text(subtitle, { size: "sm", color: COLORS.muted, align: "center" }),
        { type: "separator", margin: "md", color: "#6B2020" },
        text("此遊戲目前無法點選", { size: "xs", color: COLORS.red, weight: "bold", align: "center" }),
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
      ...(action ? { action } : {}),
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "16px",
      backgroundColor: unavailable ? "#151010" : COLORS.black,
      ...(action ? { action } : {}),
      contents: bodyContents,
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "10px",
      contents: [text("BLACKDOMAIN ATG AI", { size: "xxs", color: COLORS.muted, align: "center", wrap: false })],
    },
  };
}

function electronicMenuFlex(isGameEnabled = () => true) {
  return {
    type: "flex",
    altText: "ATG AI 遊戲選單",
    contents: {
      type: "carousel",
      contents: [
        gameCard({
          title: "戰神賽特1",
          subtitle: "AI 房號推薦",
          image: "seth1-hd.webp",
          actionText: "戰神賽特1",
          unavailable: !isGameEnabled("戰神賽特1"),
        }),
        gameCard({
          title: "戰神賽特2",
          subtitle: "AI 即時空桌推薦與房間數據",
          image: "seth2-hd.webp",
          actionText: "戰神賽特2",
          unavailable: !isGameEnabled("戰神賽特2"),
        }),
        gameCard({
          title: "古神巴風特",
          subtitle: "AI 房號推薦",
          image: "baphomet-hd.webp",
          actionText: "古神巴風特",
          unavailable: !isGameEnabled("古神巴風特"),
        }),
        gameCard({
          title: "虎小妹",
          subtitle: "AI 房號推薦",
          image: "tiger-girl-hd.webp",
          actionText: "虎小妹",
          unavailable: !isGameEnabled("虎小妹"),
        }),
        gameCard({
          title: "赤三國",
          subtitle: "AI 房號推薦",
          image: "red-three-kingdoms-hd.webp",
          actionText: "赤三國",
          unavailable: !isGameEnabled("赤三國"),
        }),
      ],
    },
  };
}

module.exports = electronicMenuFlex;
