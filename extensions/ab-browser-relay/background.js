const relayUrl = "http://127.0.0.1:19487";
const relayHeaders = { "x-blackdomain-relay": "ab" };

chrome.runtime.onMessage.addListener((data, sender, sendResponse) => {
  if (sender.origin !== "https://www.ab88.games:8888") return;

  if (data?.type === "BLACKDOMAIN_AB_STATUS") {
    fetch(relayUrl + "/status", {
      method: "POST",
      headers: relayHeaders,
      signal: AbortSignal.timeout(4000),
    }).then(response => {
      if (!response.ok) throw new Error("Relay status unavailable");
      return response.json();
    }).then(status => sendResponse({ ok: true, status }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (typeof data !== "string" || data.length >= 350000) return;
  fetch(relayUrl + "/packet", {
    method: "POST",
    headers: { ...relayHeaders, "content-type": "application/json" },
    body: data,
    signal: AbortSignal.timeout(4000),
  }).catch(() => {});
});
