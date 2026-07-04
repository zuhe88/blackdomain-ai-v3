require("dotenv").config();

const express = require("express");
const { registerHealthRoutes } = require("./routes/health");
const { registerImageRoutes } = require("./routes/images");
const { registerWebhookRoutes } = require("./routes/webhook");
const { register3AWebhookRoutes } = require("./routes/webhook3a");
const { registerBoxRoutes } = require("./routes/box");

const app = express();

registerImageRoutes(app);
registerHealthRoutes(app);
registerWebhookRoutes(app);
register3AWebhookRoutes(app);
registerBoxRoutes(app);

module.exports = {
  app,
};
