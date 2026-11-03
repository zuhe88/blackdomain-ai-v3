const { test } = require("node:test");
const assert = require("node:assert/strict");
const source = require("../modules/baccarat/mtSource");
const { MT_ROOMS } = require("../modules/baccarat/constants");
const { normalizeRoom, validateRoom } = require("../modules/baccarat/utils");
const { baccaratRoomFlex } = require("../ui/flex/baccarat");

// Observed in the authenticated MT lobby and its tables WebSocket on 2026-11-04.
const observed = [
  ["BAV01_LIVE", "B01", "B01-L"],
  ["BAV02_LIVE", "B02", "B02-L"],
  ["BAV03_LIVE", "B03", "B03-L"],
  ...["01", "02", "03", "03A", "05", "06", "07", "08", "09", "10"]
    .map(code => [`BAV${code}`, `B${code}`, `B${code}`]),
];

test("all 13 observed MT table IDs keep distinct canonical rooms and LINE actions", () => {
  source.resetForTest();
  try {
    assert.deepEqual(MT_ROOMS, observed.map(row => row[2]));
    observed.forEach(([id, name, room], index) => {
      assert.equal(source.roomFromName(name, id), room);
      assert.equal(source.ingestTables([{
        table_id: id, table_name: name, table_type: "BAC", shoe: "test-shoe",
        trend: { bead_plate2: index % 2 ? "0102" : "0201" },
      }]), true);
      assert.equal(source.getTableByRoom(room).tableId, id);
      assert.equal(validateRoom("MT", normalizeRoom("MT", room.toLowerCase())), true);
    });
    assert.equal(new Set(source.getSnapshot().tables.map(t => t.room)).size, 13);
    assert.notEqual(source.getTableByRoom("B01").tableId, source.getTableByRoom("B01-L").tableId);
    assert.equal(source.getTableByRoom("B03A").tableId, "BAV03A");
    const menu = JSON.stringify(baccaratRoomFlex("MT", MT_ROOMS));
    for (const room of MT_ROOMS) assert.ok(menu.includes(`"text":"${room}"`));
    assert.ok(!menu.includes("MT01"));
    for (const room of ["B04", "B11", "B13A", "B05-L", "MT01"]) {
      assert.equal(validateRoom("MT", normalizeRoom("MT", room)), false);
    }
  } finally { source.resetForTest(); }
});
