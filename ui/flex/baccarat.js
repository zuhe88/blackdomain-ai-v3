const {
  bubble,
  button,
  infoLine,
  metric,
  note,
  text,
  COLORS,
} = require("./premium");
const { moduleImageUrl } = require("../../utils/moduleImage");

function baccaratPromptFlex({ title, lines = [], quickReply }) {
  return bubble({
    altText: title,
    title,
    subtitle: "BLACKDOMAIN 百家樂AI",
    quickReply,
    footer: "BLACKDOMAIN BACCARAT AI",
    contents: lines.map((line) => text(line, { size: "sm", color: COLORS.white, align: "center" })),
  });
}

function platformImageBubble(actionText, title, imageName) {
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
      url: moduleImageUrl(imageName),
      size: "full",
      aspectRatio: "8:9",
      aspectMode: "cover",
      action: { type: "message", text: actionText },
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "16px",
      action: { type: "message", text: actionText },
      contents: [
        text(title, { size: "lg", weight: "bold", color: COLORS.gold, align: "center" }),
        text("點擊平台進入房間選擇", { size: "sm", color: COLORS.white, align: "center" }),
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "10px",
      contents: [text("BLACKDOMAIN BACCARAT AI", { size: "xxs", color: COLORS.muted, align: "center", wrap: false })],
    },
  };
}

function baccaratPlatformFlex(quickReply) {
  return {
    type: "flex",
    altText: "百家樂AI",
    quickReply,
    contents: {
      type: "carousel",
      contents: [
        platformImageBubble("DG", "DG 百家樂AI", "dg.png"),
        platformImageBubble("MT", "MT 百家樂AI", "mt.png"),
      ],
    },
  };
}

function roomButton(room) {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    paddingAll: "10px",
    backgroundColor: COLORS.panel,
    cornerRadius: "10px",
    action: { type: "message", text: room },
    contents: [text(room, { size: "sm", weight: "bold", color: COLORS.gold, align: "center", wrap: false })],
  };
}

function chunk(list, size) {
  const rows = [];
  for (let i = 0; i < list.length; i += size) rows.push(list.slice(i, i + size));
  return rows;
}

function baccaratRoomFlex(platform, rooms, quickReply) {
  return bubble({
    altText: `${platform} 房號選擇`,
    title: `${platform} 房號選擇`,
    subtitle: "BLACKDOMAIN 百家樂AI",
    quickReply,
    footer: "BLACKDOMAIN BACCARAT AI",
    contents: [
      text("請選擇下方房號", { size: "sm", color: COLORS.white, align: "center" }),
      ...chunk(rooms, 3).map((row) => ({
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          ...row.map(roomButton),
          ...Array.from({ length: 3 - row.length }, () => ({ type: "box", layout: "vertical", flex: 1, contents: [] })),
        ],
      })),
      note(`可選房號：${rooms.join("、")}`),
    ],
  });
}

function resultActionButton(label, color) {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    height: "54px",
    paddingAll: "12px",
    backgroundColor: color,
    cornerRadius: "14px",
    justifyContent: "center",
    action: { type: "message", text: label },
    contents: [text(label, { size: "xl", weight: "bold", color: COLORS.white, align: "center", wrap: false })],
  };
}

function resultActionPanel() {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    margin: "md",
    contents: [
      text("請回報本局結果", { size: "sm", weight: "bold", color: COLORS.gold, align: "center" }),
      {
        type: "box",
        layout: "horizontal",
        spacing: "md",
        contents: [
          resultActionButton("閒", "#1F5FBF"),
          resultActionButton("和", "#8F6B24"),
          resultActionButton("莊", "#B03030"),
        ],
      },
    ],
  };
}

function roomStat(label, value, color) {
  return {
    type: "box",
    layout: "horizontal",
    flex: 1,
    spacing: "xs",
    alignItems: "center",
    contents: [
      {
        type: "box",
        layout: "vertical",
        width: "22px",
        height: "22px",
        backgroundColor: color,
        cornerRadius: "5px",
        justifyContent: "center",
        contents: [
          text(label, {
            size: "xxs",
            weight: "bold",
            color: COLORS.white,
            align: "center",
            gravity: "center",
            wrap: false,
          }),
        ],
      },
      text(value, {
        size: "sm",
        weight: "bold",
        color: COLORS.white,
        flex: 1,
        wrap: false,
        adjustMode: "shrink-to-fit",
      }),
    ],
  };
}

function roomStatsPanel(stats) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    paddingAll: "12px",
    backgroundColor: "#11100E",
    cornerRadius: "14px",
    borderColor: "#4C3C1E",
    borderWidth: "1px",
    contents: [
      text("本房牌路統計", {
        size: "sm",
        color: COLORS.blueSoft,
        weight: "bold",
      }),
      {
        type: "box",
        layout: "horizontal",
        spacing: "xs",
        contents: [
          roomStat("莊", stats.banker, "#D71920"),
          roomStat("閒", stats.player, "#1464D2"),
          roomStat("和", stats.tie, "#278A18"),
          roomStat("總", stats.total, "#9A6728"),
        ],
      },
    ],
  };
}

function recordStat(label, value, color) {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    spacing: "xs",
    paddingAll: "7px",
    backgroundColor: "#181612",
    cornerRadius: "9px",
    contents: [
      text(value, {
        size: "md",
        weight: "bold",
        color,
        align: "center",
        wrap: false,
        adjustMode: "shrink-to-fit",
      }),
      text(label, {
        size: "xxs",
        color: COLORS.gray,
        align: "center",
        wrap: false,
        adjustMode: "shrink-to-fit",
      }),
    ],
  };
}

