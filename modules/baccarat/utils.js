function normalizeRoom(platform, room) {
  if (!room) return null;

  const value = String(room).trim().toUpperCase().replace(/\s+/g, "");

  if (platform === "DG") {
    if (/^DG\d+$/.test(value)) {
      const num = parseInt(value.replace("DG", ""), 10);
      return `DG${String(num).padStart(2, "0")}`;
    }

    if (/^RB\d+$/.test(value)) {
      const num = parseInt(value.replace("RB", ""), 10);
      return `RB${String(num).padStart(2, "0")}`;
    }

    if (/^S\d+$/.test(value)) {
      const num = parseInt(value.replace("S", ""), 10);
      return `S${String(num).padStart(2, "0")}`;
    }

    if (/^\d+$/.test(value)) {
      return `DG${String(parseInt(value, 10)).padStart(2, "0")}`;
    }
  }

  if (platform === "MT") {
    if (/^MT\d+$/.test(value)) {
      const num = parseInt(value.replace("MT", ""), 10);
      return `MT${String(num).padStart(2, "0")}`;
    }

    if (value === "3A") return "3A";
    if (value === "13A") return "13A";

    if (/^\d+$/.test(value)) {
      return `MT${String(parseInt(value, 10)).padStart(2, "0")}`;
    }
  }

  return value;
}

function validateRoom(platform, room) {
  if (platform === "DG") {
    if (/^DG\d{2}$/.test(room)) {
      const n = parseInt(room.substring(2), 10);
      return n >= 1 && n <= 7;
    }

    if (/^RB\d{2}$/.test(room)) {
      const n = parseInt(room.substring(2), 10);
      return n >= 1 && n <= 7;
    }

    if (/^S\d{2}$/.test(room)) {
      const n = parseInt(room.substring(1), 10);
      return n >= 1 && n <= 7;
    }

    return false;
  }

  if (platform === "MT") {
    if (room === "3A" || room === "13A") return true;

    if (/^MT\d{2}$/.test(room)) {
      const n = parseInt(room.substring(2), 10);
      return n >= 1 && n <= 13;
    }

    return false;
  }

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
  return ["過", "倒", "和"].includes(text);
}

function isMode(text) {
  return ["AI配注", "天門", "自由配注"].includes(text);
}

function isCancel(text) {
  return text === "取消";
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
