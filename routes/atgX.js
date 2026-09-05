const path = require("path");
const express = require("express");
const lineSdk = require("@line/bot-sdk");
const web = require("../services/webChannel");
const { isAdminLineUserId } = require("../config/admin");
const access = require("../modules/atgX/access");
const analyzer = require("../modules/atgX/analyzer");
const electronicSource = require("../modules/electronic/source");

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

function registerAtgXLineWebhook(app) {
  const config = {
    channelAccessToken: process.env.ATGX_LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.ATGX_LINE_CHANNEL_SECRET,
  };
  if (!config.channelAccessToken || !config.channelSecret) {
    app.post("/webhook/atg-x", (_req, res) => res.status(503).json({ error: "ATG X LINE 尚未設定。" }));
    return;
  }
  const client = new lineSdk.Client(config);
  app.post("/webhook/atg-x", lineSdk.middleware(config), async (req, res) => {
    res.sendStatus(200);
    for (const event of req.body.events || []) {
      if (event.type !== "message" || event.message?.type !== "text" || !event.replyToken) continue;
      const text = String(event.message.text || "").trim();
      const userId = String(event.source?.userId || "");
      const isAdmin = configuredLineAdmins().includes(userId);
      let replyText = "ATG AI 預測X輔助程式\n\n輸入「網站」開啟序號登入頁。";
      if (/^(網站|登入|開始|首頁)$/i.test(text)) {
        const base = String(process.env.PUBLIC_BASE_URL || "https://blackdomain-ai-v3-production.up.railway.app").replace(/\/$/, "");
        replyText = `ATG AI 預測X輔助程式\n${base}/atg-x/\n\n請使用管理員提供的序號啟用。`;
      } else if (text === "我的ID") {
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
        await client.replyMessage(event.replyToken, { type: "text", text: replyText.slice(0, 5000) });
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
      return res.json({ games: electronicSource.GAME_NAMES.map(analyzer.gameStatus) });
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
