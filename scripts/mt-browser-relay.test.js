const assert = require("node:assert/strict");
const { test } = require("node:test");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const { recoveryDecision } = require("../extensions/mt-browser-relay/watchdog");
test("recovery respects stale duration, foreground, login, local failure and reload limits", () => {
  const now = 10000000;
  const record = { firstSeenAt: now - 120000, lastCapturedAt: now - 120000, lastPollAt: now - 35000, reloadTimes: [] };
  const probe = { tabExists: true, allowedPage: true, localAvailable: true, hidden: true };
  assert.equal(recoveryDecision(record, probe, now), "reload_background");
  for (const [overrides, expected] of [
    [{ hidden: false }, "foreground_waiting"], [{ requiresLogin: true }, "login_required"],
    [{ localAvailable: false }, "local_unavailable"], [{ allowedPage: false }, "tab_unavailable"],
  ]) assert.equal(recoveryDecision(record, { ...probe, ...overrides }, now), expected);
  assert.equal(recoveryDecision({ ...record, lastCapturedAt: now - 1000 }, probe, now), "receiving");
  assert.equal(recoveryDecision({ ...record, lastCapturedAt: now - 60000 }, probe, now), "request_tables");
  assert.equal(recoveryDecision({ ...record, lastPollAt: 0 }, probe, now), "request_tables");
  assert.equal(recoveryDecision({ ...record, lastPollAt: now - 10000 }, probe, now), "waiting_after_request");
  assert.equal(recoveryDecision({ ...record, reloadTimes: [now - 120000] }, probe, now), "reload_cooldown");
  assert.equal(recoveryDecision({ ...record, reloadTimes: [now - 900000, now - 400000] }, probe, now), "recovery_limit");
});

test("worker reloads only eligible MT tabs and rechecks navigation before reload", async () => {
  for (const scenario of ["hidden", "visible", "login", "offline", "navigated", "limit", "recovered"]) {
    const now = 10000000;
    const record = { firstSeenAt: now - 120000, lastCapturedAt: now - 120000, lastPollAt: now - 35000,
      reloadTimes: scenario === "limit" ? [now - 900000, now - 400000] : [] };
    let reloads = 0, gets = 0;
    class TestDate extends Date { static now() { return now; } }
    const event = { addListener() {} };
    const context = vm.createContext({
      URL, Date: TestDate, setTimeout, clearTimeout, AbortSignal, importScripts() {},
      MT_RECOVERY_DECISION: recoveryDecision,
      MT_BRIDGE_CONFIG: { endpoint: "http://127.0.0.1:43128/browser-ingest", bridgeKey: "test" },
      fetch: async () => ({ ok: scenario !== "offline", json: async () => ({ ok: true }) }),
      chrome: {
        storage: { session: { get: async () => ({ mtRecoveryTabs: { 1: record } }), set: async () => {} } },
        alarms: { get: async () => ({}), onAlarm: event },
        runtime: { onInstalled: event, onStartup: event, onMessage: event },
        tabs: {
          get: async () => ({ url: ++gets > 1 && scenario === "navigated" ? "https://example.com/" : "https://gsa.ofalive99.net/", active: scenario === "visible" }),
          sendMessage: async (_id, message) => {
            if (message.type === "BLACKDOMAIN_MT_HEALTH") {
              if (scenario === "recovered" && gets > 1) record.lastCapturedAt = now;
              return { visibility: scenario === "visible" ? "visible" : "hidden", requiresLogin: scenario === "login" };
            }
            return { ok: true };
          },
          reload: async () => { reloads++; },
        },
      },
    });
    vm.runInContext(fs.readFileSync(path.join(root, "extensions/mt-browser-relay/background.js"), "utf8"), context);
    await vm.runInContext("checkTabs()", context);
    assert.equal(reloads, scenario === "hidden" ? 1 : 0, scenario);
  }
});
const table = { table_id: 1, table_type: "BAC", table_name: "MT01",
  trend: { bead_plate2: [1, 2], total_round_banker: 1 },
  account: "must-not-leave-browser", balance: 100, bets: [100] };
const tableAction = "/api/v1/gametype/*/game/*/room/*/tables";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}
async function waitFor(probe, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { const result = await probe(); if (result) return result; } catch { /* Starting. */ }
    await delay(50);
  }
  throw new Error("Timed out waiting for relay test state.");
}

