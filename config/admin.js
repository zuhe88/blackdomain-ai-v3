const BUILTIN_ADMIN_LINE_USER_IDS = ["U0ac5f4989e00ef3d8a9ab59dc00dca7d"];

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
