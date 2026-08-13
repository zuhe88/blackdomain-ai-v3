const { lineConfig } = require("../services/line");
const { isLineWebsiteOnlyMode } = require("../config/lineWebsiteMode");

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
      lineWebsiteOnlyMode: isLineWebsiteOnlyMode(),
      websiteCommandsBypassLineRedirect: true,
      websiteMonitoringLifecycle: "server-session-v2",
      portalDirectReplyRendering: "unfiltered-v2",
      lineMemberBindingPreserved: true,
      portalBuild: "20260813.8",
    });
  });
}

module.exports = {
  registerHealthRoutes,
};
