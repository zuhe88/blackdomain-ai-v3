const path = require("path");
const express = require("express");
const QRCode = require("qrcode");
const atgSource = require("../modules/atg/source");
const { buildAnalysis } = require("../modules/atg/service");

const LINE_FRIEND_URL = "https://line.me/ti/p/@391wiftp";

function publicSnapshot() {
  const snapshot = atgSource.getSnapshot();
  const analysis = buildAnalysis(snapshot.history, 5, snapshot);
  const updatedTime = snapshot.updatedAt ? new Date(snapshot.updatedAt).getTime() : 0;

  return {
    brand: "BLACKDOMAIN AI",
    fresh: ["relay", "live"].includes(snapshot.source)
      && updatedTime > 0
      && Date.now() - updatedTime < 180000,
    source: snapshot.source,
    targetPeriodId: snapshot.targetPeriodId,
    latestPeriodId: snapshot.history[0]?.periodId || null,
    updatedAt: snapshot.updatedAt,
    recentResults: snapshot.history.slice(0, 3).map((record) => ({
      periodId: record.periodId,
      time: record.time,
      result: record.result,
    })),
    recommendation: analysis.available
      ? {
          periodId: analysis.targetPeriodId,
          count: analysis.count,
          ranks: analysis.rows.slice(0, 3).map((row) => ({
            rank: row.rank,
            label: row.label,
            picks: row.picks,
          })),
        }
      : null,
  };
}

async function lineQr(_req, res) {
  try {
    const svg = await QRCode.toString(LINE_FRIEND_URL, {
      type: "svg",
      errorCorrectionLevel: "H",
      margin: 2,
      color: { dark: "#080808", light: "#ffffff" },
    });
    res.set({
      "cache-control": "public, max-age=86400",
      "content-type": "image/svg+xml; charset=utf-8",
      "x-content-type-options": "nosniff",
    });
    res.send(svg);
  } catch {
    res.status(500).send("Unable to generate QR code.");
  }
}

function registerExposureRoutes(app) {
  const resultsRoot = path.join(__dirname, "..", "public", "results");
  app.use("/results", express.static(resultsRoot, {
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  }));
  app.get("/results", (_req, res) => res.redirect(301, "/results/"));
  app.get("/api/public/atg", (_req, res) => {
    res.set("cache-control", "no-store");
    res.json(publicSnapshot());
  });
  app.get("/api/public/line-qr.svg", lineQr);
}

module.exports = {
  LINE_FRIEND_URL,
  publicSnapshot,
  registerExposureRoutes,
};
