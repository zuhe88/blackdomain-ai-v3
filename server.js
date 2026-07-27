require("dotenv").config();

const PORT = process.env.PORT || 3000;

async function start() {
  const { hydrateSessions } = require("./modules/baccarat/session");
  const restored = await hydrateSessions();
  if (restored) console.log(`[Baccarat] Restored ${restored} active session(s).`);

  const { app } = require("./app");
  app.listen(PORT, () => {
    console.log(`BLACKDOMAIN AI V3 running on port ${PORT}`);
  });
}

start().catch((error) => {
  console.error("BLACKDOMAIN AI V3 failed to start:", error);
  process.exitCode = 1;
});
