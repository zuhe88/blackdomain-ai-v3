require("dotenv").config();

const express = require("express");
const { registerHealthRoutes } = require("./routes/health");
const { registerImageRoutes } = require("./routes/images");
const { registerWebhookRoutes } = require("./routes/webhook");
const { registerPenaltyGameRoutes } = require("./routes/penaltyGame");
const { registerBrandLandingRoutes } = require("./routes/brandLanding");
const { registerElectronicRelayRoutes } = require("./routes/electronicRelay");
const { registerMbRelayRoutes } = require("./routes/mbRelay");
const { registerDgRelayRoutes } = require("./routes/dgRelay");
const { registerMtLiveRoutes } = require("./routes/mtLive");
const { registerWebPortalRoutes } = require("./routes/webPortal");
const { errorHandler } = require("./middleware/errorHandler");
const { portalCsrf, portalRateLimit, securityHeaders } = require("./middleware/portalSecurity");

const app = express();

app.use(securityHeaders);
app.use(portalRateLimit);
app.use(portalCsrf);

registerImageRoutes(app);
registerHealthRoutes(app);
registerWebhookRoutes(app);
registerPenaltyGameRoutes(app);
registerBrandLandingRoutes(app);
registerElectronicRelayRoutes(app);
registerMbRelayRoutes(app);
registerDgRelayRoutes(app);
registerMtLiveRoutes(app);
registerWebPortalRoutes(app);
app.use(errorHandler);

module.exports = {
  app,
};
