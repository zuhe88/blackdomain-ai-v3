"use strict";

const portal = "https://blackdomain-ai-v3-production.up.railway.app";
let membershipRequest;

async function checkMember() {
  try {
    const response = await fetch(`${portal}/api/web/me`, {
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { status: response.status === 401 ? "login" : "unavailable" };
    const member = await response.json();
    if (!member.authenticated) return { status: "login" };
    const expiresAt = Date.parse(member.accessExpiresAt);
    return member.accessAllowed && (!Number.isFinite(expiresAt) || expiresAt > Date.now())
      ? { status: "ready", expiresAt: Number.isFinite(expiresAt) ? expiresAt : null }
      : { status: "denied" };
  } catch {
    return { status: "unavailable" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "turbo-membership" || sender.id !== chrome.runtime.id) return;
  membershipRequest ??= checkMember().finally(() => { membershipRequest = null; });
  membershipRequest.then(sendResponse);
  return true;
});
