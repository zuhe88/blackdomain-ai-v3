const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const express = require("express");
const root = path.join(__dirname, "..");
const browserPath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(file => file && fs.existsSync(file));
function load(file, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), {
    module, exports: module.exports, require: name => dependencies[name] || {},
    __dirname: path.dirname(path.join(root, file)), Buffer, process: { env: {} }, console, Date, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
  }, { filename: file });
  return module.exports;
}
function fixture() {
  const state = { row: null, error: null };
  const db = { from() {
    return { select() { return this; }, eq(field, value) { this.field = field; this.value = value; return this; },
      async maybeSingle() { return { data: state.row?.[this.field] === this.value ? state.row : null, error: state.error }; },
      async insert(record) { state.row = { ...record, id: crypto.randomUUID() }; return { error: state.error }; },
      update(record) { return { async eq() { Object.assign(state.row, record); return { error: state.error }; } }; },
    };
  } };
  const service = load("services/webMembers.js", { crypto, util: require("util"), "./supabase": db, "../config/admin": { isAdminLineUserId: id => id === "admin" } });
  return { state, service };
}
const password = "test-only-password-234";
const future = () => new Date(Date.now() + 86400000).toISOString();
test("standalone account: admin guard, password hashing, eligibility, reset revocation and DB failure", async () => {
  const { service, state } = fixture();
  const input = { account: "Malaysia123", password, enabled: true, expiresAt: future() };
  assert.equal((await service.save("member", input)).status, 403);
  assert.equal(state.row, null);
  assert.equal((await service.save("admin", { ...input, password: "short" })).status, 400);
  assert.equal((await service.save("admin", input)).ok, true);
  assert.equal(state.row.account, "malaysia123");
  assert.notEqual(state.row.password_hash, password);
  assert.equal((await service.login(input.account, "wrong", "ip1")).status, 401);
  const login = await service.login(input.account, password, "ip1");
  assert.equal(login.ok, true);
  assert.equal((await service.access(login.userId)).allowed, true);
  const hash = state.row.password_hash;
  assert.equal((await service.save("admin", { ...input, password: "" })).ok, true);
  assert.equal(state.row.password_hash, hash);
  state.row.auth_version = crypto.randomUUID();
  assert.equal((await service.access(login.userId)).allowed, false);
  assert.equal((await service.save("admin", { ...input, password: "replacement-password-234" })).ok, true);
  assert.equal((await service.login(input.account, password, "ip2")).status, 401);
  state.row.enabled = false;
  assert.equal((await service.login(input.account, "replacement-password-234", "ip2")).status, 401);
  state.row.enabled = true;
  state.row.expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await service.login(input.account, "replacement-password-234", "ip2")).status, 401);
  state.error = { message: "offline" };
  await assert.rejects(service.access(login.userId), error => error.status === 503);
});
test("unknown accounts and repeated password attempts fail closed", async () => {
  const { service } = fixture();
  for (let i = 0; i < 10; i++) assert.equal((await service.login("unknown", password, "same-ip")).status, 401);
  assert.equal((await service.login("other", password, "same-ip")).status, 429);
  assert.equal(await service.verifyPassword(password, "malformed"), false);
});
test("migration: private table and database constraints", async () => {
  const { PGlite } = require("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(fs.readFileSync(path.join(root, "database/20261023_web_members.sql"), "utf8"));
    const result = await db.query("select has_table_privilege('anon','public.web_members','SELECT') as anon, has_table_privilege('authenticated','public.web_members','UPDATE') as member, has_table_privilege('service_role','public.web_members','INSERT') as server");
    assert.deepEqual(result.rows[0], { anon: false, member: false, server: true });
    await assert.rejects(db.exec("insert into web_members(account,password_hash,expires_at,updated_by) values ('INVALID','hash',now(),'admin')"));
  } finally { await db.close(); }
});
test("website identities use shared VIP checks and website delivery without calling LINE", async () => {
  const { service } = fixture();
  await service.save("admin", { account: "myuser", password, enabled: true, expiresAt: future() });
  const login = await service.login("myuser", password, "ip");
  const vip = load("modules/vip/index.js", { "../../services/webMembers": service });
  assert.equal((await vip.checkVipAccess(login.userId)).allowed, true);
  const delivered = [];
  const line = load("services/line.js", {
    "./webMembers": service,
    "./webChannel": { publish: (id, messages) => delivered.push({ id, messages }) },
  });
  await line.pushStrict(login.userId, { type: "text", text: "analysis" });
  await line.pushLineStrict(login.userId, { type: "text", text: "analysis" });
  assert.equal(delivered.length, 2);
  const web = load("services/webChannel.js", { crypto });
  const token = `web:${login.userId}:request-id`;
  const pending = web.waitReply(token, 1000);
  web.resolveReply(token, [{ type: "text", text: "analysis" }]);
  await pending;
  assert.equal(web.history(login.userId).length, 1);
});
test("browser login and admin form at mobile/desktop widths, with actual CSRF middleware", { skip: !browserPath && "Chrome/Edge unavailable" }, async () => {
  const { service, state } = fixture();
  const app = express();
  require("../routes/images").registerImageRoutes(app);
  const { portalCsrf, securityHeaders } = require("../middleware/portalSecurity");
  app.use(securityHeaders, portalCsrf);
  const sessions = new Map([["admin-token", "admin"]]);
  const routes = load("routes/webPortal.js", {
    path, express, "../services/webMembers": service,
    "../modules/baccarat": { reconcileActiveBaccaratSession: async () => ({}) },
    "../services/webChannel": { authenticate: token => sessions.get(token), issueSession: id => { sessions.set("member-token", id); return "member-token"; } },
    "../modules/vip/lineTransfer": { isLineRevoked: async () => false },
    "../config/admin": { isAdminLineUserId: id => id === "admin" },
  });
  routes.registerWebPortalRoutes(app);
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = require("playwright-core");
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    assert.equal((await fetch(base + "/portal/admin/web-members")).status, 403);
    assert.equal((await fetch(base + "/api/web/admin/web-members", { method: "POST", headers: { "x-blackdomain-portal": "1", "content-type": "application/json" }, body: "{}" })).status, 403);
    await context.addCookies([{ name: "blackdomain_web", value: "admin-token", url: base }]);
    await page.goto(base + "/portal/admin/web-members");
    await page.locator("#account").fill("Malaysia123");
    await page.locator("#password").fill(password);
    await page.locator("#expiresAt").fill("2099-12-31T12:00");
    await page.locator("#submit").click();
    await page.waitForFunction(() => document.getElementById("password").value === "");
    assert.equal(state.row.account, "malaysia123");
    if (process.env.WEB_MEMBER_CAPTURE_DIR) {
      fs.mkdirSync(process.env.WEB_MEMBER_CAPTURE_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.WEB_MEMBER_CAPTURE_DIR, "web-member-admin.png"), fullPage: true });
    }
    await context.clearCookies();
    for (const width of [375, 430, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(base + "/portal/member-login");
      assert.equal(await page.locator("img").evaluate(img => img.complete && img.naturalWidth > 0), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.WEB_MEMBER_CAPTURE_DIR) await page.screenshot({ path: path.join(process.env.WEB_MEMBER_CAPTURE_DIR, `web-member-login-${width}.png`), fullPage: true });
    }
    await page.locator("#account").fill("Malaysia123");
    await page.locator("#password").fill("incorrect-password");
    await page.locator("#submit").click();
    await page.waitForFunction(() => !document.getElementById("submit").disabled);
    assert.equal((await context.cookies()).some(cookie => cookie.name === "blackdomain_web"), false);
    await page.locator("#password").fill(password);
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/web/member/login"));
    await page.locator("#submit").click();
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    assert.match((await response.allHeaders())["set-cookie"], /HttpOnly; Secure; SameSite=Lax/);
    const sync = () => fetch(base + "/api/web/sync", { method: "POST", headers: { "x-blackdomain-portal": "1", cookie: "blackdomain_web=member-token" } });
    assert.equal((await sync()).status, 200);
    await service.save("admin", { account: "malaysia123", password: "replacement-password-456", enabled: true, expiresAt: future() });
    assert.equal((await sync()).status, 401);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
