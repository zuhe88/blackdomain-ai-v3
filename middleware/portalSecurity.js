const crypto = require("crypto");

const buckets = new Map();

function clientAddress(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function securityHeaders(req, res, next) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "SAMEORIGIN");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("x-request-id", req.get("x-request-id") || crypto.randomUUID());
  if (req.path === "/portal" || req.path.startsWith("/portal/")) {
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
    );
  }
  next();
}

function portalRateLimit(req, res, next) {
  const isLogin = req.path === "/portal/login";
  const isPortalApi = req.path.startsWith("/api/web/");
  if (!isLogin && !isPortalApi) return next();

  const windowMs = isLogin ? 10 * 60 * 1000 : 60 * 1000;
  const limit = isLogin ? 30 : 180;
  const now = Date.now();
  const key = `${isLogin ? "login" : "web"}:${clientAddress(req)}`;
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;
  bucket.count += 1;
  buckets.set(key, bucket);
  res.setHeader("ratelimit-limit", String(limit));
  res.setHeader("ratelimit-remaining", String(Math.max(0, limit - bucket.count)));
  res.setHeader("ratelimit-reset", String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count > limit) {
    res.setHeader("retry-after", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    return res.status(429).json({ error: "操作過於頻繁，請稍後再試。" });
  }
  if (buckets.size > 5000) {
    for (const [bucketKey, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(bucketKey);
    }
  }
  return next();
}

function portalCsrf(req, res, next) {
  if (req.method !== "POST" || !req.path.startsWith("/api/web/")) return next();
  if (req.get("x-blackdomain-portal") !== "1") {
    return res.status(403).json({ error: "無效的網站操作，請重新整理後再試。" });
  }
  const origin = req.get("origin");
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== req.get("host")) {
        return res.status(403).json({ error: "無效的網站來源。" });
      }
    } catch {
      return res.status(403).json({ error: "無效的網站來源。" });
    }
  }
  return next();
}

module.exports = { portalCsrf, portalRateLimit, securityHeaders };
