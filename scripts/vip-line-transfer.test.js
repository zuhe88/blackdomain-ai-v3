const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { PGlite } = require("@electric-sql/pglite");
const oldLine = `U${"1".repeat(32)}`;
const newLine = `U${"2".repeat(32)}`;
const otherLine = `U${"3".repeat(32)}`;
async function fixture() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const file of ["blackdomain_membership.sql", "20261003_vip_binding_admin.sql", "20261006_vip_line_transfer.sql"]) {
    await db.exec(fs.readFileSync(path.join(__dirname, "../database", file), "utf8"));
  }
  await db.query("insert into vip_users(line_user_id,three_a_account,expires_at) values ($1,'member123','2030-01-01')", [oldLine]);
  await db.query("insert into vip_requests(line_user_id,three_a_account,status) values ($1,'member123','approved')", [oldLine]);
  const request = async (line = newLine) => (await db.query("select request_vip_line_transfer('MEMBER123',$1,'新會員') as r", [line])).rows[0].r;
  const review = async (id, approve = true, account = "member123") => (await db.query("select review_vip_line_transfer($1,$2,'admin',$3) as r", [id, account, approve])).rows[0].r;
  return { db, request, review };
}
test("approval preserves rights and expiry, moves binding, revokes old identity and cannot replay", async () => {
  const { db, request, review } = await fixture();
  try {
    const original = (await db.query("select * from vip_users")).rows[0];
    const r = await request(); assert.equal(r.ok, true);
    assert.equal((await request()).id, r.id);
    assert.equal((await db.query("select count(*)::int as n from lottery_settings where key like 'vip_line_revoked:%'")).rows[0].n, 0);
    assert.equal((await review(r.id, true, "wrong123")).ok, false);
    assert.equal((await review(r.id)).ok, true);
    const current = (await db.query("select * from vip_users")).rows[0];
    for (const key of ["id", "three_a_account", "vip_status", "ai_permission", "expires_at", "is_admin", "created_at"]) assert.deepEqual(current[key], original[key], key);
    assert.equal(current.line_user_id, newLine);
    assert.equal((await db.query("select line_user_id from vip_requests")).rows[0].line_user_id, newLine);
    assert.equal((await db.query("select value from lottery_settings where key=$1", [`vip_line_revoked:${oldLine}`])).rows[0].value.revoked, true);
    assert.equal((await review(r.id)).ok, false);
    assert.equal((await db.query("select count(*)::int as n from admin_logs where action='轉移LINE'")).rows[0].n, 1);
    const rights = (await db.query("select has_function_privilege('anon','review_vip_line_transfer(uuid,text,text,boolean)','execute') as anon, has_function_privilege('authenticated','request_vip_line_transfer(text,text,text)','execute') as member, has_function_privilege('service_role','review_vip_line_transfer(uuid,text,text,boolean)','execute') as service")).rows[0];
    assert.deepEqual(rights, { anon: false, member: false, service: true });
  } finally { await db.close(); }
});
test("permanent membership stays permanent and competing or stale approvals fail", async () => {
  const { db, request, review } = await fixture();
  try {
    await db.exec("update vip_users set expires_at=null");
    const a = await request(); const b = await request(otherLine);
    assert.equal((await review(a.id)).ok, true);
    assert.equal((await review(b.id)).ok, false);
    assert.equal((await db.query("select expires_at from vip_users")).rows[0].expires_at, null);
  } finally { await db.close(); }
});
test("destination conflicts, expired requests, rejection and transaction failures never partially transfer", async () => {
  const { db, request, review } = await fixture();
  try {
    let r = await request();
    assert.equal((await review(r.id, false)).status, "rejected");
    r = await request();
    await db.query("update vip_line_transfers set expires_at=now()-interval '1 second' where id=$1", [r.id]);
    assert.equal((await review(r.id)).ok, false);
    r = await request();
    await db.query("insert into vip_requests(line_user_id,three_a_account) values($1,'occupied')", [newLine]);
    assert.equal((await review(r.id)).ok, false);
    await db.query("delete from vip_requests where line_user_id=$1", [newLine]);
    await db.exec("alter table admin_logs add constraint reject_transfer check(action <> '轉移LINE')");
    await assert.rejects(review(r.id));
    assert.equal((await db.query("select line_user_id from vip_users")).rows[0].line_user_id, oldLine);
    assert.equal((await db.query("select status from vip_line_transfers where id=$1", [r.id])).rows[0].status, "pending");
    assert.equal((await db.query("select count(*)::int as n from lottery_settings where key like 'vip_line_revoked:%'")).rows[0].n, 0);
  } finally { await db.close(); }
});
test("server refuses non-admin approval and revocation lookup fails closed", async () => {
  let calls = 0; let fail = false;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../modules/vip/lineTransfer.js"), "utf8"), { module, require(name) {
    if (name.endsWith("supabase")) return { rpc() { calls++; }, from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return fail ? { error: {} } : { data: { value: { revoked: true } } }; } }; } };
    if (name.endsWith("admin")) return { isAdminLineUserId: id => id === "admin" };
    return require("../modules/vip/validator");
  } });
  assert.equal((await module.exports.reviewTransfer("id", "member123", "member", true)).ok, false);
  assert.equal(calls, 0);
  assert.equal(await module.exports.isLineRevoked(oldLine), true);
  fail = true;
  await assert.rejects(module.exports.isLineRevoked(oldLine), e => e.status === 503);
});

test("old login links cannot be redeemed after transfer, including after service reload", async () => {
  let revoked = false;
  function loadWeb() {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../services/webChannel.js"), "utf8"), {
      module, Buffer, process: { env: { WEB_SESSION_SECRET: "test-only-session-secret" } }, setTimeout, clearTimeout, console,
      require(name) {
        if (name === "crypto") return require("node:crypto");
        if (name === "./supabase") return null;
        if (name.endsWith("lineTransfer")) return { isLineRevoked: async () => revoked };
        throw new Error(name);
      },
    });
    return module.exports;
  }
  const before = loadWeb(); const link = before.issue(oldLine);
  revoked = true;
  assert.equal(await loadWeb().redeem(link), null);
  revoked = false;
  assert.ok(await loadWeb().redeem(link));
});
