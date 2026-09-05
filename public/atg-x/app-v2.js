const root = document.querySelector("#app");
const toastNode = document.querySelector("#toast");
const DEVICE_KEY = "atgx_device";
let games = [];
let selectedGame = "戰神賽特2";
let currentMember = null;
let activeResult = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID() + crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: {
      "x-atgx-device": deviceId(),
      ...(options.method ? { "x-atgx-client": "1" } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function toast(message) {
  toastNode.textContent = message;
  toastNode.classList.add("show");
  clearTimeout(toastNode.timer);
  toastNode.timer = setTimeout(() => toastNode.classList.remove("show"), 3000);
}

function formatNumber(value, suffix = "") {
  if (value == null || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number)
    ? `${number.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}${suffix}`
    : "—";
}

function login() {
  root.innerHTML = `<section class="hero"><div class="hero-copy"><p class="eyebrow">ATG INTELLIGENCE・SERIAL ACCESS</p><h1>ATG AI <span>預測X輔助程式</span></h1><p>專注戰神賽特1、戰神賽特2的即時選房、資料訊號與資金節奏輔助。輸入管理員提供的專屬序號，即可啟用你的分析介面。</p><form class="login-card" id="activate"><label>輸入啟用序號</label><div class="serial-row"><input name="serial" autocomplete="off" spellcheck="false" placeholder="ATGX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" required><button class="primary">安全啟用</button></div><small>每組序號限綁定一個瀏覽器裝置。清除瀏覽器資料前請先聯絡管理員。</small></form></div><div class="hero-logo"><img src="/atg-x/assets/atg-x-logo.webp" alt="ATG駭客"></div></section>`;
}

function gameCard(game, index) {
  const active = game.gameName === selectedGame;
  const operational = game.ready && game.availableRooms > 0;
  const status = operational ? `${game.availableRooms} 房完成校驗` : game.ready ? "等待可分析空房" : "資料鏈路同步中";
  return `<button class="game ${operational ? "ready" : ""} ${active ? "active" : ""}" data-game="${escapeHtml(game.gameName)}"><span class="game-visual"><img src="${escapeHtml(game.image)}" alt="${escapeHtml(game.gameName)}"><em>SET-${String(index + 1).padStart(2, "0")}</em></span><span class="game-body"><small>ATG EXCLUSIVE MODULE</small><b>${escapeHtml(game.gameName)}</b><span><i></i>${escapeHtml(status)}</span><u>${active ? "目前選定" : "切換分析"}</u></span></button>`;
}

function dashboard(me) {
  currentMember = me;
  activeResult = null;
  root.innerHTML = `<section class="section-head"><div><p class="eyebrow">ATG X・SETH EXCLUSIVE COMMAND</p><h1>戰神雙核心分析</h1><p>雙遊戲獨立資料鏈路，空房校驗完成後才會建立分析結果。</p></div><div class="license-state">授權至 ${new Date(me.expiresAt).toLocaleDateString("zh-TW")}</div></section><section class="game-grid" id="games">${games.map(gameCard).join("")}</section><div class="intel-strip"><span><i></i>LIVE DATA LINK</span><b>房況同步</b><b>空房核對</b><b>樣本評級</b><b>風控計算</b></div><section class="workspace"><div class="panel command-panel"><div class="panel-kicker">ANALYSIS CONTROL</div><h2>戰術參數</h2><div class="control"><label>目前分析核心</label><input id="gameName" value="${escapeHtml(selectedGame)}" readonly></div><div class="control"><label>本次操作本金（選填）</label><input id="bankroll" inputmode="numeric" placeholder="例如 10000"></div><button class="primary" id="analyze">啟動 AI 戰術掃描</button><button class="ghost" id="logout">登出本裝置</button></div><div class="result" id="result"><div class="empty-result"><div class="scanner-orbit"><i></i><span>AI</span></div><div><p class="eyebrow">SYSTEM STANDBY</p><b>等待啟動戰術掃描</b><p>依序執行房況同步、空房核對、樣本評級與風控計算</p></div></div></div></section>`;
}

function playbookPanel(result) {
  const book = result.playbook;
  const signal = result.predictionSignal;
  if (!book || !signal) return "";
  const symbolCards = signal.symbols.map((symbol) => `<div class="combo-symbol"><div class="combo-art"><img src="${escapeHtml(symbol.icon)}" alt="${escapeHtml(symbol.label)}"><strong>×${escapeHtml(symbol.count)}</strong></div><b>${escapeHtml(symbol.label)}</b></div>`).join('<span class="combo-plus">＋</span>');
  const purchase = signal.purchase || {};
  const purchaseLabel = "出現訊號後建議購買金額";
  const purchaseValue = purchase.allowed && purchase.bet != null ? formatNumber(purchase.bet) : "本輪不購買";
  const purchaseMeta = purchase.allowed && purchase.bet != null
    ? `底注 ${formatNumber(purchase.bet)} × ${formatNumber(purchase.multiplier)} 倍・總購買金額 ${formatNumber(purchase.cost)}`
    : purchase.cost != null ? `最低購買金額 ${formatNumber(purchase.cost)}，目前本金不適合` : "維持平轉，不額外購買";
  return `<section class="playbook signal-matrix"><header><div><small>ATG X・SIGNAL MATRIX</small><h3>本輪訊號</h3></div><span class="matrix-code">${escapeHtml(signal.code)}</span></header><div class="combo-stage">${symbolCards}</div><div class="action-callout action-${escapeHtml(signal.action)}"><div><small>本輪建議</small><h2>${escapeHtml(signal.recommendation)}</h2><p>${escapeHtml(signal.detail)}</p></div><div class="signal-strength"><b>${escapeHtml(signal.level)}</b><span>訊號強度</span></div></div>${book.staking ? `<div class="execution-grid"><article class="execution-card flat"><small>建議平轉金額</small><strong>${formatNumber(book.staking.regularBet)}</strong><span>每一轉固定此金額</span></article><article class="execution-card purchase ${purchase.allowed ? "allowed" : "disabled"}"><small>${escapeHtml(purchaseLabel)}</small><strong>${escapeHtml(purchaseValue)}</strong><span>${escapeHtml(purchaseMeta)}</span></article></div>` : `<div class="plan-empty">輸入本金後，會直接顯示平轉金額與免遊購買金額。</div>`}</section>`;
}

function resultCard(result) {
  const confidenceClass = result.confidence === "高" ? "high" : result.confidence === "中" ? "medium" : "low";
  const updated = result.updatedAt ? new Date(result.updatedAt).toLocaleTimeString("zh-TW", { hour12: false }) : "—";
  return `<section class="result-summary"><div class="result-topline"><span><i></i>ANALYSIS READY</span><time>資料核對 ${escapeHtml(updated)}</time></div><div class="room-overview"><div class="room"><small>${escapeHtml(result.gameName)}・推薦房間</small><strong>${escapeHtml(result.roomNumber)}</strong><em>SELECTED ROOM</em></div><div class="confidence ${confidenceClass}"><b>${escapeHtml(result.confidence)}</b><span>資料可信度</span></div></div><div class="data-strip"><div><span>今日得分率</span><b>${formatNumber(result.metrics.todayRtp, "%")}</b></div><div><span>近30日得分率</span><b>${formatNumber(result.metrics.monthRtp, "%")}</b></div><div><span>今日有效樣本</span><b>${formatNumber(result.metrics.todayBet)}</b></div></div></section>${playbookPanel(result)}<p class="note">${escapeHtml(result.note)}</p>`;
}

async function loadGames() {
  const data = await api("/api/atg-x/games");
  games = data.games || [];
  if (!games.some((game) => game.gameName === selectedGame)) selectedGame = games[0]?.gameName || "戰神賽特2";
}

async function boot() {
  try {
    const me = await api("/api/atg-x/me");
    if (!me.authenticated) return login();
    await loadGames();
    dashboard(me);
  } catch (error) {
    login();
    toast(error.message);
  }
}

document.addEventListener("submit", async (event) => {
  if (event.target.id !== "activate") return;
  event.preventDefault();
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    await api("/api/atg-x/activate", { method: "POST", body: JSON.stringify({ serial: event.target.serial.value, deviceId: deviceId() }) });
    toast("序號啟用成功");
    await boot();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const card = event.target.closest("[data-game]");
  if (card) {
    selectedGame = card.dataset.game;
    dashboard(currentMember);
    const input = document.querySelector("#gameName");
    if (input) input.value = selectedGame;
    return;
  }
  if (event.target.id === "analyze") {
    const button = event.target;
    button.disabled = true;
    button.textContent = "正在建立戰術模型…";
    try {
      const data = await api("/api/atg-x/analyze", { method: "POST", body: JSON.stringify({ gameName: selectedGame, bankroll: document.querySelector("#bankroll").value }) });
      activeResult = data.result;
      document.querySelector("#result").innerHTML = resultCard(data.result);
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = "啟動 AI 戰術掃描";
    }
  }
  if (event.target.id === "logout") {
    await api("/api/atg-x/logout", { method: "POST", body: "{}" });
    login();
  }
});

document.addEventListener("pointermove", (event) => {
  document.documentElement.style.setProperty("--mx", `${event.clientX}px`);
  document.documentElement.style.setProperty("--my", `${event.clientY}px`);
});

boot();
