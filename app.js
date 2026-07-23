require("dotenv").config();

const express = require("express");
const { registerHealthRoutes } = require("./routes/health");
const { registerImageRoutes } = require("./routes/images");
const { registerWebhookRoutes } = require("./routes/webhook");
const { registerPenaltyGameRoutes } = require("./routes/penaltyGame");
const { registerBrandLandingRoutes } = require("./routes/brandLanding");
const { registerAtgRelayRoutes } = require("./routes/atgRelay");
const { registerExposureRoutes } = require("./routes/exposure");

const app = express();

registerImageRoutes(app);
registerHealthRoutes(app);
registerWebhookRoutes(app);
registerPenaltyGameRoutes(app);
registerBrandLandingRoutes(app);
registerAtgRelayRoutes(app);
registerExposureRoutes(app);

module.exports = {
  app,
};
