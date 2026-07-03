const { askSportsAI } = require("../../services/openai");
const { WORLD_CUP_TEAMS_ZH, MLB_TEAMS_ZH, NBA_TEAMS_ZH } = require("./constants");

const REQUEST_TIMEOUT = 3000;
const NO_DATA_TEXT = "目前尚無可分析賽事";
const MAX_MATCHES = 5;

function taiwanNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function compactDate(date) {
  return formatDate(date).replace(/-/g, "");
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatTaiwanTime(value) {
  return new Date(value).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function confidenceFromRate(rate) {
  if (rate >= 0.65) return "高";
  if (rate >= 0.55) return "中";
  return "低";
}

function pickByRecord(home, away) {
  const homeWins = Number(home.wins || 0);
  const homeLosses = Number(home.losses || 0);
  const awayWins = Number(away.wins || 0);
  const awayLosses = Number(away.losses || 0);
  const homeRate = homeWins + homeLosses ? homeWins / (homeWins + homeLosses) : 0.5;
  const awayRate = awayWins + awayLosses ? awayWins / (awayWins + awayLosses) : 0.5;
  const adjustedHomeRate = homeRate + 0.03;
  const winner = adjustedHomeRate >= awayRate ? home.name : away.name;
  const rate = Math.max(adjustedHomeRate, awayRate);

  return {
    winner,
    confidence: confidenceFromRate(rate),
    rate,
  };
}

async function requestJson(url, params = {}, headers = {}) {
  const endpoint = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      endpoint.searchParams.set(key, String(value));
    }
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(endpoint, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Official sports API responded ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function parseForm(form = "") {
  let wins = 0;
  let losses = 0;
  for (const char of String(form)) {
    if (char === "W") wins += 1;
    if (char === "L") losses += 1;
  }
  return { wins, losses };
}

function worldCupTeamName(team = {}) {
  return WORLD_CUP_TEAMS_ZH[team.abbreviation] || team.displayName || team.name || "球隊";
}

function fallbackPreview(match) {
  const lean = match.confidence === "高" ? "方向較明確" : match.confidence === "中" ? "仍需觀察臨場狀態" : "差距有限";
  return `${match.away} 對 ${match.home}，AI依賽程、近期狀態與戰績評估，勝方傾向 ${match.prediction}，${lean}。大小分建議 ${match.total}，僅供賽前參考。`;
}

function fallbackPoints(match) {
  return [
    `• 主隊與客隊近期狀態已納入AI評估`,
    `• AI預估 ${match.prediction} 勝出機率較高`,
    `• 讓分建議可參考 ${match.spread}`,
    `• 大小分建議可參考 ${match.total}`,
    `• 比分方向建議 ${match.score}`,
    `• 賽前仍需留意臨場名單與盤口變化`,
  ];
}

async function attachPreview(match) {
  const prompt = [
    `聯盟：${match.league}`,
    `賽事：${match.away} VS ${match.home}`,
    `開賽時間：${match.startTime}`,
    `近期狀態：${match.form || "官方資料不足"}`,
    `AI預測勝方：${match.prediction}`,
    `讓分方向：${match.spread}`,
    `大小分：${match.total}`,
    `比分/總分推估：${match.score}`,
    `信心等級：${match.confidence}`,
    "請輸出一段 70 字以內的繁體中文賽前分析，不要保證結果。",
  ].join("\n");

  try {
    const aiText = await askSportsAI(prompt);
    return {
      ...match,
      preview: aiText.trim() || fallbackPreview(match),
      points: fallbackPoints(match),
    };
  } catch (error) {
    return {
      ...match,
      preview: fallbackPreview(match),
      points: fallbackPoints(match),
    };
  }
}

async function loadWorldCupMatches() {
  const today = taiwanNow();
  const data = await requestJson("https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard", {
    dates: compactDate(today),
  });

  const events = data.events || [];
  return events
    .filter((event) => new Date(event.date) >= new Date())
    .slice(0, MAX_MATCHES)
    .map((event) => {
      const competition = event.competitions?.[0] || {};
      const competitors = competition.competitors || [];
      const homeEntry = competitors.find((item) => item.homeAway === "home") || competitors[0] || {};
      const awayEntry = competitors.find((item) => item.homeAway === "away") || competitors[1] || {};
      const homeForm = parseForm(homeEntry.form);
      const awayForm = parseForm(awayEntry.form);
      const home = {
        name: worldCupTeamName(homeEntry.team),
        wins: homeForm.wins,
        losses: homeForm.losses,
      };
      const away = {
        name: worldCupTeamName(awayEntry.team),
        wins: awayForm.wins,
        losses: awayForm.losses,
      };
      const pick = pickByRecord(home, away);
      const form = `${home.name} ${homeEntry.form || "無"} / ${away.name} ${awayEntry.form || "無"}`;

      return {
        league: "世足",
        date: formatDate(new Date(event.date)),
        home: home.name,
        away: away.name,
        startTime: formatTaiwanTime(event.date),
        form,
        prediction: pick.winner,
        spread: pick.winner,
        total: pick.rate >= 0.6 ? "Over" : "Under",
        score: pick.rate >= 0.6 ? "預估 2-1" : "預估 1-1",
        stars: pick.confidence === "高" ? "★★★★★" : pick.confidence === "中" ? "★★★★☆" : "★★★☆☆",
        totalGoals: pick.rate >= 0.6 ? "2至3球" : "1至2球",
        halfTime: pick.rate >= 0.6 ? "半場主隊不敗" : "半場平手機率較高",
        confidence: pick.confidence,
        updatedAt: new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }),
      };
    });
}

async function loadMlbMatches() {
  const today = taiwanNow();
  const data = await requestJson("https://statsapi.mlb.com/api/v1/schedule", {
    sportId: 1,
    startDate: formatDate(today),
    endDate: formatDate(addDays(today, 6)),
    hydrate: "team",
  });

  const upcoming = [];
  for (const date of data.dates || []) {
    for (const game of date.games || []) {
      if (new Date(game.gameDate) >= new Date()) {
        upcoming.push({ date, game });
      }
    }
  }

  return upcoming.slice(0, MAX_MATCHES).map(({ date, game }) => {
    const homeTeam = game.teams?.home?.team || {};
    const awayTeam = game.teams?.away?.team || {};
    const home = {
      name: MLB_TEAMS_ZH[homeTeam.id] || homeTeam.name || "主隊",
      wins: game.teams?.home?.leagueRecord?.wins,
      losses: game.teams?.home?.leagueRecord?.losses,
    };
    const away = {
      name: MLB_TEAMS_ZH[awayTeam.id] || awayTeam.name || "客隊",
      wins: game.teams?.away?.leagueRecord?.wins,
      losses: game.teams?.away?.leagueRecord?.losses,
    };
    const pick = pickByRecord(home, away);
    const combinedRate = pick.rate;

    return {
      league: "MLB",
      date: date.date,
      home: home.name,
      away: away.name,
      startTime: formatTaiwanTime(game.gameDate),
      form: `${home.name} ${home.wins || 0}勝${home.losses || 0}敗 / ${away.name} ${away.wins || 0}勝${away.losses || 0}敗`,
      prediction: pick.winner,
      spread: pick.winner,
      total: combinedRate >= 0.6 ? "Over" : "Under",
      score: combinedRate >= 0.6 ? "預估總分偏高" : "預估總分偏低",
      stars: pick.confidence === "高" ? "★★★★★" : pick.confidence === "中" ? "★★★★☆" : "★★★☆☆",
      totalGoals: combinedRate >= 0.6 ? "總分偏高" : "總分偏低",
      halfTime: "前半段節奏需觀察先發投手",
      confidence: pick.confidence,
      updatedAt: new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }),
    };
  });
}

