const express = require("express");
const { isAdminLineUserId } = require("../config/admin");
const { findMemberByLineUserId, listHistory } = require("../modules/luckyBox/repository");
const { BLACKDOMAIN_LINE_URL, boxUrl, formatDateTime, openBoxByLineUserId } = require("../modules/luckyBox");

function statusForMember(member, lineUserId) {
  const isAdmin = isAdminLineUserId(lineUserId);
  if (!member.threeAAccount) {
    return {
      state: "unbound",
      message: "尚未綁定3A帳號",
      lineUserId,
      threeAAccount: "未綁定",
      vipStatus: "未綁定",
      keys: 0,
      openTimes: 0,
      isAdmin,
    };
  }

  if (member.status !== "approved") {
    return {
      state: "pending",
      message: "綁定審核中",
      lineUserId,
      threeAAccount: member.threeAAccount,
      vipStatus: "審核中",
      keys: member.keys || 0,
      openTimes: Math.floor((member.keys || 0) / 2),
      isAdmin,
    };
  }

  return {
    state: "ready",
    message: "可開啟幸運寶箱",
    lineUserId,
    threeAAccount: member.threeAAccount,
    vipStatus: isAdmin ? "管理員" : "已開通",
    keys: member.keys || 0,
    openTimes: isAdmin ? "無限制" : Math.floor((member.keys || 0) / 2),
    isAdmin,
  };
}

