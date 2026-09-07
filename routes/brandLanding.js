const path = require("path");
const express = require("express");

function registerBrandLandingRoutes(app) {
  const landingRoot = path.join(__dirname, "..", "public", "3a");
  const assistantRoot = path.join(__dirname, "..", "public", "assistant");

  app.use("/3a", express.static(landingRoot));
  app.use("/assistant", express.static(assistantRoot));
  app.get("/3a", (_req, res) => {
    res.redirect(301, "/3a/");
  });
}

module.exports = {
  registerBrandLandingRoutes,
};
