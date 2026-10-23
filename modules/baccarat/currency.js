const CURRENCIES = {
  TWD: { code: "TWD", label: "台幣 TWD", symbol: "NT$", minBet: 50, scale: 1 },
  MYR: { code: "MYR", label: "令吉 MYR", symbol: "RM", minBet: 10, scale: 5 },
};

function currencyFor(currency) {
  return CURRENCIES[currency] || CURRENCIES.TWD;
}

function parseCurrency(value) {
  const text = String(value || "").trim().toUpperCase();
  if (["TWD", "台幣", "台幣 TWD"].includes(text)) return "TWD";
  if (["MYR", "令吉", "令吉 MYR", "RM"].includes(text)) return "MYR";
  return null;
}

function formatMoney(value, currency) {
  return `${currencyFor(currency).symbol} ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

// Apply denomination rules to the final native-currency recommendation.
// Always round down so a suggestion cannot exceed bankroll or the user's cap.
function roundRecommendedStake(value, currency) {
  const amount = Number(value);
  const minimum = currencyFor(currency).minBet;
  if (!Number.isFinite(amount) || amount < minimum) return 0;
  const unit = amount >= 10000 ? 1000 : amount >= 1000 ? 100 : minimum;
  return Math.floor(amount / unit) * unit;
}

// Scale the existing stake schedule by minimum chip size, without currency conversion.
function normalizeStakeSession(session) {
  const scale = currencyFor(session.currency).scale;
  if (scale === 1) return session;
  const normalized = { ...session, currency: "TWD" };
  for (const key of ["capital", "startBankroll", "bankroll", "maxBet"]) {
    if (session[key] !== undefined && session[key] !== null && session[key] !== "") {
      normalized[key] = Number(session[key]) * scale;
    }
  }
  return normalized;
}

module.exports = { currencyFor, parseCurrency, formatMoney, normalizeStakeSession, roundRecommendedStake };
