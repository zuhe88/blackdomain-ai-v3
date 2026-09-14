const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const express = require("express");

function load(relative, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", relative), "utf8"), {
    module, exports: module.exports,
    require: (name) => name in dependencies ? dependencies[name] : {},
    __dirname: path.dirname(path.join(__dirname, "..", relative)),
    console, setTimeout, clearTimeout, Date,
  }, { filename: relative });
  return module.exports;
}

function fixture() {
  const state = {
    user: { line_user_id: "member", three_a_account: "testmember", vip_status: "approved", ai_permission: true },
    userError: null, globalError: null, globalEnabled: false, cleared: 0,
  };
  const db = { from(table) {
    return { select() { return this; }, eq() { return this; }, async maybeSingle() {
      return table === "vip_users"
        ? { data: state.user, error: state.userError }
        : { data: { value: { enabled: state.globalEnabled } }, error: state.globalError };
    } };
  } };
  const repo = load("modules/vip/repository.js", { "../../services/supabase": db });
  const vip = load("modules/vip/index.js", {
    "./repository": repo,
    "../../config/admin": { isAdminLineUserId: () => false },
  });
  return { state, repo, vip };
}

test("database failure must never become a confirmed VIP denial", async () => {
  const { state, vip } = fixture();
  assert.equal((await vip.checkVipAccess("member")).allowed, true);
  state.userError = { code: "FETCH_ERROR", message: "upstream unavailable" };
  await assert.rejects(vip.checkVipAccess("member"), (error) => error.status === 503 && error.code === "VIP_ACCESS_UNAVAILABLE");
  state.userError = null;
  assert.equal((await vip.checkVipAccess("member")).allowed, true);
});

test("global permission lookup failure must not cache a false revocation", async () => {
  const { state, repo, vip } = fixture();
  state.user.ai_permission = false;
  state.globalEnabled = true;
  state.globalError = { code: "FETCH_ERROR" };
  await assert.rejects(vip.checkVipAccess("member"), (error) => error.code === "VIP_ACCESS_UNAVAILABLE");
  await repo.getGlobalAiAccessState(); // A best-effort read must not poison the strict reader's cache.
  state.globalError = null;
  assert.equal((await vip.checkVipAccess("member")).allowed, true);
});

test("real revocation, expiry and missing membership still deny access", async () => {
  const { state, vip } = fixture();
  state.user.ai_permission = false;
  assert.equal((await vip.checkVipAccess("member")).allowed, false);
  state.user.ai_permission = true;
  state.user.expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await vip.checkVipAccess("member")).allowed, false);
  state.user = null;
  assert.equal((await vip.checkVipAccess("member")).allowed, false);
});

test("runtime access API preserves active analysis on lookup failure and enforces real revocation", async () => {
  const { state, vip } = fixture();
  const { registerWebPortalRoutes } = load("routes/webPortal.js", {
    path, express,
    "../modules/vip": vip,
    "../services/webChannel": { authenticate: () => "member", history: () => [] },
    "../modules/baccarat": { hasActiveBaccaratSession: () => state.cleared === 0, activeBaccaratPlatform: () => "DG" },
    "../modules/electronic/availability": { areAllElectronicGamesEnabled: () => true },
    "../config/admin": { isAdminLineUserId: () => false },
    "./webhook": { clearAllUserSessions: async () => { state.cleared++; } },
  });
  const app = express();
  registerWebPortalRoutes(app);
  app.use((error, req, res, next) => res.status(error.status || 500).json({ code: error.code }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}/api/web/me`;
  try {
    assert.equal((await (await fetch(url)).json()).activeBaccaratSession, true);
    state.userError = { code: "FETCH_ERROR" };
    const failed = await fetch(url);
    assert.equal(failed.status, 503);
    assert.equal(state.cleared, 0);
    state.userError = null;
    const recovered = await (await fetch(url)).json();
    assert.equal(recovered.accessAllowed, true);
    assert.equal(recovered.activeBaccaratSession, true);
    state.user.ai_permission = false;
    assert.equal((await (await fetch(url)).json()).accessAllowed, false);
    assert.equal(state.cleared, 1);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

function portalFunction(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'public/portal/app.js'), 'utf8')
    .split(/\r?\n/).find((line) => line.startsWith(`async function ${name}(`) || line.startsWith(`function ${name}(`));
}

test('portal preserves the current analysis during failed refresh, then applies authoritative access', async () => {
  let response = { ok: false, status: 503 };
  let applied = 0, login = 0, cleared = 0;
  const context = vm.createContext({
    authenticated: true, accessAllowed: true, accessRefreshInFlight: false,
    fetch: async () => response,
    setConnection() {}, console,
    renderLogin() { login++; }, clearPortalSession() { cleared++; },
    applyRuntimeAccess(value) { applied++; context.accessAllowed = value.accessAllowed; },
  });
  vm.runInContext(portalFunction('refreshRuntimeAccess'), context);
  await context.refreshRuntimeAccess();
  assert.equal(context.accessAllowed, true);
  assert.equal(applied, 0);
  response = { ok: true, json: async () => ({ authenticated: true, accessAllowed: false }) };
  await context.refreshRuntimeAccess();
  assert.equal(context.accessAllowed, false);
  assert.equal(applied, 1);
  response = { ok: true, json: async () => ({ authenticated: false, accessAllowed: false }) };
  await context.refreshRuntimeAccess();
  assert.equal(login, 1);
  assert.equal(cleared, 1);
  assert.equal(context.authenticated, false);
});

test('portal refresh does not overlap slow access requests', async () => {
  let finish, calls = 0;
  const context = vm.createContext({
    authenticated: true, accessRefreshInFlight: false,
    fetch: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
    setConnection() {}, console,
  });
  vm.runInContext(portalFunction('refreshRuntimeAccess'), context);
  const first = context.refreshRuntimeAccess();
  await context.refreshRuntimeAccess();
  assert.equal(calls, 1);
  finish({ ok: false, status: 503 });
  await first;
  assert.equal(context.accessRefreshInFlight, false);
});

test('portal startup keeps the saved login on temporary access failure and schedules recovery', async () => {
  let cleared = 0, unavailable = 0, retried = 0;
  const context = vm.createContext({
    fetch: async () => ({ ok: false, status: 503 }),
    console: { error() {} }, navigator: { onLine: true },
    portalSessionToken: 'existing-session',
    clearPortalSession() { cleared++; },
    renderAccessUnavailable() { unavailable++; },
    setTimeout(fn, delay) { assert.equal(delay, 5000); retried++; },
  });
  vm.runInContext(portalFunction('initializePortal'), context);
  await context.initializePortal();
  assert.equal(cleared, 0);
  assert.equal(context.portalSessionToken, 'existing-session');
  assert.equal(unavailable, 1);
  assert.equal(retried, 1);
});

test('a reply timeout before a slow command is awaited must not crash Node', () => {
  const { spawnSync } = require('node:child_process');
  const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', `
    const assert = require('node:assert/strict');
    const web = require('./services/webChannel');
    const pending = web.waitReply('web:member:timeout-test', 1);
    setTimeout(async () => {
      await assert.rejects(pending, /Command timeout/);
      assert.equal(web.cancelReply('web:member:timeout-test'), false);
    }, 30);
  `], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stderr);
});
