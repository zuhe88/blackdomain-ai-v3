const { lineConfig } = require("../services/line");
const { isLineWebsiteOnlyMode } = require("../config/lineWebsiteMode");
const path = require("path");
const express = require("express");

const PUBLIC_SITE_URL = String(
  process.env.PUBLIC_SITE_URL || "https://blackdomain-ai-v3-production.up.railway.app",
).replace(/\/$/, "");

function registerHealthRoutes(app) {
  app.use("/videos", express.static(path.join(__dirname, "..", "public", "videos"), {
    maxAge: "30d",
    immutable: true,
  }));

  app.get("/", (req, res) => {
    res.set("Cache-Control", "public, max-age=300, s-maxage=900");
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });

  app.get("/robots.txt", (req, res) => {
    res.type("text/plain").send([
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      `Sitemap: ${PUBLIC_SITE_URL}/sitemap.xml`,
      "",
    ].join("\n"));
  });

  app.get("/sitemap.xml", (req, res) => {
    res.type("application/xml").send([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      "  <url>",
      `    <loc>${PUBLIC_SITE_URL}/</loc>`,
      "    <changefreq>weekly</changefreq>",
      "    <priority>1.0</priority>",
      "  </url>",
      "</urlset>",
      "",
    ].join("\n"));
  });

  app.get("/google9ea0721a8c1ecc83.html", (req, res) => {
    res.type("text/plain").send("google-site-verification: google9ea0721a8c1ecc83.html");
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
      portalBuild: "20260813.16",
    });
  });
}

module.exports = {
  registerHealthRoutes,
};
