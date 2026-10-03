const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function fixture(state = { row: null }) {
  const db = { from() { return {
    select() { return this; }, eq() { return this; },
    async maybeSingle() { return { data: state.row, error: state.readError }; },
    async upsert(row) {
      if (state.writeError) return { error: state.writeError };
      state.row = row;
      return { error: null };
    },
  }; } };
  function restart() {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../config/lineWebsiteMode.js"), "utf8"), {
      module, console, Date, setTimeout, clearTimeout,
      process: { env: { LINE_WEBSITE_ONLY_MODE: "false" } },
      require(name) { return name.endsWith("supabase") ? db : { isAdminLineUserId: (id) => id === "admin" }; },
    });
    return module.exports;
  }
  return { state, restart, mode: restart() };
}

test("admin restriction persists across restart and can be reopened", async () => {
  const { state, mode, restart } = fixture();
  assert.equal(mode.isLineWebsiteOnlyMode(), true, "startup must not leak pushes before settings load");
  await mode.refreshLineWebsiteMode();
  assert.equal(mode.isLineWebsiteOnlyMode(), false);
  assert.equal((await mode.setLineWebsiteOnlyMode(true, "admin")).ok, true);
  assert.equal(state.row.updated_by, "admin");
  const restored = restart();
  await restored.refreshLineWebsiteMode();
  assert.equal(restored.isLineWebsiteOnlyMode(), true);
  assert.equal((await restored.setLineWebsiteOnlyMode(false, "admin")).ok, true);
  const reopened = restart();
  await reopened.refreshLineWebsiteMode();
  assert.equal(reopened.isLineWebsiteOnlyMode(), false);
});

test("unauthorized or failed writes cannot change active mode", async () => {
  const { mode, state } = fixture();
  await mode.refreshLineWebsiteMode();
  assert.equal((await mode.setLineWebsiteOnlyMode(true, "member")).ok, false);
  assert.equal(state.row, null);
  state.writeError = { message: "offline" };
  assert.equal((await mode.setLineWebsiteOnlyMode(true, "admin")).ok, false);
  assert.equal(mode.isLineWebsiteOnlyMode(), false);
});

test("unavailable settings on startup keep LINE pushes disabled", async () => {
  const { mode } = fixture({ row: null, readError: { message: "offline" } });
  await mode.refreshLineWebsiteMode();
  assert.equal(mode.isLineWebsiteOnlyMode(), true);
});
