const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright-core");
const { recoveryDecision } = require("../extensions/mt-browser-relay/watchdog");
const { MT_ORIGIN, launchUrl, createForwarder } = require("./lib/mt-headless");

function savedToken() {
  if (process.env.MT_TOKEN) return process.env.MT_TOKEN;
  const configPath = process.env.MT_CONFIG_PATH || path.join(os.homedir(), "AppData", "Local", "BLACKDOMAIN", "mt-relay.json");
  if (process.platform !== "win32" || !fs.existsSync(configPath)) throw new Error("MT_LOGIN_REQUIRED");
  const env = { ...process.env, BLACKDOMAIN_MT_CONFIG_PATH: configPath };
  for (const key of Object.keys(env)) if (key.toLowerCase() === "psmodulepath") delete env[key];
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", [
    "$ErrorActionPreference = 'Stop'",
    "$value = Get-Content -Raw -LiteralPath $env:BLACKDOMAIN_MT_CONFIG_PATH | ConvertFrom-Json",
    "$secure = ConvertTo-SecureString -String $value.token",
    "$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
    "try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }",
  ].join("; ")], { env, encoding: "utf8", windowsHide: true, timeout: 10000 });
  if (result.status !== 0 || !result.stdout) throw new Error("MT_LOGIN_REQUIRED");
  return result.stdout.trim();
}

