const GOLD = "#D6B46A";
const BLACK = "#050505";
const CARD = "#111111";
const WHITE = "#FFFFFF";
const GRAY = "#A8A8A8";
const DARK_GRAY = "#777777";

function title(title, subtitle) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    contents: [
      {
        type: "text",
        text: title,
        weight: "bold",
        size: "xxl",
        color: GOLD,
        align: "center",
      },
      {
        type: "text",
        text: subtitle,
        size: "sm",
        color: GRAY,
        align: "center",
      },
      {
        type: "separator",
        margin: "lg",
        color: GOLD,
      },
    ],
  };
}

function card(titleText, subtitle, actionText) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    margin: "md",
    paddingAll: "14px",
    backgroundColor: CARD,
    cornerRadius: "14px",
    action: {
      type: "message",
      text: actionText,
    },
    contents: [
      {
        type: "text",
        text: titleText,
        weight: "bold",
        size: "md",
        color: WHITE,
      },
      {
        type: "text",
        text: subtitle,
        size: "xs",
        color: GRAY,
        wrap: true,
      },
    ],
  };
}

function footer(text = "Powered by BLACKDOMAIN AI") {
  return {
    type: "box",
    layout: "vertical",
    contents: [
      {
        type: "text",
        text,
        size: "xs",
        color: DARK_GRAY,
        align: "center",
      },
    ],
  };
}

function bubble(bodyContents, footerText) {
  return {
    type: "flex",
    altText: "BLACKDOMAIN AI",
    contents: {
      type: "bubble",
      size: "mega",
      styles: {
        body: { backgroundColor: BLACK },
        footer: { backgroundColor: BLACK },
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: bodyContents,
      },
      footer: footer(footerText),
    },
  };
}

module.exports = {
  GOLD,
  BLACK,
  CARD,
  WHITE,
  GRAY,
  DARK_GRAY,
  title,
  card,
  footer,
  bubble,
};