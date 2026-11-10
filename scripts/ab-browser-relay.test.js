const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const { createTableFeed, decodeRoad, normalizeTable } = require("../modules/baccarat/abProtocol");
const source = require("../modules/baccarat/abSource");
const { firstAnalysis } = require("../modules/baccarat/ai");
const { registerAbRelayRoutes } = require("../routes/abRelay");

const initial = ["077000400000", "269080300000", "224002500000"];
const latest = "160040H00300";

test("ALLBET history validates the encoded winner against both totals", () => {
  assert.deepEqual(initial.map(decodeRoad).map((round) => round.code), [9, 5, 5]);
  assert.deepEqual(decodeRoad(latest), { code: 1, banker: 6, player: 0 });
  assert.equal(decodeRoad("260040H00300"), null);
  assert.equal(normalizeTable({ tableId: 157, room: "BB701", roads: initial }), null);
});

test("relay accepts complete snapshots, deduplicates rounds and waits after a gap", () => {
  const feed = createTableFeed();
  const hall = feed({ c: "getGameHall", p: { A: 0, D: [
    { AA: 157, BB: "B505", WW3: [initial] },
    { AA: 326, BB: "BB801", WW3: [["34A70"]] },
  ] } });
  assert.deepEqual(hall.map(({ room, roads }) => ({ room, roads })), [
    { room: "B505", roads: initial }, { room: "BB801", roads: ["34A70"] },
  ]);
  const result = (index) => feed({ c: "pushGameTableResults", p: { A: 157, C: index, G: [[latest]] } });
  assert.deepEqual(result(1), []);
  assert.deepEqual(result(4)[0].roads, [...initial, latest]);
  assert.deepEqual(result(4), []);
  assert.deepEqual(result(6), []);
  assert.deepEqual(result(7), []);
  assert.equal(feed({ c: "getRoadData", p: { A: 0, C: 157, G: [[...initial, latest]] } }).length, 1);
});

test("authenticated intake keeps ALLBET separate and publishes new results only once", async (t) => {
  const previousKey = process.env.AB_RELAY_KEY;
  process.env.AB_RELAY_KEY = "test-only-key";
  source.resetForTest();
  const updates = [];
  const unsubscribe = source.onResult((event) => updates.push(event));
  const app = express();
  registerAbRelayRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.close();
    unsubscribe();
    source.resetForTest();
    if (previousKey === undefined) delete process.env.AB_RELAY_KEY;
    else process.env.AB_RELAY_KEY = previousKey;
  });
  const url = "http://127.0.0.1:" + server.address().port + "/api/ab/";
  const send = (roads, key) => fetch(url + "ingest", {
    method: "POST",
    headers: { "content-type": "application/json", "x-ab-relay-key": key },
    body: JSON.stringify({ tables: [{ room: "B505", tableId: 157, roads }] }),
  });
  assert.equal((await send(initial, "incorrect")).status, 401);
  assert.equal((await send(initial, "test-only-key")).status, 202);
  assert.equal((await send([...initial, latest], "test-only-key")).status, 202);
  assert.equal((await send([...initial, latest], "test-only-key")).status, 202);
  assert.deepEqual(updates.map(({ isContinuous }) => isContinuous), [false, true]);
  assert.equal(updates[1].result, "莊");
  const special = await fetch(url + "ingest", {
    method: "POST",
    headers: { "content-type": "application/json", "x-ab-relay-key": "test-only-key" },
    body: JSON.stringify({ tables: [
      { tableId: 326, room: "BB801", roads: ["34A70"] },
      { tableId: 191, room: "T501", roads: ["54435292B15111001"] },
    ] }),
  });
  assert.equal(special.status, 202);
  const status = await (await fetch(url + "status")).json();
  assert.deepEqual(status.games.map(({ room, game }) => [room, game]), [
    ["BB801", "bullbull"], ["T501", "dotsmahjong"],
  ]);
  assert.equal(status.source, "browser-relay");
  assert.equal(status.rooms[0].historyCount, 4);
  const analysis = firstAnalysis({ platform: "歐博", history: Array(20).fill("莊"), bankroll: 10000 });
  assert.equal(analysis.bet, 0);
  assert.equal(analysis.prediction, "觀望");
  assert.equal(analysis.session.bankroll, 10000);
});
