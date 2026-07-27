const crypto = require("crypto");
const express = require("express");
const dgSource = require("../modules/baccarat/dgSource");
const dgLive = require("../modules/baccarat/dgLive");

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
  const dgEndpoint = `${baseUrl}/api/dg/ingest`;
  const mtEndpoint = `${baseUrl}/api/mt/ingest`;
  const host = new URL(baseUrl).host;
  return `// ==UserScript==
// @name         BLACKDOMAIN DG MT 百家樂即時轉送器
// @namespace    blackdomain-ai
// @version      1.3.0
// @description  僅轉送 DG、MT 百家樂桌況與牌路更新，不讀取下注或帳戶資料
// @match        *://*/ddnewpc/*
// @match        *://gsa.ofalive99.net/*
// @match        *://gsa.mtx55.net/*
// @match        *://gsa.mtx66.net/*
// @match        *://gsa.mtx77.net/*
// @match        *://gsa.mtx88.net/*
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

  const DG_ENDPOINT = ${JSON.stringify(dgEndpoint)};
  const MT_ENDPOINT = ${JSON.stringify(mtEndpoint)};
  const NativeWebSocket = unsafeWindow.WebSocket;
  const ALLOWED_COMMANDS = new Set([2, 27, 207, 1002, 1004, 1005]);
  const DG_SOCKET_HOST = /(taxyss\\.com|kindlestone\\.com|ywjxi\\.com)$/i;
  const MT_SOCKET_HOST = /^a1\\.(ofalive99|mtx55|mtx66|mtx77|mtx88)\\.net$/i;
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

  function post(endpoint, payload) {
    const key = ensureRelayKey();
    if (!key) return;
    GM_xmlhttpRequest({
      method: "POST",
      url: endpoint,
      headers: {
        "content-type": "application/json",
        "x-dg-relay-key": key,
      },
      data: JSON.stringify(payload),
      onload(response) {
        if (response.status === 401) {
          relayKey = "";
          GM_setValue("blackdomainDgRelayKey", "");
          console.warn("[BLACKDOMAIN DG] 密鑰錯誤，重新整理後請再次輸入。");
        }
      },
    });
  }

  async function handleDg(raw) {
    let buffer = raw;
    if (raw instanceof Blob) buffer = await raw.arrayBuffer();
    if (!(buffer instanceof ArrayBuffer)) return;
    const bytes = new Uint8Array(buffer);
    if (!ALLOWED_COMMANDS.has(commandOf(bytes))) return;
    if (bytes.length <= 512 * 1024) post(DG_ENDPOINT, { frame: base64(bytes) });
  }

  function handleMt(raw) {
    if (typeof raw !== "string" || raw.length > 512 * 1024) return;
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const action = typeof message.action === "string" ? message.action : message.action?.name;
    if (action !== "/api/v1/gametype/*/game/*/room/*/tables") return;
    const tables = Object.values(message.msg?.tables || {})
      .filter((table) => table?.table_type === "BAC" || table?.table_type === "BAS")
      .slice(0, 50)
      .map((table) => ({
        table_id: table.table_id,
        table_name: table.table_name,
        table_type: table.table_type,
        game_sn: table.game_sn,
        game_state: table.game_state,
        shoe: table.shoe,
        round: table.round,
        trend: {
          bead_plate2: table.trend?.bead_plate2,
          total_round_banker: table.trend?.total_round_banker,
          total_round_player: table.trend?.total_round_player,
          total_round_tie: table.trend?.total_round_tie,
        },
      }));
    if (tables.length) post(MT_ENDPOINT, { tables });
  }

  unsafeWindow.WebSocket = new Proxy(NativeWebSocket, {
    construct(Target, args) {
      const socket = Reflect.construct(Target, args);
      try {
        const url = new URL(String(args[0] || ""));
        if (DG_SOCKET_HOST.test(url.hostname)) {
          socket.addEventListener("message", (event) => handleDg(event.data));
        } else if (MT_SOCKET_HOST.test(url.hostname)) {
          socket.addEventListener("message", (event) => handleMt(event.data));
        }
      } catch {
        // Ignore unrelated WebSocket connections.
      }
      return socket;
    },
  });

  setTimeout(ensureRelayKey, 1500);
  console.info("[BLACKDOMAIN] DG、MT 百家樂即時轉送器已啟動");
}());
`;
}

function registerDgRelayRoutes(app) {
  app.get("/dg-relay.user.js", (req, res) => {
    res.type("application/javascript; charset=utf-8");
    res.send(userscript(publicBaseUrl(req)));
  });

  app.get("/api/dg/status", (_req, res) => {
    res.json({
      ...dgSource.getSnapshot(),
      live: dgLive.getStatus(),
    });
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
