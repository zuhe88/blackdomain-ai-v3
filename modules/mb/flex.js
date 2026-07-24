const { quickReply } = require("../../services/line");
const { moduleImageUrl } = require("../../utils/moduleImage");
const { COLORS, infoLine, note, section, text } = require("../../ui/flex/premium");

function baseBubble(hero, bodyContents, quickReplyData = null) {
  const contents = {
    type: "bubble",
    size: "mega",
    styles: {
      hero: { backgroundColor: COLORS.black },
      body: { backgroundColor: COLORS.black },
      footer: { backgroundColor: COLORS.black },
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "18px",
      contents: bodyContents,
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "10px",
      contents: [
        text("BLACKDOMAIN MB AI", {
          size: "xxs",
          color: COLORS.muted,
          align: "center",
          wrap: false,
        }),
      ],
    },
  };
  if (hero) contents.hero = hero;
  const message = {
    type: "flex",
    altText: "MB彈珠AI",
    contents,
  };
  if (quickReplyData) message.quickReply = quickReplyData;
  return message;
}

function heroImage() {
  return {
    type: "image",
    url: moduleImageUrl("mb-marble-hd.webp"),
    size: "full",
    aspectRatio: "8:9",
    aspectMode: "cover",
  };
}

function trackButton(track) {
  return {
    type: "box",
    layout: "horizontal",
    paddingAll: "13px",
    cornerRadius: "16px",
    backgroundColor: COLORS.glass,
    borderColor: "#6D5728",
    borderWidth: "1px",
    action: { type: "message", text: `MB ${track.name}` },
    contents: [
      {
        type: "box",
        layout: "vertical",
        flex: 1,
        spacing: "xs",
        contents: [
          text(track.name, { size: "md", weight: "bold", color: COLORS.white }),
          text(`${track.latestPeriodId || "等待同步"} · ${track.historyCount}期`, {
            size: "xs",
            color: COLORS.muted,
          }),
        ],
      },
      text("›", { size: "xxl", color: COLORS.gold, align: "end", flex: 0 }),
    ],
  };
}

function menuQuickReply() {
  return quickReply([
    { label: "賭城", text: "MB 賭城賽車" },
    { label: "雪地", text: "MB 雪地賽車" },
    { label: "運動", text: "MB 運動賽車" },
    { label: "海洋", text: "MB 海洋賽車" },
    { label: "返回首頁", text: "返回首頁" },
  ]);
}

function mbMenuFlex(snapshot) {
  return baseBubble(heroImage(), [
    text("MB彈珠AI", { size: "xl", weight: "bold", color: COLORS.gold, align: "center" }),
    text("獨立四賽道即時資料", { size: "sm", color: COLORS.gray, align: "center" }),
    ...snapshot.tracks.map(trackButton),
    note("選擇賽道查看最新期數與最近 3 場前三名。"),
  ], menuQuickReply());
}

function recordRow(record) {
  const values = record.result.slice(0, 3);
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    paddingAll: "11px",
    cornerRadius: "13px",
    backgroundColor: "#11100E",
    borderColor: "#4C3C1E",
    borderWidth: "1px",
    contents: [
      text(`${record.periodId}期`, { size: "xs", weight: "bold", color: COLORS.gold }),
      text(`冠軍 ${values[0]}　亞軍 ${values[1]}　第三名 ${values[2]}`, {
        size: "sm",
        weight: "bold",
        color: COLORS.white,
      }),
      text(`冠亞和 ${record.sum || values[0] + values[1]} · ${record.overUnder === "OVER" ? "大" : "小"} · ${record.oddEven === "ODD" ? "單" : "雙"}`, {
        size: "xs",
        color: COLORS.gray,
      }),
    ],
  };
}

function trackQuickReply(track) {
  return quickReply([
    { label: "立即刷新", text: `MB ${track.name}` },
    { label: "切換賽道", text: "MB彈珠" },
    { label: "返回首頁", text: "返回首頁" },
  ]);
}

function mbTrackFlex(track) {
  const recent = track.history.slice(0, 3);
  const contents = [
    text(`MB彈珠 · ${track.name}`, {
      size: "xl",
      weight: "bold",
      color: COLORS.gold,
      align: "center",
    }),
    infoLine("目前狀態", track.state),
    infoLine("預測期數", track.targetPeriodId || "等待同步"),
    infoLine("最新開獎", track.latestPeriodId || "等待同步"),
    infoLine("歷史資料", `${track.historyCount}期`),
    section(recent.length
      ? [
          text("最近 3 場開獎", { size: "sm", weight: "bold", color: COLORS.gold }),
          ...recent.map(recordRow),
        ]
      : [note("尚未收到歷史資料，請確認 MB 轉送器已啟動。")]),
    note("資料來自 MB RACING 即時轉送；分析功能將使用各賽道獨立樣本。"),
  ];
  return baseBubble(null, contents, trackQuickReply(track));
}

module.exports = {
  mbMenuFlex,
  mbTrackFlex,
};
