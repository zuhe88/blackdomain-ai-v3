const { lineConfig } = require("../services/line");

function registerHealthRoutes(app) {
  app.get("/", (req, res) => {
    res.status(200).send("BLACKDOMAIN AI V3 is running.");
  });

  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      service: "BLACKDOMAIN AI V3",
      time: new Date().toISOString(),
      lineConfigured: Boolean(lineConfig.channelAccessToken && lineConfig.channelSecret),
    });
  });
}

module.exports = {
  registerHealthRoutes,
};
