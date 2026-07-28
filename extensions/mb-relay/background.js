"use strict";

const ENDPOINT = "https://blackdomain-ai-v3-production.up.railway.app/api/mb/ingest";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "BLACKDOMAIN_MB_FORWARD") return false;
  const key = String(message.key || "").trim();
  const body = message.body;
  if (!key || !body || !["roadmap", "socket"].includes(body.type)) {
    sendResponse({ ok: false, status: 400 });
    return false;
  }

  fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mb-relay-key": key,
    },
    body: JSON.stringify(body),
  })
    .then((response) => sendResponse({ ok: response.ok, status: response.status }))
    .catch(() => sendResponse({ ok: false, status: 0 }));
  return true;
});
