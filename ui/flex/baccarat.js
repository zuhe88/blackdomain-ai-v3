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
const { isMtEntryEnabled, MT_PAUSE_REASON } = require("../../modules/baccarat/availability");

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
  const paused = actionText === "MT" && !isMtEntryEnabled();
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
      ...(!paused ? { action: { type: "message", text: actionText } } : {}),
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "16px",
      ...(!paused ? { action: { type: "message", text: actionText } } : {}),
      contents: [
        text(title, { size: "lg", weight: "bold", color: COLORS.gold, align: "center" }),
        text(paused ? MT_PAUSE_REASON : "點擊平台進入房間選擇", { size: "sm", color: COLORS.white, align: "center" }),
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

function verificationNotice() {
  return {
    type: "box",
    layout: "vertical",
    spacing: "md",
    paddingAll: "14px",
    backgroundColor: "#15130E",
    cornerRadius: "16px",
    borderColor: "#353A43",
    borderWidth: "1px",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        alignItems: "center",
        contents: [
          {
            type: "box",
            layout: "vertical",
            width: "24px",
            height: "24px",
            backgroundColor: "#302713",
            cornerRadius: "12px",
            justifyContent: "center",
            contents: [
              text("✓", {
                size: "xs",
                weight: "bold",
                color: COLORS.gold,
                align: "center",
                gravity: "center",
                wrap: false,
              }),
            ],
          },
          text("核對提示", {
            size: "sm",
            weight: "bold",
            color: COLORS.gold,
            flex: 1,
            wrap: false,
          }),
        ],
      },
      text("請核對本局莊、閒、和是否與平台一致，", {
        size: "sm",
        color: COLORS.white,
        lineSpacing: "5px",
      }),
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        paddingAll: "10px",
        backgroundColor: "#102219",
        cornerRadius: "10px",
        alignItems: "center",
        contents: [
          text("●", { size: "xxs", color: COLORS.green, flex: 0, wrap: false }),
          text("下一局會自動分析。", {
            size: "xs",
            weight: "bold",
            color: COLORS.green,
            flex: 1,
            wrap: false,
          }),
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
    backgroundColor: "#171B21",
    cornerRadius: "14px",
    borderColor: "#30353E",
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
    backgroundColor: "#171B21",
    cornerRadius: "14px",
    borderColor: "#30353E",
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
        color: "#30353E",
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

function compactPerformancePanel(results) {
  const trackedRounds = results.pass + results.fail + results.tie + results.observe;
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    paddingAll: "10px",
    backgroundColor: "#171B21",
    cornerRadius: "12px",
    borderColor: "#30353E",
    borderWidth: "1px",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [
          text("推薦紀錄", { size: "xs", weight: "bold", color: COLORS.blueSoft, flex: 1, wrap: false }),
          text(`共 ${trackedRounds} 局`, { size: "xxs", color: COLORS.muted, align: "end", flex: 1, wrap: false }),
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
    ],
  };
}

function baccaratLiveUpdateFlex({ session, prediction, betText, betLabel, isFreeBet, isObserve, profit, results, tableStats, notice, quickReply }) {
  const muted = "#9CA3AF", gold = "#E2C18D", white = "#F2F3F5";
  const value = amount => Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const stat = (label, amount, color = white) => ({ type: "box", layout: "vertical", flex: 1, spacing: "sm", contents: [
    text(label, { size: "xxs", color: muted, wrap: true }),
    text(amount, { size: "xl", color, weight: "bold", wrap: true, adjustMode: "shrink-to-fit" }),
  ] });
  const divider = { type: "separator", color: "#30343B", margin: "md" };
  const message = { type: "flex", altText: ["分析中", session.platform + " " + session.room, prediction, isObserve ? "" : betLabel + " " + betText].filter(Boolean).join("｜"), contents: {
    type: "bubble", size: "mega", styles: { body: { backgroundColor: "#14171C" } },
    body: { type: "box", layout: "vertical", paddingAll: "22px", spacing: "lg", contents: [
      { type: "box", layout: "horizontal", alignItems: "center", contents: [
        text(session.platform + " " + session.room, { size: "md", color: white, weight: "bold", flex: 1, wrap: true }),
        text("分析中", { size: "xxs", color: "#84C7AA", align: "end", flex: 0 }),
      ] }, divider,
      { type: "box", layout: "horizontal", spacing: "lg", contents: [
        stat(isObserve ? "本局策略" : "下一局建議", prediction, prediction === "莊" ? "#EF8B83" : prediction === "閒" ? "#83AFE5" : gold),
        ...(!isObserve ? [stat(betLabel, betText, gold)] : []),
      ] },
      ...(!isFreeBet ? [divider, { type: "box", layout: "horizontal", spacing: "md", contents: [
        stat("剩餘模擬本金", value(session.bankroll)),
        stat("累計模擬盈虧", (Number(profit) > 0 ? "+" : "") + value(profit), Number(profit) < 0 ? "#EF8B83" : gold),
      ] }, text("依建議金額模擬計算", { size: "xxs", color: muted })] : []),
      divider, roomStatsPanel(tableStats), compactPerformancePanel(results),
      ...(notice ? [text("同步提示：" + notice, { size: "xs", color: "#EF8B83", wrap: true })] : []),
      text("請核對莊、閒、和、總數是否與平台一致", { size: "xxs", color: muted, wrap: true }),
      { type: "box", layout: "vertical", paddingAll: "12px", cornerRadius: "10px", borderWidth: "1px", borderColor: "#897656", action: { type: "message", label: "結束分析", text: "首頁" }, contents: [text("結束分析", { size: "sm", color: gold, align: "center", weight: "bold" })] },
    ] },
  } };
  if (quickReply) message.quickReply = quickReply;
  return softenBaccaratCard(message);
}

function softenBaccaratCard(message) {
  const colors = { "#171B21": "#14171C", "#181612": "#1B1F25", "#30353E": "#30343B", "#353A43": "#30343B", "#D71920": "#9B514E", "#1464D2": "#3C618C", "#278A18": "#3B715B", "#9A6728": "#76654B" };
  function visit(node) {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && colors[value]) node[key] = colors[value];
      else if (typeof value === "object") visit(value);
    }
  }
  visit(message);
  return message;
}

