const { reply } = require("../../services/line");
const { bubble, button, infoLine, note, uriButton } = require("../../ui/flex/premium");

const EXPOSURE_URL = "https://blackdomain-ai-v3-production.up.railway.app/results/?ref=line";
const LINE_URL = "https://line.me/ti/p/@391wiftp";
const COMMANDS = new Set(["分享黑域", "黑域戰績", "戰績中心"]);

function isExposureCommand(text) {
  return COMMANDS.has(String(text || "").trim());
}

function exposureFlex() {
  return bubble({
    altText: "BLACKDOMAIN AI 即時戰績中心",
    title: "分享黑域 AI",
    subtitle: "即時戰績・公開驗證・一鍵分享",
    footer: "BLACKDOMAIN AI",
    contents: [
      infoLine("即時資料", "最新期數與最近 3 場開獎"),
      infoLine("分享內容", "前三名推薦與黑金戰績圖"),
      uriButton("開啟即時戰績中心", EXPOSURE_URL),
      uriButton("加入 BLACKDOMAIN LINE", LINE_URL, "secondary"),
      button("返回首頁", "首頁", "secondary"),
      note("僅供娛樂參考，不保證獲利或命中。18+"),
    ],
  });
}

function handleExposureMessage(event) {
  return reply(event.replyToken, exposureFlex());
}

module.exports = {
  EXPOSURE_URL,
  exposureFlex,
  handleExposureMessage,
  isExposureCommand,
};
