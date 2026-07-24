const crypto = require("crypto");
const express = require("express");
const mbSource = require("../modules/mb/source");

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function configuredRelayKey() {
  return String(process.env.MB_RELAY_KEY || process.env.ATG_RELAY_KEY || "").trim();
}

function relayAuthorized(req) {
  return secureEqual(configuredRelayKey(), req.get("x-mb-relay-key"));
}

function publicBaseUrl(req) {
  const forwarded = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  return `${forwarded || req.protocol || "https"}://${req.get("host")}`;
}

function userscript(baseUrl) {
  const endpoint = `${baseUrl}/api/mb/ingest`;
  const host = new URL(baseUrl).host;
  return `// ==UserScript==
// @name         BLACKDOMAIN MB 彈珠即時轉送器
// @namespace    blackdomain-ai
// @version      1.0.0
// @description  將 MB RACING 四賽道歷史與即時開獎同步至 BLACKDOMAIN AI
// @match        https://mbracing.cc/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      ${host}
// @updateURL    ${baseUrl}/mb-relay.user.js
// @downloadURL  ${baseUrl}/mb-relay.user.js
// ==/UserScript==

(function () {
  "use strict";

  const ENDPOINT = ${JSON.stringify(endpoint)};
  const NativeWebSocket = unsafeWindow.WebSocket;
  const nativeFetch = unsafeWindow.fetch.bind(unsafeWindow);
  const ALLOWED_EVENTS = new Set(["OPEN", "CLOSE", "RESULT_PUBLIC", "TABLE_STATE_CHANGED"]);
  const CACHE_KEY = "blackdomainMbRoadmaps";
  let relayKey = GM_getValue("blackdomainMbRelayKey", "");
  let cachedRoadmaps = GM_getValue(CACHE_KEY, {});
  let lastSocketEventAt = Date.now();

  function ensureRelayKey() {
    if (relayKey) return relayKey;
    const value = window.prompt("請輸入 BLACKDOMAIN MB_RELAY_KEY（可與 ATG_RELAY_KEY 相同）");
    if (!value) return "";
    relayKey = value.trim();
    GM_setValue("blackdomainMbRelayKey", relayKey);
    return relayKey;
  }

  function send(body, attempt = 0) {
    const key = ensureRelayKey();
    if (!key) return;
    GM_xmlhttpRequest({
      method: "POST",
      url: ENDPOINT,
      headers: {
        "content-type": "application/json",
        "x-mb-relay-key": key,
      },
      data: JSON.stringify(body),
      onload(response) {
        if (response.status >= 200 && response.status < 300) {
          console.info("[BLACKDOMAIN MB] 已同步", body.type, body.event || "");
          return;
        }
        if (response.status === 401) {
          relayKey = "";
          GM_setValue("blackdomainMbRelayKey", "");
          console.warn("[BLACKDOMAIN MB] 密鑰錯誤，重新整理後請再次輸入。");
          return;
        }
        retry(body, attempt);
      },
      onerror() {
        retry(body, attempt);
      },
    });
  }

  function retry(body, attempt) {
    if (attempt >= 5) {
      console.warn("[BLACKDOMAIN MB] 同步失敗", body.type);
      return;
    }
    setTimeout(() => send(body, attempt + 1), Math.min(30000, 1000 * (2 ** attempt)));
  }

  function rememberRoadmaps(items) {
    items.forEach((item) => {
      if (!item?.game_name || !Array.isArray(item.roadmap)) return;
      cachedRoadmaps[item.game_name] = item;
    });
    GM_setValue(CACHE_KEY, cachedRoadmaps);
  }

  function handleGraphql(json) {
    const items = json?.data?.marbleRoadmapBatch?.items;
    if (!Array.isArray(items) || !items.length) return;
    rememberRoadmaps(items);
    send({ type: "roadmap", items });
  }

  unsafeWindow.fetch = async function blackdomainMbFetch(...args) {
    const response = await nativeFetch(...args);
    try {
      const clone = response.clone();
      clone.json().then(handleGraphql).catch(() => {});
    } catch {
      // Keep the game's original fetch response untouched.
    }
    return response;
  };

  function handleSocketMessage(raw) {
    if (typeof raw !== "string") return;
    let packet;
    try {
      packet = JSON.parse(raw);
    } catch {
      return;
    }
    if (!ALLOWED_EVENTS.has(packet?.event)) return;
    lastSocketEventAt = Date.now();
    const data = packet.data || {};
    send({
      type: "socket",
      event: packet.event,
      data: {
        dcs_id: data.dcs_id,
        game_name: data.game_name,
        draw_num: data.draw_num,
        next_draw_num: data.next_draw_num,
        current: data.current,
        state: data.state,
        state_string: data.state_string,
        result: data.result,
        result_display: data.result_display,
        result_time: data.result_time,
        sended_at: data.sended_at,
        public_result_at: data.public_result_at,
      },
    });
  }

  unsafeWindow.WebSocket = new Proxy(NativeWebSocket, {
    construct(Target, args) {
      const socket = Reflect.construct(Target, args);
      socket.addEventListener("message", (event) => handleSocketMessage(event.data));
      return socket;
    },
  });

  setTimeout(() => {
    const items = Object.values(cachedRoadmaps || {});
    if (items.length) send({ type: "roadmap", items });
    ensureRelayKey();
  }, 1500);

  setInterval(() => {
    const items = Object.values(cachedRoadmaps || {});
    if (items.length) send({ type: "roadmap", items });
    if (Date.now() - lastSocketEventAt > 180000) {
      console.warn("[BLACKDOMAIN MB] 三分鐘未收到即時事件，請確認遊戲連線。");
    }
  }, 60000);

  console.info("[BLACKDOMAIN MB] 四賽道即時轉送器已啟動");
}());
`;
}

function registerMbRelayRoutes(app) {
  app.get("/mb-relay.user.js", (req, res) => {
    res.type("application/javascript; charset=utf-8");
    res.send(userscript(publicBaseUrl(req)));
  });

  app.get("/api/mb/status", (_req, res) => {
    const snapshot = mbSource.getSnapshot();
    res.json({
      source: snapshot.source,
      tracks: snapshot.tracks.map((track) => ({
        gameName: track.gameName,
        dcsId: track.dcsId,
        name: track.name,
        state: track.state,
        targetPeriodId: track.targetPeriodId,
        latestPeriodId: track.latestPeriodId,
        historyCount: track.historyCount,
        updatedAt: track.updatedAt,
      })),
    });
  });

  app.post("/api/mb/ingest", express.json({ limit: "250kb" }), (req, res) => {
    if (!configuredRelayKey()) {
      return res.status(503).json({ ok: false, error: "MB relay is not configured." });
    }
    if (!relayAuthorized(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized." });
    }
    const body = req.body || {};
    const accepted = body.type === "roadmap"
      ? mbSource.ingestRoadmap(body)
      : body.type === "socket" && mbSource.ingestSocketEvent(body);
    if (!accepted) return res.status(400).json({ ok: false, error: "Invalid MB payload." });
    return res.status(202).json({ ok: true });
  });
}

module.exports = {
  registerMbRelayRoutes,
  userscript,
};
