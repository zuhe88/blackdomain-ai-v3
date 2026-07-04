const COLORS = {
  black: "#06080C",
  deep: "#0B0E13",
  panel: "#11151C",
  glass: "#151A22",
  blue: "#4A9BD8",
  blueSoft: "#8DBCE4",
  blueDark: "#172B3D",
  gold: "#B99A55",
  white: "#FFFFFF",
  gray: "#C7CED8",
  muted: "#7C8794",
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

function hexMark() {
  return {
    type: "box",
    layout: "vertical",
    width: "34px",
    height: "34px",
    cornerRadius: "12px",
    backgroundColor: "#111923",
    borderColor: "#26445C",
    borderWidth: "1px",
    contents: [
      text("AI", {
        size: "xxs",
        weight: "bold",
        color: COLORS.blueSoft,
        align: "center",
        gravity: "center",
        wrap: false,
      }),
    ],
  };
}

function header(title, subtitle = "AI 即時分析中心") {
  return {
    type: "box",
    layout: "vertical",
    spacing: "md",
    paddingAll: "20px",
    backgroundColor: "#0D1118",
    cornerRadius: "22px",
    borderColor: "#202A36",
    borderWidth: "1px",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        spacing: "md",
        contents: [
          hexMark(),
          {
            type: "box",
            layout: "vertical",
            flex: 1,
            contents: [
              text(title, { size: "xl", weight: "bold", color: COLORS.white }),
              text(subtitle, { size: "xs", color: COLORS.blueSoft }),
            ],
          },
        ],
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
    backgroundColor: "#0B121B",
    cornerRadius: "12px",
    borderColor: "#14304A",
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
    borderColor: "#1B5B85",
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
    borderColor: "#163854",
    borderWidth: "1px",
    action: { type: "message", text: actionText },
    contents: [
      text(title, { size: "md", weight: "bold", color: COLORS.white }),
      text(subtitle, { size: "xs", color: COLORS.gray }),
    ],
  };
}

function button(label, actionText, style = "primary") {
  const color = style === "danger" ? COLORS.red : style === "secondary" ? "#0D1722" : "#145B91";
  return {
    type: "box",
    layout: "vertical",
    margin: "sm",
    paddingAll: "12px",
    backgroundColor: color,
    cornerRadius: "14px",
    borderColor: style === "secondary" ? "#1B3A55" : COLORS.blueSoft,
    borderWidth: "1px",
    action: { type: "message", text: actionText },
    contents: [text(label, { size: "sm", weight: "bold", color: COLORS.white, align: "center" })],
  };
}

function uriButton(label, uri, style = "primary") {
  const color = style === "danger" ? COLORS.red : style === "secondary" ? "#0D1722" : "#145B91";
  return {
    type: "box",
    layout: "vertical",
    margin: "sm",
    paddingAll: "12px",
    backgroundColor: color,
    cornerRadius: "14px",
    borderColor: style === "secondary" ? "#1B3A55" : COLORS.blueSoft,
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
    borderColor: "#163854",
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
