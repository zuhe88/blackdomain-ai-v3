const API_URL = "/api/public/atg";
const RESULTS_URL = "https://blackdomain-ai-v3-production.up.railway.app/results/";
const HORSE_COLORS = {
  1: "#c5a810", 2: "#3f9db3", 3: "#747c82", 4: "#df5c2c", 5: "#0b8b91",
  6: "#8d43c7", 7: "#314ca0", 8: "#d83e4f", 9: "#a47d4a", 10: "#2d9d57",
};

let snapshot = null;
let toastTimer = null;

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function ball(number) {
  const value = Number(number);
  return `<span class="ball h${value}">${value}</span>`;
}

function formatTime(value) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未同步";
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function render(data) {
  snapshot = data;
  byId("targetPeriod").textContent = data.targetPeriodId || "等待同步";
  byId("latestPeriod").textContent = data.latestPeriodId || "等待同步";
  byId("updatedAt").textContent = formatTime(data.updatedAt);

  const state = byId("liveState");
  state.classList.toggle("live", Boolean(data.fresh));
  state.lastChild.textContent = data.fresh ? " 即時同步中" : " 等待瀏覽器同步";

  const ranks = data.recommendation?.ranks || [];
  byId("recommendations").innerHTML = ranks.length
    ? ranks.map((row) => `
      <div class="rank-row">
        <strong>${escapeHtml(row.label)}</strong>
        <div class="numbers">${row.picks.map(ball).join("")}</div>
      </div>`).join("")
    : '<p class="empty">累積資料不足，暫時沒有公開推薦。</p>';

  const history = data.recentResults || [];
  byId("history").innerHTML = history.length
    ? history.map((record) => `
      <div class="history-row">
        <div class="history-meta">
          <strong>${escapeHtml(record.periodId)} 期</strong>
          <span>${formatTime(record.time)}</span>
        </div>
        <div class="numbers">${record.result.map(ball).join("")}</div>
      </div>`).join("")
    : '<p class="empty">尚未收到開獎資料。</p>';
}

async function refresh() {
  try {
    const response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch {
    byId("liveState").classList.remove("live");
    byId("liveState").lastChild.textContent = " 暫時無法取得資料";
  }
}

function sanitizeCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}

