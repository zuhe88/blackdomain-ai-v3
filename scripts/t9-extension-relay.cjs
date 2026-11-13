const http = require("node:http");
const crypto = require("node:crypto");
const { key } = require("../extensions/t9-browser-relay/manifest.json");
require("dotenv").config();

const port = 19489;
const extensionId = crypto.createHash("sha256").update(Buffer.from(key, "base64"))
  .digest("hex").slice(0, 32).replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
const origin = "chrome-extension://" + extensionId;
const destination = new URL(process.env.T9_INGEST_URL || "http://127.0.0.1:3000/api/t9/ingest");
const relayKey = process.env.T9_RELAY_KEY;
if (!relayKey) throw new Error("Set T9_RELAY_KEY before starting the relay.");
if (destination.protocol !== "https:" && destination.origin !== "http://127.0.0.1:3000") {
  throw new Error("The T9 ingest URL must use HTTPS or the local development server.");
}

let forwarding = false;
http.createServer(async (req, res) => {
  if (req.headers.host !== "127.0.0.1:" + port || req.url !== "/tables"
    || req.headers.origin !== origin) return res.writeHead(403).end();
  res.setHeader("Access-Control-Allow-Origin", origin);
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.writeHead(204).end();
  }
  if (req.method !== "POST") return res.writeHead(405).end();
  if (forwarding) return res.writeHead(429).end();

  forwarding = true;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 90000) return res.writeHead(413).end();
      chunks.push(chunk);
    }
    const response = await fetch(destination, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json", "x-t9-relay-key": relayKey },
      body: Buffer.concat(chunks),
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) console.error("T9 ingest returned HTTP", response.status);
    return res.writeHead(response.ok ? 204 : 502).end();
  } catch {
    return res.writeHead(502).end();
  } finally {
    forwarding = false;
  }
}).listen(port, "127.0.0.1", () => console.log("T9 relay ready on loopback."));
