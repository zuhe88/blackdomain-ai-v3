const { AB_ROOMS } = require("./constants");

function specialGame(room) {
  if (["BB602", "BB701", "BB801"].includes(room)) return "bullbull";
  if (room === "T501") return "dotsmahjong";
  return null;
}

function decodeRoad(road) {
  if (typeof road !== "string" || !/^[012]\d{2}[0-9A-Z]{9}$/i.test(road)) return null;
  const banker = Number(road[1]);
  const player = Number(road[2]);
  const winner = banker === player ? 0 : banker > player ? 1 : 2;
  if (Number(road[0]) !== winner) return null;
  return { code: [9, 1, 5][winner], banker, player };
}

function normalizeTable({ tableId, room, roads } = {}) {
  if (!Number.isSafeInteger(tableId) || tableId <= 0 || !AB_ROOMS.includes(room)
    || !Array.isArray(roads) || roads.length > 150) return null;
  const normalized = roads.map((road, index) => {
    const round = decodeRoad(road);
    return round ? `${index + 1}-${road}#${round.code}` : null;
  });
  if (normalized.includes(null)) return null;
  return { tableId, tableName: room, round: roads.length, roads: normalized };
}

function normalizeSpecialTable({ tableId, room, roads } = {}) {
  const game = specialGame(room);
  if (!game || !Number.isSafeInteger(tableId) || tableId <= 0
    || !Array.isArray(roads) || roads.length > 150) return null;
  const pattern = game === "bullbull" ? /^[0-9A-Z]{5}$/i : /^[0-9A-Z]{17}$/i;
  if (!roads.every((road) => typeof road === "string" && pattern.test(road))) return null;
  return { tableId, room, game, historyCount: roads.length };
}

function createTableFeed() {
  const tables = new Map();
  function update(tableId, roads) {
    const table = tables.get(tableId);
    if (!table) return [];
    if (!Array.isArray(roads) || !(normalizeTable({ ...table, roads }) || normalizeSpecialTable({ ...table, roads }))) {
      table.roads = null;
      return [];
    }
    table.roads = [...roads];
    return [{ ...table }];
  }
  return function ingest({ c, p } = {}) {
    if (!p) return [];
    if (c === "getGameHall" && p.A === 0 && Array.isArray(p.D)) {
      tables.clear();
      return p.D.flatMap((entry) => {
        if (!entry || (!AB_ROOMS.includes(entry.BB) && !specialGame(entry.BB))) return [];
        tables.set(entry.AA, { tableId: entry.AA, room: entry.BB, roads: null });
        return update(entry.AA, entry.WW3?.[0]);
      });
    }
    if (c === "getRoadData" && p.A === 0) return update(p.C, p.G?.[0]);
    if (c === "pushGameTableResults") {
      const current = tables.get(p.A)?.roads;
      const delta = p.G?.[0];
      if (!Array.isArray(delta) || delta.length !== 1 || !Number.isInteger(p.C)) return [];
      if (p.C === 1 && (current?.length === 0 || tables.get(p.A)?.round === 1)) {
        return update(p.A, delta);
      }
      if (!current) return [];
      if (p.C <= current.length) {
        if (p.C === current.length && current.at(-1) !== delta[0]) {
          return update(p.A, [...current.slice(0, -1), delta[0]]);
        }
        return [];
      }
      return update(p.A, p.C === current.length + 1 ? [...current, ...delta] : null);
    }
    if (c === "pushGameStatus" && Array.isArray(p.A)) {
      return p.A.flatMap(({ AA, BB }) => {
        const table = tables.get(AA);
        if (!table) return [];
        if (specialGame(table.room)) return table.roads ? [{ ...table }] : [];
        table.round = BB;
        if (BB === 1 && table.roads?.length) return update(AA, []);
        return table.roads && BB === table.roads.length + 1 ? [{ ...table }] : [];
      });
    }
    return [];
  };
}

module.exports = { createTableFeed, decodeRoad, normalizeTable, normalizeSpecialTable };
