require("dotenv").config();

const PORT = process.env.PORT || 3000;

async function start() {
  const { app } = require("./app");
  app.listen(PORT, () => {
    console.log(`BLACKDOMAIN AI V3 running on port ${PORT}`);
  });

  const { hydrateElectronicGameAccess } = require("./modules/electronic/availability");
  const { hydrateSessions } = require("./modules/baccarat/session");
  const { hydratePendingRecommendations } = require("./modules/electronic");
  const { startStartupRecovery } = require("./services/startupRecovery");

  startStartupRecovery({
    electronicGameAccess: hydrateElectronicGameAccess,
    baccaratSessions: async () => {
      const restored = await hydrateSessions();
      if (restored) console.log(`[Baccarat] Restored ${restored} active session(s).`);
      return restored;
    },
    pendingElectronicRecommendations: async () => {
      const restored = await hydratePendingRecommendations();
      if (restored) console.log(`[Electronic] Restored ${restored} pending recommendation(s).`);
      return restored;
    },
  });
}

start().catch((error) => {
  console.error("BLACKDOMAIN AI V3 failed to start:", error);
  process.exitCode = 1;
});
