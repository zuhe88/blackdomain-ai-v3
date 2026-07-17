const path = require("path");
const express = require("express");

function registerPenaltyGameRoutes(app) {
  const gameRoot = path.join(__dirname, "..", "public", "games", "worldcup-penalty");
  app.use("/games/worldcup-penalty", express.static(gameRoot));
  app.get("/worldcup-penalty", (req, res) => {
    res.redirect("/games/worldcup-penalty/");
  });
}

module.exports = {
  registerPenaltyGameRoutes,
};
