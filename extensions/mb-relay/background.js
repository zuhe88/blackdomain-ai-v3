"use strict";

const ENDPOINT = "https://blackdomain-ai-v3-production.up.railway.app/api/mb/ingest";
const ELECTRONIC_ENDPOINT = "https://blackdomain-ai-v3-production.up.railway.app/api/electronic/ingest";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const isMb = message?.type === "BLACKDOMAIN_MB_FORWARD";
  const isElectronic = message?.type === "BLACKDOMAIN_ELECTRONIC_FORWARD";
  if (!isMb && !isElectronic) return false;
  const key = String(message.key || "").trim();
  const body = message.body;
  const allowedTypes = isMb ? ["roadmap", "socket"] : ["tables", "detail", "spin"];
  if (!key || !body || !allowedTypes.includes(body.type)) {
    sendResponse({ ok: false, status: 400 });
    return false;
  }

  fetch(isMb ? ENDPOINT : ELECTRONIC_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [isMb ? "x-mb-relay-key" : "x-electronic-relay-key"]: key,
    },
    body: JSON.stringify(body),
  })
    .then((response) => sendResponse({ ok: response.ok, status: response.status }))
    .catch(() => sendResponse({ ok: false, status: 0 }));
  return true;
});
