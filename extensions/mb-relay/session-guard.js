(function () {
  "use strict";

  if (window.__blackdomain3aSessionGuardInstalled) return;
  window.__blackdomain3aSessionGuardInstalled = true;

  const KEEPALIVE_INTERVAL_MS = 2 * 60 * 1000;
  const LOGIN_RETRY_COOLDOWN_MS = 15 * 1000;
  const LOGOUT_PATTERN = /(?:^|\/)(?:login|logout|signin)(?:\/|$)/i;
  let lastState = "";
  let lastLoginAttemptAt = 0;

  function pageLooksLoggedOut(url = window.location.href) {
    try {
      const parsed = new URL(url, window.location.href);
      if (LOGOUT_PATTERN.test(parsed.pathname)) return true;
    } catch {
      return false;
    }
    const text = String(document.body?.innerText || "").replace(/\s+/g, " ");
    return /(?:請重新登入|重新登入|登入已逾時|連線逾時|session\s*(?:expired|timeout))/i.test(text);
  }

  function report(state, reason = "") {
    if (state === lastState && state !== "expired") return;
    lastState = state;
    chrome.runtime.sendMessage({
      type: "BLACKDOMAIN_3A_SESSION_STATE",
      state,
      reason,
      url: window.location.origin,
    }).catch(() => {});
  }

  function visible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0
      && style.visibility !== "hidden"
      && style.display !== "none";
  }

  function attemptAutomaticLogin() {
    const now = Date.now();
    if (now - lastLoginAttemptAt < LOGIN_RETRY_COOLDOWN_MS) return false;
    const passwordInput = document.querySelector('input[type="password"]');
    const candidates = [...document.querySelectorAll(
      'button, input[type="submit"], a, [role="button"]',
    )].filter(visible);
    let action = null;
    if (passwordInput) {
      const form = passwordInput.closest("form");
      action = form?.querySelector('button[type="submit"], input[type="submit"], button') || null;
      if (!action) {
        action = candidates.find((element) => /^(?:登入|登錄|login|sign\s*in)$/i.test(
          String(element.innerText || element.value || "").trim(),
        )) || null;
      }
    } else {
      action = candidates.find((element) => /請重新登入|重新登入/i.test(
        String(element.innerText || element.value || "").trim(),
      )) || null;
    }
    if (!action || !visible(action) || action.disabled) return false;
    lastLoginAttemptAt = now;
    window.setTimeout(() => action.click(), 800);
    return true;
  }

  async function checkSession() {
    if (pageLooksLoggedOut()) {
      report("expired", "3a-page-logged-out");
      attemptAutomaticLogin();
      return;
    }
    try {
      const response = await fetch(`${window.location.origin}/`, {
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
      });
      if (response.status === 401 || response.status === 403 || pageLooksLoggedOut(response.url)) {
        report("expired", "3a-keepalive-rejected");
        return;
      }
      report("active");
    } catch {
      // A temporary network failure is not proof that the account was logged out.
    }
  }

  document.addEventListener("DOMContentLoaded", checkSession, { once: true });
  const loginPollStartedAt = Date.now();
  const loginPoll = window.setInterval(() => {
    if (Date.now() - loginPollStartedAt > 60 * 1000 || !pageLooksLoggedOut()) {
      window.clearInterval(loginPoll);
      return;
    }
    attemptAutomaticLogin();
  }, 2000);
  window.setInterval(checkSession, KEEPALIVE_INTERVAL_MS);
}());
