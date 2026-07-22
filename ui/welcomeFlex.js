const { COLORS, bubble, button, note, text } = require("./flex/premium");

function statusBadge() {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "xs",
    paddingTop: "7px",
    paddingBottom: "7px",
    paddingStart: "11px",
    paddingEnd: "11px",
    cornerRadius: "999px",
    backgroundColor: "#11100E",
    borderColor: "#5C4823",
    borderWidth: "1px",
    contents: [
      text("●", { size: "xxs", color: COLORS.green, flex: 0, wrap: false }),
      text("系統運行中", { size: "xxs", color: COLORS.gray, flex: 0, wrap: false }),
    ],
  };
}

function feature(label) {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    paddingAll: "10px",
    cornerRadius: "12px",
    backgroundColor: "#11100E",
    borderColor: "#4C3C1E",
    borderWidth: "1px",
    contents: [text(label, { size: "xs", weight: "bold", color: COLORS.white, align: "center", wrap: false })],
  };
}

function welcomeFlex() {
  return bubble({
    altText: "歡迎加入黑域AI｜點此開始使用",
    title: "歡迎加入黑域AI",
    subtitle: "你的 AI 即時分析中心",
    footer: "BLACKDOMAIN AI",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [statusBadge()],
      },
      {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "15px",
        cornerRadius: "16px",
        backgroundColor: "#0F0E0C",
        borderColor: "#5C4823",
        borderWidth: "1px",
        contents: [
          text("從這裡開始", { size: "md", weight: "bold", color: COLORS.gold }),
          text("選擇主選單中的分析模組，即可查看功能；尚未開通的會員可先進入 VIP 中心完成綁定。", {
            size: "sm",
            color: COLORS.gray,
          }),
        ],
      },
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [feature("🎲 百家樂"), feature("⚡ 電子")],
      },
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [feature("⚾ 體育"), feature("🎯 539")],
      },
      button("立即開始使用", "黑域AI"),
      button("VIP 綁定與權限", "VIP", "secondary"),
      button("聯繫管理員", "聯繫管理員", "secondary"),
      note("BLACKDOMAIN AI 提供 AI 分析、預測、建議與統計，結果僅供參考。"),
    ],
  });
}

module.exports = welcomeFlex;
