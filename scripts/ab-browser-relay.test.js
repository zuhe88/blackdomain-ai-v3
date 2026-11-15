const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const express = require("express");
const { createTableFeed, decodeRoad, normalizeTable } = require("../modules/baccarat/abProtocol");
const source = require("../modules/baccarat/abSource");
const { firstAnalysis } = require("../modules/baccarat/ai");
const { registerAbRelayRoutes } = require("../routes/abRelay");

const initial = ["077000400000", "269080300000", "224002500000"];
const latest = "160040H00300";

test("browser capture accepts table messages across endpoint changes and ignores unrelated traffic", async () => {
  const origin = "https://www.ab88.games:8888";
  const sent = [];
  class FakeSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = new URL(url).href;
    }
  }
  const window = {
    WebSocket: FakeSocket, postMessage: ({ type, data }, target) => sent.push([type, JSON.parse(data).c, target]),
  };
  const path = resolve(__dirname, "../extensions/ab-browser-relay/capture.js");
  runInNewContext(readFileSync(path, "utf8"), {
    window, location: { origin }, TextDecoder, Blob, ArrayBuffer,
  });

  const tableSocket = new window.WebSocket("wss://new-provider.example/websocket?v=2");
  const table = JSON.stringify({ c: "getGameHall", p: { A: 0, D: [] } });
  const status = JSON.stringify({ c: "pushGameStatus", p: { A: [] } });
  tableSocket.dispatchEvent(new MessageEvent("message", { data: new Blob([table]) }));
  tableSocket.dispatchEvent(new MessageEvent("message", { data: "invalid json" }));
  tableSocket.dispatchEvent(new MessageEvent("message", { data: '{"c":"getAccount","p":{}}' }));
  tableSocket.dispatchEvent(new MessageEvent("message", { data: status }));
  const otherSocket = new window.WebSocket("ws://new-provider.example/websocket");
  otherSocket.dispatchEvent(new MessageEvent("message", { data: table }));

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, [
    ["BLACKDOMAIN_AB_PACKET", "getGameHall", origin],
    ["BLACKDOMAIN_AB_PACKET", "pushGameStatus", origin],
  ]);
});

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
  const analysis = firstAnalysis({ platform: "歐博", history: Array(20).fill("莊"), mode: "自由配注", bankroll: 10000 });
  assert.equal(analysis.bet, 0);
  assert.equal(analysis.prediction, "莊");
  assert.equal(analysis.session.bankroll, 10000);
});
