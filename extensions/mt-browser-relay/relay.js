(() => {
  "use strict";
  const TYPE = "BLACKDOMAIN_MT_BROWSER_TABLES_V1";
  let pending = null;
  let sending = false;
  let lastSuccess = 0;
  let detail = "等待 MT 桌況；安裝後請重新整理 MT 一次";
  let requiresLogin = false;
  const badge = document.createElement("div");
  badge.style.cssText = "position:fixed;bottom:8px;left:8px;z-index:2147483647;padding:8px 12px;border-radius:8px;background:#20242d;color:#fff;font:13px/1.5 system-ui;pointer-events:none;max-width:440px";
  function render() {
    if (!badge.isConnected && document.documentElement) document.documentElement.appendChild(badge);
    const age = lastSuccess ? Math.floor((Date.now() - lastSuccess) / 1000) : null;
    const fresh = age !== null && age < 15;
    badge.textContent = fresh ? `BLACKDOMAIN MT：已成功轉送（${age} 秒前）`
      : `BLACKDOMAIN MT：${lastSuccess ? "資料未持續更新｜" : ""}${detail}`;
    badge.style.border = `1px solid ${fresh ? "#47d18b" : "#e7b45b"}`;
  }
  async function flush() {
    if (sending || !pending) return;
    sending = true;
    const packet = pending;
    pending = null;
    try {
      const response = await chrome.runtime.sendMessage({ type: TYPE, tables: packet.tables, diagnostics: packet.diagnostics });
      if (response?.ok) {
        lastSuccess = Date.now();
        detail = "等待新的 MT 桌況";
      } else {
        detail = response?.error || "轉送尚未成功";
        lastSuccess = 0;
      }
    } catch {
      detail = "擴充功能已更新，請重新整理 MT";
      lastSuccess = 0;
    } finally {
      sending = false;
      render();
      if (pending) void flush();
    }
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type === "BLACKDOMAIN_MT_SOCKET_STATE") {
      requiresLogin = event.data.requiresLogin === true;
      if (requiresLogin) { detail = "MT 登入已失效，請由平台重新進入 MT"; lastSuccess = 0; render(); }
      return;
    }
    if (event.data?.type !== TYPE || !Array.isArray(event.data.tables)
      || !event.data.tables.length || event.data.tables.length > 50) return;
    requiresLogin = false;
    pending = { tables: event.data.tables, diagnostics: event.data.diagnostics };
    void flush();
  });
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === "BLACKDOMAIN_MT_HEALTH") {
      reply({ visibility: document.visibilityState, requiresLogin });
      window.postMessage({ type: "BLACKDOMAIN_MT_REQUEST_TABLES" }, location.origin);
    } else if (message?.type === "BLACKDOMAIN_MT_RECOVERY_NOTICE") {
      detail = String(message.text || "");
      render();
      reply({ ok: true });
    }
  });
  chrome.runtime.sendMessage({ type: "BLACKDOMAIN_MT_REGISTER" }).catch(() => {});
  window.setInterval(render, 2000);
  render();
})();
