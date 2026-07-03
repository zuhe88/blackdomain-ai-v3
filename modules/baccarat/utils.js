function normalizeRoom(platform, room) {
  if (!room) return null;

  room = String(room).trim().toUpperCase();

  room = room.replace(/\s+/g, "");

  if (platform === "DG") {

    if (/^RB\d+$/.test(room)) {

      const num = parseInt(room.replace("RB", ""));

      return `RB${String(num).padStart(2, "0")}`;

    }

    if (/^S\d+$/.test(room)) {

      const num = parseInt(room.replace("S", ""));

      return `S${String(num).padStart(2, "0")}`;

    }

    if (/^\d+$/.test(room)) {

      return String(parseInt(room)).padStart(2, "0");

    }

  }

  if (platform === "MT") {

    if (room === "3A") return "3A";

    if (room === "13A") return "13A";

    if (/^\d+$/.test(room)) {

      return String(parseInt(room)).padStart(2, "0");

    }

  }

  return room;
}

function validateRoom(platform, room) {

  if (platform === "DG") {

    if (/^\d{2}$/.test(room)) {

      const n = parseInt(room);

      return n >= 1 && n <= 7;

    }

    if (/^RB\d{2}$/.test(room)) {

      const n = parseInt(room.substring(2));

      return n >= 1 && n <= 7;

    }

    if (/^S\d{2}$/.test(room)) {

      const n = parseInt(room.substring(1));

      return n >= 1 && n <= 7;

    }

    return false;

  }

  if (platform === "MT") {

    if (room === "3A") return true;

    if (room === "13A") return true;

    if (/^\d{2}$/.test(room)) {

      const n = parseInt(room);

      return n >= 1 && n <= 13;

    }

    return false;

  }

  return false;
}

function parseMoney(value) {

  if (value === undefined || value === null) return null;

  value = String(value);

  value = value.replace(/,/g, "");

  const money = parseFloat(value);

  if (isNaN(money)) return null;

  if (money <= 0) return null;

  return money;
}

function validateMaxBet(capital, maxBet) {

  if (maxBet <= 0) return false;

  if (maxBet > capital) return false;

  return true;
}

function isResult(text) {

  return [

    "莊",

    "閒",

    "和"

  ].includes(text);

}

function isMode(text) {

  return [

    "AI配注",

    "天門",

    "自由配注"

  ].includes(text);

}

function isCancel(text){

    return text==="取消";

}

module.exports={

    normalizeRoom,

    validateRoom,

    parseMoney,

    validateMaxBet,

    isResult,

    isMode,

    isCancel

};