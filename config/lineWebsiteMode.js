// LINE member analysis is temporarily locked to the website portal.
// Keep the test override so the legacy LINE flows can still be regression-tested.
const PRODUCTION_WEBSITE_ONLY_LOCK = true;

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
