window.addEventListener("message", (event) => {
  if (location.origin !== "https://www.ab88.games:8888" || event.origin !== location.origin
    || event.source !== window || event.data?.type !== "BLACKDOMAIN_AB_PACKET") return;
  chrome.runtime.sendMessage(event.data.data).catch(() => {});
});
