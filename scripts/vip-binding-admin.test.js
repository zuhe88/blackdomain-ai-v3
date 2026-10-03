const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { PGlite } = require("@electric-sql/pglite");

test("binding transaction preserves rights, releases both unique bindings and rolls back failures", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(fs.readFileSync(path.join(__dirname, "../database/blackdomain_membership.sql"), "utf8"));
    await db.exec("alter table admin_logs rename column target to target_3a_account; alter table admin_logs drop column result;");
    await db.exec(fs.readFileSync(path.join(__dirname, "../database/20261003_vip_binding_admin.sql"), "utf8"));
    const change = async (oldName, newName) => (await db.query(
      "select admin_change_vip_binding($1, $2, 'admin') as result", [oldName, newName],
    )).rows[0].result;
    await db.exec(`insert into vip_users(line_user_id, three_a_account, expires_at) values ('member', 'Old123', '2030-01-01T00:00:00Z');
      insert into vip_requests(line_user_id, three_a_account, status) values ('member', 'Old123', 'approved');
      insert into vip_requests(line_user_id, three_a_account) values ('other', 'taken123');`);
    assert.equal((await change("old123", "TAKEN123")).ok, false);
    assert.equal((await change("old123", "old123")).ok, false);
    assert.equal((await change("unknown123", null)).ok, false);
    assert.equal((await change("old123", "新帳號")).ok, false);
    assert.equal((await change("OLD123", "New123")).ok, true);
    let row = (await db.query("select * from vip_users where line_user_id = 'member'")).rows[0];
    assert.equal(row.three_a_account, "new123");
    assert.equal(row.ai_permission, true);
    assert.equal(row.vip_status, "approved");
    assert.equal(new Date(row.expires_at).toISOString(), "2030-01-01T00:00:00.000Z");
    assert.equal((await db.query("select three_a_account from vip_requests where line_user_id = 'member'")).rows[0].three_a_account, "new123");
    const audit = JSON.parse((await db.query("select result from admin_logs")).rows[0].result);
    assert.equal(audit.vip_users[0].three_a_account, "Old123");
    await db.exec("alter table vip_requests add constraint fail_update check (three_a_account <> 'blocked123');");
    await assert.rejects(change("new123", "blocked123"));
    assert.equal((await db.query("select three_a_account from vip_users where line_user_id = 'member'")).rows[0].three_a_account, "new123");
    assert.equal((await db.query("select count(*)::int as n from admin_logs")).rows[0].n, 1);
    assert.equal((await change("new123", null)).ok, true);
    assert.equal((await db.query("select count(*)::int as n from vip_users where line_user_id = 'member'")).rows[0].n, 0);
    await db.exec("insert into vip_requests(line_user_id, three_a_account) values ('member', 'fresh123');");
    assert.equal((await change("fresh123", "pending456")).ok, true);
    assert.equal((await db.query("select status from vip_requests where line_user_id = 'member'")).rows[0].status, "pending");
    assert.equal((await change("pending456", null)).ok, true);
    await db.exec("insert into vip_requests(line_user_id, three_a_account) values ('member', 'new123');");
    const privileges = (await db.query("select has_function_privilege('anon', 'admin_change_vip_binding(text,text,text)', 'EXECUTE') as anon, has_function_privilege('authenticated', 'admin_change_vip_binding(text,text,text)', 'EXECUTE') as member")).rows[0];
    assert.equal(privileges.anon, false);
    assert.equal(privileges.member, false);
  } finally { await db.close(); }
});

test("server rejects non-admin senders and invalid input before database access", async () => {
  let calls = 0;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../modules/vip/bindingAdmin.js"), "utf8"), {
    module,
    require(name) {
      if (name.endsWith("supabase")) return { async rpc() { calls += 1; return { error: { message: "offline" } }; } };
      if (name.endsWith("admin")) return { isAdminLineUserId: (id) => id === "admin" };
      return require("../modules/vip/validator");
    },
  });
  const change = module.exports.changeVipBinding;
  assert.equal((await change("old123", null, "member")).ok, false);
  assert.equal((await change("old123", "bad account", "admin")).ok, false);
  assert.equal(calls, 0);
  assert.equal((await change("old123", "new123", "admin")).ok, false);
  assert.equal(calls, 1);
});
