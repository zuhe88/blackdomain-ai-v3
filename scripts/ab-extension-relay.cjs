const http = require("node:http");
require("dotenv").config();
const { createTableFeed } = require("../modules/baccarat/abProtocol");
const { AB_BACCARAT_VARIANTS } = require("../modules/baccarat/constants");

const rooms = new Set(Object.values(AB_BACCARAT_VARIANTS).flat());
const ingest = createTableFeed();
const pending = new Map();
let sending = false;
let lastPacketAt = null;
let lastPublishedAt = null;
let publishFailed = false;
if (!process.env.AB_INGEST_URL || !process.env.AB_RELAY_KEY) throw Error("Missing ALLBET relay configuration");

http.createServer(async (req, res) => {
  if (req.headers.host !== "127.0.0.1:19487"
    || !/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin || "")
    || req.headers["x-blackdomain-relay"] !== "ab") {
    res.writeHead(403).end();
    return;
  }
  if (req.method === "POST" && req.url === "/status") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ lastPacketAt, lastPublishedAt, publishFailed }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/packet") {
    res.writeHead(404).end();
    return;
  }
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length >= 350000) {
        res.writeHead(413).end();
        return;
      }
    }
    const tables = ingest(JSON.parse(body));
    lastPacketAt = Date.now();
    for (const table of tables) {
      if (rooms.has(table.room)) pending.set(table.tableId, table);
    }
    res.writeHead(204).end();
  } catch {
    res.writeHead(400).end();
  }
}).listen(19487, "127.0.0.1");

setInterval(async () => {
  if (sending || !pending.size) return;
  sending = true;
  const tables = [...pending.values()];
  try {
    const response = await fetch(process.env.AB_INGEST_URL, {
      method:"POST", redirect:"error", signal:AbortSignal.timeout(5000),
      headers:{"content-type":"application/json","x-ab-relay-key":process.env.AB_RELAY_KEY},
      body:JSON.stringify({tables}),
    });
    if (!response.ok) throw Error("Ingest HTTP " + response.status);
    for (const table of tables) {
      if (pending.get(table.tableId) === table) pending.delete(table.tableId);
    }
    lastPublishedAt = Date.now();
    publishFailed = false;
    console.log("Published", tables.length, "table(s)");
  } catch (error) {
    publishFailed = true;
    console.error(error.message);
  } finally {
    sending = false;
  }
}, 1000);