function performancePanel(results, hitRate) {
  const resolvedRounds = results.pass + results.fail;
  const trackedRounds = resolvedRounds + results.tie + results.observe;
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    paddingAll: "12px",
    backgroundColor: "#11100E",
    cornerRadius: "14px",
    borderColor: "#4C3C1E",
    borderWidth: "1px",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        alignItems: "center",
        contents: [
          text("推薦紀錄", {
            size: "sm",
            color: COLORS.blueSoft,
            weight: "bold",
            flex: 1,
            wrap: false,
          }),
          text(`共 ${trackedRounds} 局`, {
            size: "xxs",
            color: COLORS.muted,
            align: "end",
            flex: 1,
            wrap: false,
          }),
        ],
      },
      {
        type: "box",
        layout: "horizontal",
        spacing: "xs",
        contents: [
          recordStat("命中", results.pass, COLORS.green),
          recordStat("未中", results.fail, COLORS.red),
          recordStat("和局", results.tie, "#8FCB65"),
          recordStat("觀望", results.observe, COLORS.muted),
        ],
      },
      {
        type: "separator",
        color: "#4C3C1E",
      },
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        alignItems: "center",
        contents: [
          {
            type: "box",
            layout: "vertical",
            spacing: "xs",
            flex: 3,
            contents: [
              text("有效命中率", {
                size: "sm",
                weight: "bold",
                color: COLORS.white,
                wrap: false,
              }),
              text(
                resolvedRounds ? `依 ${resolvedRounds} 局有效推薦計算` : "尚無已結算推薦",
                {
                  size: "xxs",
                  color: COLORS.muted,
                  wrap: false,
                  adjustMode: "shrink-to-fit",
                },
              ),
            ],
          },
          text(hitRate, {
            size: "xl",
            weight: "bold",
            color: resolvedRounds ? COLORS.green : COLORS.gray,
            align: "end",
            flex: 2,
            wrap: false,
            adjustMode: "shrink-to-fit",
          }),
        ],
      },
    ],
  };
}

function naturalReason(reason, { isFreeBet, isObserve }) {
  if (isObserve) return reason;
  if (/莊家數學基準|短期路單|天門五關/.test(String(reason || ""))) {
    return isFreeBet
      ? "本局方向已完成分析"
      : "已依目前設定提供本局建議";
  }
  return reason;
}

function baccaratAnalysisFlex({
  session,
  prediction,
  bet,
  reason = "BLACKDOMAIN AI 已完成分析",
  roomStats = {},
  timing = {},
  autoResult = false,
  notice = null,
  quickReply,
}) {
  const profit = session.mode === "自由配注" ? "-" : Math.round((session.bankroll - session.startBankroll) * 100) / 100;
  const isFreeBet = session.mode === "自由配注";
  const isObserve = prediction === "觀望";
  const betLabel = isFreeBet ? "配注方式" : "建議下注";
  const betText = isFreeBet ? "玩家自行決定" : String(bet);
  const displayReason = naturalReason(reason, { isFreeBet, isObserve });
  const results = {
    pass: session.results.pass || 0,
    fail: session.results.fail || 0,
    tie: session.results.tie || 0,
    observe: session.results.observe || 0,
  };
  const resolvedRounds = results.pass + results.fail;
  const hitRate = resolvedRounds
    ? `${((results.pass / resolvedRounds) * 100).toFixed(2)}%`
    : "-";
  const tableStats = {
    banker: Number(roomStats.banker) || 0,
    player: Number(roomStats.player) || 0,
    tie: Number(roomStats.tie) || 0,
    total: Number(roomStats.total) || 0,
  };

  return bubble({
    altText: "百家樂AI 分析結果",
    title: "AI分析結果",
    subtitle: `${session.platform} ${session.room}`,
    quickReply,
    footer: "BLACKDOMAIN BACCARAT AI",
    contents: [
      metric(isObserve ? "本局策略" : "建議", prediction, displayReason),
      ...(!isObserve ? [
        metric(betLabel, betText, isFreeBet ? null : `上限 ${session.maxBet}`),
      ] : []),
      ...(!isFreeBet ? [
        infoLine("目前本金", String(session.bankroll)),
        infoLine("目前獲利", String(profit)),
      ] : []),
      roomStatsPanel(tableStats),
      infoLine("下注狀態", timing.state || "同步中"),
      ...(Number.isFinite(Number(timing.countDown)) ? [infoLine("下注倒數", `${Math.max(0, Math.floor(Number(timing.countDown)))} 秒`)] : []),
      infoLine(
        "核對提示",
        "請核對本局莊、閒、和是否與平台一致，下一局會自動分析。",
      ),
      performancePanel(results, hitRate),
      ...(notice ? [infoLine("同步狀態", notice)] : []),
      ...(autoResult ? [infoLine(
        "自動結算",
        isObserve ? "開獎後會自動重新分析" : "等待本房下一局開獎",
      )] : []),
      infoLine("更新時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
      ...(!autoResult ? [resultActionPanel()] : []),
      button("結束並返回遊戲選單", "首頁", "danger"),
    ],
  });
}

module.exports = {
  baccaratPromptFlex,
  baccaratPlatformFlex,
  baccaratRoomFlex,
  baccaratAnalysisFlex,
};
