const assert = require("node:assert/strict");
const { test } = require("node:test");
const { once } = require("node:events");
const express = require("express");
const { registerT9RelayRoutes } = require("../routes/t9Relay");
const source = require("../modules/baccarat/t9Source");
const { multiTableOverview } = require("../modules/baccarat");

test("T9 intake authenticates, settles a round once, and resets only on an empty shoe", async () => {
  const key = "local-test-key";
  process.env.T9_RELAY_KEY = key;
  const app = express();
  registerT9RelayRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${server.address().port}/api/t9/ingest`;
  const table = (road, shuffling = false) => ({ id: 135, road, round: road ? road.split(",").length + 1 : 1, shuffling });
  const send = (tables, supplied = key) => fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-t9-relay-key": supplied },
    body: JSON.stringify({ tables }),
  });
  try {
    const initial = table("1,5,9,13,101,109");
    assert.equal((await send([initial], "wrong")).status, 401);
    assert.equal((await send([table("4")])).status, 400);
    assert.equal((await send([initial, initial])).status, 400);
    assert.equal((await send([initial])).status, 202);
    const overview = () => multiTableOverview("T9")[0];
    assert.equal(overview().round, 6);
    assert.equal(overview().counts["莊"], 6);
    assert.equal(overview().nextRound, 7);
    assert.equal(overview().prediction, "莊");

    const next = table(initial.road + ",10");
    assert.equal((await send([next])).status, 202);
    assert.equal((await send([next])).status, 202);
    assert.equal(overview().totalIncorrect, 1);
    assert.equal((await send([table("")])).status, 202);
    assert.equal(overview().round, 7);
    assert.equal((await send([table("1,2")])).status, 202);
    assert.equal(overview().round, 7);
    assert.equal(source.isRoomFresh("135", Date.now() + 21000), false);
    assert.equal((await send([table("", true)])).status, 202);
    assert.deepEqual(source.getRoomStats("135"), { banker: 0, player: 0, tie: 0, total: 0 });
    assert.equal(overview().totalIncorrect, 0);
    assert.equal((await send([table("103")])).status, 202);
    assert.equal(overview().round, 1);
    assert.equal(overview().counts["和"], 1);
  } finally {
    delete process.env.T9_RELAY_KEY;
    server.close();
  }
});
