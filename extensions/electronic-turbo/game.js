"use strict";

(() => {
  const seth2RateAttribute = "data-blackdomain-seth2-rate";
  const seth2ReadyAttribute = "data-blackdomain-seth2-ready";

  const root = document.documentElement;
  if (!root.hasAttribute("data-blackdomain-supported-atg")) return;
  const speed = { set(value) { root.removeAttribute("data-blackdomain-seth2-applied"); root.setAttribute(seth2RateAttribute, String(value)); } };
  let authorized = false;
  const panel = globalThis.createTurboPanel(document.body, {
    speed,
    supportsFreeGameHistory: true,
    bankroll: {
      status: () => authorized ? root.getAttribute("data-blackdomain-bankroll-status") : null,
      clear() { root.removeAttribute("data-blackdomain-bankroll-settings"); },
      save(config) {
        root.setAttribute("data-blackdomain-bankroll-settings", JSON.stringify(config));
      },
    },
  });
  let expiryTimer;
  function syncRoom() {
    panel.setRoom(authorized ? root.getAttribute("data-blackdomain-room") : null);
  }
  new MutationObserver(syncRoom).observe(root, { attributes: true, attributeFilter: ["data-blackdomain-room"] });
  let requestPending = false;
  panel.setState("正在檢查黑域會員資格…");

  async function refreshMember() {
    if (requestPending) return;
    requestPending = true;
    const result = await chrome.runtime.sendMessage({ type: "turbo-membership" }).catch(() => null);
    requestPending = false;
    clearTimeout(expiryTimer);
    authorized = result?.status === "ready" && (result.expiresAt === null || result.expiresAt > Date.now());
    syncRoom();
    if (!authorized) {
      root.removeAttribute("data-blackdomain-bankroll-settings");
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
        syncRoom();
        panel.clearHistory();
        panel.setState("會員使用期限已到");
      }, Math.min(result.expiresAt - Date.now(), 2147483647));
    }
    renderAvailability();
  }

  let presentationAvailable;
  let reportedRate;
  function renderAvailability() {
    const available = root.getAttribute(seth2ReadyAttribute);
    const applied = root.getAttribute("data-blackdomain-seth2-applied");
    if (available === presentationAvailable && applied === reportedRate) return;
    reportedRate = applied;
    presentationAvailable = available;
    const labels = { effects: "加速已就緒", reels: applied ? `加速已套用 ${applied}×` : "加速已就緒", scoreboard: "加速已就緒" };
    panel.setState(labels[available] || "加速準備中", Boolean(labels[available]));
  }

  window.addEventListener("BLACKDOMAIN_TURBO_FREE_GAME_PREVIEW", event => {
    if (authorized) panel.preview(event.detail?.total, event.detail?.complete !== false);
  });
  window.addEventListener("BLACKDOMAIN_TURBO_FREE_GAME_SUMMARY", event => {
    if (!authorized) return;
    panel.record(event.detail?.id, event.detail?.total);
  });
  window.addEventListener("pagehide", () => {
    authorized = false;
    syncRoom();
    panel.setState("遊戲已離開");
    presentationAvailable = undefined;
  });
  window.addEventListener("pageshow", refreshMember);
  window.setInterval(refreshMember, 60000);
  window.setInterval(() => {
    if (!authorized) {
      root.removeAttribute("data-blackdomain-bankroll-settings");
      presentationAvailable = undefined;
      return;
    }
    renderAvailability();
  }, 250);
  refreshMember();
})();
