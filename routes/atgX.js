const path = require("path");
const express = require("express");
const lineSdk = require("@line/bot-sdk");
const web = require("../services/webChannel");
const { isAdminLineUserId } = require("../config/admin");
const access = require("../modules/atgX/access");
const analyzer = require("../modules/atgX/analyzer");
const electronicSource = require("../modules/electronic/source");
const onboarding = require("../modules/atgX/onboarding").createOnboarding();

function cookies(req) {
  return Object.fromEntries(String(req.get("cookie") || "").split(";").map((v) => v.trim().split("=")).filter((v) => v.length === 2));
}

function deviceId(req) {
  return String(req.get("x-atgx-device") || req.body?.deviceId || "").trim();
}

async function member(req) {
  return access.authenticate(cookies(req).atgx_session, deviceId(req));
}

function requireSameOrigin(req, res, next) {
  if (req.get("x-atgx-client") !== "1") return res.status(403).json({ error: "無效的網站操作。" });
  const origin = req.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host")) return res.status(403).json({ error: "無效的網站來源。" });
    } catch {
      return res.status(403).json({ error: "無效的網站來源。" });
    }
  }
  return next();
}

function configuredLineAdmins() {
  return String(process.env.ATGX_LINE_ADMIN_USER_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
}

let atgXLineClient = null;
let atgXLineTokenExpiresAt = 0;

async function getAtgXLineClient(config) {
  if (process.env.ATGX_LINE_CHANNEL_ACCESS_TOKEN) {
    if (!atgXLineClient) atgXLineClient = new lineSdk.Client(config);
    return atgXLineClient;
  }
  const channelId = String(process.env.ATGX_LINE_CHANNEL_ID || "").trim();
  if (!channelId) throw new Error("ATGX_LINE_CHANNEL_ID is not configured.");
  if (atgXLineClient && Date.now() < atgXLineTokenExpiresAt - 300000) return atgXLineClient;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: channelId,
    client_secret: config.channelSecret,
  });
  const response = await fetch("https://api.line.me/v2/oauth/accessToken", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const token = await response.json();
  if (!response.ok || !token.access_token) throw new Error(token.error_description || "LINE access token renewal failed.");
  atgXLineTokenExpiresAt = Date.now() + Math.max(60000, Number(token.expires_in) * 1000);
  atgXLineClient = new lineSdk.Client({ ...config, channelAccessToken: token.access_token });
  return atgXLineClient;
}

function registerAtgXLineWebhook(app) {
  const config = {
    channelAccessToken: process.env.ATGX_LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.ATGX_LINE_CHANNEL_SECRET,
  };
  if (!config.channelSecret || (!config.channelAccessToken && !process.env.ATGX_LINE_CHANNEL_ID)) {
    app.post("/webhook/atg-x", (_req, res) => res.status(503).json({ error: "ATG X LINE 尚未設定。" }));
    return;
  }
  app.post("/webhook/atg-x", lineSdk.middleware(config), async (req, res) => {
    res.sendStatus(200);
    for (const event of req.body.events || []) {
      if (!event.replyToken) continue;
      const text = event.type === "message" && event.message?.type === "text" ? String(event.message.text || "").trim() : "";
      const userId = String(event.source?.userId || "");
      const isAdmin = configuredLineAdmins().includes(userId) || isAdminLineUserId(userId);
      let replyText = null;
      if (text === "我的ID") {
        replyText = `你的 LINE 管理識別碼：\n${userId}`;
      } else if (/^產生序號(?:\s|$)/.test(text)) {
        if (!isAdmin) {
          replyText = "此指令僅限管理員使用。";
        } else {
          const parts = text.split(/\s+/);
          const days = Number.parseInt(parts[1], 10) || 30;
          const label = parts.slice(2).join(" ");
          try {
            const license = await access.createLicense({ days, label, createdBy: `atgx-line:${userId}` });
            replyText = `ATG X 序號建立完成\n\n${license.serial}\n\n有效期限：${new Date(license.expiresAt).toLocaleDateString("zh-TW")}\n${label ? `備註：${label}\n` : ""}序號只顯示這一次，請妥善提供給使用者。`;
          } catch (error) {
            replyText = `序號建立失敗：${error.message}`;
          }
        }
      }
      try {
        const message = replyText ? { type: "text", text: replyText.slice(0, 5000) } : await onboarding.handle(event);
        if (!message) continue;
        const client = await getAtgXLineClient(config);
        await client.replyMessage(event.replyToken, message);
      } catch (error) {
        console.error("[ATG X LINE] Reply failed:", error.message);
      }
    }
  });
}

function registerAtgXRoutes(app) {
  registerAtgXLineWebhook(app);
  app.use("/atg-x", express.static(path.join(__dirname, "..", "public", "atg-x"), {
    etag: false,
    setHeaders(response) {
      response.setHeader("cache-control", "no-cache");
      response.setHeader("x-robots-tag", "noindex, nofollow, noarchive");
    },
  }));
  app.get("/atg-x/*", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "atg-x", "index.html")));

  app.get("/api/atg-x/me", async (req, res, next) => {
    try {
      const current = await member(req);
      return res.json({ authenticated: Boolean(current), expiresAt: current?.expiresAt || null });
    } catch (error) { return next(error); }
  });
  app.post("/api/atg-x/activate", express.json({ limit: "4kb" }), requireSameOrigin, async (req, res, next) => {
    try {
      const result = await access.activate(req.body?.serial, deviceId(req));
      if (!result.ok) return res.status(401).json({ error: result.error });
      res.setHeader("set-cookie", `atgx_session=${result.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`);
      return res.json({ ok: true, expiresAt: result.expiresAt });
    } catch (error) { return next(error); }
  });
  app.post("/api/atg-x/logout", express.json({ limit: "1kb" }), requireSameOrigin, (_req, res) => {
    res.setHeader("set-cookie", "atgx_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    return res.json({ ok: true });
  });
  app.get("/api/atg-x/games", async (req, res, next) => {
    try {
      if (!await member(req)) return res.status(401).json({ error: "請先輸入有效序號。" });
      return res.json({ games: analyzer.EXCLUSIVE_GAMES.map(analyzer.gameStatus) });
    } catch (error) { return next(error); }
  });
  app.post("/api/atg-x/analyze", express.json({ limit: "4kb" }), requireSameOrigin, async (req, res, next) => {
    try {
      if (!await member(req)) return res.status(401).json({ error: "授權已失效，請重新登入。" });
      return res.json({ result: analyzer.analyze(String(req.body?.gameName || ""), req.body?.bankroll) });
    } catch (error) {
      if (/請重新|正在同步|目前沒有/.test(error.message)) return res.status(409).json({ error: error.message });
      return next(error);
    }
  });

  app.get("/api/atg-x/admin/licenses", async (req, res, next) => {
    try {
      const adminId = web.authenticate(cookies(req).blackdomain_web);
      if (!adminId || !isAdminLineUserId(adminId)) return res.status(403).json({ error: "管理員權限不足。" });
      return res.json({ licenses: await access.listLicenses() });
    } catch (error) { return next(error); }
  });
  app.post("/api/atg-x/admin/licenses", express.json({ limit: "4kb" }), requireSameOrigin, async (req, res, next) => {
    try {
      const adminId = web.authenticate(cookies(req).blackdomain_web);
      if (!adminId || !isAdminLineUserId(adminId)) return res.status(403).json({ error: "管理員權限不足。" });
      return res.status(201).json({ license: await access.createLicense({ days: req.body?.days, label: req.body?.label, createdBy: adminId }) });
    } catch (error) { return next(error); }
  });
}

module.exports = { registerAtgXRoutes };
