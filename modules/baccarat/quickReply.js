const { quickReply } = require("../../services/line");

function platformQuickReply() {
  return quickReply([
    { label: "DG", text: "DG" },
    { label: "MT", text: "MT" },
    { label: "返回首頁", text: "首頁" },
  ]);
}

function modeQuickReply() {
  return quickReply([
    { label: "AI配注", text: "AI配注" },
    { label: "天門", text: "天門" },
    { label: "自由配注", text: "自由配注" },
    { label: "返回首頁", text: "首頁" },
  ]);
}

function resultQuickReply() {
  return quickReply([
    { label: "重新開始", text: "重新開始" },
    { label: "返回房號", text: "返回房號" },
    { label: "返回首頁", text: "首頁" },
  ]);
}

function restartQuickReply() {
  return quickReply([
    { label: "重新開始", text: "百家樂" },
    { label: "返回首頁", text: "首頁" },
  ]);
}

module.exports = {
  platformQuickReply,
  modeQuickReply,
  resultQuickReply,
  restartQuickReply,
};
