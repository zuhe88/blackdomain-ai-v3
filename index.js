require("dotenv").config();

const express = require("express");
const path = require("path");

const {
  line,
  lineConfig,
  reply,
  textMessage,
  quickReply,
} = require("./services/line");

const mainMenuFlex = require("./ui/mainMenuFlex");
const electronicMenuFlex = require("./ui/flex/electronicMenu");
const electronicGameMenu = require("./ui/flex/electronicGameMenu");

const electronic = require("./modules/electronic");
const baccarat = require("./modules/baccarat");

const app = express();
const PORT = process.env.PORT || 3000;

// 讓 Railway 可以讀取圖片
app.use("/images", express.static(path.join(__dirname, "assets", "images")));

app.get("/", (req, res) => {
  res.status(200).send("BLACKDOMAIN AI V3 is running.");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "BLACKDOMAIN AI V3",
    time: new Date().toISOString(),
    lineConfigured: Boolean(lineConfig.channelAccessToken && lineConfig.channelSecret),
  });
});

app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  res.status(200).end();

  const events = req.body.events || [];

  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error("EVENT_ERROR:", err);
    }
  }
});

async function handleEvent(event) {
  if (event.type !== "message") return;
  if (event.message.type !== "text") return;

  const text = event.message.text.trim();
  const replyToken = event.replyToken;
  const userId = event.source.userId;

  // 首頁
  if (["黑域AI", "首頁", "開始", "選單"].includes(text)) {
    return reply(replyToken, mainMenuFlex());
  }

  // 電子 AI 首頁：保留原本遊戲圖片選單
  if (text === "電子" || text === "電子AI" || text === "🎰 電子AI") {
    return reply(replyToken, electronicMenuFlex());
  }

  // 選擇電子遊戲
  if (
    text === "戰神賽特1" ||
    text === "戰神賽特2" ||
    text === "古神巴風特"
  ) {
    electronic.setGameSession(userId, text);
    return reply(replyToken, electronicGameMenu(text));
  }

  // 電子 AI 功能
  if (electronic.isElectronicCommand(text)) {
    return electronic.handleElectronicMessage(event);
  }

  // 百家樂
  if (baccarat.isBaccaratCommand(text)) {
    return baccarat.handleBaccaratMessage(event);
  }

  if (["539", "539AI", "📊 539AI"].includes(text)) {
    return reply(replyToken, textMessage("📊 539AI 建置中"));
  }

  if (["體育", "體育AI", "⚽ 體育AI", "MLB"].includes(text)) {
    return reply(replyToken, textMessage("⚽ 體育AI 建置中"));
  }

  if (["VIP", "VIP查詢", "👑 VIP查詢"].includes(text)) {
    return reply(replyToken, textMessage("👑 VIP查詢 建置中"));
  }

  return reply(replyToken, mainMenuFlex());
}

function mainMenu() {
  return textMessage(
    `━━━━━━━━━━━━━━━━━━━━

⚡ BLACKDOMAIN AI V3

請選擇功能

━━━━━━━━━━━━━━━━━━━━

🤖 百家樂AI
🎰 電子AI
📊 539AI
⚽ 體育AI
👑 VIP查詢

━━━━━━━━━━━━━━━━━━━━`,
    quickReply([
      { label: "🤖 百家樂AI", text: "百家樂" },
      { label: "🎰 電子AI", text: "電子" },
      { label: "📊 539AI", text: "539" },
      { label: "⚽ 體育AI", text: "體育" },
      { label: "👑 VIP查詢", text: "VIP查詢" },
    ])
  );
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`BLACKDOMAIN AI V3 running on port ${PORT}`);
  });
}

module.exports = {
  app,
  handleEvent,
};
