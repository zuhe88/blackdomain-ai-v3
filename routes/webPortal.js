const path = require("path");
const express = require("express");
const web = require("../services/webChannel");
const vip = require("../modules/vip");
const baccarat = require("../modules/baccarat");
const electronic = require("../modules/electronic");
const electronicAvailability = require("../modules/electronic/availability");
const featureAudit = require("../modules/electronic/featureAudit");
const mobileAccountLogin = require("../services/mobileAccountLogin");
const { isAdminLineUserId } = require("../config/admin");
const { getSystemHealth } = require("../services/systemHealth");
const accessExpiryTimers = new Map();
const accessRevokedUsers = new Set();
const MAX_TIMER_DELAY_MS = 2_147_000_000;

function effectiveAccessExpiry(access) {
  if (!access?.allowed || access.isAdmin || access.globalAccess) return null;
  const timestamp = Date.parse(access.user?.expiresAt || "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

function cancelAccessExpiry(userId) {
  const timer = accessExpiryTimers.get(userId);
  if (timer) clearTimeout(timer);
  accessExpiryTimers.delete(userId);
}

async function clearExpiredUserSessions(userId) {
  if (accessRevokedUsers.has(userId)) return;
  accessRevokedUsers.add(userId);
  const { clearAllUserSessions } = require("./webhook");
  await clearAllUserSessions(userId);
}

function scheduleAccessExpiry(userId, expiresAt) {
  cancelAccessExpiry(userId);
  if (!Number.isFinite(expiresAt)) return;
  const enforce = async () => {
    accessExpiryTimers.delete(userId);
    const remaining = expiresAt - Date.now();
    if (remaining > 0) {
      const timer = setTimeout(enforce, Math.min(remaining, MAX_TIMER_DELAY_MS));
      timer.unref();
      accessExpiryTimers.set(userId, timer);
      return;
    }
    try {
      const access = await vip.checkVipAccess(userId);
      if (access.allowed) {
        accessRevokedUsers.delete(userId);
        scheduleAccessExpiry(userId, effectiveAccessExpiry(access));
        return;
      }
      await clearExpiredUserSessions(userId);
    } catch (error) {
      console.error("[Web] Access expiry enforcement failed:", error.message);
    }
  };
  const timer = setTimeout(enforce, Math.min(Math.max(0, expiresAt - Date.now()), MAX_TIMER_DELAY_MS));
  timer.unref();
  accessExpiryTimers.set(userId, timer);
}

function cookies(req) {
  return Object.fromEntries(String(req.get("cookie") || "").split(";").map((v) => v.trim().split("=")).filter((v) => v.length === 2));
}
function user(req) { return web.authenticate(cookies(req).blackdomain_web); }
function isExactFeatureRecord(record) {
  return record?.featureTrigger === "purchased" || record?.featureTrigger === "natural";
}

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

function mobileLoginPage() {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#07080c"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="黑域AI"><link rel="manifest" href="/portal/manifest.webmanifest"><link rel="icon" type="image/png" sizes="192x192" href="/portal/icons/icon-192.png"><link rel="apple-touch-icon" sizes="180x180" href="/portal/icons/apple-touch-icon.png"><title>黑域AI｜會員登入</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:calc(24px + env(safe-area-inset-top)) 24px calc(24px + env(safe-area-inset-bottom));background:radial-gradient(circle at 50% 0,#252112 0,#090b10 38%,#050609 100%);color:#f7f4eb;font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif}.card{width:min(100%,430px);padding:30px 24px;border:1px solid #756029;border-radius:24px;background:linear-gradient(145deg,rgba(28,27,22,.97),rgba(8,10,14,.98));box-shadow:0 28px 80px #000}.brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}.brand img{width:50px;height:50px;border-radius:50%;object-fit:contain}.brand small{display:block;color:#c2a966;letter-spacing:.14em;font-size:10px}.brand b{display:block;margin-top:3px;font-size:18px}h1{font-size:25px;margin:0 0 8px}.copy{margin:0 0 22px;color:#aaa99f;line-height:1.65;font-size:14px}.step{display:flex;gap:8px;margin-bottom:18px}.step i{height:3px;flex:1;border-radius:3px;background:#2c3038}.step i.on{background:#dcb85b;box-shadow:0 0 12px #bd8c20}label{display:block;margin:14px 0 7px;color:#d8d5cb;font-size:13px;font-weight:700}input{width:100%;height:50px;padding:0 14px;border:1px solid #404650;border-radius:13px;background:#090c11;color:white;font-size:16px;outline:none}input:focus{border-color:#dcb85b;box-shadow:0 0 0 3px rgba(220,184,91,.12)}button{width:100%;height:50px;margin-top:14px;border:0;border-radius:13px;background:linear-gradient(135deg,#efcd73,#b98a2e);color:#171207;font-size:15px;font-weight:900}.message{min-height:20px;margin:12px 0 0;color:#b7bdc8;font-size:12px;line-height:1.55}.message.bad{color:#ff9292}.secondary{background:#252a33;color:#e7e2d7}.install-button{margin-top:10px;border:1px solid #555044;background:#15171c;color:#e8ddbd}.install-guide{margin-top:12px;padding:13px 14px;border:1px solid #3d4149;border-radius:13px;background:#0b0e13;color:#c9c8c2;font-size:12px;line-height:1.65}.install-guide b{display:block;margin-bottom:3px;color:#efcd73}.hidden{display:none}.legal{display:block;margin-top:18px;color:#747b87;font-size:10px;text-align:center;line-height:1.5}</style></head><body><main class="card"><div class="brand"><img src="/brand/blackdomain-ai-logo.png" alt="黑域AI"><div><small>BLACKDOMAIN SECURE ACCESS</small><b>黑域 AI 手機助手</b></div></div><div class="step"><i class="on"></i><i id="step2"></i></div>
<section id="accountStep"><h1>輸入 3A 帳號</h1><p class="copy">系統會直接核對原有會員資料與有效期限，只有已開通帳號能繼續。</p><form id="accountForm"><label for="account">3A 帳號</label><input id="account" name="account" autocomplete="username" inputmode="text" pattern="[A-Za-z0-9]+" maxlength="64" required><button type="submit">驗證會員資格</button></form><p id="accountMessage" class="message"></p></section>
<section id="codeStep" class="hidden"><h1>輸入驗證碼</h1><p class="copy">6 位數驗證碼已傳送到會員原綁定的 LINE，有效時間 5 分鐘。</p><form id="codeForm"><label for="code">LINE 驗證碼</label><input id="code" name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required><button type="submit">登入黑域 AI</button></form><p id="codeMessage" class="message"></p><button id="back" class="secondary" type="button">返回修改帳號</button></section><button id="installButton" class="install-button" type="button">安裝到手機主畫面</button><div id="installGuide" class="install-guide hidden"><b>iPhone 安裝方式</b>請使用 Safari 開啟本頁，點「分享」→「加入主畫面」→「加入」。<br><b>Android 安裝方式</b>請使用 Chrome 開啟本頁，點右上角選單→「安裝應用程式」。</div><small class="legal">登入只會核對既有權限，不會變更會員資料或有效期限。</small></main>
<script>
let challengeId="",installPrompt=null;
const embedded=new URLSearchParams(location.search).get("embed")==="1";
const accountStep=document.getElementById("accountStep"),codeStep=document.getElementById("codeStep"),step2=document.getElementById("step2"),accountMessage=document.getElementById("accountMessage"),codeMessage=document.getElementById("codeMessage");
function busy(form,value){form.querySelector("button[type=submit]").disabled=value}
function within(promise,timeout=1600){return Promise.race([promise,new Promise(resolve=>setTimeout(()=>resolve(false),timeout))])}
async function requestEmbeddedStorage(){if(!embedded||typeof document.requestStorageAccess!=="function")return false;try{const hasAccess=typeof document.hasStorageAccess==="function"?await within(document.hasStorageAccess()):false;if(hasAccess)return true;return (await within(document.requestStorageAccess()))!==false}catch{return false}}
async function postJson(url,body){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);try{return await fetch(url,{method:"POST",headers:{"content-type":"application/json"},credentials:"include",signal:controller.signal,body:JSON.stringify(body)})}catch(error){if(error.name==="AbortError")throw new Error("連線逾時，請確認網路後再試一次。");throw error}finally{clearTimeout(timer)}}
addEventListener("beforeinstallprompt",event=>{event.preventDefault();installPrompt=event});
document.getElementById("installButton").addEventListener("click",async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;return}document.getElementById("installGuide").classList.toggle("hidden")});
document.getElementById("accountForm").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget;accountMessage.className="message";accountMessage.textContent="正在核對會員資料…";busy(form,true);try{await requestEmbeddedStorage();const response=await postJson("/api/mobile/login/account",{account:document.getElementById("account").value,embed:embedded});const value=await response.json();if(!response.ok)throw new Error(value.error||value.message||"目前無法驗證");location.replace(embedded?"/portal/?embed=1":"/portal/")}catch(error){accountMessage.className="message bad";accountMessage.textContent=error.message||"目前無法驗證，請稍後再試。"}finally{busy(form,false)}});
document.getElementById("codeForm").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget;codeMessage.className="message";codeMessage.textContent="正在登入…";busy(form,true);try{await requestEmbeddedStorage();const response=await postJson("/api/mobile/login/verify",{challengeId,code:document.getElementById("code").value,embed:embedded});const value=await response.json();if(!response.ok)throw new Error(value.error||"登入失敗");location.replace(embedded?"/portal/?embed=1":"/portal/")}catch(error){codeMessage.className="message bad";codeMessage.textContent=error.message||"登入失敗，請稍後再試。";busy(form,false)}});
document.getElementById("back").addEventListener("click",()=>{challengeId="";codeStep.classList.add("hidden");accountStep.classList.remove("hidden");step2.classList.remove("on");codeMessage.textContent=""});
if("serviceWorker" in navigator)addEventListener("load",()=>navigator.serviceWorker.register("/portal/sw.js",{scope:"/portal/",updateViaCache:"none"}).catch(()=>{}));
</script></body></html>`;
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
  app.post("/portal/login", async (req, res, next) => {
    let token;
    try {
      token = await web.redeem(req.query.code);
    } catch (error) {
      return next(error);
    }
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-robots-tag", "noindex, nofollow, noarchive");
    if (!token) return res.status(401).type("html").send(invalidLoginPage());
    res.setHeader("set-cookie", `blackdomain_web=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
    return res.redirect(302, "/portal/");
  });
  app.get("/portal/mobile-login", (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-robots-tag", "noindex, nofollow, noarchive");
    const embedSuffix = req.query.embed === "1" ? "?embed=1" : "";
    return user(req) ? res.redirect(302, `/portal/${embedSuffix}`) : res.type("html").send(mobileLoginPage());
  });
  app.post("/api/mobile/login/request", express.json({ limit: "4kb" }), async (req, res, next) => {
    try {
      const result = await mobileAccountLogin.requestCode(req.body?.account, req.ip || req.socket?.remoteAddress);
      if (result.retryAfter) res.setHeader("retry-after", String(result.retryAfter));
      return res.status(result.status || 200).json(result);
    } catch (error) { return next(error); }
  });
  app.post("/api/mobile/login/account", express.json({ limit: "4kb" }), async (req, res, next) => {
    try {
      const result = await mobileAccountLogin.authenticateAccount(req.body?.account, req.ip || req.socket?.remoteAddress);
      if (result.retryAfter) res.setHeader("retry-after", String(result.retryAfter));
      if (!result.ok) return res.status(result.status || 403).json(result);
      const token = web.issueSession(result.userId);
      const sameSite = req.body?.embed === true ? "None" : "Lax";
      res.setHeader("set-cookie", `blackdomain_web=${token}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=2592000`);
      return res.json({ ok: true });
    } catch (error) { return next(error); }
  });
  app.post("/api/mobile/login/verify", express.json({ limit: "4kb" }), async (req, res, next) => {
    try {
      const result = await mobileAccountLogin.verifyCode(req.body?.challengeId, req.body?.code);
      if (!result.ok) return res.status(result.status || 401).json(result);
      const token = await web.redeem(web.issue(result.userId));
      if (!token) return res.status(503).json({ ok: false, error: "登入服務暫時無法使用。" });
      const sameSite = req.body?.embed === true ? "None" : "Lax";
      res.setHeader("set-cookie", `blackdomain_web=${token}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=2592000`);
      return res.json({ ok: true });
    } catch (error) { return next(error); }
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
    const expiresAt = effectiveAccessExpiry(access);
    const accessExpired = Boolean(
      !access.allowed
      && access.user?.expiresAt
      && Date.parse(access.user.expiresAt) <= Date.now(),
    );
    if (access.allowed) {
      accessRevokedUsers.delete(userId);
      scheduleAccessExpiry(userId, expiresAt);
    } else {
      cancelAccessExpiry(userId);
      await clearExpiredUserSessions(userId);
    }
    return res.json({
      authenticated: true,
      isAdmin: isAdminLineUserId(userId),
      accessAllowed: Boolean(access.allowed),
      accessExpired,
      accessExpiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      allElectronicGamesEnabled: electronicAvailability.areAllElectronicGamesEnabled(),
      activeBaccaratSession: baccarat.hasActiveBaccaratSession(userId),
      activeBaccaratPlatform: baccarat.activeBaccaratPlatform(userId),
      messages: web.history(userId),
    });
    } catch (error) { return next(error); }
  });
  app.get("/api/web/admin/monitor", async (req, res, next) => {
    try {
    const userId = user(req);
    if (!userId) return res.status(401).json({ error: "請重新登入。" });
    if (!isAdminLineUserId(userId)) return res.status(403).json({ error: "沒有管理員權限。" });
    res.setHeader("cache-control", "no-store");
    const featureRecords = (await featureAudit.listFeatureNotifications(100))
      .filter(isExactFeatureRecord)
      .slice(0, 30);
    const recordsWithTracking = await Promise.all(featureRecords.map(async (record) => ({
      ...record,
      stillTracking: await electronic.isStillTracking(
        record.member.lineUserId,
        record.gameName,
        record.roomNumber,
      ),
    })));
    const adminWatch = await electronic.getActiveWatchForUser(userId);
    return res.json({ ...getSystemHealth(), featureRecords: recordsWithTracking, adminWatch });
    } catch (error) { return next(error); }
  });
  app.post("/api/web/admin/electronic-watch", express.json({ limit: "4kb" }), async (req, res, next) => {
    try {
      const userId = user(req);
      if (!userId) return res.status(401).json({ error: "請重新登入。" });
      if (!isAdminLineUserId(userId)) return res.status(403).json({ error: "沒有管理員權限。" });
      const result = electronic.startAdminRoomWatch(userId, req.body?.gameName, req.body?.roomNumber);
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  });
  app.get("/api/web/admin/electronic-room", async (req, res, next) => {
    try {
      const userId = user(req);
      if (!userId) return res.status(401).json({ error: "請重新登入。" });
      if (!isAdminLineUserId(userId)) return res.status(403).json({ error: "沒有管理員權限。" });
      const gameName = String(req.query.gameName || "");
      const roomNumber = Number(req.query.roomNumber);
      const allRecords = await featureAudit.listFeatureNotifications(100);
      const matching = allRecords.filter((record) => (
        isExactFeatureRecord(record)
        && record.gameName === gameName && Number(record.roomNumber) === roomNumber
      ));
      const records = await Promise.all(matching.map(async (record) => ({
        ...record,
        stillTracking: await electronic.isStillTracking(
          record.member.lineUserId,
          record.gameName,
          record.roomNumber,
        ),
      })));
      return res.json({ ok: true, gameName, roomNumber, records });
    } catch (error) {
      return next(error);
    }
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
        portalBuild: "20260907.05",
      });
    } catch (error) { return next(error); }
  });
}
module.exports = { registerWebPortalRoutes };