test("browser capture keeps the original socket, requests only tables and strips account data", () => {
  const posts = [];
  const timers = new Map();
  class FakeSocket {
    static OPEN = 1;
    constructor() { this.listeners = {}; this.readyState = 1; this.sent = []; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    send(value) { this.sent.push(JSON.parse(value)); }
  }
  const window = { WebSocket: FakeSocket, addEventListener() {},
    setInterval(fn) { timers.set(1, fn); return 1; },
    clearInterval(id) { timers.delete(id); },
    postMessage(value) { if(value.type === "BLACKDOMAIN_MT_BROWSER_TABLES_V1") posts.push(value); } };
  vm.runInNewContext(fs.readFileSync(path.join(root, "extensions/mt-browser-relay/capture.js"), "utf8"), {
    window, URL, location: { href: "https://gsa.ofalive99.net/", origin: "https://gsa.ofalive99.net" },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
  });
  const unrelated = new window.WebSocket("wss://unrelated.example/game/ws");
  assert.equal(Object.keys(unrelated.listeners).length, 0);
  const socket = new window.WebSocket("wss://a1.ofalive99.net/game/ws");
  assert.ok(socket instanceof FakeSocket);
  assert.equal(socket.sent.length, 0);
  socket.listeners.message({ data: JSON.stringify({ action: "/api/v1/authenticate", err: 0 }) });
  timers.get(1)();
  assert.ok(socket.sent.every((item) => item.method === "GET" && item.action.name === tableAction));
  socket.listeners.message({ data: JSON.stringify({ action: "/account", msg: { balance: 100 } }) });
  assert.equal(posts.length, 0);
  socket.listeners.message({ data: JSON.stringify({ action: tableAction, msg: { tables: [table] } }) });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].tables[0].table_id, 1);
  assert.ok(!JSON.stringify(posts).includes("must-not-leave-browser"));
  assert.equal(posts[0].tables[0].balance, undefined);
  socket.listeners.close();
  assert.equal(timers.size, 0);
});

