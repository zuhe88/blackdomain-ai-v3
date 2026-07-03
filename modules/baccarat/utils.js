const { RESULTS, MODES, DG_ROOMS, MT_ROOMS } = require("./constants");

function normalizeRoom(platform, room) {
  if (!room) return null;

  const value = String(room).trim().toUpperCase().replace(/\s+/g, "");

  if (platform === "DG") {
    if (/^RB\d+$/.test(value)) {
      const num = parseInt(value.replace("RB", ""), 10);
      return `RB${String(num).padStart(2, "0")}`;
    }

    if (/^S\d+$/.test(value)) {
      const num = parseInt(value.replace("S", ""), 10);
      return `S${String(num).padStart(2, "0")}`;
    }

    return value;
  }

  if (platform === "MT") {
    if (value === "3A") return "MT3A";
    if (value === "13A") return "MT13A";

    if (/^MT\d+A$/.test(value)) {
      const num = parseInt(value.replace("MT", "").replace("A", ""), 10);
      return `MT${num}A`;
    }

    if (/^MT\d+$/.test(value)) {
      const num = parseInt(value.replace("MT", ""), 10);
      return `MT${String(num).padStart(2, "0")}`;
    }

    if (/^\d+$/.test(value)) {
      return `MT${String(parseInt(value, 10)).padStart(2, "0")}`;
    }
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
  if (!Number.isInteger(money) || money <= 0) return null;
  return money;
}

function validateMaxBet(capital, maxBet) {
  if (maxBet <= 0) return false;
  if (maxBet > capital) return false;
  return true;
}

function isResult(text) {
  return RESULTS.includes(text);
}

function isMode(text) {
  return MODES.includes(text);
}

function isCancel(text) {
  return ["返回首頁", "首頁", "主選單", "選單", "取消", "退出"].includes(String(text || "").trim());
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