async function main({ browserType = chromium, tokenProvider = savedToken, signal, env = process.env } = {}) {
  const port = Number(env.MT_RELAY_PORT || 43128);
  const statusPort = Number(env.MT_HEADLESS_PORT || 43129);
  const base = `http://127.0.0.1:${port}`;
  const state = { mode: "headless", state: "starting", healthy: false, lastTablesAt: null, lastForwardAt: null, reloadCount: 0, accessDenied: null };
  let browser, launching, page, forwarder, timer, stopping = false, ticking = false, requiresLogin = false, blocked = false;
  const record = { firstSeenAt: Date.now(), lastCapturedAt: 0, lastPollAt: 0, reloadTimes: [] };
  const freshnessMs = 15000;
  const jsonFetch = async (url, options = {}) => {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("LOCAL_RELAY_UNAVAILABLE");
    return response.json();
  };
  // A separate local status endpoint also prevents accidentally launching two clients.
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/status") { res.writeHead(404); res.end(); return; }
    const now = Date.now();
    const fresh = (value) => now - Date.parse(value) >= 0 && now - Date.parse(value) < freshnessMs;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify({ ...state, healthy: state.healthy && fresh(state.lastTablesAt) && fresh(state.lastForwardAt), freshnessMs }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(statusPort, "127.0.0.1", resolve);
  });
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    await forwarder?.close();
    await launching?.catch(() => {});
    await browser?.close().catch(() => {});
    server.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    signal?.removeEventListener("abort", stop);
    finish();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) { await stop(); return; }
  function report(value) {
    if (state.state !== value) console.log(`[MT background] ${value}`);
    state.state = value;
  }
  try {
    const target = launchUrl(tokenProvider());
    const pairing = await jsonFetch(`${base}/browser-config`);
    if (pairing.endpoint !== `${base}/browser-ingest` || !/^[a-f0-9]{64}$/.test(pairing.bridgeKey)) throw new Error("LOCAL_RELAY_UNAVAILABLE");
    const post = (endpoint, payload) => jsonFetch(endpoint, {
      method: "POST", headers: { "content-type": "application/json", "x-blackdomain-bridge-key": pairing.bridgeKey }, body: JSON.stringify(payload),
    });
    forwarder = createForwarder({
      send: (packet) => post(pairing.endpoint, packet),
      onSuccess: (packet) => {
        state.lastTablesAt = packet.diagnostics.capturedAt;
        state.lastForwardAt = new Date().toISOString();
        state.healthy = !requiresLogin && !blocked;
        if (state.healthy) report("receiving");
      },
      onError: () => { state.healthy = false; report("local_unavailable"); },
    });
    const capture = fs.readFileSync(path.join(__dirname, "../extensions/mt-browser-relay/capture.js"), "utf8");
    const bridge = `(() => {
      if (location.origin !== ${JSON.stringify(MT_ORIGIN)} || window.top !== window) return;
      window.addEventListener('message', event => {
        if (event.source !== window || event.origin !== location.origin) return;
        if (event.data?.type === 'BLACKDOMAIN_MT_BROWSER_TABLES_V1' || event.data?.type === 'BLACKDOMAIN_MT_SOCKET_STATE') {
          window.mtCapture(event.data).catch(() => {});
        }
      });
    })();\nif (location.origin === ${JSON.stringify(MT_ORIGIN)} && window.top === window) {\n${capture}\n}`;
    async function openBrowser() {
      if (stopping) return;
      launching = browserType.launch({ channel: "chrome", headless: true, chromiumSandbox: true, timeout: 20000 });
      browser = await launching;
      if (stopping) return;
      const context = await browser.newContext({ locale: "zh-TW", acceptDownloads: false });
      await context.exposeBinding("mtCapture", (source, packet) => {
        if (stopping || source.page !== page || source.frame !== page.mainFrame() || new URL(source.frame.url()).origin !== MT_ORIGIN) return;
        if (packet?.type === "BLACKDOMAIN_MT_SOCKET_STATE") {
          requiresLogin = packet.requiresLogin === true;
          if (requiresLogin) { state.healthy = false; report("login_required"); }
          return;
        }
        if (packet?.type !== "BLACKDOMAIN_MT_BROWSER_TABLES_V1") return;
        record.lastCapturedAt = Date.now();
        record.lastPollAt = 0;
        return forwarder.enqueue(packet);
      });
      await context.addInitScript({ content: bridge });
      page = await context.newPage();
      page.setDefaultTimeout(5000);
      page.on("dialog", async (dialog) => { await dialog.dismiss().catch(() => {}); });
      page.on("response", (response) => {
        if (response.request().isNavigationRequest() && response.frame() === page.mainFrame() && [401, 403].includes(response.status())) {
          blocked = true; state.healthy = false; report("access_denied");
          state.accessDenied = { phase: "navigation", httpStatus: response.status(), server: response.headers().server === "cloudflare" ? "cloudflare" : "upstream" };
        }
      });
      page.on("websocket", (socket) => {
        const socketUrl = new URL(socket.url());
        if (socketUrl.protocol !== "wss:" || !/(^|\.)ofalive99\.net$/i.test(socketUrl.hostname) || socketUrl.pathname !== "/game/ws") return;
        socket.on("socketerror", (error) => {
          if (!/Unexpected response code: (401|403)/.test(String(error))) return;
          blocked = true; state.healthy = false; report("access_denied");
          state.accessDenied = { phase: "websocket", httpStatus: Number(String(error).match(/(401|403)/)[1]), server: "unknown" };
        });
      });
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => { report("navigation_failed"); });
    }
    console.log(`MT background status: http://127.0.0.1:${statusPort}/status`);
    await openBrowser();
    if (stopping) return;
    async function tick() {
      if (ticking || stopping) return;
      ticking = true;
      try {
        if (blocked) return;
        const localAvailable = await jsonFetch(`${base}/status`).then(() => true).catch(() => false);
        const now = Date.now();
        const closed = !browser?.isConnected() || page?.isClosed();
        const allowedPage = !closed && new URL(page.url()).origin === MT_ORIGIN;
        const decision = recoveryDecision(record, { tabExists: true, allowedPage: allowedPage || closed, hidden: true, localAvailable, requiresLogin }, now);
        record.reloadTimes = record.reloadTimes.filter((at) => now - at < 3600000);
        if (decision === "request_tables") {
          record.lastPollAt = now;
          if (allowedPage) {
            let requestTimer;
            await Promise.race([
              page.evaluate(() => window.postMessage({ type: "BLACKDOMAIN_MT_REQUEST_TABLES" }, location.origin)).catch(() => {}),
              new Promise((resolve) => { requestTimer = setTimeout(resolve, 5000); }),
            ]).finally(() => clearTimeout(requestTimer));
          }
        }
        if (decision === "reload_background") {
          record.reloadTimes.push(now);
          state.reloadCount = record.reloadTimes.length;
          if (browser?.isConnected() && !page.isClosed()) await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
          else { await browser?.close().catch(() => {}); await openBrowser(); }
        }
        if (decision !== "receiving") state.healthy = false;
        report(decision);
        await post(`${base}/browser-health`, { state: decision, reloadCount: record.reloadTimes.length }).catch(() => {});
      } finally { ticking = false; }
    }
    timer = setInterval(() => { void tick().catch(() => { state.healthy = false; report("recovery_failed"); }); }, 5000);
    await done;
  } catch (error) {
    // Browser exceptions may contain the login URL. Never log their raw text.
    const code = ["MT_LOGIN_REQUIRED", "LOCAL_RELAY_UNAVAILABLE"].includes(error.message) ? error.message : "BACKGROUND_START_FAILED";
    console.error(`[MT background] ${code}`);
    process.exitCode = 1;
    await stop();
  }
}

if (require.main === module) main().catch(() => { console.error("[MT background] ALREADY_RUNNING_OR_PORT_UNAVAILABLE"); process.exitCode = 1; });
module.exports = { main };
