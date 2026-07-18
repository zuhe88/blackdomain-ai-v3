const path = require("path");
const express = require("express");

function registerBrandLandingRoutes(app) {
  const landingRoot = path.join(__dirname, "..", "public", "3a");

  app.use("/3a", express.static(landingRoot));
  app.get("/3a", (_req, res) => {
    res.redirect(301, "/3a/");
  });
}

module.exports = {
  registerBrandLandingRoutes,
};