function parseNbaRecord(record) {
  const [wins, losses] = String(record || "0-0").split("-").map((x) => parseInt(x, 10));
  return {
    wins: Number.isFinite(wins) ? wins : 0,
    losses: Number.isFinite(losses) ? losses : 0,
  };
}

async function loadNbaMatches() {
  const data = await requestJson(
    "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json",
    {},
    {
      Accept: "application/json",
      Referer: "https://www.nba.com/",
      "User-Agent": "Mozilla/5.0",
    }
  );
  const games = data?.scoreboard?.games || [];

  return games
    .filter((game) => game.gameStatus === 1)
    .slice(0, MAX_MATCHES)
    .map((game) => {
      const homeRecord = parseNbaRecord(
        game.homeTeam?.wins !== undefined && game.homeTeam?.losses !== undefined
          ? `${game.homeTeam.wins}-${game.homeTeam.losses}`
          : game.homeTeam?.record
      );
      const awayRecord = parseNbaRecord(
        game.awayTeam?.wins !== undefined && game.awayTeam?.losses !== undefined
          ? `${game.awayTeam.wins}-${game.awayTeam.losses}`
          : game.awayTeam?.record
      );
      const home = {
        name: NBA_TEAMS_ZH[game.homeTeam?.teamTricode] || game.homeTeam?.teamName || "主隊",
        wins: homeRecord.wins,
        losses: homeRecord.losses,
      };
      const away = {
        name: NBA_TEAMS_ZH[game.awayTeam?.teamTricode] || game.awayTeam?.teamName || "客隊",
        wins: awayRecord.wins,
        losses: awayRecord.losses,
      };
      const pick = pickByRecord(home, away);

      return {
        league: "NBA",
        date: formatDate(taiwanNow()),
        home: home.name,
        away: away.name,
        startTime: formatTaiwanTime(game.gameTimeUTC),
        form: `${home.name} ${home.wins}勝${home.losses}敗 / ${away.name} ${away.wins}勝${away.losses}敗`,
        prediction: pick.winner,
        spread: pick.winner,
        total: pick.rate >= 0.6 ? "Over" : "Under",
        score: "依官方戰績推估",
        stars: pick.confidence === "高" ? "★★★★★" : pick.confidence === "中" ? "★★★★☆" : "★★★☆☆",
        totalGoals: pick.rate >= 0.6 ? "總分偏高" : "總分偏低",
        halfTime: "上半場節奏偏向主隊掌握",
        confidence: pick.confidence,
        updatedAt: new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }),
      };
    });
}

async function loadAvailableMatches(league) {
  try {
    let matches = [];
    if (league === "世足") matches = await loadWorldCupMatches();
    if (league === "MLB") matches = await loadMlbMatches();
    if (league === "NBA") matches = await loadNbaMatches();
    return await Promise.all(matches.slice(0, MAX_MATCHES).map(attachPreview));
  } catch (error) {
    return [];
  }
}

module.exports = {
  NO_DATA_TEXT,
  loadAvailableMatches,
};
