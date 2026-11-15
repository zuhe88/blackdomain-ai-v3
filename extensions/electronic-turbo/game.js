"use strict";

(() => {
  const seth2RateAttribute = "data-blackdomain-seth2-rate";
  const seth2ReadyAttribute = "data-blackdomain-seth2-ready";

  const root = document.documentElement;
  const speed = { set: value => root.setAttribute(seth2RateAttribute, String(value)) };
  const panel = globalThis.createTurboPanel(document.body, { speed });
  let authorized = false;
  let expiryTimer;
  let requestPending = false;
  panel.setState("正在檢查黑域會員資格…");

  async function refreshMember() {
    if (requestPending) return;
    requestPending = true;
    const result = await chrome.runtime.sendMessage({ type: "turbo-membership" }).catch(() => null);
    requestPending = false;
    clearTimeout(expiryTimer);
    authorized = result?.status === "ready" && (result.expiresAt === null || result.expiresAt > Date.now());
    if (!authorized) {
      panel.clearHistory();
      const message = {
        login: "請先在黑域會員入口登入",
        denied: "目前會員資格無法使用",
      }[result?.status];
      panel.setState(message || "會員驗證暫時無法連線");
      return;
    }
    if (result.expiresAt !== null) {
      expiryTimer = setTimeout(() => {
        authorized = false;
        panel.clearHistory();
        panel.setState("會員使用期限已到");
      }, Math.min(result.expiresAt - Date.now(), 2147483647));
    }
    renderAvailability();
  }

  let presentationAvailable;
  function renderAvailability() {
    const available = root.hasAttribute(seth2ReadyAttribute);
    if (available === presentationAvailable) return;
    presentationAvailable = available;
    panel.setState(available ? "戰神賽特 2 · 得分看板動畫就緒" : "等待得分看板動畫就緒", available);
  }

  window.addEventListener("BLACKDOMAIN_ELECTRONIC_RELAY", event => {
    const record = event.detail;
    if (!authorized || record?.type !== "spin" || record.gameName !== "戰神賽特2" || record.featureTrigger !== "natural") return;
    panel.record(record.spinId, record.totalWinnings);
  });
  window.addEventListener("pagehide", () => {
    panel.setState("遊戲已離開");
    presentationAvailable = undefined;
  });
  window.addEventListener("pageshow", refreshMember);
  window.setInterval(refreshMember, 60000);
  window.setInterval(() => {
    if (!authorized) {
      presentationAvailable = undefined;
      return;
    }
    renderAvailability();
  }, 250);
  refreshMember();
})();
