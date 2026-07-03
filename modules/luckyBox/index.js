const { reply, quickReply } = require("../../services/line");
const { bubble, card, infoLine, metric, note } = require("../../ui/flex/premium");

const COMMANDS = ["幸運盒", "Lucky Box", "LUCKY BOX", "抽獎", "開盒"];

function isLuckyBoxCommand(text) {
  return COMMANDS.includes(String(text || "").trim());
}

function luckyQuickReply() {
  return quickReply([
    { label: "開盒", text: "開盒" },
    { label: "VIP查詢", text: "VIP查詢" },
    { label: "回首頁", text: "首頁" },
  ]);
}

function drawPrize(userId) {
  const seedText = `${userId || "guest"}:${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" })}`;
  const seed = Array.from(seedText).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const roll = seed % 100;

  if (roll < 5) return { name: "尊榮金盒", probability: "5%" };
  if (roll < 25) return { name: "高級銀盒", probability: "20%" };
  if (roll < 60) return { name: "幸運黑盒", probability: "35%" };
  return { name: "一般禮盒", probability: "40%" };
}

function luckyMenuFlex() {
  return bubble({
    altText: "幸運盒",
    title: "幸運盒",
    subtitle: "BLACKDOMAIN LUCKY BOX",
    quickReply: luckyQuickReply(),
    footer: "BLACKDOMAIN LUCKY BOX",
    contents: [
      card("開盒", "每日一次機率抽取", "開盒"),
      infoLine("尊榮金盒", "5%"),
      infoLine("高級銀盒", "20%"),
      infoLine("幸運黑盒", "35%"),
      infoLine("一般禮盒", "40%"),
      note("幸運盒結果依使用者與台北日期產生，方便追蹤與驗證。"),
    ],
  });
}

function luckyResultFlex(userId) {
  const prize = drawPrize(userId);

  return bubble({
    altText: "幸運盒結果",
    title: "開盒結果",
    subtitle: "BLACKDOMAIN LUCKY BOX",
    quickReply: luckyQuickReply(),
    footer: "BLACKDOMAIN LUCKY BOX",
    contents: [
      metric("本次結果", prize.name, `機率：${prize.probability}`),
      infoLine("日期", new Date().toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })),
      note("請截圖保留結果，實際兌換規則以管理員公告為準。"),
    ],
  });
}

async function handleLuckyBoxMessage(event) {
  const textValue = event.message.text.trim();
  if (textValue === "開盒" || textValue === "抽獎") {
    return reply(event.replyToken, luckyResultFlex(event.source.userId || ""));
  }

  return reply(event.replyToken, luckyMenuFlex());
}

module.exports = {
  isLuckyBoxCommand,
  handleLuckyBoxMessage,
};