function initialCode() {
  const queryCode = sanitizeCode(new URLSearchParams(location.search).get("ref"));
  if (queryCode.length >= 4) {
    localStorage.setItem("blackdomainShareCode", queryCode);
    return queryCode;
  }
  const saved = sanitizeCode(localStorage.getItem("blackdomainShareCode"));
  if (saved.length >= 4) return saved;
  const generated = `BD${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  localStorage.setItem("blackdomainShareCode", generated);
  return generated;
}

function shareUrl() {
  const code = sanitizeCode(byId("referralCode").value);
  return code.length >= 4 ? `${RESULTS_URL}?ref=${encodeURIComponent(code)}` : RESULTS_URL;
}

async function copyShareLink() {
  try {
    await navigator.clipboard.writeText(shareUrl());
    showToast("分享連結已複製");
  } catch {
    showToast("請長按網址後複製");
  }
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function drawBalls(ctx, numbers, x, y, size, gap) {
  numbers.forEach((number, index) => {
    const left = x + index * (size + gap);
    roundRect(ctx, left, y, size, size, 10, HORSE_COLORS[number] || "#5b554c");
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 ${number === 10 ? 21 : 23}px "Microsoft JhengHei", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(number), left + size / 2, y + size / 2 + 1);
  });
}

function createShareCanvas() {
  if (!snapshot) throw new Error("No data");
  const canvas = byId("shareCanvas");
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 1200, 1200);
  gradient.addColorStop(0, "#090804");
  gradient.addColorStop(0.55, "#171209");
  gradient.addColorStop(1, "#050503");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1200, 1200);

  ctx.strokeStyle = "rgba(216,179,75,.16)";
  ctx.lineWidth = 1;
  for (let position = 0; position <= 1200; position += 80) {
    ctx.beginPath();
    ctx.moveTo(position, 0);
    ctx.lineTo(position, 1200);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, position);
    ctx.lineTo(1200, position);
    ctx.stroke();
  }

  roundRect(ctx, 78, 72, 72, 72, 18, "#d8b34b");
  ctx.fillStyle = "#100c03";
  ctx.font = '1000 42px "Microsoft JhengHei", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("B", 114, 121);
  ctx.textAlign = "left";
  ctx.fillStyle = "#fffdf6";
  ctx.font = '900 34px "Microsoft JhengHei", sans-serif';
  ctx.fillText("BLACKDOMAIN AI", 174, 104);
  ctx.fillStyle = "#a99f8b";
  ctx.font = '700 16px "Microsoft JhengHei", sans-serif';
  ctx.fillText("ATG HORSE RACING · LIVE INTELLIGENCE", 176, 137);

  ctx.fillStyle = "#fffdf6";
  ctx.font = '900 68px "Microsoft JhengHei", sans-serif';
  ctx.fillText("即時戰績", 78, 248);
  ctx.fillStyle = "#d8b34b";
  ctx.font = '800 25px "Microsoft JhengHei", sans-serif';
  ctx.fillText(`推薦期數  ${snapshot.targetPeriodId || "等待同步"}`, 80, 300);

  roundRect(ctx, 74, 346, 1052, 350, 28, "rgba(8,7,4,.86)", "rgba(216,179,75,.32)");
  ctx.fillStyle = "#9f9684";
  ctx.font = '800 18px "Microsoft JhengHei", sans-serif';
  ctx.fillText("AI RECOMMENDATION · 前三名 5 碼推薦", 112, 394);

  const ranks = snapshot.recommendation?.ranks || [];
  ranks.forEach((row, index) => {
    const top = 438 + index * 78;
    ctx.fillStyle = "#f7df8d";
    ctx.font = '900 25px "Microsoft JhengHei", sans-serif';
    ctx.fillText(row.label, 112, top + 35);
    drawBalls(ctx, row.picks, 300, top, 52, 13);
  });
  if (!ranks.length) {
    ctx.fillStyle = "#9f9684";
    ctx.font = '700 26px "Microsoft JhengHei", sans-serif';
    ctx.fillText("等待最新資料同步", 112, 510);
  }

  const latest = snapshot.recentResults?.[0];
  roundRect(ctx, 74, 730, 1052, 218, 28, "rgba(8,7,4,.86)", "rgba(216,179,75,.22)");
  ctx.fillStyle = "#9f9684";
  ctx.font = '800 18px "Microsoft JhengHei", sans-serif';
  ctx.fillText("LATEST RESULT · 最新開獎", 112, 779);
  ctx.fillStyle = "#fffdf6";
  ctx.font = '900 27px "Microsoft JhengHei", sans-serif';
  ctx.fillText(latest ? `${latest.periodId} 期` : "等待同步", 112, 827);
  if (latest) drawBalls(ctx, latest.result, 112, 858, 49, 8);

  ctx.fillStyle = "#f7df8d";
  ctx.font = '900 27px "Microsoft JhengHei", sans-serif';
  ctx.fillText("加入 LINE，輸入「ATG」開始體驗", 78, 1032);
  ctx.fillStyle = "#9f9684";
  ctx.font = '700 17px "Microsoft JhengHei", sans-serif';
  ctx.fillText("僅供娛樂參考 · 不保證獲利或命中 · 18+", 78, 1074);
  ctx.fillStyle = "#d8b34b";
  ctx.textAlign = "right";
  ctx.fillText(sanitizeCode(byId("referralCode").value), 1124, 1074);
  ctx.textAlign = "left";
  return canvas;
}

function canvasBlob() {
  return new Promise((resolve, reject) => {
    createShareCanvas().toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Unable to create image"));
    }, "image/png", 0.94);
  });
}

async function downloadCard() {
  try {
    const blob = await canvasBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `BLACKDOMAIN-ATG-${snapshot?.targetPeriodId || "LIVE"}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("分享圖已下載");
  } catch {
    showToast("資料同步後即可下載");
  }
}

async function nativeShare() {
  const title = "BLACKDOMAIN AI 即時戰績";
  const text = `查看 ATG ${snapshot?.targetPeriodId || ""} 期 AI 推薦與最新結果`;
  try {
    const blob = await canvasBlob();
    const file = new File([blob], "BLACKDOMAIN-ATG.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title, text, url: shareUrl(), files: [file] });
    } else if (navigator.share) {
      await navigator.share({ title, text, url: shareUrl() });
    } else {
      await copyShareLink();
    }
  } catch (error) {
    if (error.name !== "AbortError") await copyShareLink();
  }
}

function wireEvents() {
  const codeInput = byId("referralCode");
  codeInput.value = initialCode();
  codeInput.addEventListener("input", () => {
    codeInput.value = sanitizeCode(codeInput.value);
    localStorage.setItem("blackdomainShareCode", codeInput.value);
  });
  byId("copyButton").addEventListener("click", copyShareLink);
  byId("shareButton").addEventListener("click", nativeShare);
  byId("nativeShareButton").addEventListener("click", nativeShare);
  byId("downloadButton").addEventListener("click", downloadCard);
}

wireEvents();
refresh();
setInterval(refresh, 15000);

window.BLACKDOMAIN_EXPOSURE = { refresh, shareUrl };
