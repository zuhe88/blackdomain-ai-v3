const path = require("path");
const express = require("express");
const web = require("../services/webChannel");

function cookies(req) {
  return Object.fromEntries(String(req.get("cookie") || "").split(";").map((v) => v.trim().split("=")).filter((v) => v.length === 2));
}
function user(req) { return web.authenticate(cookies(req).blackdomain_web); }

function registerWebPortalRoutes(app) {
  app.use("/portal", express.static(path.join(__dirname, "..", "public", "portal")));
  app.get("/portal/login", (req, res) => {
    const token = web.redeem(req.query.code);
    if (!token) return res.redirect(302, "/portal/?error=invalid_code");
    res.setHeader("set-cookie", `blackdomain_web=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
    return res.redirect(302, "/portal/");
  });
  app.get("/api/web/me", (req, res) => {
    const userId = user(req);
    res.json({ authenticated: Boolean(userId), messages: userId ? web.history(userId) : [] });
  });
  app.get("/api/web/events", (req, res) => {
    const userId = user(req); if (!userId) return res.status(401).end();
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.write("event: ready\ndata: {}\n\n");
    const unsubscribe = web.subscribe(userId, res);
    req.on("close", unsubscribe);
  });
  app.post("/api/web/command", express.json({ limit: "16kb" }), async (req, res, next) => {
    try {
      const userId = user(req); if (!userId) return res.status(401).json({ error: "請重新登入" });
      const text = String(req.body?.text || "").trim().slice(0, 300);
      if (!text) return res.status(400).json({ error: "請輸入指令" });
      const replyToken = `web:${require("crypto").randomUUID()}`;
      const pending = web.waitReply(replyToken);
      const { handleEvent } = require("./webhook");
      try {
        await handleEvent({ type: "message", replyToken, source: { userId }, message: { type: "text", text } });
      } catch (error) {
        web.cancelReply(replyToken);
        throw error;
      }
      return res.json({ messages: await pending });
    } catch (error) { return next(error); }
  });
}
module.exports = { registerWebPortalRoutes };
