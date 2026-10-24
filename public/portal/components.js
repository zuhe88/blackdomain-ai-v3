/* Presentation only. Permissions and analysis decisions remain on the server. */
(function (root) {
  "use strict";
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const paths = {
    home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
    baccarat: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="m12 7 4 5-4 5-4-5Z"/>',
    atg: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 15v-3m5 3V8m5 7v-5"/>',
    lottery: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 8h1m6 0h1m-5 4h2m-5 4h1m6 0h1"/>',
    sports: '<path d="M8 3h8v7a4 4 0 0 1-8 0Z M12 14v6m-4 1h8M8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4"/>',
    vip: '<path d="m3 6 5 4 4-6 4 6 5-4-2 13H5Z"/>',
    settings: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  };
  function icon(name) { return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.atg}</svg>`; }
  function badge(label, state = "neutral") { return `<span class="ui-badge" data-tone="${escape(state)}"><i></i>${escape(label)}</span>`; }
  function date(value, time = true) {
    const timestamp = Date.parse(value || "");
    if (!Number.isFinite(timestamp)) return "暫無資料";
    return new Intl.DateTimeFormat("zh-TW", {timeZone:"Asia/Taipei", year:"numeric", month:"2-digit", day:"2-digit", ...(time ? {hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false} : {})}).format(new Date(timestamp));
  }
  function expiry(profile = {}) {
    if (profile.accessType === "admin") return "管理員權限";
    if (profile.accessType === "global") return "全線開放期間";
    if (profile.accessType === "permanent") return "永久有效";
    return date(profile.expiresAt, false);
  }
  function stat(label, value, detail, name) {
    return `<article class="ui-stat">${icon(name)}<span>${escape(label)}</span><strong>${escape(value)}</strong><small>${escape(detail)}</small></article>`;
  }
  function hero() {
    return `<section class="v4-hero"><div class="hero-copy"><p class="eyebrow"><span class="hero-sigil" aria-hidden="true"></span>數據分析工作台</p><h1>黑域AI</h1><h2>智慧數據分析系統</h2><p class="hero-description">整合多平台數據，<br class="hero-mobile-break">提供更直覺的智慧分析體驗。</p><div class="hero-controls"><a href="#homeFeatures" class="hero-enter">選擇分析功能 ${icon("arrow")}</a><button data-go="/portal/vip/status" class="hero-member">會員權限 ${icon("arrow")}</button></div><div class="hero-process"><span>資料同步</span><i aria-hidden="true"></i><span>狀態辨識</span><i aria-hidden="true"></i><span>分析呈現</span></div></div><div class="core-visual" aria-hidden="true"><div class="core-grid"></div><svg class="core-circuits" viewBox="0 0 420 300" fill="none"><path d="M210 150H140L104 73H45M210 150h70l36-77h59M210 150h-70l-36 77H45M210 150h70l36 77h59"/><path class="core-circuit-light" d="M45 73h59l36 77h140l36 77h59"/><circle cx="45" cy="73" r="3"/><circle cx="375" cy="73" r="3"/><circle cx="45" cy="227" r="3"/><circle cx="375" cy="227" r="3"/></svg><span class="core-ring ring-outer"></span><span class="core-ring ring-inner"></span><span class="core-ring ring-track"></span><div class="core-brand"><img src="/brand/blackdomain-ai-logo.png" alt="" width="112" height="112"></div><span class="core-node node-baccarat">${icon("baccarat")}百家樂</span><span class="core-node node-atg">${icon("atg")}電子遊戲</span><span class="core-node node-lottery">${icon("lottery")}彩票</span><span class="core-node node-sports">${icon("sports")}體育</span><span class="core-caption">多平台分析架構</span></div></section>`;
  }
  function member(profile = {}, allowed, expired) {
    const label = expired ? "會員權限已到期" : allowed ? "會員權限有效" : "尚未開通使用權限";
    return `<article class="ui-member"><header><div><p class="eyebrow">會員資訊</p><h2>你的使用權限</h2></div>${badge(label, expired ? "warning" : allowed ? "success" : "neutral")}</header><dl><div><dt>綁定帳號</dt><dd>${escape(profile.account || "暫無資料")}</dd></div><div><dt>有效期限</dt><dd>${escape(expiry(profile))}</dd></div><div><dt>已開通功能</dt><dd>${escape(Array.isArray(profile.features) && profile.features.length ? profile.features.join("、") : "尚未開通")}</dd></div></dl><button class="ui-text-button" data-go="/portal/vip/status">查看會員權限 ${icon("arrow")}</button></article>`;
  }
  function feature(key, title, description, items, allowed) {
    const active = items.filter(item => !item.disabled);
    const state = !active.length ? "暫停開放" : allowed ? "可使用" : "需開通權限";
    const artworkItems = items.filter(item => item.image).slice(0,3);
    // With two covers, keep the first available service in the foreground.
    if (artworkItems.length === 2) artworkItems.reverse();
    const artwork = artworkItems.length ? `<div class="feature-game-stack" data-covers="${artworkItems.length}" aria-hidden="true">${artworkItems.map(item=>`<img src="${escape(item.image)}" alt="" width="96" height="112" loading="lazy"${item.disabled?' class="cover-paused"':''}>`).join("")}</div>` : `<div class="feature-emblem" aria-hidden="true">${icon(key)}<span></span></div>`;
    return `<article class="ui-feature feature-${escape(key)}${artworkItems.length?' has-artwork':''}" data-feature="${escape(key)}"><div class="feature-surface" aria-hidden="true"></div><div class="ui-feature-top"><div class="feature-category-label"><span class="ui-feature-icon">${icon(key)}</span><strong>${escape(({atg:"電子遊戲",baccarat:"百家樂",lottery:"彩票",sports:"體育"})[key] || title)}</strong></div>${badge(state, allowed && active.length ? "success" : "neutral")}</div>${artwork}<div class="feature-copy"><p class="feature-kicker">${escape(({atg:"房況數據",baccarat:"牌路分析",lottery:"號碼資訊",sports:"賽事情報"})[key] || "數據分析")}</p><h3>${escape(title)}</h3><p>${escape(description)}</p></div><div class="ui-feature-tags">${items.map(item => `<span>${escape(item.fullName || item.name)}${item.disabled ? "・" + escape(item.disabledLabel || "暫停開放") : ""}</span>`).join("")}</div><button class="ui-feature-link" data-go="/portal/${escape(key)}">進入分析 ${icon("arrow")}</button></article>`;
  }
  // This is a source health summary, never an analysis or recommendation result.
  function sourceSummary(games, now = Date.now()) {
    const sources = Array.isArray(games) ? games : [];
    const valid = sources.filter(game => {
      const time = Date.parse(game.updatedAt || "");
      return Number.isFinite(time) && time <= now;
    });
    const latest = valid.map(game => game.updatedAt).sort((a,b) => Date.parse(b)-Date.parse(a))[0] || null;
    const fresh = valid.filter(game => now-Date.parse(game.updatedAt) <= 120000 && Number(game.freshDetailCount) > 0 && game.ready === true);
    return {latest, count:fresh.length, total:sources.length, label:!valid.length ? "暫無資料" : fresh.length === sources.length && sources.length ? "資料已更新" : "資料未齊備", tone:fresh.length === sources.length && sources.length ? "success" : "warning"};
  }
  root.PortalUI = Object.freeze({escape,icon,badge,date,expiry,stat,member,feature,hero,sourceSummary});
})(typeof window !== "undefined" ? window : globalThis);
