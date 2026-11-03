const { test } = require("node:test");
const assert = require("node:assert/strict");
const source = require("../modules/baccarat/mtSource");
const { MT_ROOMS } = require("../modules/baccarat/constants");
const { normalizeRoom, validateRoom } = require("../modules/baccarat/utils");
const { baccaratRoomFlex } = require("../ui/flex/baccarat");
const { baccaratAnalysisFlex } = require("../ui/flex/baccarat");
const express = require("express");
const path = require("node:path");
const { chromium } = require("playwright-core");

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

test("MT live-room analysis keeps its platform and full room name at mobile widths", async () => {
  const app = express();
  app.get("/api/web/me", (_req, res) => res.json({ authenticated: false }));
  app.use(express.static(path.join(__dirname, "../public")));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  let browser;
  try {
    browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    const page = await browser.newPage({ serviceWorkers: "block" });
    await page.goto(`http://127.0.0.1:${server.address().port}/portal/`);
    await page.waitForFunction(() => typeof resultCard === "function");
    for (const width of [320, 375, 768]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const room of ["B01-L", "B02-L", "B03-L", "B03A", "B10"]) {
        const card = baccaratAnalysisFlex({
          session: { platform: "MT", room, currency: "TWD", mode: "自由配注", results: {} },
          prediction: "觀望", roomStats: { banker: 1, player: 1, tie: 0, total: 2 },
          autoResult: true, compact: true,
        });
        await page.evaluate(card => { document.querySelector("#view").innerHTML = resultCard(card); }, card);
        assert.equal(await page.locator(".room-platform").innerText(), "MT");
        assert.equal(await page.locator(".baccarat-room-identity h2").innerText(), `MT ${room}`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
