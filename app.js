require("dotenv").config();

const express = require("express");
const { registerHealthRoutes } = require("./routes/health");
const { registerImageRoutes } = require("./routes/images");
const { registerWebhookRoutes } = require("./routes/webhook");
const { registerPenaltyGameRoutes } = require("./routes/penaltyGame");
const { registerBrandLandingRoutes } = require("./routes/brandLanding");
const { registerAtgRelayRoutes } = require("./routes/atgRelay");

const app = express();

registerImageRoutes(app);
registerHealthRoutes(app);
registerWebhookRoutes(app);
registerPenaltyGameRoutes(app);
registerBrandLandingRoutes(app);
registerAtgRelayRoutes(app);

module.exports = {
  app,
};
