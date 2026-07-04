const express = require("express");
const { isAdminLineUserId } = require("../config/admin");
const { findMemberByLineUserId, listHistory } = require("../modules/luckyBox/repository");
const { BLACKDOMAIN_LINE_URL, WHEEL_SEGMENTS, boxUrl, formatDateTime, notifySpinResult, openBoxByLineUserId } = require("../modules/luckyBox");

function statusForMember(member, lineUserId) {
  const isAdmin = isAdminLineUserId(lineUserId);
  if (isAdmin) {
    return {
      state: "ready",
      message: "管理員測試模式",
      lineUserId,
      threeAAccount: "管理員測試",
      vipStatus: "管理員",
      keys: "無限制",
      openTimes: "無限制",
      isAdmin: true,
    };
  }

  if (!member.threeAAccount) {
    return {
      state: "unbound",
      message: "尚未綁定3A帳號",
      lineUserId,
      threeAAccount: "未綁定",
      vipStatus: "未綁定",
      keys: 0,
      openTimes: 0,
      isAdmin: false,
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
      isAdmin: false,
    };
  }

  return {
    state: "ready",
    message: "可抽幸運轉盤",
    lineUserId,
    threeAAccount: member.threeAAccount,
    vipStatus: "已開通",
    keys: member.keys || 0,
    openTimes: Math.floor((member.keys || 0) / 2),
    isAdmin: false,
  };
}

