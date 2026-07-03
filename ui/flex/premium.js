const COLORS = {
  black: "#050505",
  panel: "#111111",
  gold: "#D6B46A",
  goldDark: "#8F6B24",
  white: "#FFFFFF",
  gray: "#A8A8A8",
  muted: "#777777",
  red: "#D65A5A",
  green: "#62C48A",
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
    color: COLORS.goldDark,
  };
}

function header(title, subtitle = "BLACKDOMAIN AI") {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    contents: [
      text(subtitle, {
        size: "sm",
        weight: "bold",
        color: COLORS.gold,
        align: "center",
      }),
      text(title, {
        size: "xxl",
        weight: "bold",
        color: COLORS.white,
        align: "center",
      }),
      separator("lg"),
    ],
  };
}

function infoLine(label, value) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    contents: [
      text(label, {
        size: "sm",
        color: COLORS.gray,
        flex: 2,
      }),
      text(value, {
        size: "sm",
        color: COLORS.white,
        align: "end",
        flex: 4,
      }),
    ],
  };
}

function metric(label, value, note) {
  const contents = [
    text(label, {
      size: "sm",
      color: COLORS.gray,
      align: "center",
    }),
    text(value, {
      size: "xxl",
      weight: "bold",
      color: COLORS.gold,
      align: "center",
    }),
  ];

  if (note) {
    contents.push(
      text(note, {
        size: "xs",
        color: COLORS.gray,
        align: "center",
      })
    );
  }

  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    backgroundColor: COLORS.panel,
    cornerRadius: "14px",
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
    cornerRadius: "14px",
    action: {
      type: "message",
      text: actionText,
    },
    contents: [
      text(title, {
        size: "md",
        weight: "bold",
        color: COLORS.white,
      }),
      text(subtitle, {
        size: "xs",
        color: COLORS.gray,
      }),
    ],
  };
}

function note(value) {
  return text(value, {
    size: "xs",
    color: COLORS.muted,
    align: "center",
  });
}

function bubble({ altText, title, subtitle, contents = [], quickReply, footer = "BLACKDOMAIN AI ENGINE" }) {
  const message = {
    type: "flex",
    altText: String(altText || title || "BLACKDOMAIN AI").slice(0, 400),
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
        paddingAll: "20px",
        spacing: "md",
        contents: [header(title, subtitle), ...contents],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: [
          text(footer, {
            size: "xs",
            color: COLORS.muted,
            align: "center",
            wrap: false,
          }),
        ],
      },
    },
  };

  if (quickReply) message.quickReply = quickReply;
  return message;
}

module.exports = {
  COLORS,
  text,
  separator,
  header,
  infoLine,
  metric,
  card,
  note,
  bubble,
};
