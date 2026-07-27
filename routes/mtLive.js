const mtSource = require("../modules/baccarat/mtSource");
const mtLive = require("../modules/baccarat/mtLive");

function registerMtLiveRoutes(app) {
  app.get("/api/mt/status", (_req, res) => {
    res.json({
      ...mtSource.getSnapshot(),
      live: mtLive.getStatus(),
    });
  });
}

module.exports = {
  registerMtLiveRoutes,
};
