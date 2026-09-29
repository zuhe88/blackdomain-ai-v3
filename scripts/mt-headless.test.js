const assert = require("node:assert/strict");
const { test } = require("node:test");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { MT_ORIGIN, launchUrl, createForwarder } = require("./lib/mt-headless");
const { main } = require("./mt-headless-client");

const table = { table_id: 1, table_type: "BAC", account: "secret", balance: 100 };
const packet = (at, id = 1) => ({ tables: [{ ...table, table_id: id }], diagnostics: { capturedAt: new Date(at).toISOString(), version: "1.2.0" } });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

test("launch always uses the MT origin and URL-encodes the existing ticket", () => {
  assert.throws(() => launchUrl(""), /MT_LOGIN_REQUIRED/);
  const token = "an-existing-token&other=value#fragment";
  const url = new URL(launchUrl(token));
  assert.equal(url.origin, MT_ORIGIN);
  assert.equal(url.searchParams.get("token"), token);
  assert.equal(url.searchParams.get("other"), null);
});

test("headless queue keeps only the newest waiting tables and strips account data", async () => {
  let unblock;
  let now = Date.now();
  const sent = [];
  const successes = [];
  const queue = createForwarder({ now: () => now,
    send: async (value) => { sent.push(value); if (sent.length === 1) await new Promise((resolve) => { unblock = resolve; }); },
    onSuccess: (value) => successes.push(value),
  });
  const first = queue.enqueue(packet(now, 1));
  queue.enqueue(packet(now, 2));
  queue.enqueue(packet(now, 3));
  unblock();
  await first;
  assert.deepEqual(sent.map((value) => value.tables[0].table_id), [1, 3]);
  assert.equal(sent[0].tables[0].account, undefined);
  assert.equal(sent[0].tables[0].balance, undefined);
  assert.equal(sent[0].diagnostics.browserMode, "headless");
  assert.equal(successes.length, 2);
  now += 16000;
  await queue.enqueue(packet(now - 16000));
  await queue.enqueue(packet(now + 1000));
  await queue.enqueue({ tables: [table], diagnostics: { capturedAt: "invalid" } });
  assert.equal(sent.length, 2, "stale, future, and invalid captures must never be forwarded");
  await queue.close();
  await queue.enqueue(packet(now));
  assert.equal(sent.length, 2);
});

test("headless queue reports failures and does not replay failed tables", async () => {
  let calls = 0, errors = 0;
  const queue = createForwarder({ send: async () => { calls++; throw new Error("failure"); }, onError: () => { errors++; } });
  await queue.enqueue(packet(Date.now()));
  await queue.close();
  assert.equal(calls, 1);
  assert.equal(errors, 1);
});

test("background runtime identifies its own capture, rejects other frames, and surfaces 403", async () => {
  for (const scenario of ["capture", "denied", "socket-denied", "login"]) {
    let binding, closed = false, browserOptions, received;
    const page = new EventEmitter();
    const frame = { url: () => MT_ORIGIN };
    Object.assign(page, {
      mainFrame: () => frame, setDefaultTimeout() {}, isClosed: () => false, url: () => MT_ORIGIN,
      async goto() {
        if (scenario === "denied") page.emit("response", {
          request: () => ({ isNavigationRequest: () => true }), frame: () => frame,
          status: () => 403, headers: () => ({ server: "cloudflare" }),
        });
        else if (scenario === "socket-denied") {
          const socket = new EventEmitter();
          socket.url = () => "wss://a1.ofalive99.net/game/ws";
          page.emit("websocket", socket);
          socket.emit("socketerror", "WebSocket handshake: Unexpected response code: 403");
        } else if (scenario === "login") {
          await binding({ page, frame }, { type: "BLACKDOMAIN_MT_SOCKET_STATE", requiresLogin: true });
        } else {
          await binding({ page, frame: { url: () => "https://unrelated.example" } }, { type: "BLACKDOMAIN_MT_BROWSER_TABLES_V1", ...packet(Date.now(), 99) });
          await binding({ page, frame }, { type: "BLACKDOMAIN_MT_BROWSER_TABLES_V1", ...packet(Date.now()) });
        }
      },
    });
    const context = {
      exposeBinding: async (_name, fn) => { binding = fn; },
      addInitScript: async ({ content }) => { assert.match(content, /BLACKDOMAIN_MT_BROWSER_TABLES_V1/); },
      newPage: async () => page,
    };
    const browserType = { launch: async (options) => { browserOptions = options; return {
      newContext: async () => context, close: async () => { closed = true; }, isConnected: () => !closed,
    }; } };
    let relayPort;
    const local = http.createServer(async (req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/browser-config") {
        res.end(JSON.stringify({ endpoint: `http://127.0.0.1:${relayPort}/browser-ingest`, bridgeKey: "a".repeat(64) }));
      } else {
        let body = "";
        for await (const chunk of req) body += chunk;
        received = JSON.parse(body);
        assert.equal(req.headers["x-blackdomain-bridge-key"], "a".repeat(64));
        res.end('{"ok":true}');
      }
    });
    relayPort = await listen(local);
    const reservation = http.createServer();
    const statusPort = await listen(reservation);
    await new Promise((resolve) => reservation.close(resolve));
    const controller = new AbortController();
    const run = main({ browserType, tokenProvider: () => "test-token-not-real", signal: controller.signal,
      env: { MT_RELAY_PORT: String(relayPort), MT_HEADLESS_PORT: String(statusPort) } });
    try {
      let result;
      for (let i = 0; i < 100; i++) {
        result = await fetch(`http://127.0.0.1:${statusPort}/status`).then((r) => r.json()).catch(() => null);
        if (result && result.state !== "starting") break;
        await delay(10);
      }
      assert.equal(browserOptions.headless, true);
      assert.equal(browserOptions.chromiumSandbox, true);
      if (scenario === "capture") {
        assert.equal(result.healthy, true);
        assert.equal(received.tables[0].table_id, 1);
        assert.equal(received.diagnostics.browserMode, "headless");
      } else {
        assert.equal(result.healthy, false);
        assert.equal(result.lastTablesAt, null);
        if (scenario === "login") {
          assert.equal(result.state, "login_required");
          assert.equal(result.accessDenied, null);
        } else {
          assert.deepEqual(result.accessDenied, { phase: scenario === "denied" ? "navigation" : "websocket", httpStatus: 403, server: scenario === "denied" ? "cloudflare" : "unknown" });
        }
        assert.equal(received, undefined);
      }
    } finally {
      controller.abort();
      await run;
      local.closeAllConnections();
      await new Promise((resolve) => local.close(resolve));
    }
    assert.equal(closed, true, "shutdown must close the dedicated browser");
  }
});
