"use strict";

const ENDPOINT = "https://blackdomain-ai-v3-production.up.railway.app/api/mb/ingest";
const ELECTRONIC_ENDPOINT = "https://blackdomain-ai-v3-production.up.railway.app/api/electronic/ingest";
const ELECTRONIC_WATCH_ENDPOINT = "https://blackdomain-ai-v3-production.up.railway.app/api/electronic/watch-rooms";
const MT_ENDPOINT = "https://blackdomain-ai-v3-production.up.railway.app/api/mt/ingest";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const isMb = message?.type === "BLACKDOMAIN_MB_FORWARD";
  const isElectronic = message?.type === "BLACKDOMAIN_ELECTRONIC_FORWARD";
  const isElectronicWatches = message?.type === "BLACKDOMAIN_ELECTRONIC_WATCHES";
  const isMt = message?.type === "BLACKDOMAIN_MT_FORWARD";
  if (!isMb && !isElectronic && !isElectronicWatches && !isMt) return false;
  const key = String(message.key || "").trim();
  const body = message.body;
  if (isElectronicWatches) {
    if (!key) {
      sendResponse({ ok: false, status: 400 });
      return false;
    }
    fetch(ELECTRONIC_WATCH_ENDPOINT, {
      headers: { "x-electronic-relay-key": key },
    })
      .then(async (response) => {
        const data = response.ok ? await response.json() : null;
        sendResponse({ ok: response.ok, status: response.status, data });
      })
      .catch(() => sendResponse({ ok: false, status: 0 }));
    return true;
  }
  const allowedTypes = isMb
    ? ["roadmap", "socket"]
    : isMt ? ["tables"] : ["tables", "updates", "detail", "spin"];
  if (!key || !body || !allowedTypes.includes(body.type)) {
    sendResponse({ ok: false, status: 400 });
    return false;
  }

  const endpoint = isMb ? ENDPOINT : isMt ? MT_ENDPOINT : ELECTRONIC_ENDPOINT;
  fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [isMb ? "x-mb-relay-key" : "x-electronic-relay-key"]: key,
    },
    body: JSON.stringify(body),
  })
    .then((response) => {
      if (isElectronic) chrome.storage.local.set({ blackdomainElectronicLastStatus: { status: response.status, at: Date.now() } });
      if (isMt) chrome.storage.local.set({ blackdomainMtLastStatus: { status: response.status, at: Date.now() } });
      sendResponse({ ok: response.ok, status: response.status });
    })
    .catch(() => {
      if (isElectronic) chrome.storage.local.set({ blackdomainElectronicLastStatus: { status: 0, at: Date.now() } });
      if (isMt) chrome.storage.local.set({ blackdomainMtLastStatus: { status: 0, at: Date.now() } });
      sendResponse({ ok: false, status: 0 });
    });
  return true;
});