test("table snapshots start polling without an auth response; socket events refresh without timer ticks", () => {
  let now = Date.now();
  const posts = [];
  const timers = new Map();
  const visibilityListeners = new Map();
  class TestDate extends Date { static now() { return now; } }
  class FakeSocket {
    static OPEN = 1;
    constructor() { this.listeners = {}; this.readyState = 1; this.sent = []; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    send(value) { this.sent.push(JSON.parse(value)); }
  }
  const window = { WebSocket: FakeSocket, addEventListener() {},
    setInterval(fn) { timers.set(1, fn); return 1; },
    clearInterval(id) { timers.delete(id); },
    postMessage(value) { posts.push(value); } };
  const document = { visibilityState: "hidden",
    addEventListener(name, fn) { visibilityListeners.set(name, fn); },
    removeEventListener(name) { visibilityListeners.delete(name); } };
  vm.runInNewContext(fs.readFileSync(path.join(root, "extensions/mt-browser-relay/capture.js"), "utf8"), {
    window, document, Date: TestDate, URL,
    location: { href: "https://gsa.ofalive99.net/", origin: "https://gsa.ofalive99.net" },
  });
  const socket = new window.WebSocket("wss://a1.ofalive99.net/game/ws");
  const message = (value) => socket.listeners.message({ data: JSON.stringify(value) });
  message({ name: "heartbeat" });
  assert.equal(socket.sent.length, 0, "do not query until authenticated or real tables observed");
  message({ action: tableAction, msg: { tables: [table] } });
  assert.equal(timers.size, 1, "must poll even when the authentication response was not observed");
  assert.equal(socket.sent.length, 1);
  assert.equal(posts[0].diagnostics.pollingActive, true);
  assert.equal(posts[0].diagnostics.visibility, "hidden");
  now += 5000;
  message({ name: "heartbeat" });
  assert.equal(socket.sent.length, 2, "network events must request new tables without a timer tick");
  assert.equal(posts.length, 1, "a heartbeat must never relabel cached tables as fresh");
  message({ action: tableAction, msg: { tables: [table] } });
  assert.equal(socket.sent.length, 2, "table responses must not cause a request loop");
  now += 1000;
  message({ body: { table_id: 1 } });
  assert.equal(socket.sent.length, 3, "table events trigger a bounded prompt refresh");
  now += 1000;
  document.visibilityState = "visible";
  visibilityListeners.get("visibilitychange")();
  assert.equal(socket.sent.length, 4);
  assert.ok(socket.sent.every((item) => item.method === "GET" && item.action.name === tableAction));
  socket.listeners.close();
  assert.equal(timers.size, 0);
  assert.equal(visibilityListeners.size, 0);
});

test("live local bridge authenticates, reports upstream failures, forwards filtered data and expires health", { timeout: 45000 }, async () => {
  let failForward = true;
  let received;
  let receivedKey;
  const upstream = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received = JSON.parse(body);
    receivedKey = req.headers["x-dg-relay-key"];
    res.writeHead(failForward ? 503 : 202);
    res.end("{}");
  });
  upstream.on("upgrade", (_req, socket) => {
    socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  const upstreamPort = await listen(upstream);
  const portReservation = http.createServer();
  const port = await listen(portReservation);
  await new Promise((resolve) => portReservation.close(resolve));
  const child = spawn(process.execPath, ["scripts/mt-relay-client.js"], {
    cwd: root, windowsHide: true, stdio: "ignore",
    env: { ...process.env, MT_RELAY_PORT: String(port), MT_PERSIST_CONFIG: "false",
      MT_TOKEN: "test-token-not-a-real-token", MT_RELAY_KEY: "test-key-not-a-real-key",
      MT_SOCKET_URL: `ws://127.0.0.1:${upstreamPort}/game/ws`,
      MT_INGEST_URL: `http://127.0.0.1:${upstreamPort}/ingest` },
  });
  const base = `http://127.0.0.1:${port}`;
  const status = async () => (await fetch(`${base}/status`)).json();
  try {
    const rejected = await waitFor(async () => {
      const value = await status();
      return value.lastHandshakeStatus === 403 && value.lastCloseCode ? value : null;
    });
    assert.match(rejected.lastError, /403/);
    assert.equal(rejected.healthy, false);
    const foreign = await fetch(`${base}/browser-config`, { headers: { origin: "https://unrelated.example" } });
    assert.equal(foreign.status, 403);
    const pairing = await (await fetch(`${base}/browser-config`)).json();
    const post = (body, key = pairing.bridgeKey) => fetch(pairing.endpoint, {
      method: "POST", headers: { "x-blackdomain-bridge-key": key, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    assert.equal((await post({ tables: [table] }, "wrong")).status, 401);
    assert.equal((await post("invalid-json")).status, 400);
    assert.equal((await post({ tables: [{ table_type: "SLOT" }] })).status, 400);
    assert.equal((await post({ tables: Array(51).fill(table) })).status, 400);
    assert.equal((await post({ tables: [table] })).status, 502);
    const failed = await status();
    assert.equal(failed.transport, "browser");
    assert.equal(failed.healthy, false);
    assert.match(failed.lastError, /503/);
    failForward = false;
    assert.equal((await post({ tables: [table] })).status, 202);
    const healthy = await status();
    assert.equal(healthy.healthy, true);
    assert.equal(healthy.lastHandshakeStatus, null);
    assert.equal(healthy.lastError, null);
    const healthPost = (state, key = pairing.bridgeKey) => fetch(`${base}/browser-health`, {
      method: "POST", headers: { "x-blackdomain-bridge-key": key, "content-type": "application/json" },
      body: JSON.stringify({ state, reloadCount: 1 }),
    });
    assert.equal((await healthPost("receiving", "wrong")).status, 401);
    assert.equal((await healthPost("invalid")).status, 400);
    assert.equal((await healthPost("login_required")).status, 200);
    const heartbeat = await status();
    assert.equal(heartbeat.browserWatchdog.state, "login_required");
    assert.equal(heartbeat.lastTablesAt, healthy.lastTablesAt);
    assert.equal(heartbeat.lastForwardAt, healthy.lastForwardAt);
    assert.equal(receivedKey, "test-key-not-a-real-key");
    assert.equal(received.tables[0].table_id, 1);
    assert.equal(received.tables[0].account, undefined);
    assert.equal(received.tables[0].balance, undefined);
    const stale = await waitFor(async () => {
      const value = await status();
      return value.state === "browser_waiting" ? value : null;
    }, 32000);
    assert.equal(stale.healthy, false);
    await healthPost("receiving");
    assert.equal((await status()).healthy, false, "watchdog heartbeat must not make expired tables fresh");
  } finally {
    child.kill();
    await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once("exit", resolve));
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
