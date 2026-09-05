// LINE member analysis and the website portal are both available in production.
// Keep the test override so website-only fallback behavior can still be regression-tested.
const PRODUCTION_WEBSITE_ONLY_LOCK = false;

function isLineWebsiteOnlyMode() {
  const configured = process.env.LINE_WEBSITE_ONLY_MODE;
  if (configured != null && String(configured).trim() !== "") {
    return String(configured).toLowerCase() !== "false";
  }
  return process.env.NODE_ENV === "test" ? true : PRODUCTION_WEBSITE_ONLY_LOCK;
}

module.exports = {
  isLineWebsiteOnlyMode,
  PRODUCTION_WEBSITE_ONLY_LOCK,
};
