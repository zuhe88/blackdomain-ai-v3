const DEFAULT_STARTUP_RECOVERY_TIMEOUT_MS = 8000;

const recoveryState = {
  status: "idle",
  startedAt: null,
  completedAt: null,
  tasks: {},
};

function configuredTimeoutMs() {
  const configured = Number(process.env.STARTUP_RECOVERY_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_STARTUP_RECOVERY_TIMEOUT_MS;
}

function snapshotStartupRecovery() {
  return {
    status: recoveryState.status,
    startedAt: recoveryState.startedAt,
    completedAt: recoveryState.completedAt,
    tasks: Object.fromEntries(Object.entries(recoveryState.tasks).map(([name, task]) => [
      name,
      { ...task },
    ])),
  };
}

async function runRecoveryTask(name, run, timeoutMs = configuredTimeoutMs()) {
  const startedAt = new Date().toISOString();
  recoveryState.tasks[name] = { status: "running", startedAt, completedAt: null, error: null };

  let timer = null;
  try {
    const result = await Promise.race([
      Promise.resolve().then(run),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${name} exceeded ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
    recoveryState.tasks[name] = {
      status: "ready",
      startedAt,
      completedAt: new Date().toISOString(),
      error: null,
    };
    return { ok: true, result };
  } catch (error) {
    const message = error?.message || String(error);
    recoveryState.tasks[name] = {
      status: "degraded",
      startedAt,
      completedAt: new Date().toISOString(),
      error: message,
    };
    console.error(`[Startup] ${name} recovery failed: ${message}`);
    return { ok: false, error };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function startStartupRecovery(tasks) {
  if (recoveryState.status === "recovering" || recoveryState.status === "ready" || recoveryState.status === "degraded") {
    return Promise.resolve(snapshotStartupRecovery());
  }

  recoveryState.status = "recovering";
  recoveryState.startedAt = new Date().toISOString();
  recoveryState.completedAt = null;
  recoveryState.tasks = {};

  const recovery = Promise.all(Object.entries(tasks).map(async ([name, run]) => {
    const outcome = await runRecoveryTask(name, run);
    return outcome;
  }));

  recovery.then((outcomes) => {
    recoveryState.status = outcomes.every((outcome) => outcome.ok) ? "ready" : "degraded";
    recoveryState.completedAt = new Date().toISOString();
  }).catch((error) => {
    recoveryState.status = "degraded";
    recoveryState.completedAt = new Date().toISOString();
    console.error("[Startup] Recovery coordinator failed:", error.message);
  });

  return recovery;
}

module.exports = {
  DEFAULT_STARTUP_RECOVERY_TIMEOUT_MS,
  snapshotStartupRecovery,
  startStartupRecovery,
};