function baccaratAnalysisFlex({
  session,
  prediction,
  bet,
  reason = "BLACKDOMAIN AI 已完成分析",
  roomStats = {},
  autoResult = false,
  compact = false,
  notice = null,
  quickReply,
}) {
  const profit = session.mode === "自由配注" ? "-" : Math.round((session.bankroll - session.startBankroll) * 100) / 100;
  const isFreeBet = session.mode === "自由配注" || session.fundingPaused;
  if (session.fundingPaused) {
    notice = ["資金條件不足，已停止推薦金額與本金紀錄；預測持續更新。", notice].filter(Boolean).join("；");
  }
  const isObserve = prediction === "觀望";
  const betLabel = isFreeBet ? "配注方式" : "建議下注";
  const betText = session.fundingPaused ? "已停止推薦金額" : isFreeBet ? "玩家自行決定" : String(bet);
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

  if (autoResult && compact) {
    return baccaratLiveUpdateFlex({
      session,
      prediction,
      betText,
      betLabel,
      isFreeBet,
      isObserve,
      profit,
      results,
      tableStats,
      notice,
      quickReply,
    });
  }

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
        infoLine("剩餘模擬本金", String(session.bankroll)),
        infoLine("累計模擬盈虧", String(profit)),
      ] : []),
      roomStatsPanel(tableStats),
      verificationNotice(),
      performancePanel(results, hitRate),
      ...(notice ? [infoLine("同步狀態", notice)] : []),
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
