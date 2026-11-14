chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.origin !== "https://g.t9gaming.fun"
    || !sender.url?.startsWith("https://g.t9gaming.fun/VideoBaccarat/index.html?")
    || !Array.isArray(message?.tables) || message.tables.length > 100) return;

  const body = JSON.stringify({ tables: message.tables });
  if (body.length > 90000) return;
  fetch("http://127.0.0.1:19489/tables", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(5000),
  }).then(response => respond({ ok: response.status === 204 }), () => respond({ ok: false }));
  return true;
});
