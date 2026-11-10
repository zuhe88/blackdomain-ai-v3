require("dotenv").config();

const { chromium } = require("playwright-core");
const { createTableFeed } = require("../modules/baccarat/abProtocol");

const browserEndpoint = process.env.AB_BROWSER_CDP_URL;
const ingestUrl = process.env.AB_INGEST_URL;
const relayKey = process.env.AB_RELAY_KEY;
const gameOrigin = "https://www.ab88.games:8888";
const socketEndpoint = "wss://sfs2c.51shengce.com:8843/websocket";

async function run() {
  if (!browserEndpoint || !ingestUrl || !relayKey) {
    throw new Error("Set AB_BROWSER_CDP_URL, AB_INGEST_URL and AB_RELAY_KEY.");
  }
  const browser = await chromium.connectOverCDP(browserEndpoint);
  const pending = new Map();
  let socket;
  let sending = false;

  function watch(page) {
    page.on("websocket", (connection) => {
      if (connection.url() !== socketEndpoint || !page.url().startsWith(gameOrigin + "/")) return;
      socket = connection;
      pending.clear();
      const ingest = createTableFeed();
      connection.on("framereceived", ({ payload }) => {
        if (socket !== connection) return;
        let message;
        try {
          message = JSON.parse(payload);
        } catch {
          return;
        }
        for (const table of ingest(message)) pending.set(table.tableId, table);
      });
      connection.on("close", () => {
        if (socket !== connection) return;
        socket = null;
        pending.clear();
        console.log("ALLBET connection closed. Open or sign in to the game again.");
      });
    });
  }
  for (const context of browser.contexts()) {
    context.on("page", watch);
    context.pages().forEach(watch);
  }

  const timer = setInterval(async () => {
    if (sending || !socket || !pending.size) return;
    const batch = [...pending.values()];
    pending.clear();
    sending = true;
    try {
      const response = await fetch(ingestUrl, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: { "content-type": "application/json", "x-ab-relay-key": relayKey },
        body: JSON.stringify({ tables: batch }),
      });
      if (!response.ok) console.error(`AB ingest returned HTTP ${response.status}`);
    } catch {
      console.error("AB ingest request failed.");
    } finally {
      sending = false;
    }
    // New provider updates supersede a failed batch. Never refresh a stale snapshot.
  }, 1000);
  browser.on("disconnected", () => clearInterval(timer));
  console.log("AB relay ready. Open or refresh ALLBET in the connected browser.");
}

run().catch(() => {
  console.error("AB relay could not start. Verify its configuration and Chrome debugging connection.");
  process.exitCode = 1;
});
