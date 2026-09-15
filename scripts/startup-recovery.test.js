const test = require("node:test");
const assert = require("node:assert/strict");

process.env.STARTUP_RECOVERY_TIMEOUT_MS = "20";

const { snapshotStartupRecovery, startStartupRecovery } = require("../services/startupRecovery");

test("startup recovery never delays the listening server for a stalled dependency", async () => {
  const recovery = startStartupRecovery({
    stalledDependency: () => new Promise(() => {}),
  });

  assert.equal(snapshotStartupRecovery().status, "recovering");
  await recovery;

  const state = snapshotStartupRecovery();
  assert.equal(state.status, "degraded");
  assert.equal(state.tasks.stalledDependency.status, "degraded");
  assert.match(state.tasks.stalledDependency.error, /exceeded 20ms/);
});
