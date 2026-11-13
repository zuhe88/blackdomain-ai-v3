const { createRoadSource } = require("./dgSource");

const source = createRoadSource({
  platform: "T9",
  roomAllowed: room => /^\d{1,8}$/.test(room),
  allowImplicitShoeReset: false,
  roomPattern: /^(\d{1,8})$/,
  freshnessSetting: "T9_DATA_FRESHNESS_MS",
  defaultFreshnessMs: 20000,
});

function normalizeTable(table) {
  const { id, round, road, shuffling } = table || {};
  if (!Number.isInteger(id) || id < 1 || id > 99999999
    || !Number.isInteger(round) || round < 1 || round > 201
    || typeof road !== "string" || road.length > 800
    || typeof shuffling !== "boolean") return null;

  const codes = road === "" ? [] : road.split(",");
  if (codes.length > 200 || (codes.length && round !== codes.length + 1)
    || (!codes.length && round !== 1 && !shuffling)) return null;
  const roads = codes.map((code, index) => {
    if (!/^\d{1,3}$/.test(code)) return null;
    const value = Number(code) % 100;
    const result = value % 4;
    if (value < 1 || value > 15 || !result) return null;
    return `${index + 1}#${[0, 1, 5, 9][result]}`;
  });
  if (roads.includes(null)) return null;

  const countdownEndsAt = Number.isSafeInteger(table.countdownEndsAt)
    && table.countdownEndsAt > Date.now() && table.countdownEndsAt <= Date.now() + 60000
    ? table.countdownEndsAt : null;
  return {
    tableId: id, tableName: String(id), round: codes.length + 1, roads, countdownEndsAt,
    confirmedEmptyShoe: shuffling && codes.length === 0,
  };
}

function ingestTables(tables) {
  if (!Array.isArray(tables) || !tables.length || tables.length > 100) return false;
  const normalized = tables.map(normalizeTable);
  if (normalized.includes(null)
    || new Set(normalized.map(table => table.tableId)).size !== tables.length) return false;
  for (const table of normalized) {
    const current = source.getTableByRoom(table.tableName);
    const generation = Number(current?.shoeId || 1);
    table.shoeId = generation + Number(table.confirmedEmptyShoe && current?.history.length > 0);
  }
  source.ingestTables(normalized);
  return true;
}

module.exports = { ...source, ingestTables, normalizeTable };
