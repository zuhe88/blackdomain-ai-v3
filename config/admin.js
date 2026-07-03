const BUILTIN_ADMIN_LINE_USER_IDS = ["Uaf293ee976e5170d4e8672d2c12b3f76"];

function splitIds(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function adminLineUserIds() {
  return Array.from(
    new Set([
      ...BUILTIN_ADMIN_LINE_USER_IDS,
      ...splitIds(process.env.ADMIN_USER_IDS),
      ...splitIds(process.env.ADMIN_LINE_USER_IDS),
    ])
  );
}

function isAdminLineUserId(userId) {
  return adminLineUserIds().includes(String(userId || "").trim());
}

module.exports = {
  adminLineUserIds,
  isAdminLineUserId,
};
