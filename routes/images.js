const express = require("express");
const path = require("path");

function registerImageRoutes(app) {
  const assetsPath = path.join(__dirname, "..", "assets", "images");
  const publicImagesPath = path.join(__dirname, "..", "public", "images");
  const publicBrandPath = path.join(__dirname, "..", "public", "brand");

  app.use("/images", express.static(assetsPath));
  app.use("/public/images", express.static(publicImagesPath));
  app.use("/brand", express.static(publicBrandPath));

  app.use("/images/home", express.static(path.join(publicImagesPath, "home")));
  app.use("/images/baccarat", express.static(path.join(publicImagesPath, "baccarat")));
  app.use("/images/electronic", express.static(path.join(publicImagesPath, "electronic")));
  app.use("/images/sport", express.static(path.join(publicImagesPath, "sport")));
  app.use("/images/539", express.static(path.join(publicImagesPath, "lottery539")));
  app.use("/images/vip", express.static(path.join(publicImagesPath, "vip")));
  app.use("/images/admin", express.static(path.join(publicImagesPath, "admin")));
}

module.exports = {
  registerImageRoutes,
};
