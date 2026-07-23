const crypto = require("crypto");

const DEFAULT_PLATFORM_URL = "https://sn058.3a1788.bet";
const TOKEN_KEYS = /^(?:t|token|auth_?token|access_?token|launch_?token|ticket)$/i;

function platformBaseUrl() {
  return String(process.env.ATG_PLATFORM_URL || DEFAULT_PLATFORM_URL).trim().replace(/\/+$/, "");
}

function isConfigured() {
  return Boolean(
    String(process.env.ATG_PLATFORM_USERNAME || "").trim() &&
    String(process.env.ATG_PLATFORM_PASSWORD || "").trim()
  );
}

function deviceId(username) {
  const configured = String(process.env.ATG_PLATFORM_DEVICE_ID || "").trim();
  if (configured) return configured;
  return crypto.createHash("sha256").update(username).digest("hex").slice(0, 20);
}

function extractTokenFromUrl(value) {
  try {
    const url = new URL(value);
    for (const [key, candidate] of [...url.searchParams, ...new URLSearchParams(url.hash.replace(/^#/, ""))]) {
      if (TOKEN_KEYS.test(key) && candidate) return candidate;
    }
  } catch {
    return "";
  }
  return "";
}

function extractSocketToken(value, seen = new Set()) {
  if (!value || seen.has(value)) return "";
  if (typeof value === "string") return extractTokenFromUrl(value);
  if (typeof value !== "object") return "";
  seen.add(value);

  for (const [key, candidate] of Object.entries(value)) {
    if (TOKEN_KEYS.test(key) && typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  for (const candidate of Object.values(value)) {
    const token = extractSocketToken(candidate, seen);
    if (token) return token;
  }
  return "";
}

function responseError(payload, fallback) {
  const message = payload?.message || payload?.msg || payload?.error || fallback;
  return payload?.code ? `${message} (code ${payload.code})` : message;
}

async function requestJson(path, options = {}) {
  const baseUrl = platformBaseUrl();
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: baseUrl,
      referer: `${baseUrl}/`,
      "user-agent": "Mozilla/5.0 BLACKDOMAIN-ATG-Cloud/1.0",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(responseError(payload, `HTTP ${response.status}`));
  const code = Number(payload.code);
  if (Number.isFinite(code) && ![200, 1000].includes(code)) {
    throw new Error(responseError(payload, `Platform code ${code}`));
  }
  return payload.data || payload;
}

async function followLaunch(launch) {
  const gameUrl = String(launch?.game_url || "").trim();
  if (!gameUrl) return "";

  const directToken = extractSocketToken({ gameUrl, gamePost: launch.game_post });
  if (directToken) return directToken;

  const gamePost = launch.game_post && typeof launch.game_post === "object" ? launch.game_post : null;
  const response = await fetch(gameUrl, gamePost
    ? {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(gamePost),
        redirect: "follow",
      }
    : { redirect: "follow" });
  const html = await response.text();
  const finalToken = extractSocketToken(response.url);
  if (finalToken) return finalToken;

  const patterns = [
    /["'](?:token|auth_?token|access_?token|launch_?token)["']\s*:\s*["']([^"']+)["']/i,
    /[?&#](?:token|auth_?token|access_?token|launch_?token)=([^&#"']+)/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return "";
}

async function fetchAtgSocketToken() {
  if (!isConfigured()) return "";
  const username = String(process.env.ATG_PLATFORM_USERNAME).trim();
  const password = String(process.env.ATG_PLATFORM_PASSWORD);
  const login = await requestJson("/v1/login", {
    method: "POST",
    body: JSON.stringify({
      username,
      password,
      device_id: deviceId(username),
    }),
  });
  if (!login?.token) throw new Error("3A login did not return a token.");

  const launch = await requestJson("/v2/game/ATG/login", {
    method: "POST",
    headers: { authorization: `Beaer ${login.token}` },
    body: JSON.stringify({
      game_return_url: platformBaseUrl(),
      game_kind: "",
      game_type: "slot",
      game_device: "Desktop",
      game_money: "-1",
    }),
  });
  const token = await followLaunch(launch);
  if (!token) throw new Error("ATG launch did not expose a socket token.");
  return token;
}

module.exports = {
  extractSocketToken,
  fetchAtgSocketToken,
  isConfigured,
};
