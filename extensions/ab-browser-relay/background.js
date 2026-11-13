chrome.runtime.onMessage.addListener((data, sender) => {
  if (sender.origin !== "https://www.ab88.games:8888" || typeof data !== "string" || data.length >= 350000) return;
  fetch("http://127.0.0.1:19487/packet", {
    method:"POST",
    headers:{"content-type":"application/json", "x-blackdomain-relay":"ab"},
    body:data,
  }).catch(() => {});
});