function pageHtml() {
  const liffId = process.env.LINE_3A_LIFF_ID || process.env.LIFF_ID || "";
  const segments = WHEEL_SEGMENTS;
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>3A尊榮會員 幸運轉盤</title>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <style>
    :root {
      --black: #090909;
      --panel: #15100a;
      --panel2: #241a10;
      --gold: #d4aa52;
      --gold2: #f3d995;
      --white: #fffaf2;
      --muted: #b9aa89;
      --danger: #c94d38;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--white);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif;
      background:
        radial-gradient(circle at 50% 8%, rgba(244, 221, 161, .22), transparent 30%),
        radial-gradient(circle at 50% 48%, rgba(217, 182, 109, .12), transparent 42%),
        linear-gradient(160deg, #090909 0%, #17100a 52%, #090909 100%);
    }
    h1, .club, .badge, .value, .result-title, .result-prize, button, a.button, .seg, .wheel-center {
      font-weight: 800;
      letter-spacing: .02em;
      text-shadow: 0 2px 8px rgba(0,0,0,.5);
    }
    .wrap { width: min(430px, 100%); min-height: 100vh; margin: 0 auto; padding: 18px 14px 28px; display: grid; gap: 14px; }
    .hero, .card {
      border: 1px solid rgba(217, 182, 109, .52);
      border-radius: 22px;
      background: linear-gradient(145deg, rgba(28, 21, 12, .96), rgba(7, 6, 5, .98));
      box-shadow: 0 18px 54px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.08);
    }
    .hero { padding: 22px 18px; text-align: center; position: relative; overflow: hidden; }
    .hero:before { content: ""; position: absolute; inset: -90px 48px auto; height: 136px; background: radial-gradient(circle, rgba(244,221,161,.34), transparent 66%); filter: blur(10px); }
    .club { position: relative; color: var(--gold2); font-size: 12px; letter-spacing: 1px; font-weight: 800; }
    h1 { position: relative; margin: 8px 0 0; font-size: 30px; color: #ffffff; }
    .badge { display: inline-flex; margin-top: 14px; padding: 8px 15px; border-radius: 999px; color: #261805; background: linear-gradient(135deg, #f5dfa3, #b88a3f); font-size: 13px; font-weight: 800; text-shadow: none; }
    .card { padding: 16px; }
    .row { display: flex; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px solid rgba(217, 182, 109, .14); font-size: 15px; }
    .row:last-child { border-bottom: 0; }
    .label { color: var(--muted); letter-spacing: .03em; }
    .value { color: var(--white); font-weight: 800; text-align: right; }
    .wheel-card { text-align: center; overflow: visible; }
    .wheel-wrap {
      position: relative;
      width: min(318px, calc(100vw - 84px));
      height: min(318px, calc(100vw - 84px));
      margin: 4px auto 14px;
      display: grid;
      place-items: center;
      justify-self: center;
    }
    .pointer {
      position: absolute; top: -2px; z-index: 5; width: 34px; height: 42px;
      clip-path: polygon(50% 100%, 0 0, 100% 0);
      background: linear-gradient(180deg, #fff1b8, #c2913d);
      filter: drop-shadow(0 6px 10px rgba(0,0,0,.46));
    }
    .wheel {
      width: 100%; height: 100%; border-radius: 50%; position: relative; overflow: hidden;
      border: 9px solid rgba(244,221,161,.86);
      box-shadow: 0 0 34px rgba(217,182,109,.24), 0 14px 38px rgba(0,0,0,.42), inset 0 0 34px rgba(0,0,0,.46);
      transition: transform 2.8s cubic-bezier(.12,.78,.12,1);
      background: conic-gradient(
        #17110b 0deg 60deg,
        #d8b35f 60deg 120deg,
        #21160d 120deg 180deg,
        #8b642a 180deg 240deg,
        #2b1c0f 240deg 300deg,
        #f0d48b 300deg 360deg
      );
    }
    .wheel:before { content: ""; position: absolute; inset: 18px; border: 1px solid rgba(255,255,255,.14); border-radius: 50%; }
    .wheel-center {
      position: absolute; z-index: 4; width: 96px; height: 96px; border-radius: 50%; display: grid; place-items: center; text-align: center;
      color: #291b08; font-weight: 900; background: linear-gradient(135deg, #f6e1a8, #b7883e);
      border: 5px solid #fff1bf; box-shadow: 0 10px 30px rgba(0,0,0,.38), 0 0 24px rgba(244,221,161,.38);
      line-height: 1.25;
    }
    .seg {
      position: absolute; left: 50%; top: 50%; width: 112px; margin-left: -56px; margin-top: -16px;
      transform-origin: 50% 16px; color: var(--white); font-size: 17px; font-weight: 900; text-align: center;
      text-shadow: 0 2px 6px rgba(0,0,0,.8);
    }
    .seg.light { color: #2c1c08; text-shadow: 0 1px 0 rgba(255,255,255,.25); }
    .jackpot { color: #2c1c08; filter: drop-shadow(0 0 8px rgba(255,218,104,.72)); }
    .pass { color: #fffaf2; }
    .result {
      min-height: 86px; padding: 14px; border-radius: 20px; background: rgba(255,255,255,.04); border: 1px solid rgba(217,182,109,.18);
    }
    .result-title { color: var(--gold2); font-weight: 900; font-size: 18px; }
    .result-prize { color: var(--white); font-size: 34px; font-weight: 1000; margin-top: 4px; }
    .result-note { color: var(--muted); font-size: 13px; margin-top: 6px; }
    button, a.button {
      width: 100%; border: 1px solid rgba(212,175,55,.72); border-radius: 18px; padding: 12px 16px; color: #ffffff;
      background: linear-gradient(135deg, rgba(9,9,9,.98), rgba(35,29,17,.98)); font-size: 16px; font-weight: 900;
      text-decoration: none; text-align: center; display: block; cursor: pointer;
      box-shadow: 0 12px 30px rgba(0,0,0,.36), 0 0 18px rgba(212,175,55,.12);
    }
    button:hover, a.button:hover { box-shadow: 0 12px 30px rgba(0,0,0,.42), 0 0 26px rgba(212,175,55,.28); }
    .secondary { color: var(--white); background: linear-gradient(135deg, #12110f, #090909); border: 1px solid rgba(217,182,109,.35); }
    .connect { display: none; }
    .connect.on { display: block; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .notice { color: var(--muted); font-size: 14px; line-height: 1.7; text-align: center; }
    .history { display: none; gap: 10px; }
    .history.on { display: grid; }
    .history-item { border: 1px solid rgba(217,182,109,.22); border-radius: 14px; padding: 12px; background: rgba(255,255,255,.04); font-size: 14px; line-height: 1.6; }
    .spark { animation: spark 1.3s ease-out; }
    @keyframes spark { 0% { box-shadow: 0 0 0 rgba(244,221,161,0); } 50% { box-shadow: 0 0 52px rgba(244,221,161,.62); } 100% { box-shadow: 0 0 0 rgba(244,221,161,0); } }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="club">3A尊榮會員</div>
      <h1>幸運轉盤</h1>
      <div class="badge" id="statusBadge">會員資料讀取中</div>
    </section>
    <section class="card connect" id="connectPanel">
      <div class="notice" id="connectText">請先連結LINE身分，系統才能讀取會員與鑰匙資料。</div>
      <button id="connectButton" style="margin-top:12px">連結LINE身分</button>
    </section>
    <section class="card">
      <div class="row"><span class="label">會員</span><span class="value" id="account">—</span></div>
      <div class="row"><span class="label">VIP</span><span class="value" id="vipStatus">—</span></div>
      <div class="row"><span class="label">鑰匙</span><span class="value" id="keys">—</span></div>
      <div class="row"><span class="label">可抽</span><span class="value" id="openTimes">—</span></div>
    </section>
    <section class="card wheel-card">
      <div class="wheel-wrap">
        <div class="pointer"></div>
        <div class="wheel" id="wheel"></div>
        <div class="wheel-center">👑<br>尊榮會員</div>
      </div>
      <div class="result" id="resultBox">
        <div class="result-title">等待抽獎</div>
        <div class="result-note">每2把鑰匙可抽一次幸運轉盤</div>
      </div>
    </section>
    <button id="openButton">🎡 轉動輪盤</button>
    <div class="grid">
      <button class="secondary" id="historyButton">📒 抽獎紀錄</button>
      <button class="secondary" id="activityButton">📜 活動公告</button>
    </div>
    <a class="button secondary" href="line://nv/chat">返回LINE</a>
    <a class="button secondary" href="${BLACKDOMAIN_LINE_URL}">黑域AI</a>
    <section class="card history" id="history"></section>
    <section class="card notice" id="activity" style="display:none">
      新會員加入立即獲得2把鑰匙<br>
      成功邀請好友加入即可獲得4把鑰匙<br>
      每儲值1000元可獲得1把鑰匙<br>
      每2把鑰匙可抽一次幸運轉盤<br>
      幸運轉盤有機會獲得：AI權限1天、88、888、2888<br>
      活動內容依官方公告為準。
    </section>
  </main>
  <script>
    const LIFF_ID = ${JSON.stringify(liffId)};
    const SEGMENTS = ${JSON.stringify(segments)};
    let lineUserId = "";
    let memberState = "";
    let latestKeys = 0;
    let currentRotation = 0;
    let spinning = false;
    const $ = (id) => document.getElementById(id);
    const wheel = $("wheel");

    const segmentAngle = 360 / SEGMENTS.length;
    SEGMENTS.forEach((label, index) => {
      const div = document.createElement("div");
      const isLight = index === 1 || index === 3 || index === 5;
      div.className = "seg " + (isLight ? "light " : "") + (label === "2888" ? "jackpot" : label.includes("AI") ? "pass" : "");
      const angle = index * segmentAngle + segmentAngle / 2;
      div.style.transform = "rotate(" + angle + "deg) translateY(-106px)";
      div.innerHTML = label === "2888" ? "👑<br>2888" : label;
      wheel.appendChild(div);
    });

    function setNotice(message) { $("statusBadge").textContent = message; }
    function setConnectVisible(visible, message) {
      $("connectPanel").classList.toggle("on", Boolean(visible));
      if (message) $("connectText").textContent = message;
    }
    async function startLineLogin() {
      if (!LIFF_ID || !window.liff) {
        setConnectVisible(true, "目前尚未設定LIFF，請由3A官方LINE的幸運轉盤入口重新開啟。");
        return;
      }
      await liff.init({ liffId: LIFF_ID });
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: location.href });
        return;
      }
      await loadStatus();
    }
    function prizeNote(prize) { return prize === "AI權限1天" ? "AI權限已立即開通。" : "獎勵已發送至您的會員帳號。"; }
    function prizeIndex(prize) {
      if (prize === "2888") return SEGMENTS.indexOf("2888");
      return SEGMENTS.findIndex((item) => item === prize);
    }
    async function resolveLineUserId() {
      if (!LIFF_ID || !window.liff) return "";
      await liff.init({ liffId: LIFF_ID });
      if (!liff.isLoggedIn()) {
        return "";
      }
      const profile = await liff.getProfile();
      return profile.userId || "";
    }
    async function loadStatus() {
      lineUserId = await resolveLineUserId();
      if (!lineUserId) {
        memberState = "no_line";
        setNotice("尚未連結LINE身分");
        $("account").textContent = "尚未連結";
        $("vipStatus").textContent = "請點下方按鈕";
        $("keys").textContent = "—";
        $("openTimes").textContent = "—";
        setConnectVisible(true, LIFF_ID ? "請點擊下方按鈕連結LINE身分。" : "目前尚未設定LIFF，請由3A官方LINE的幸運轉盤入口重新開啟。");
        return;
      }
      setConnectVisible(false);
      const response = await fetch("/api/box/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineUserId }),
      });
      const data = await response.json();
      memberState = data.state;
      latestKeys = Number(data.keys || 0);
      setNotice(data.message);
      $("account").textContent = data.threeAAccount;
      $("vipStatus").textContent = data.vipStatus;
      $("keys").textContent = data.isAdmin ? "無限制（管理員）" : data.keys + " 把";
      $("openTimes").textContent = data.openTimes;
    }
    async function spin() {
      if (spinning) return;
      if (!lineUserId) return setNotice("尚未取得LINE身分");
      if (memberState === "unbound") return setNotice("尚未綁定3A帳號，請先完成會員綁定");
      if (memberState === "pending") return setNotice("綁定審核中，請等待管理員審核");
      const restoreButtonText = $("openButton").textContent || "🎡 轉動輪盤";
      spinning = true;
      $("openButton").disabled = true;
      $("openButton").textContent = "請稍後 正在轉動幸運轉盤...";
      let data;
      try {
        const response = await fetch("/api/box/open", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lineUserId }),
        });
        data = await response.json();
      } catch (error) {
        console.error("[box/open]", error);
        setNotice("⚠️ 抽獎失敗，請稍後再試。");
        $("resultBox").innerHTML = '<div class="result-title">⚠️ 抽獎失敗，請稍後再試。</div>';
        $("openButton").disabled = false;
        $("openButton").textContent = restoreButtonText;
        spinning = false;
        return;
      }
      if (!data.ok) {
        setNotice("⚠️ 抽獎失敗，請稍後再試。");
        $("resultBox").innerHTML = '<div class="result-title">⚠️ 抽獎失敗，請稍後再試。</div>';
        $("openButton").disabled = false;
        $("openButton").textContent = restoreButtonText;
        spinning = false;
        return;
      }
      const index = Number.isInteger(data.sectorIndex) ? data.sectorIndex : Math.max(0, prizeIndex(data.prize));
      const target = 360 - (index * segmentAngle + segmentAngle / 2);
      const normalizedRotation = ((currentRotation % 360) + 360) % 360;
      currentRotation += 360 * 5 + ((target - normalizedRotation + 360) % 360);
      wheel.style.transform = "rotate(" + currentRotation + "deg)";
      setTimeout(async () => {
        $("resultBox").classList.add("spark");
        $("resultBox").innerHTML = '<div class="result-title">🎉 恭喜獲得</div><div class="result-prize">' + data.prize + '</div><div class="result-note">' + prizeNote(data.prize) + '</div>';
        setNotice("抽獎完成");
        try {
          await fetch("/api/box/notify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ lineUserId, prize: data.prize, aiAccess: data.aiAccess || null }),
          });
          await loadStatus();
        } catch (error) {
          console.error("[box/notify]", error);
        }
        $("openButton").disabled = false;
        $("openButton").textContent = "🎯 再抽一次";
        spinning = false;
        setTimeout(() => $("resultBox").classList.remove("spark"), 1400);
      }, 2900);
    }
    async function loadHistory() {
      if (!lineUserId) return;
      const panel = $("history");
      panel.classList.toggle("on");
      if (!panel.classList.contains("on")) return;
      const response = await fetch("/api/box/history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineUserId }),
      });
      const data = await response.json();
      panel.innerHTML = data.rows.length
        ? data.rows.map((row) => '<div class="history-item">抽獎時間：' + row.createdAt + '<br>獎項：' + row.prize + '<br>3A帳號：' + row.threeAAccount + '</div>').join("")
        : '<div class="notice">目前尚無抽獎紀錄。</div>';
    }
    $("openButton").addEventListener("click", spin);
    $("connectButton").addEventListener("click", () => startLineLogin().catch(() => setNotice("LINE身分連結失敗")));
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

  app.get("/box", (req, res) => res.type("html").send(pageHtml()));

  async function sendStatus(lineUserId, res) {
    if (isAdminLineUserId(lineUserId)) return res.json(statusForMember({}, lineUserId));
    const member = await findMemberByLineUserId(lineUserId);
    return res.json(statusForMember(member, lineUserId));
  }

  async function sendHistory(lineUserId, res) {
    const rows = await listHistory(lineUserId, 20);
    return res.json({
      rows: rows.map((row) => ({
        prize: row.prize || "—",
        threeAAccount: row.threeAAccount || "—",
        createdAt: formatDateTime(row.createdAt),
      })),
    });
  }

  app.get("/api/box/status", async (req, res) => {
    try {
      const lineUserId = String(req.query.lineUserId || "");
      return sendStatus(lineUserId, res);
    } catch (error) {
      console.error("[box/status]", error);
      return res.json({ state: "error", message: "系統忙碌中，請稍後再試。", threeAAccount: "—", vipStatus: "—", keys: 0, openTimes: 0 });
    }
  });

  app.post("/api/box/status", jsonParser, async (req, res) => {
    try {
      const lineUserId = String(req.body?.lineUserId || "");
      return sendStatus(lineUserId, res);
    } catch (error) {
      console.error("[box/status]", error);
      return res.json({ state: "error", message: "系統忙碌中，請稍後再試。", threeAAccount: "—", vipStatus: "—", keys: 0, openTimes: 0 });
    }
  });

  app.post("/api/box/open", jsonParser, async (req, res) => {
    try {
      const lineUserId = String(req.body?.lineUserId || "");
      if (!lineUserId) return res.json({ ok: false, message: "尚未取得LINE身分" });
      res.json(await openBoxByLineUserId(lineUserId));
    } catch (error) {
      console.error("[box/open]", error);
      res.json({ ok: false, message: "系統忙碌中，請稍後再試。" });
    }
  });

  app.post("/api/box/notify", jsonParser, async (req, res) => {
    try {
      const lineUserId = String(req.body?.lineUserId || "");
      const prize = String(req.body?.prize || "");
      const aiAccess = req.body?.aiAccess || null;
      if (!lineUserId || !prize) return res.json({ ok: false, message: "通知資料不完整" });
      res.json(await notifySpinResult(lineUserId, prize, aiAccess));
    } catch (error) {
      console.error("[box/notify]", error);
      res.json({ ok: false, message: "系統忙碌中，請稍後再試。" });
    }
  });

  app.get("/api/box/history", async (req, res) => {
    try {
      const lineUserId = String(req.query.lineUserId || "");
      return sendHistory(lineUserId, res);
    } catch (error) {
      console.error("[box/history]", error);
      return res.json({ rows: [] });
    }
  });

  app.post("/api/box/history", jsonParser, async (req, res) => {
    try {
      const lineUserId = String(req.body?.lineUserId || "");
      return sendHistory(lineUserId, res);
    } catch (error) {
      console.error("[box/history]", error);
      return res.json({ rows: [] });
    }
  });

  app.get("/api/box/activity", (req, res) => {
    res.json({
      title: "活動公告",
      items: [
        "新會員加入立即獲得2把鑰匙",
        "成功邀請好友加入即可獲得4把鑰匙",
        "每儲值1000元可獲得1把鑰匙",
        "每2把鑰匙可抽一次幸運轉盤",
        "幸運轉盤有機會獲得：AI權限1天、88、888、2888",
        "活動內容依官方公告為準。",
      ],
    });
  });

  return { boxUrl: boxUrl() };
}

module.exports = {
  registerBoxRoutes,
};
