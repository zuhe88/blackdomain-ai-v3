const { publicBaseUrl } = require("../utils/moduleImage");
const { COLORS, text } = require("./flex/premium");

function actionButton(label, actionText, primary = false) {
  return {
    type: "button",
    style: primary ? "primary" : "link",
    height: "sm",
    color: primary ? COLORS.gold : COLORS.blueSoft,
    action: {
      type: "message",
      label,
      text: actionText,
    },
  };
}

function welcomeFlex() {
  return {
    type: "flex",
    altText: "歡迎加入黑域AI｜立即開始使用",
    contents: {
      type: "bubble",
      size: "mega",
      styles: {
        hero: { backgroundColor: COLORS.black },
        body: { backgroundColor: COLORS.black },
        footer: { backgroundColor: COLORS.black },
      },
      hero: {
        type: "image",
        url: `${publicBaseUrl()}/brand/blackdomain-ai-fb-cover-mobile-640x360.png?v=2`,
        size: "full",
        aspectRatio: "16:9",
        aspectMode: "cover",
        action: { type: "message", text: "黑域AI" },
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        paddingAll: "22px",
        contents: [
          text("WELCOME TO THE DOMAIN", {
            size: "xxs",
            weight: "bold",
            color: COLORS.gold,
            wrap: false,
          }),
          text("歡迎進入黑域 AI", {
            size: "xl",
            weight: "bold",
            color: COLORS.white,
          }),
          text("首次使用請先綁定 3A 帳號，開通全部 AI 權限；已開通會員可直接進入主選單。", {
            size: "sm",
            color: COLORS.gray,
          }),
          {
            type: "separator",
            margin: "sm",
            color: "#5C4823",
          },
          text("百家樂  ·  電子  ·  體育  ·  539", {
            size: "xs",
            color: COLORS.muted,
            align: "center",
            wrap: false,
          }),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "xs",
        paddingStart: "18px",
        paddingEnd: "18px",
        paddingTop: "0px",
        paddingBottom: "16px",
        contents: [
          actionButton("綁定 3A 開通全部權限", "綁定", true),
          {
            type: "box",
            layout: "horizontal",
            contents: [
              actionButton("已開通，直接開始", "黑域AI"),
              actionButton("聯繫管理員", "聯繫管理員"),
            ],
          },
          text("AI 分析結果僅供參考", {
            size: "xxs",
            color: COLORS.muted,
            align: "center",
          }),
        ],
      },
    },
  };
}

module.exports = welcomeFlex;
