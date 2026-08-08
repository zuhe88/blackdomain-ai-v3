require("dotenv").config();

const express = require("express");
const { registerHealthRoutes } = require("./routes/health");
const { registerImageRoutes } = require("./routes/images");
const { registerWebhookRoutes } = require("./routes/webhook");
const { registerPenaltyGameRoutes } = require("./routes/penaltyGame");
const { registerBrandLandingRoutes } = require("./routes/brandLanding");
const { registerAtgRelayRoutes } = require("./routes/atgRelay");
const { registerElectronicRelayRoutes } = require("./routes/electronicRelay");
const { registerMbRelayRoutes } = require("./routes/mbRelay");
const { registerDgRelayRoutes } = require("./routes/dgRelay");
const { registerMtLiveRoutes } = require("./routes/mtLive");
const { errorHandler } = require("./middleware/errorHandler");

const app = express();

registerImageRoutes(app);
registerHealthRoutes(app);
registerWebhookRoutes(app);
registerPenaltyGameRoutes(app);
registerBrandLandingRoutes(app);
registerAtgRelayRoutes(app);
registerElectronicRelayRoutes(app);
registerMbRelayRoutes(app);
registerDgRelayRoutes(app);
registerMtLiveRoutes(app);
app.use(errorHandler);

module.exports = {
  app,
};
