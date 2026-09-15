(function (root) {
  "use strict";
  function recoveryDecision(record, probe, now) {
    if (!probe.tabExists || !probe.allowedPage) return "tab_unavailable";
    if (probe.requiresLogin) return "login_required";
    if (!probe.localAvailable) return "local_unavailable";
    const age = now - (record.lastCapturedAt || record.firstSeenAt);
    if (record.lastCapturedAt && age < 15000) return "receiving";
    const recentReloads = (record.reloadTimes || []).filter((time) => now - time < 3600000);
    if (recentReloads.length >= 2) return "recovery_limit";
    if (age < 90000 || !record.lastPollAt) return "request_tables";
    if (now - record.lastPollAt < 30000) return "waiting_after_request";
    if (recentReloads.length && now - recentReloads[recentReloads.length - 1] < 180000) return "reload_cooldown";
    if (!probe.hidden) return "foreground_waiting";
    return "reload_background";
  }
  root.MT_RECOVERY_DECISION = recoveryDecision;
  if (typeof module !== "undefined") module.exports = { recoveryDecision };
})(typeof globalThis === "undefined" ? this : globalThis);
