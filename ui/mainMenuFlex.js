const { COLORS, text } = require("./flex/premium");

function serviceCard({ icon, title, subtitle, actionText, accent = COLORS.gold }) {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    height: "118px",
    spacing: "sm",
    paddingAll: "13px",
    backgroundColor: "#11100E",
    cornerRadius: "18px",
    borderColor: "#5C4823",
    borderWidth: "1px",
    action: { type: "message", text: actionText },
    contents: [
      {
        type: "box",
        layout: "horizontal",
        alignItems: "center",
        contents: [
          {
            type: "box",
            layout: "vertical",
            width: "34px",
            height: "34px",
            cornerRadius: "12px",
            backgroundColor: "#1A1710",
            borderColor: accent,
            borderWidth: "1px",
            justifyContent: "center",
            contents: [text(icon, { size: "md", align: "center", wrap: false })],
          },
          text("↗", { size: "sm", color: accent, align: "end", flex: 1, wrap: false }),
        ],
      },
      text(title, { size: "sm", weight: "bold", color: COLORS.white, wrap: false }),
      text(subtitle, { size: "xxs", color: COLORS.muted, maxLines: 1, wrap: false }),
    ],
  };
}

function utilityButton(label, actionText, accent = COLORS.gold) {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    paddingAll: "10px",
    cornerRadius: "14px",
    backgroundColor: "#0F0E0C",
    borderColor: "#4C3C1E",
    borderWidth: "1px",
    action: { type: "message", text: actionText },
    contents: [text(label, { size: "xs", weight: "bold", color: accent, align: "center", wrap: false })],
  };
}

function mainMenuFlex() {
  return {
    type: "flex",
    altText: "黑域 AI 智能分析中心",
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
        contents: [
          {
            type: "box",
            layout: "vertical",
            paddingAll: "18px",
            spacing: "sm",
            cornerRadius: "22px",
            backgroundColor: "#0E0D0B",
            borderColor: "#6D5728",
            borderWidth: "1px",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                alignItems: "center",
                contents: [
                  text("BLACKDOMAIN", { size: "xxs", weight: "bold", color: COLORS.gold, flex: 1, wrap: false }),
                  {
                    type: "box",
                    layout: "horizontal",
                    spacing: "xs",
                    paddingTop: "5px",
                    paddingBottom: "5px",
                    paddingStart: "9px",
                    paddingEnd: "9px",
                    cornerRadius: "999px",
                    backgroundColor: "#102018",
                    contents: [
                      text("●", { size: "xxs", color: COLORS.green, flex: 0, wrap: false }),
                      text("系統在線", { size: "xxs", color: COLORS.green, flex: 0, wrap: false }),
                    ],
                  },
                ],
              },
              text("黑域 AI", { size: "xxl", weight: "bold", color: COLORS.white, wrap: false }),
              text("即時數據・智能分析", { size: "sm", color: COLORS.gray, wrap: false }),
              { type: "separator", margin: "sm", color: COLORS.gold },
              text("選擇下方服務，立即開始分析", { size: "xs", color: COLORS.muted, wrap: false }),
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            alignItems: "center",
            contents: [
              text("分析服務", { size: "sm", weight: "bold", color: COLORS.gold, flex: 1, wrap: false }),
              text("4 個模組", { size: "xxs", color: COLORS.muted, align: "end", wrap: false }),
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              serviceCard({ icon: "🎲", title: "百家樂 AI", subtitle: "牌路・配注分析", actionText: "百家樂" }),
              serviceCard({ icon: "⚡", title: "電子 AI", subtitle: "賽特2房間推薦", actionText: "ATG", accent: COLORS.blueSoft }),
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              serviceCard({ icon: "🎟️", title: "彩票 AI", subtitle: "MB彈珠・今彩539", actionText: "彩票", accent: COLORS.blueSoft }),
              serviceCard({ icon: "⚾", title: "體育 AI", subtitle: "賽前數據分析", actionText: "體育" }),
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            paddingAll: "13px",
            cornerRadius: "18px",
            backgroundColor: "#15120C",
            borderColor: COLORS.gold,
            borderWidth: "1px",
            action: { type: "message", text: "VIP" },
            contents: [
              text("👑", { size: "lg", flex: 0, wrap: false }),
              {
                type: "box",
                layout: "vertical",
                flex: 1,
                spacing: "xs",
                contents: [
                  text("VIP 權限中心", { size: "sm", weight: "bold", color: COLORS.white, wrap: false }),
                  text("查看目前權限與會員狀態", { size: "xxs", color: COLORS.muted, wrap: false }),
                ],
              },
              text("›", { size: "xl", color: COLORS.gold, align: "end", flex: 0, wrap: false }),
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              utilityButton("官方網站", "黑域官網"),
              utilityButton("聯繫管理員", "聯繫管理員", COLORS.gray),
            ],
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "11px",
        contents: [text("BLACKDOMAIN ELECTRONIC AI", {
          size: "xxs",
          color: COLORS.muted,
          align: "center",
          wrap: false,
        })],
      },
    },
  };
}

module.exports = mainMenuFlex;
