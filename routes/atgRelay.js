const crypto = require("crypto");
const express = require("express");
const atgSource = require("../modules/atg/source");

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function relayAuthorized(req) {
  const configured = String(process.env.ATG_RELAY_KEY || "").trim();
  const supplied = String(req.get("x-atg-relay-key") || "").trim();
  return secureEqual(configured, supplied);
}

function publicBaseUrl(req) {
  const forwarded = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const protocol = forwarded || req.protocol || "https";
  return `${protocol}://${req.get("host")}`;
}

function userscript(baseUrl) {
  const endpoint = `${baseUrl}/api/atg/ingest`;
  const host = new URL(baseUrl).host;
  return `// ==UserScript==
// @name         BLACKDOMAIN ATG 即時轉送
// @namespace    blackdomain-ai
// @version      1.2.0
// @description  將 ATG 開獎期號與十名結果安全轉送至 BLACKDOMAIN AI
// @match        https://play.godeebxp.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      ${host}
// @updateURL    ${baseUrl}/atg-relay.user.js
// @downloadURL  ${baseUrl}/atg-relay.user.js
// ==/UserScript==

(function () {
  "use strict";

  const ENDPOINT = ${JSON.stringify(endpoint)};
  const NativeWebSocket = unsafeWindow.WebSocket;
  let pendingDraw = null;
  let relayKey = GM_getValue("blackdomainAtgRelayKey", "");
  let lastSocketEventAt = Date.now();

  function ensureRelayKey() {
    if (relayKey) return relayKey;
    const value = window.prompt("請輸入 BLACKDOMAIN ATG_RELAY_KEY");
    if (!value) return "";
    relayKey = value.trim();
    GM_setValue("blackdomainAtgRelayKey", relayKey);
    return relayKey;
  }

  function send(body, attempt = 0) {
    const key = ensureRelayKey();
    if (!key) return;
    const retry = () => {
      if (attempt >= 5) {
        console.warn("[BLACKDOMAIN ATG] 重試失敗", body.type);
        return;
      }
      const delay = Math.min(30000, 1000 * (2 ** attempt));
      setTimeout(() => send(body, attempt + 1), delay);
    };
    GM_xmlhttpRequest({
      method: "POST",
      url: ENDPOINT,
      headers: {
        "content-type": "application/json",
        "x-atg-relay-key": key,
      },
      data: JSON.stringify(body),
      onload(response) {
        if (response.status >= 200 && response.status < 300) {
          console.info("[BLACKDOMAIN ATG] 已同步", body.type, body.periodId || body.targetPeriodId || "");
        } else if (response.status === 401) {
          relayKey = "";
          GM_setValue("blackdomainAtgRelayKey", "");
          console.warn("[BLACKDOMAIN ATG] 密鑰錯誤，下一次同步時會重新詢問");
        } else {
          console.warn("[BLACKDOMAIN ATG] 同步失敗", response.status);
          retry();
        }
      },
      onerror() {
        console.warn("[BLACKDOMAIN ATG] 無法連接後端");
        retry();
      },
    });
  }

  function handleSocketMessage(raw) {
    if (typeof raw !== "string") return;

    const ack = raw.match(/^43\\d+(\\[.*)$/s);
    if (ack) {
      lastSocketEventAt = Date.now();
      try {
        const response = JSON.parse(ack[1])[0] || {};
        const data = response.data || {};
        if (response.eventName === "result" && Array.isArray(data.result)) {
          send({
            type: "result",
            periodId: String(data.periodId || ""),
            nextPeriodId: String(data.nextPeriodId || ""),
            time: Number(data.resultTime || data.serverCurrentTime) || Date.now(),
            result: data.result,
          });
        }
      } catch {
        // Ignore malformed Socket.IO acknowledgements.
      }
      return;
    }

    if (!raw.startsWith("42")) return;
    lastSocketEventAt = Date.now();
    let packet;
    try {
      packet = JSON.parse(raw.slice(2));
    } catch {
      return;
    }

    const eventName = packet[0];
    const payload = packet[1] || {};
    if (eventName === "initial" && Array.isArray(payload.engine?.results)) {
      send({
        type: "snapshot",
        targetPeriodId: String(payload.engine.periodId || ""),
        results: payload.engine.results.map((item) => ({
          periodId: String(item.periodId),
          time: Number(item.time) || null,
          result: item.result,
        })),
      });
      return;
    }

    if (eventName === "drawNotify") {
      const data = payload.data || {};
      pendingDraw = {
        periodId: String(data.periodId || ""),
        nextPeriodId: String(data.nextPeriodId || ""),
        time: Number(data.serverCurrentTime) || Date.now(),
      };
      if (data.nextPeriodId) {
        send({
          type: "state",
          targetPeriodId: String(data.nextPeriodId),
          currentPeriodId: String(data.periodId || ""),
          time: Number(data.serverCurrentTime) || Date.now(),
        });
      }
      return;
    }

    if (eventName === "horseAnime" && pendingDraw && Array.isArray(payload.data?.result)) {
      send({
        type: "result",
        ...pendingDraw,
        result: payload.data.result,
      });
      pendingDraw = null;
    }
  }

  unsafeWindow.WebSocket = new Proxy(NativeWebSocket, {
    construct(Target, args) {
      const socket = Reflect.construct(Target, args);
      socket.addEventListener("message", (event) => handleSocketMessage(event.data));
      return socket;
    },
  });

  setInterval(() => {
    if (Date.now() - lastSocketEventAt < 150000) return;
    const lastReloadAt = Number(GM_getValue("blackdomainAtgLastReloadAt", 0));
    if (Date.now() - lastReloadAt < 180000) return;
    GM_setValue("blackdomainAtgLastReloadAt", Date.now());
    console.warn("[BLACKDOMAIN ATG] 超過兩個週期未收到資料，正在自動重新連線");
    unsafeWindow.location.reload();
  }, 30000);

  setTimeout(ensureRelayKey, 1500);
  console.info("[BLACKDOMAIN ATG] 即時轉送器已啟動");
}());
`;
}

function registerAtgRelayRoutes(app) {
  app.get("/atg-relay.user.js", (req, res) => {
    res.type("application/javascript; charset=utf-8");
    res.send(userscript(publicBaseUrl(req)));
  });

  app.get("/api/atg/status", (req, res) => {
    const snapshot = atgSource.getSnapshot();
    res.json({
      source: snapshot.source,
      targetPeriodId: snapshot.targetPeriodId,
      latestPeriodId: snapshot.history[0]?.periodId || null,
      historyCount: snapshot.history.length,
      updatedAt: snapshot.updatedAt,
    });
  });

  app.post("/api/atg/ingest", express.json({ limit: "100kb" }), (req, res) => {
    if (!process.env.ATG_RELAY_KEY) {
      return res.status(503).json({ ok: false, error: "ATG relay is not configured." });
    }
    if (!relayAuthorized(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized." });
    }

    const body = req.body || {};
    const accepted = body.type === "snapshot"
      ? atgSource.ingestSnapshot(body)
      : body.type === "result"
        ? atgSource.ingestResult(body)
        : body.type === "state" && atgSource.ingestState(body);

    if (!accepted) return res.status(400).json({ ok: false, error: "Invalid ATG payload." });
    return res.status(202).json({ ok: true });
  });
}

module.exports = {
  registerAtgRelayRoutes,
  userscript,
};
