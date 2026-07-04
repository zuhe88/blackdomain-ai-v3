const COLORS = {
  black: "#090909",
  deep: "#0D0D0D",
  panel: "#12110F",
  glass: "#171511",
  blue: "#D6B45F",
  blueSoft: "#F0D58A",
  blueDark: "#2A2112",
  gold: "#D4AF37",
  white: "#FFFFFF",
  gray: "#D8D3C8",
  muted: "#9B927E",
  red: "#D65A5A",
  green: "#43D18C",
};

function text(value, options = {}) {
  return {
    type: "text",
    text: String(value),
    wrap: options.wrap !== false,
    ...options,
  };
}

function separator(margin = "md") {
  return {
    type: "separator",
    margin,
    color: "#17304A",
  };
}

function divider(margin = "md") {
  return separator(margin);
}

function header(title, subtitle = "AI 即時分析中心") {
  return {
    type: "box",
    layout: "vertical",
    spacing: "md",
    paddingAll: "22px",
    backgroundColor: "#0E0D0B",
    cornerRadius: "22px",
    borderColor: "#6D5728",
    borderWidth: "1px",
    contents: [
      {
        type: "separator",
        color: "#D4AF37",
      },
      {
        type: "box",
        layout: "vertical",
        spacing: "xs",
        paddingTop: "8px",
        paddingBottom: "8px",
        contents: [
          text("BLACKDOMAIN AI", { size: "xs", weight: "bold", color: COLORS.gold, align: "center", wrap: false }),
          text(title, { size: "xl", weight: "bold", color: COLORS.white, align: "center" }),
          text(subtitle, { size: "xs", color: COLORS.gray, align: "center" }),
        ],
      },
      {
        type: "separator",
        color: "#D4AF37",
      },
    ],
  };
}

function infoLine(label, value) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    paddingAll: "10px",
    backgroundColor: "#11100E",
    cornerRadius: "12px",
    borderColor: "#4C3C1E",
    borderWidth: "1px",
    contents: [
      text(label, { size: "sm", color: COLORS.blueSoft, flex: 2 }),
      text(value, { size: "sm", color: COLORS.white, align: "end", flex: 4 }),
    ],
  };
}

function metric(label, value, note) {
  const contents = [
    text(label, { size: "xs", color: COLORS.blueSoft, align: "center" }),
    text(value, { size: "xxl", weight: "bold", color: COLORS.white, align: "center" }),
  ];
  if (note) contents.push(text(note, { size: "xs", color: COLORS.gray, align: "center" }));
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    backgroundColor: COLORS.glass,
    cornerRadius: "18px",
    borderColor: "#6D5728",
    borderWidth: "1px",
    paddingAll: "16px",
    contents,
  };
}

function card(title, subtitle, actionText) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    margin: "sm",
    paddingAll: "14px",
    backgroundColor: COLORS.glass,
    cornerRadius: "18px",
    borderColor: "#6D5728",
    borderWidth: "1px",
    action: { type: "message", text: actionText },
    contents: [
      text(title, { size: "md", weight: "bold", color: COLORS.white }),
      text(subtitle, { size: "xs", color: COLORS.gray }),
    ],
  };
}

function button(label, actionText, style = "primary") {
  const color = style === "danger" ? COLORS.red : "#0F0E0C";
  return {
    type: "box",
    layout: "vertical",
    margin: "sm",
    paddingAll: "12px",
    backgroundColor: color,
    cornerRadius: "18px",
    borderColor: style === "secondary" ? "#6D5728" : COLORS.gold,
    borderWidth: "1px",
    action: { type: "message", text: actionText },
    contents: [text(label, { size: "sm", weight: "bold", color: COLORS.white, align: "center" })],
  };
}

function uriButton(label, uri, style = "primary") {
  const color = style === "danger" ? COLORS.red : "#0F0E0C";
  return {
    type: "box",
    layout: "vertical",
    margin: "sm",
    paddingAll: "12px",
    backgroundColor: color,
    cornerRadius: "18px",
    borderColor: style === "secondary" ? "#6D5728" : COLORS.gold,
    borderWidth: "1px",
    action: { type: "uri", uri },
    contents: [text(label, { size: "sm", weight: "bold", color: COLORS.white, align: "center" })],
  };
}

function section(contents = []) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    backgroundColor: COLORS.panel,
    cornerRadius: "18px",
    borderColor: "#6D5728",
    borderWidth: "1px",
    paddingAll: "14px",
    contents,
  };
}

function note(value) {
  return text(value, { size: "xs", color: COLORS.muted, align: "center" });
}

function bubble({ altText, title, subtitle, contents = [], quickReply, footer = "黑域AI" }) {
  const message = {
    type: "flex",
    altText: String(altText || title || "黑域AI").slice(0, 400),
    contents: {
      type: "bubble",
      size: "mega",
      styles: {
        body: { backgroundColor: COLORS.black },
        footer: { backgroundColor: COLORS.black },
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        spacing: "md",
        backgroundColor: COLORS.black,
        contents: [header(title, subtitle), ...contents],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: [text(footer, { size: "xs", color: COLORS.muted, align: "center", wrap: false })],
      },
    },
  };
  if (quickReply) message.quickReply = quickReply;
  return message;
}

function carousel(altText, bubbles) {
  return {
    type: "flex",
    altText: String(altText || "黑域AI").slice(0, 400),
    contents: {
      type: "carousel",
      contents: bubbles,
    },
  };
}

const baseBubble = bubble;
const baseHeader = header;
const baseFooter = (value = "黑域AI") => ({
  type: "box",
  layout: "vertical",
  paddingAll: "12px",
  contents: [text(value, { size: "xs", color: COLORS.muted, align: "center", wrap: false })],
});
const baseButton = button;
const baseMetric = metric;
const baseDivider = divider;

module.exports = {
  COLORS,
  text,
  separator,
  divider,
  header,
  infoLine,
  metric,
  button,
  uriButton,
  card,
  section,
  note,
  bubble,
  carousel,
  baseBubble,
  baseHeader,
  baseFooter,
  baseButton,
  baseMetric,
  baseDivider,
};
