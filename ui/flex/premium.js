const COLORS = {
  black: "#101216",
  deep: "#14171C",
  panel: "#191D23",
  glass: "#1B1F26",
  blue: "#D9BD8E",
  blueSoft: "#E3CFA9",
  blueDark: "#292722",
  gold: "#DEC398",
  white: "#F2F3F5",
  gray: "#CDD1D8",
  muted: "#A1A8B3",
  red: "#DF8A84",
  green: "#8AC9AC",
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
    color: "#30353E",
  };
}

function divider(margin = "md") {
  return separator(margin);
}

function header(title, subtitle = "AI 即時分析中心") {
  return { type: "box", layout: "vertical", spacing: "sm", paddingTop: "6px", paddingBottom: "14px", contents: [
    text("BLACKDOMAIN AI", { size: "xxs", color: COLORS.gold, wrap: false }),
    text(title, { size: "xl", weight: "bold", color: COLORS.white }),
    text(subtitle, { size: "xs", color: COLORS.muted }),
  ] };
}

function infoLine(label, value) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    paddingAll: "10px",
    backgroundColor: "#171B21",
    cornerRadius: "12px",
    borderColor: "#30353E",
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
    cornerRadius: "10px",
    borderColor: "#353A43",
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
    cornerRadius: "10px",
    borderColor: "#353A43",
    borderWidth: "1px",
    action: { type: "message", text: actionText },
    contents: [
      text(title, { size: "md", weight: "bold", color: COLORS.white }),
      text(subtitle, { size: "xs", color: COLORS.gray }),
    ],
  };
}

function button(label, actionText, style = "primary") {
  const color = style === "primary" ? "#DEC398" : "#20252D";
  return {
    type: "box",
    layout: "vertical",
    margin: "sm",
    paddingAll: "12px",
    backgroundColor: color,
    cornerRadius: "10px",
    borderColor: style === "danger" ? "#79504F" : "#353A43",
    borderWidth: "1px",
    action: { type: "message", text: actionText },
    contents: [text(label, { size: "sm", weight: "bold", color: style === "primary" ? "#17191D" : style === "danger" ? COLORS.red : COLORS.white, align: "center" })],
  };
}

function uriButton(label, uri, style = "primary") {
  const color = style === "primary" ? "#DEC398" : "#20252D";
  return {
    type: "box",
    layout: "vertical",
    margin: "sm",
    paddingAll: "12px",
    backgroundColor: color,
    cornerRadius: "10px",
    borderColor: style === "danger" ? "#79504F" : "#353A43",
    borderWidth: "1px",
    action: { type: "uri", uri },
    contents: [text(label, { size: "sm", weight: "bold", color: style === "primary" ? "#17191D" : style === "danger" ? COLORS.red : COLORS.white, align: "center" })],
  };
}

function section(contents = []) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    backgroundColor: COLORS.panel,
    cornerRadius: "10px",
    borderColor: "#353A43",
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
