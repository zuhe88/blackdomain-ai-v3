const USER_ERROR_TEXT = "系統忙碌中，請稍後再試。";

const ERROR_CODES = {
  E001: "Reply Error",
  E002: "Push Error",
  E003: "Supabase Error",
  E004: "AI Error",
  E005: "Image Error",
  E006: "Flex Error",
  E007: "Railway Error",
  E008: "Webhook Error",
};

function logError(code, err, meta = {}) {
  const label = ERROR_CODES[code] || "System Error";
  console.error(`${code} ${label}:`, err?.message || err || USER_ERROR_TEXT, meta);

  const detail = err?.originalError?.response?.data || err?.response?.data;
  if (detail) {
    console.error(JSON.stringify(detail, null, 2));
  }
}

module.exports = {
  USER_ERROR_TEXT,
  ERROR_CODES,
  logError,
};
