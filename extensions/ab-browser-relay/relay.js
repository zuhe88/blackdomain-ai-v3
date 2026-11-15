(() => {
  if (location.origin !== "https://www.ab88.games:8888") return;

  const badge = document.createElement("div");
  badge.style.cssText = "position:fixed;bottom:8px;left:8px;z-index:2147483647;padding:8px 12px;border-radius:8px;background:#121a25;color:#edf7ff;font:13px/1.5 system-ui;pointer-events:none;max-width:calc(100% - 16px)";
  let polling = false;

  function render(label, fresh = false) {
    badge.textContent = `BLACKDOMAIN 歐博：${label}`;
    badge.style.border = `1px solid ${fresh ? "#47d18b" : "#e7b45b"}`;
    if (!badge.isConnected) document.documentElement?.append(badge);
  }

  window.addEventListener("message", event => {
    if (event.origin !== location.origin || event.source !== window
      || event.data?.type !== "BLACKDOMAIN_AB_PACKET") return;
    chrome.runtime.sendMessage(event.data.data).catch(() => {});
  });

  async function refresh() {
    if (polling) return;
    polling = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: "BLACKDOMAIN_AB_STATUS" });
      if (!response?.ok) return render("本機中繼未連上");
      const { lastPublishedAt, lastPacketAt, publishFailed } = response.status;
      if (publishFailed) return render("線上轉送失敗，等待重試");
      if (Number.isFinite(lastPublishedAt)) {
        const age = Math.max(0, Math.floor((Date.now() - lastPublishedAt) / 1000));
        return age < 45 ? render(`已成功轉送（${age} 秒前）`, true) : render(`資料逾時（${age} 秒前）`);
      }
      render(lastPacketAt ? "收到遊戲資料，等候新桌況" : "尚未收到歐博桌況");
    } catch {
      render("請重新整理歐博");
    } finally {
      polling = false;
    }
  }

  render("確認本機中繼中");
  void refresh();
  setInterval(refresh, 3000);
})();
