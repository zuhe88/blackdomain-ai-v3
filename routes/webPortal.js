const path = require("path");
const express = require("express");
const web = require("../services/webChannel");
const vip = require("../modules/vip");
const baccarat = require("../modules/baccarat");
const electronicAvailability = require("../modules/electronic/availability");
function cookies(req) {
  return Object.fromEntries(String(req.get("cookie") || "").split(";").map((v) => v.trim().split("=")).filter((v) => v.length === 2));
}
function user(req) { return web.authenticate(cookies(req).blackdomain_web); }

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function loginPage(code) {
  const action = `/portal/login?code=${encodeURIComponent(String(code || ""))}`;
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>黑域AI｜網站登入</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070706;color:#fff;font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif}.card{width:min(90vw,390px);padding:34px 26px;text-align:center;border:1px solid #806415;border-radius:24px;background:linear-gradient(145deg,#17150f,#090909);box-shadow:0 24px 70px #000}.brand{color:#f3cc39;font-size:12px;letter-spacing:.12em}.card h1{margin:12px 0 8px;font-size:26px}.card p{margin:0 0 22px;color:#bcb7a9;line-height:1.7}.card button{width:100%;border:1px solid #d8aa20;border-radius:14px;padding:14px;background:#e0b529;color:#171207;font-size:16px;font-weight:800;cursor:pointer}.hint{margin-top:16px!important;font-size:12px;color:#817b6c!important}</style></head>
<body><main class="card"><div class="brand">BLACKDOMAIN AI</div><h1>正在安全登入</h1><p>即將進入黑域AI即時分析中心</p>
<form id="login" method="post" action="${escapeHtml(action)}"><button type="submit">進入網站</button></form>
<p class="hint">若畫面沒有自動前往，請點擊上方按鈕</p></main>
<script>window.addEventListener("DOMContentLoaded",()=>document.getElementById("login").requestSubmit());</script></body></html>`;
}

function invalidLoginPage() {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>登入連結已失效</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080807;color:#fff;font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif}.card{width:min(88vw,390px);padding:34px 25px;text-align:center;border:1px solid #806415;border-radius:24px;background:#12110e}.brand{color:#f3cc39;font-size:12px;letter-spacing:.12em}h1{font-size:24px;margin:12px 0}p{color:#bbb5a5;line-height:1.7}a{display:block;margin-top:22px;padding:13px;border-radius:14px;background:#dfb426;color:#171207;text-decoration:none;font-weight:800}</style></head><body><main class="card"><div class="brand">BLACKDOMAIN AI</div><h1>登入連結已失效</h1><p>連結已使用或已超過有效時間。<br>請回到 LINE 再傳送一次「網站登入」。</p><a href="/portal/">返回網站首頁</a></main></body></html>`;
}

function registerWebPortalRoutes(app) {
  app.use("/portal", express.static(path.join(__dirname, "..", "public", "portal"), {
    etag: false,
    lastModified: false,
    setHeaders(response) {
      response.setHeader("cache-control", "no-store, no-cache, must-revalidate");
      response.setHeader("pragma", "no-cache");
      response.setHeader("x-robots-tag", "noindex, nofollow, noarchive");
    },
  }));
  app.get("/portal/login", (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-robots-tag", "noindex, nofollow, noarchive");
    return res.type("html").send(loginPage(req.query.code));
  });
  app.post("/portal/login", (req, res) => {
    const token = web.redeem(req.query.code);
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-robots-tag", "noindex, nofollow, noarchive");
    if (!token) return res.status(401).type("html").send(invalidLoginPage());
    res.setHeader("set-cookie", `blackdomain_web=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
    return res.redirect(302, "/portal/");
  });
  app.get("/portal/*", (req, res) => {
    res.setHeader("cache-control", "no-cache");
    res.setHeader("x-robots-tag", "noindex, nofollow, noarchive");
    return res.sendFile(path.join(__dirname, "..", "public", "portal", "index.html"));
  });
  app.get("/api/web/me", async (req, res, next) => {
    try {
    const userId = user(req);
    if (!userId) return res.json({ authenticated: false, accessAllowed: false, messages: [] });
    const access = await vip.checkVipAccess(userId);
    return res.json({
      authenticated: true,
      accessAllowed: Boolean(access.allowed),
      allElectronicGamesEnabled: electronicAvailability.areAllElectronicGamesEnabled(),
      activeBaccaratSession: baccarat.hasActiveBaccaratSession(userId),
      activeBaccaratPlatform: baccarat.activeBaccaratPlatform(userId),
      messages: web.history(userId),
    });
    } catch (error) { return next(error); }
  });
  app.get("/api/web/events", (req, res) => {
    const userId = user(req); if (!userId) return res.status(401).end();
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.write("retry: 2000\nevent: ready\ndata: {}\n\n");
    const unsubscribe = web.subscribe(userId, res, req.get("last-event-id") || "");
    setImmediate(() => {
      baccarat.reconcileActiveBaccaratSession(userId).catch((error) => {
        console.error("[Web] Baccarat reconnect reconciliation failed:", error.message);
      });
    });
    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
  app.post("/api/web/sync", async (req, res, next) => {
    try {
      const userId = user(req);
      if (!userId) return res.status(401).json({ error: "請重新登入。" });
      const result = await baccarat.reconcileActiveBaccaratSession(userId);
      return res.json({ ok: true, ...result });
    } catch (error) {
      return next(error);
    }
  });
  app.post("/api/web/stop", async (req, res, next) => {
    try {
      const userId = user(req);
      if (!userId) return res.status(401).json({ error: "請重新登入。" });
      const { clearAllUserSessions } = require("./webhook");
      await clearAllUserSessions(userId);
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });
  app.post("/api/web/command", express.json({ limit: "16kb" }), async (req, res, next) => {
    try {
      const userId = user(req); if (!userId) return res.status(401).json({ error: "請重新登入" });
      res.setHeader("cache-control", "no-store");
      const text = String(req.body?.text || "").trim().slice(0, 300);
      if (!text) return res.status(400).json({ error: "請輸入指令" });
      const replyToken = `web:${userId}:${require("crypto").randomUUID()}`;
      const pending = web.waitReply(replyToken, 20_000);
      const { handleEvent } = require("./webhook");
      try {
        await handleEvent({ type: "message", replyToken, source: { userId }, message: { type: "text", text } });
      } catch (error) {
        web.cancelReply(replyToken);
        throw error;
      }
      let messages = [];
      try {
        messages = await pending;
      } catch (error) {
        console.warn("[WebPortal] Command reply deferred:", error.message);
      }
      return res.status(messages.length ? 200 : 202).json({
        messages,
        pending: messages.length === 0,
        portalBuild: "20260820.03",
      });
    } catch (error) { return next(error); }
  });
}
module.exports = { registerWebPortalRoutes };
