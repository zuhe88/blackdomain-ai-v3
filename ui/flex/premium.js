const COLORS = {
  black: "#05080D",
  panel: "#0D1520",
  panel2: "#111C2A",
  blue: "#2F8CFF",
  blueSoft: "#69B7FF",
  gold: "#CFAE5A",
  goldDark: "#7B6532",
  white: "#FFFFFF",
  gray: "#AEB8C6",
  muted: "#6F7A88",
  red: "#D65A5A",
  green: "#4AD18F",
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
    color: "#183A5C",
  };
}

function divider(margin = "md") {
  return separator(margin);
}

function hudLine() {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "xs",
    margin: "md",
    contents: [
      { type: "box", layout: "vertical", height: "2px", flex: 2, backgroundColor: COLORS.blue, contents: [] },
      { type: "box", layout: "vertical", height: "2px", flex: 1, backgroundColor: COLORS.gold, contents: [] },
      { type: "box", layout: "vertical", height: "2px", flex: 5, backgroundColor: "#183A5C", contents: [] },
    ],
  };
}

function header(title, subtitle = "黑域AI") {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    paddingAll: "14px",
    backgroundColor: "#08111D",
    cornerRadius: "14px",
    borderColor: "#19466D",
    borderWidth: "1px",
    contents: [
      text(subtitle, { size: "xs", weight: "bold", color: COLORS.blueSoft, align: "center" }),
      text(title, { size: "xxl", weight: "bold", color: COLORS.white, align: "center" }),
      text("AI 分析系統已同步", { size: "xxs", color: COLORS.gray, align: "center" }),
      hudLine(),
    ],
  };
}

function infoLine(label, value) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    paddingAll: "10px",
    backgroundColor: COLORS.panel,
    cornerRadius: "10px",
    borderColor: "#143657",
    borderWidth: "1px",
    contents: [
      text(label, { size: "sm", color: COLORS.blueSoft, flex: 2 }),
      text(value, { size: "sm", color: COLORS.white, align: "end", flex: 4 }),
    ],
  };
}

function metric(label, value, note) {
  const contents = [
    text(label, { size: "sm", color: COLORS.blueSoft, align: "center" }),
    text(value, { size: "xxl", weight: "bold", color: COLORS.white, align: "center" }),
  ];

  if (note) contents.push(text(note, { size: "xs", color: COLORS.gold, align: "center" }));

  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    backgroundColor: COLORS.panel2,
    cornerRadius: "14px",
    borderColor: "#1D5C8F",
    borderWidth: "1px",
    paddingAll: "16px",
    contents,
  };
}

function card(title, subtitle, actionText) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    margin: "md",
    paddingAll: "14px",
    backgroundColor: COLORS.panel,
    cornerRadius: "12px",
    borderColor: "#143657",
    borderWidth: "1px",
    action: { type: "message", text: actionText },
    contents: [
      text(title, { size: "md", weight: "bold", color: COLORS.white }),
      text(subtitle, { size: "xs", color: COLORS.gray }),
      hudLine(),
    ],
  };
}

function button(label, actionText, style = "primary") {
  const color = style === "danger" ? COLORS.red : style === "secondary" ? COLORS.panel : "#145B91";
  return {
    type: "box",
    layout: "vertical",
    margin: "sm",
    paddingAll: "12px",
    backgroundColor: color,
    cornerRadius: "12px",
    borderColor: style === "secondary" ? "#143657" : COLORS.blueSoft,
    borderWidth: "1px",
    action: { type: "message", text: actionText },
    contents: [text(label, { size: "sm", weight: "bold", color: COLORS.white, align: "center" })],
  };
}

function uriButton(label, uri, style = "primary") {
  const color = style === "danger" ? COLORS.red : style === "secondary" ? COLORS.panel : "#145B91";
  return {
    type: "box",
    layout: "vertical",
    margin: "sm",
    paddingAll: "12px",
    backgroundColor: color,
    cornerRadius: "12px",
    borderColor: style === "secondary" ? "#143657" : COLORS.blueSoft,
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
    cornerRadius: "14px",
    borderColor: "#143657",
    borderWidth: "1px",
    paddingAll: "14px",
    contents,
  };
}

function note(value) {
  return text(value, { size: "xs", color: COLORS.muted, align: "center" });
}

function bubble({ altText, title, subtitle, contents = [], quickReply, footer = "黑域AI 分析系統" }) {
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
const baseFooter = (value = "黑域AI 分析系統") => ({
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
