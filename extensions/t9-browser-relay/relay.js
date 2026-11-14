(() => {
  const badge = document.createElement("div");
  badge.style.cssText = "position:fixed;bottom:8px;left:8px;z-index:2147483647;padding:8px 12px;border-radius:8px;background:#20242d;color:#fff;font:13px/1.5 system-ui;pointer-events:none;max-width:calc(100% - 16px)";
  let lastSuccess = null;
  let detail = "等待 T9 桌況";
  let sending = false;

  function render() {
    if (!badge.isConnected) document.documentElement?.append(badge);
    const age = lastSuccess === null ? null : Math.max(0, Math.floor((Date.now() - lastSuccess) / 1000));
    const fresh = age !== null && age < 15;
    badge.textContent = fresh ? `BLACKDOMAIN T9：已成功轉送（${age} 秒前）`
      : `BLACKDOMAIN T9：${age === null ? detail : "資料未持續更新"}`;
    badge.style.border = `1px solid ${fresh ? "#47d18b" : "#e7b45b"}`;
  }

  window.addEventListener("message", async event => {
    if (event.source !== window || event.origin !== location.origin
      || event.data?.type !== "BLACKDOMAIN_T9_ROADS" || sending) return;
    sending = true;
    try {
      const response = await chrome.runtime.sendMessage({ tables: event.data.tables });
      lastSuccess = response?.ok ? Date.now() : null;
      detail = "轉送未成功，等待重試";
    } catch {
      lastSuccess = null;
      detail = "請重新整理 T9";
    } finally {
      sending = false;
      render();
    }
  });

  render();
  setInterval(render, 1000);
})();
