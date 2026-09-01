// LINE member analysis and the website portal are both available in production.
// Keep the test override so website-only fallback behavior can still be regression-tested.
const PRODUCTION_WEBSITE_ONLY_LOCK = false;

function isLineWebsiteOnlyMode() {
  if (process.env.NODE_ENV === "test") {
    return String(process.env.LINE_WEBSITE_ONLY_MODE || "true").toLowerCase() !== "false";
  }

  return PRODUCTION_WEBSITE_ONLY_LOCK;
}

module.exports = {
  isLineWebsiteOnlyMode,
  PRODUCTION_WEBSITE_ONLY_LOCK,
};
