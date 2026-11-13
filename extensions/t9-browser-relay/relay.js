window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== location.origin
    || event.data?.type !== "BLACKDOMAIN_T9_ROADS") return;
  chrome.runtime.sendMessage({ tables: event.data.tables }).catch(() => {});
});
