const { quickReply } = require("../../services/line");

function platformQuickReply() {
  return quickReply([
    { label: "DG", text: "DG" },
    { label: "MT", text: "MT" },
    { label: "取消", text: "取消" },
  ]);
}

function modeQuickReply() {
  return quickReply([
    { label: "AI配注", text: "AI配注" },
    { label: "天門", text: "天門" },
    { label: "自由配注", text: "自由配注" },
    { label: "取消", text: "取消" },
  ]);
}

function resultQuickReply() {
  return quickReply([
    { label: "莊", text: "莊" },
    { label: "閒", text: "閒" },
    { label: "和", text: "和" },
    { label: "結束分析", text: "結束分析" },
  ]);
}

function restartQuickReply() {
  return quickReply([
    { label: "重新開始", text: "百家樂" },
    { label: "回首頁", text: "首頁" },
  ]);
}

module.exports = {
  platformQuickReply,
  modeQuickReply,
  resultQuickReply,
  restartQuickReply,
};