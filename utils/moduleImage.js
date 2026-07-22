const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_BASE_URL = "https://blackdomain-ai-v3-production.up.railway.app";

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();

  if (!raw) return DEFAULT_BASE_URL;
  if (/^https:\/\//i.test(raw)) return raw.replace(/\/+$/, "");
  if (/^http:\/\//i.test(raw)) return raw.replace(/^http:\/\//i, "https://").replace(/\/+$/, "");

  return `https://${raw.replace(/\/+$/, "")}`;
}

function publicBaseUrl() {
  return normalizeBaseUrl(
    process.env.PUBLIC_BASE_URL ||
      process.env.RAILWAY_PUBLIC_DOMAIN ||
      process.env.RAILWAY_STATIC_URL ||
      DEFAULT_BASE_URL
  );
}

function imageFilePath(fileName) {
  return path.join(__dirname, "..", "public", "images", "electronic", fileName);
}

function imageVersion(fileName) {
  try {
    const buffer = fs.readFileSync(imageFilePath(fileName));
    return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 12);
  } catch (error) {
    return "blackdomain-v3";
  }
}

function moduleImageUrl(fileName) {
  return `${publicBaseUrl()}/images/electronic/${fileName}?v=${imageVersion(fileName)}`;
}

function hasModuleImage(fileName) {
  return fs.existsSync(imageFilePath(fileName));
}

module.exports = {
  publicBaseUrl,
  moduleImageUrl,
  hasModuleImage,
};
