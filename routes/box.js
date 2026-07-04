const express = require("express");
const { isAdminLineUserId } = require("../config/admin");
const { findMemberByLineUserId, listHistory } = require("../modules/luckyBox/repository");
const { BLACKDOMAIN_LINE_URL, WHEEL_SEGMENTS, boxUrl, formatDateTime, openBoxByLineUserId } = require("../modules/luckyBox");

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
    message: "可抽幸運轉盤",
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
  const segments = WHEEL_SEGMENTS;
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>3A VIP CLUB 幸運轉盤</title>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <style>
    :root {
      --black: #050403;
      --panel: #16110b;
      --panel2: #241a10;
      --gold: #d9b66d;
      --gold2: #f4dda1;
      --white: #fffaf0;
      --muted: #b7a783;
      --danger: #c94d38;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--white);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif;
      background:
        radial-gradient(circle at 50% 8%, rgba(244, 221, 161, .3), transparent 30%),
        radial-gradient(circle at 50% 48%, rgba(217, 182, 109, .16), transparent 42%),
        linear-gradient(160deg, #050403 0%, #17100a 52%, #050403 100%);
    }
    .wrap { width: min(480px, 100%); min-height: 100vh; margin: 0 auto; padding: 22px 18px 30px; display: grid; gap: 16px; }
    .hero, .card {
      border: 1px solid rgba(217, 182, 109, .52);
      border-radius: 26px;
      background: linear-gradient(145deg, rgba(36, 26, 16, .96), rgba(7, 6, 5, .98));
      box-shadow: 0 26px 80px rgba(0,0,0,.46), inset 0 1px 0 rgba(255,255,255,.08);
    }
    .hero { padding: 22px; text-align: center; position: relative; overflow: hidden; }
    .hero:before { content: ""; position: absolute; inset: -90px 40px auto; height: 140px; background: radial-gradient(circle, rgba(244,221,161,.42), transparent 66%); filter: blur(8px); }
    .club { position: relative; color: var(--gold2); font-size: 13px; letter-spacing: 2px; font-weight: 900; }
    h1 { position: relative; margin: 8px 0 0; font-size: 32px; }
    .badge { display: inline-flex; margin-top: 14px; padding: 8px 15px; border-radius: 999px; color: #261805; background: linear-gradient(135deg, #f5dfa3, #b88a3f); font-size: 13px; font-weight: 900; }
    .card { padding: 16px; }
    .row { display: flex; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px solid rgba(217, 182, 109, .14); font-size: 15px; }
    .row:last-child { border-bottom: 0; }
    .label { color: var(--muted); }
    .value { color: var(--white); font-weight: 800; text-align: right; }
    .wheel-card { text-align: center; overflow: hidden; }
    .wheel-wrap { position: relative; width: min(350px, 86vw); height: min(350px, 86vw); margin: 6px auto 14px; display: grid; place-items: center; }
    .pointer {
      position: absolute; top: -4px; z-index: 5; width: 0; height: 0;
      border-left: 18px solid transparent; border-right: 18px solid transparent; border-top: 34px solid var(--gold2);
      filter: drop-shadow(0 4px 8px rgba(0,0,0,.4));
    }
    .wheel {
      width: 100%; height: 100%; border-radius: 50%; position: relative; overflow: hidden;
      border: 9px solid rgba(244,221,161,.86);
      box-shadow: 0 0 44px rgba(217,182,109,.3), inset 0 0 44px rgba(0,0,0,.44);
      transition: transform 4.8s cubic-bezier(.08,.72,.08,1);
      background: conic-gradient(
        #24160c 0deg 30deg, #9e7230 30deg 60deg, #18110b 60deg 90deg, #5c3b17 90deg 120deg,
        #24160c 120deg 150deg, #9e7230 150deg 180deg, #18110b 180deg 210deg, #5c3b17 210deg 240deg,
        #24160c 240deg 270deg, #9e7230 270deg 300deg, #18110b 300deg 330deg, #d8b35f 330deg 360deg
      );
    }
    .wheel:before { content: ""; position: absolute; inset: 18px; border: 1px solid rgba(255,255,255,.12); border-radius: 50%; }
    .wheel-center {
      position: absolute; z-index: 4; width: 96px; height: 96px; border-radius: 50%; display: grid; place-items: center; text-align: center;
      color: #291b08; font-weight: 900; background: linear-gradient(135deg, #f6e1a8, #b7883e);
      border: 4px solid #fff1bf; box-shadow: 0 8px 28px rgba(0,0,0,.36);
    }
    .seg {
      position: absolute; left: 50%; top: 50%; width: 98px; margin-left: -49px; margin-top: -13px;
      transform-origin: 50% 13px; color: var(--white); font-size: 12px; font-weight: 900; text-align: center;
      text-shadow: 0 2px 6px rgba(0,0,0,.8);
    }
    .jackpot { color: #fff0b5; filter: drop-shadow(0 0 6px rgba(255,218,104,.8)); }
    .pass { color: #dbe7ff; }
    .result {
      min-height: 86px; padding: 14px; border-radius: 20px; background: rgba(255,255,255,.04); border: 1px solid rgba(217,182,109,.18);
    }
    .result-title { color: var(--gold2); font-weight: 900; font-size: 18px; }
    .result-prize { color: var(--white); font-size: 34px; font-weight: 1000; margin-top: 4px; }
    .result-note { color: var(--muted); font-size: 13px; margin-top: 6px; }
    button, a.button {
      width: 100%; border: 0; border-radius: 18px; padding: 15px 16px; color: #241705;
      background: linear-gradient(135deg, #f3d98e, #b4893f); font-size: 16px; font-weight: 900;
      text-decoration: none; text-align: center; display: block; cursor: pointer;
    }
    .secondary { color: var(--white); background: linear-gradient(135deg, #2b2318, #14100b); border: 1px solid rgba(217,182,109,.35); }
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
      <div class="club">3A VIP CLUB</div>
      <h1>幸運轉盤</h1>
      <div class="badge" id="statusBadge">會員資料讀取中</div>
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
        <div class="wheel-center">3A<br>VIP</div>
      </div>
      <div class="result" id="resultBox">
        <div class="result-title">等待抽獎</div>
        <div class="result-note">每2把鑰匙可抽一次幸運轉盤</div>
      </div>
    </section>
    <button id="openButton">🎯 立即抽獎</button>
    <button id="againButton" style="display:none">🎯 再抽一次</button>
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
    const $ = (id) => document.getElementById(id);
    const wheel = $("wheel");

    SEGMENTS.forEach((label, index) => {
      const div = document.createElement("div");
      div.className = "seg " + (label === "2888" ? "jackpot" : label.includes("AI") ? "pass" : "");
      div.style.transform = "rotate(" + (index * 30 + 15) + "deg) translateY(-128px)";
      div.innerHTML = label === "2888" ? "👑 JACKPOT<br>2888" : label === "AI權限1天" ? "BLACKDOMAIN<br>AI PASS" : label;
      wheel.appendChild(div);
    });

    function setNotice(message) { $("statusBadge").textContent = message; }
    function prizeNote(prize) { return prize === "AI權限1天" ? "AI權限已立即開通。" : "獎勵已發送至您的會員帳號。"; }
    function prizeIndex(prize) {
      if (prize === "2888") return SEGMENTS.indexOf("2888");
      return SEGMENTS.findIndex((item) => item === prize);
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
        $("vipStatus").textContent = "請從3A官方LINE開啟";
        return;
      }
      const response = await fetch("/api/box/status?lineUserId=" + encodeURIComponent(lineUserId));
      const data = await response.json();
      memberState = data.state;
      latestKeys = Number(data.keys || 0);
      setNotice(data.message);
      $("account").textContent = data.threeAAccount;
      $("vipStatus").textContent = data.vipStatus;
      $("keys").textContent = data.keys + (data.isAdmin ? " 把（管理員）" : " 把");
      $("openTimes").textContent = data.openTimes;
      $("againButton").style.display = data.state === "ready" && (data.isAdmin || latestKeys >= 2) ? "block" : "none";
    }
    async function spin() {
      if (!lineUserId) return setNotice("尚未取得LINE身分");
      if (memberState === "unbound") return setNotice("尚未綁定3A帳號，請先完成會員綁定");
      if (memberState === "pending") return setNotice("綁定審核中，請等待管理員審核");
      $("openButton").disabled = true;
      $("againButton").disabled = true;
      $("resultBox").innerHTML = '<div class="result-title">幸運轉盤旋轉中</div><div class="result-note">請稍候，結果由系統決定。</div>';
      const response = await fetch("/api/box/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineUserId }),
      });
      const data = await response.json();
      if (!data.ok) {
        setNotice(data.message || "目前無法抽獎");
        $("openButton").disabled = false;
        $("againButton").disabled = false;
        return;
      }
      const index = Math.max(0, prizeIndex(data.prize));
      const target = 360 - (index * 30 + 15);
      currentRotation += 360 * 7 + target;
      wheel.style.transform = "rotate(" + currentRotation + "deg)";
      setTimeout(async () => {
        $("resultBox").classList.add("spark");
        $("resultBox").innerHTML = '<div class="result-title">🎉 Congratulations<br>恭喜獲得</div><div class="result-prize">' + data.prize + '</div><div class="result-note">' + prizeNote(data.prize) + '</div>';
        setNotice("抽獎完成");
        await loadStatus();
        $("openButton").disabled = false;
        $("againButton").disabled = false;
        setTimeout(() => $("resultBox").classList.remove("spark"), 1400);
      }, 4900);
    }
    async function loadHistory() {
      if (!lineUserId) return;
      const panel = $("history");
      panel.classList.toggle("on");
      if (!panel.classList.contains("on")) return;
      const response = await fetch("/api/box/history?lineUserId=" + encodeURIComponent(lineUserId));
      const data = await response.json();
      panel.innerHTML = data.rows.length
        ? data.rows.map((row) => '<div class="history-item">抽獎時間：' + row.createdAt + '<br>獎項：' + row.prize + '<br>3A帳號：' + row.threeAAccount + '</div>').join("")
        : '<div class="notice">目前尚無抽獎紀錄。</div>';
    }
    $("openButton").addEventListener("click", spin);
    $("againButton").addEventListener("click", spin);
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
      res.json(await openBoxByLineUserId(lineUserId));
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
