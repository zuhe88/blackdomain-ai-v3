const { RESULTS, MODES, DG_ROOMS, MT_ROOMS, AB_ROOMS } = require("./constants");

function normalizeRoom(platform, room) {
  if (!room) return null;
  const value = String(room).trim().toUpperCase().replace(/\s+/g, "");

  if (platform === "DG") {
    if (/^RB\d+$/.test(value)) return `RB${String(parseInt(value.replace("RB", ""), 10)).padStart(2, "0")}`;
    if (/^S\d+$/.test(value)) return `S${String(parseInt(value.replace("S", ""), 10)).padStart(2, "0")}`;
    return value;
  }

  if (platform === "MT") {
    const match = value.match(/^B?(\d{1,2})(A|-L)?$/);
    if (match) return `B${match[1].padStart(2, "0")}${match[2] || ""}`;
  }

  return value;
}

function validateRoom(platform, room) {
  if (platform === "DG") return DG_ROOMS.includes(room);
  if (platform === "MT") return MT_ROOMS.includes(room);
  if (platform === "歐博") return AB_ROOMS.includes(room);
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