function pageHtml() {
  const liffId = process.env.LINE_3A_LIFF_ID || process.env.LIFF_ID || "";
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>3A VIP CLUB 幸運寶箱</title>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <style>
    :root {
      --black: #060504;
      --panel: #15110c;
      --panel2: #21180f;
      --gold: #d7b46a;
      --gold2: #f0d99b;
      --deep: #8b682f;
      --white: #fffaf0;
      --muted: #b8a887;
      --danger: #d05a48;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--white);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif;
      background:
        radial-gradient(circle at 50% 10%, rgba(232, 188, 92, .28), transparent 34%),
        radial-gradient(circle at 10% 80%, rgba(141, 98, 35, .22), transparent 28%),
        linear-gradient(160deg, #050403 0%, #15100a 48%, #050403 100%);
    }
    .wrap {
      width: min(460px, 100%);
      min-height: 100vh;
      margin: 0 auto;
      padding: 22px 18px 28px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .hero, .card {
      border: 1px solid rgba(215, 180, 106, .52);
      border-radius: 24px;
      background: linear-gradient(145deg, rgba(33, 24, 15, .94), rgba(9, 7, 5, .96));
      box-shadow: 0 24px 70px rgba(0, 0, 0, .45), inset 0 1px 0 rgba(255, 255, 255, .08);
    }
    .hero {
      padding: 20px;
      text-align: center;
      position: relative;
      overflow: hidden;
    }
    .hero::before {
      content: "";
      position: absolute;
      inset: -80px 20px auto;
      height: 130px;
      background: radial-gradient(circle, rgba(244, 211, 139, .35), transparent 65%);
      filter: blur(8px);
    }
    .club {
      position: relative;
      color: var(--gold2);
      font-size: 13px;
      letter-spacing: 2px;
      font-weight: 800;
    }
    h1 {
      position: relative;
      margin: 6px 0 0;
      font-size: 31px;
      letter-spacing: 0;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-top: 12px;
      padding: 7px 14px;
      border-radius: 999px;
      color: #2b1b07;
      background: linear-gradient(135deg, #f6dc96, #b98a3b);
      font-size: 13px;
      font-weight: 800;
    }
    .card { padding: 16px; }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 9px 0;
      border-bottom: 1px solid rgba(215, 180, 106, .14);
      font-size: 15px;
    }
    .row:last-child { border-bottom: 0; }
    .label { color: var(--muted); }
    .value { color: var(--white); font-weight: 700; text-align: right; }
    .chest-zone {
      min-height: 260px;
      display: grid;
      place-items: center;
      text-align: center;
      overflow: hidden;
      position: relative;
    }
    .glow {
      position: absolute;
      width: 210px;
      height: 210px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(244, 211, 139, .36), transparent 62%);
      filter: blur(10px);
      opacity: .7;
    }
    .chest {
      position: relative;
      width: 185px;
      height: 145px;
      transform-origin: 50% 70%;
      transition: transform .18s ease;
    }
    .chest.opening { animation: shake .2s linear infinite; }
    .lid, .box {
      position: absolute;
      left: 0;
      width: 185px;
      border: 2px solid rgba(247, 220, 150, .86);
      background: linear-gradient(135deg, #5f3214, #d19b41 52%, #6d3b17);
      box-shadow: inset 0 6px 18px rgba(255, 236, 178, .2), 0 16px 32px rgba(0, 0, 0, .42);
    }
    .lid {
      top: 0;
      height: 62px;
      border-radius: 22px 22px 8px 8px;
      transform-origin: 20px 62px;
      transition: transform .7s cubic-bezier(.18, .9, .22, 1.2);
    }
    .box {
      bottom: 0;
      height: 92px;
      border-radius: 14px 14px 20px 20px;
    }
    .lock {
      position: absolute;
      left: 72px;
      bottom: 50px;
      width: 42px;
      height: 52px;
      border-radius: 10px;
      background: linear-gradient(180deg, #f5df9d, #9b6d2b);
      border: 2px solid #fff0ba;
      z-index: 3;
    }
    .chest.opened .lid { transform: rotate(-24deg) translateY(-20px); }
    .result {
      position: relative;
      margin-top: 22px;
      font-size: 23px;
      font-weight: 900;
      color: var(--gold2);
      min-height: 30px;
    }
    .particles {
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0;
    }
    .particles.on { opacity: 1; }
    .particles span {
      position: absolute;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #f7dc96;
      animation: fly 1.1s ease-out forwards;
    }
    button, a.button {
      width: 100%;
      border: 0;
      border-radius: 18px;
      padding: 15px 16px;
      color: #241705;
      background: linear-gradient(135deg, #f3d98e, #b4893f);
      font-size: 16px;
      font-weight: 900;
      text-decoration: none;
      text-align: center;
      display: block;
      cursor: pointer;
      box-shadow: 0 12px 28px rgba(180, 137, 63, .25);
    }
    .secondary {
      color: var(--white);
      background: linear-gradient(135deg, #2b2318, #14100b);
      border: 1px solid rgba(215, 180, 106, .35);
      box-shadow: none;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .notice {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.7;
      text-align: center;
    }
    .history {
      display: none;
      gap: 10px;
    }
    .history.on { display: grid; }
    .history-item {
      border: 1px solid rgba(215, 180, 106, .22);
      border-radius: 14px;
      padding: 12px;
      background: rgba(255, 255, 255, .04);
      font-size: 14px;
      line-height: 1.6;
    }
    @keyframes shake {
      0%, 100% { transform: rotate(0deg); }
      25% { transform: rotate(-2deg); }
      75% { transform: rotate(2deg); }
    }
    @keyframes fly {
      from { transform: translate(0, 0) scale(1); opacity: 1; }
      to { transform: translate(var(--x), var(--y)) scale(.2); opacity: 0; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="club">3A VIP CLUB</div>
      <h1>幸運寶箱</h1>
      <div class="badge" id="statusBadge">會員資料讀取中</div>
    </section>

    <section class="card">
      <div class="row"><span class="label">3A帳號</span><span class="value" id="account">—</span></div>
      <div class="row"><span class="label">VIP狀態</span><span class="value" id="vipStatus">—</span></div>
      <div class="row"><span class="label">目前鑰匙數量</span><span class="value" id="keys">—</span></div>
      <div class="row"><span class="label">可開啟次數</span><span class="value" id="openTimes">—</span></div>
    </section>

    <section class="card chest-zone">
      <div class="glow"></div>
      <div class="particles" id="particles"></div>
      <div>
        <div class="chest" id="chest">
          <div class="lid"></div>
          <div class="box"></div>
          <div class="lock"></div>
        </div>
        <div class="result" id="resultText"></div>
      </div>
    </section>

    <button id="openButton">立即開寶箱</button>
    <div class="grid">
      <button class="secondary" id="historyButton">抽獎紀錄</button>
      <button class="secondary" id="activityButton">活動公告</button>
    </div>
    <a class="button secondary" href="line://nv/chat">返回LINE</a>
    <a class="button secondary" href="${BLACKDOMAIN_LINE_URL}">黑域AI</a>

    <section class="card history" id="history"></section>
    <section class="card notice" id="activity" style="display:none">
      新會員加入立即獲得2把鑰匙<br>
      成功邀請好友加入即可獲得4把鑰匙<br>
      每儲值1000元可獲得1把鑰匙<br>
      每2把鑰匙可開啟一次幸運寶箱<br>
      幸運寶箱有機會獲得：AI使用權限、88、288、588、888、3888<br>
      活動內容依官方公告為準。
    </section>
  </main>

  <script>
    const LIFF_ID = ${JSON.stringify(liffId)};
    let lineUserId = "";
    let memberState = "";
    const $ = (id) => document.getElementById(id);

    function setNotice(message) {
      $("statusBadge").textContent = message;
    }

    function particleBurst() {
      const layer = $("particles");
      layer.innerHTML = "";
      for (let i = 0; i < 28; i += 1) {
        const dot = document.createElement("span");
        dot.style.left = 80 + Math.random() * 120 + "px";
        dot.style.top = 70 + Math.random() * 80 + "px";
        dot.style.setProperty("--x", (Math.random() * 220 - 110) + "px");
        dot.style.setProperty("--y", (-80 - Math.random() * 140) + "px");
        layer.appendChild(dot);
      }
      layer.classList.add("on");
      setTimeout(() => layer.classList.remove("on"), 1200);
    }

    async function resolveLineUserId() {
      const params = new URLSearchParams(location.search);
      const fromQuery = params.get("lineUserId") || params.get("uid");
      if (fromQuery) return fromQuery;
      if (!LIFF_ID || !window.liff) return "";
      await liff.init({ liffId: LIFF_ID });
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: location.href });
        return "";
      }
      const profile = await liff.getProfile();
      return profile.userId || "";
    }

    async function loadStatus() {
      lineUserId = await resolveLineUserId();
      if (!lineUserId) {
        memberState = "no_line";
        setNotice("尚未取得LINE身分");
        $("account").textContent = "—";
        $("vipStatus").textContent = "請從3A官方LINE開啟";
        $("keys").textContent = "—";
        $("openTimes").textContent = "—";
        return;
      }
      const response = await fetch("/api/box/status?lineUserId=" + encodeURIComponent(lineUserId));
      const data = await response.json();
      memberState = data.state;
      setNotice(data.message);
      $("account").textContent = data.threeAAccount;
      $("vipStatus").textContent = data.vipStatus;
      $("keys").textContent = data.keys;
      $("openTimes").textContent = data.openTimes;
    }

    async function openBox() {
      if (!lineUserId) {
        setNotice("尚未取得LINE身分");
        return;
      }
      if (memberState === "unbound") {
        setNotice("尚未綁定3A帳號，請先完成會員綁定");
        return;
      }
      if (memberState === "pending") {
        setNotice("綁定審核中，請等待管理員審核");
        return;
      }
      $("openButton").disabled = true;
      $("resultText").textContent = "";
      $("chest").classList.add("opening");
      setNotice("寶箱開啟中");
      const response = await fetch("/api/box/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineUserId }),
      });
      const data = await response.json();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      $("chest").classList.remove("opening");
      if (!data.ok) {
        setNotice(data.message || "目前無法開啟寶箱");
        $("openButton").disabled = false;
        return;
      }
      $("chest").classList.add("opened");
      particleBurst();
      $("resultText").textContent = "獎項：" + data.prize;
      setNotice("開箱完成");
      await loadStatus();
      setTimeout(() => $("chest").classList.remove("opened"), 1800);
      $("openButton").disabled = false;
    }

    async function loadHistory() {
      if (!lineUserId) return;
      const panel = $("history");
      panel.classList.toggle("on");
      if (!panel.classList.contains("on")) return;
      const response = await fetch("/api/box/history?lineUserId=" + encodeURIComponent(lineUserId));
      const data = await response.json();
      if (!data.rows.length) {
        panel.innerHTML = '<div class="notice">目前尚無抽獎紀錄。</div>';
        return;
      }
      panel.innerHTML = data.rows.map((row) => '<div class="history-item">抽獎時間：' + row.createdAt + '<br>獎項：' + row.prize + '<br>3A帳號：' + row.threeAAccount + '</div>').join("");
    }

    $("openButton").addEventListener("click", openBox);
    $("historyButton").addEventListener("click", loadHistory);
    $("activityButton").addEventListener("click", () => {
      const panel = $("activity");
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    });
    loadStatus().catch(() => setNotice("系統忙碌中，請稍後再試"));
  </script>
</body>
</html>`;
}

function registerBoxRoutes(app) {
  const jsonParser = typeof express.json === "function" ? express.json({ limit: "128kb" }) : (req, res, next) => next();

  app.get("/box", (req, res) => {
    res.type("html").send(pageHtml());
  });

  app.get("/api/box/status", async (req, res) => {
    try {
      const lineUserId = String(req.query.lineUserId || "");
      const member = await findMemberByLineUserId(lineUserId);
      res.json(statusForMember(member, lineUserId));
    } catch (error) {
      console.error("[box/status]", error);
      res.json({ state: "error", message: "系統忙碌中，請稍後再試。", threeAAccount: "—", vipStatus: "—", keys: 0, openTimes: 0 });
    }
  });

  app.post("/api/box/open", jsonParser, async (req, res) => {
    try {
      const lineUserId = String(req.body?.lineUserId || "");
      if (!lineUserId) return res.json({ ok: false, message: "尚未取得LINE身分" });
      const result = await openBoxByLineUserId(lineUserId);
      res.json(result);
    } catch (error) {
      console.error("[box/open]", error);
      res.json({ ok: false, message: "系統忙碌中，請稍後再試。" });
    }
  });

  app.get("/api/box/history", async (req, res) => {
    try {
      const lineUserId = String(req.query.lineUserId || "");
      const rows = await listHistory(lineUserId, 20);
      res.json({
        rows: rows.map((row) => ({
          prize: row.prize || "—",
          threeAAccount: row.threeAAccount || "—",
          createdAt: formatDateTime(row.createdAt),
        })),
      });
    } catch (error) {
      console.error("[box/history]", error);
      res.json({ rows: [] });
    }
  });

  app.get("/api/box/activity", (req, res) => {
    res.json({
      title: "活動公告",
      items: [
        "新會員加入立即獲得2把鑰匙",
        "成功邀請好友加入即可獲得4把鑰匙",
        "每儲值1000元可獲得1把鑰匙",
        "每2把鑰匙可開啟一次幸運寶箱",
        "幸運寶箱有機會獲得：AI使用權限、88、288、588、888、3888",
        "活動內容依官方公告為準。",
      ],
    });
  });

  return { boxUrl: boxUrl() };
}

module.exports = {
  registerBoxRoutes,
};
