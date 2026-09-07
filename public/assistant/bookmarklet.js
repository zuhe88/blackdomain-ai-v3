(() => {
  "use strict";
  const ID = "blackdomain-floating-assistant";
  const sourceUrl = new URL(document.currentScript?.src || location.href);
  const deviceId = sourceUrl.searchParams.get("device") || "";
  const PORTAL = `https://blackdomain-ai-v3-production.up.railway.app/portal/mobile-login?embed=1${deviceId ? `&device=${encodeURIComponent(deviceId)}` : ""}`;
  const LOGO = "https://blackdomain-ai-v3-production.up.railway.app/brand/blackdomain-ai-logo.png";
  const existing = document.getElementById(ID);
  if (existing) {
    existing.remove();
    return;
  }

  const host = document.createElement("div");
  host.id = ID;
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `<style>
    *{box-sizing:border-box}.fab{position:fixed;right:18px;top:34%;width:68px;height:68px;padding:0;border:1px solid rgba(255,66,86,.9);border-radius:50%;background:#090b10;box-shadow:0 8px 30px rgba(0,0,0,.55),0 0 22px rgba(255,35,61,.36);pointer-events:auto;touch-action:none;overflow:hidden}.fab img{width:100%;height:100%;object-fit:cover;pointer-events:none}.panel{position:fixed;inset:max(12px,env(safe-area-inset-top)) 10px max(12px,env(safe-area-inset-bottom));display:none;overflow:hidden;border:1px solid rgba(255,66,86,.62);border-radius:20px;background:#07080c;box-shadow:0 24px 80px rgba(0,0,0,.82);pointer-events:auto}.panel.open{display:block}.bar{height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 10px 0 16px;background:linear-gradient(90deg,#19080d,#0a0c12);color:#fff;font:700 14px system-ui,-apple-system,sans-serif}.bar small{margin-left:8px;color:#ff6878;letter-spacing:.12em}.close{width:34px;height:34px;border:0;border-radius:50%;background:#262831;color:#fff;font-size:23px}.panel iframe{display:block;width:100%;height:calc(100% - 48px);border:0;background:#07080c}
  </style><button class="fab" type="button" aria-label="開啟黑域 AI"><img src="${LOGO}" alt=""></button><section class="panel" aria-label="黑域 AI 助手"><header class="bar"><span>黑域 AI <small>ASSISTANT</small></span><button class="close" type="button" aria-label="關閉">×</button></header><iframe title="黑域 AI" allow="clipboard-write" referrerpolicy="strict-origin-when-cross-origin"></iframe></section>`;
  document.documentElement.appendChild(host);

  const fab = shadow.querySelector(".fab");
  const panel = shadow.querySelector(".panel");
  const frame = shadow.querySelector("iframe");
  let dragging = false;
  let moved = false;
  let dx = 0;
  let dy = 0;

  fab.addEventListener("pointerdown", (event) => {
    dragging = true;
    moved = false;
    const rect = fab.getBoundingClientRect();
    dx = event.clientX - rect.left;
    dy = event.clientY - rect.top;
    fab.setPointerCapture(event.pointerId);
  });
  fab.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    moved = true;
    const left = Math.max(8, Math.min(innerWidth - fab.offsetWidth - 8, event.clientX - dx));
    const top = Math.max(8, Math.min(innerHeight - fab.offsetHeight - 8, event.clientY - dy));
    fab.style.left = `${left}px`;
    fab.style.top = `${top}px`;
    fab.style.right = "auto";
  });
  fab.addEventListener("pointerup", () => { dragging = false; });
  fab.addEventListener("click", () => {
    if (moved) { moved = false; return; }
    if (!frame.src) frame.src = PORTAL;
    panel.classList.add("open");
    fab.style.display = "none";
  });
  shadow.querySelector(".close").addEventListener("click", () => {
    panel.classList.remove("open");
    fab.style.display = "block";
  });
})();
