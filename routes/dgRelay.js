const crypto = require("crypto");
const express = require("express");
const dgSource = require("../modules/baccarat/dgSource");

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function configuredRelayKey() {
  return String(process.env.DG_RELAY_KEY || process.env.ATG_RELAY_KEY || "").trim();
}

function publicBaseUrl(req) {
  const forwarded = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  return `${forwarded || req.protocol || "https"}://${req.get("host")}`;
}

function userscript(baseUrl) {
  const endpoint = `${baseUrl}/api/dg/ingest`;
  const host = new URL(baseUrl).host;
  return `// ==UserScript==
// @name         BLACKDOMAIN DG 百家樂即時轉送器
// @namespace    blackdomain-ai
// @version      1.1.0
// @description  僅轉送 DG 百家樂桌況與牌路更新，不讀取下注或帳戶資料
// @match        *://*/ddnewpc/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      ${host}
// @updateURL    ${baseUrl}/dg-relay.user.js
// @downloadURL  ${baseUrl}/dg-relay.user.js
// ==/UserScript==

(function () {
  "use strict";

  const ENDPOINT = ${JSON.stringify(endpoint)};
  const NativeWebSocket = unsafeWindow.WebSocket;
  const ALLOWED_COMMANDS = new Set([207, 1002, 1004, 1005]);
  const DG_SOCKET_HOST = /(taxyss\\.com|kindlestone\\.com|ywjxi\\.com)$/i;
  let relayKey = GM_getValue("blackdomainDgRelayKey", "");

  function askRelayKey() {
    const value = window.prompt("請輸入 BLACKDOMAIN DG_RELAY_KEY");
    if (!value) return relayKey;
    relayKey = value.trim();
    GM_setValue("blackdomainDgRelayKey", relayKey);
    return relayKey;
  }

  function ensureRelayKey() {
    return relayKey || askRelayKey();
  }

  GM_registerMenuCommand("設定 DG_RELAY_KEY", askRelayKey);

  function readVarint(bytes, start) {
    let value = 0;
    let multiplier = 1;
    let offset = start;
    while (offset < bytes.length && multiplier <= 2 ** 49) {
      const byte = bytes[offset++];
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) return { value, offset };
      multiplier *= 128;
    }
    return null;
  }

  function commandOf(bytes) {
    let offset = 0;
    while (offset < bytes.length) {
      const key = readVarint(bytes, offset);
      if (!key) return null;
      offset = key.offset;
      const field = Math.floor(key.value / 8);
      const wire = key.value % 8;
      if (field === 1 && wire === 0) return readVarint(bytes, offset)?.value ?? null;
      if (wire === 0) {
        const skipped = readVarint(bytes, offset);
        if (!skipped) return null;
        offset = skipped.offset;
      } else if (wire === 1) {
        offset += 8;
      } else if (wire === 2) {
        const length = readVarint(bytes, offset);
        if (!length) return null;
        offset = length.offset + length.value;
      } else if (wire === 5) {
        offset += 4;
      } else {
        return null;
      }
    }
    return null;
  }

  function base64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  function send(bytes) {
    const key = ensureRelayKey();
    if (!key || bytes.length > 512 * 1024) return;
    GM_xmlhttpRequest({
      method: "POST",
      url: ENDPOINT,
      headers: {
        "content-type": "application/json",
        "x-dg-relay-key": key,
      },
      data: JSON.stringify({ frame: base64(bytes) }),
      onload(response) {
        if (response.status === 401) {
          relayKey = "";
          GM_setValue("blackdomainDgRelayKey", "");
          console.warn("[BLACKDOMAIN DG] 密鑰錯誤，重新整理後請再次輸入。");
        }
      },
    });
  }

  async function handle(raw) {
    let buffer = raw;
    if (raw instanceof Blob) buffer = await raw.arrayBuffer();
    if (!(buffer instanceof ArrayBuffer)) return;
    const bytes = new Uint8Array(buffer);
    if (!ALLOWED_COMMANDS.has(commandOf(bytes))) return;
    send(bytes);
  }

  unsafeWindow.WebSocket = new Proxy(NativeWebSocket, {
    construct(Target, args) {
      const socket = Reflect.construct(Target, args);
      try {
        const url = new URL(String(args[0] || ""));
        if (DG_SOCKET_HOST.test(url.hostname)) {
          socket.addEventListener("message", (event) => handle(event.data));
        }
      } catch {
        // Ignore non-DG WebSocket connections.
      }
      return socket;
    },
  });

  setTimeout(ensureRelayKey, 1500);
  console.info("[BLACKDOMAIN DG] 百家樂即時轉送器已啟動");
}());
`;
}

function registerDgRelayRoutes(app) {
  app.get("/dg-relay.user.js", (req, res) => {
    res.type("application/javascript; charset=utf-8");
    res.send(userscript(publicBaseUrl(req)));
  });

  app.get("/api/dg/status", (_req, res) => {
    res.json(dgSource.getSnapshot());
  });

  app.post("/api/dg/ingest", express.json({ limit: "750kb" }), (req, res) => {
    if (!configuredRelayKey()) {
      return res.status(503).json({ ok: false, error: "DG relay is not configured." });
    }
    if (!secureEqual(configuredRelayKey(), req.get("x-dg-relay-key"))) {
      return res.status(401).json({ ok: false, error: "Unauthorized." });
    }
    if (!dgSource.ingestFrame(req.body?.frame)) {
      return res.status(400).json({ ok: false, error: "Invalid DG payload." });
    }
    return res.status(202).json({ ok: true });
  });
}

module.exports = {
  registerDgRelayRoutes,
  userscript,
};
