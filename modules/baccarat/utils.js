const { RESULTS, MODES, DG_ROOMS, MT_ROOMS } = require("./constants");

function normalizeRoom(platform, room) {
  if (!room) return null;
  const value = String(room).trim().toUpperCase().replace(/\s+/g, "");

  if (platform === "DG") {
    if (/^RB\d+$/.test(value)) return `RB${String(parseInt(value.replace("RB", ""), 10)).padStart(2, "0")}`;
    if (/^S\d+$/.test(value)) return `S${String(parseInt(value.replace("S", ""), 10)).padStart(2, "0")}`;
    return value;
  }

  if (platform === "MT") {
    if (value === "3A") return "MT3A";
    if (value === "13A") return "MT13A";
    if (/^MT\d+A$/.test(value)) return `MT${parseInt(value.replace("MT", "").replace("A", ""), 10)}A`;
    if (/^MT\d+$/.test(value)) return `MT${String(parseInt(value.replace("MT", ""), 10)).padStart(2, "0")}`;
    if (/^\d+$/.test(value)) return `MT${String(parseInt(value, 10)).padStart(2, "0")}`;
  }

  return value;
}

function validateRoom(platform, room) {
  if (platform === "DG") return DG_ROOMS.includes(room);
  if (platform === "MT") return MT_ROOMS.includes(room);
  return false;
}

function parseMoney(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value).replace(/,/g, "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const money = parseInt(raw, 10);
  return Number.isInteger(money) && money > 0 ? money : null;
}

function validateMaxBet(capital, maxBet) {
  return maxBet > 0 && maxBet <= capital;
}

function isResult(value) {
  return RESULTS.includes(String(value || "").trim());
}

function isMode(value) {
  return MODES.includes(String(value || "").trim());
}

function isCancel(value) {
  return ["返回首頁", "首頁", "主選單", "選單", "取消", "退出"].includes(String(value || "").trim());
}

module.exports = {
  normalizeRoom,
  validateRoom,
  parseMoney,
  validateMaxBet,
  isResult,
  isMode,
  isCancel,
};
