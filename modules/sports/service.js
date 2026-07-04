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

function requestJson(url, params = {}, headers = {}) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(url);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) endpoint.searchParams.set(key, String(value));
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    fetch(endpoint, { headers, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Sports API responded ${response.status}`);
        return response.json();
      })
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeout));
  });
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

  return { winner, rate };
}

function totalAdvice(rate) {
  return rate >= 0.6 ? "大分" : "小分";
}

function fallbackPoints(match) {
  return [
    "主隊近期狀況較佳",
    "客隊防守穩定度仍需觀察",
    "主隊主場優勢較明顯",
    "AI推估比賽節奏偏快",
    `建議參考${match.prediction}`,
    `建議比分${match.score}`,
  ];
}

async function attachPreview(match) {
  try {
    const aiText = await askSportsAI([
      `聯盟：${match.league}`,
      `賽事：${match.away} VS ${match.home}`,
      `開賽時間：${match.startTime}`,
      `AI預測勝方：${match.prediction}`,
      `讓分建議：${match.spread}`,
      `大小分建議：${match.total}`,
      "請用繁體中文提供4到6點賽前分析，不要英文縮寫，不要顯示資料來源。",
    ].join("\n"));

    const points = String(aiText || "")
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-•\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 6);

    return { ...match, points: points.length >= 4 ? points : fallbackPoints(match) };
  } catch (error) {
    return { ...match, points: fallbackPoints(match) };
  }
}

function worldCupTeamName(team = {}) {
  return WORLD_CUP_TEAMS_ZH[team.abbreviation] || team.displayName || team.name || "未知隊伍";
}

async function loadWorldCupMatches() {
  const today = taiwanNow();
  const data = await requestJson("https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard", {
    dates: compactDate(today),
  });

  return (data.events || [])
    .filter((event) => new Date(event.date) >= new Date())
    .slice(0, MAX_MATCHES)
    .map((event) => {
      const competition = event.competitions?.[0] || {};
      const competitors = competition.competitors || [];
      const homeEntry = competitors.find((item) => item.homeAway === "home") || competitors[0] || {};
      const awayEntry = competitors.find((item) => item.homeAway === "away") || competitors[1] || {};
      const homeForm = parseForm(homeEntry.form);
      const awayForm = parseForm(awayEntry.form);
      const home = { name: worldCupTeamName(homeEntry.team), wins: homeForm.wins, losses: homeForm.losses };
      const away = { name: worldCupTeamName(awayEntry.team), wins: awayForm.wins, losses: awayForm.losses };
      const pick = pickByRecord(home, away);

      return {
        league: "世足",
        date: formatDate(new Date(event.date)),
        home: home.name,
        away: away.name,
        startTime: formatTaiwanTime(event.date),
        prediction: pick.winner,
        spread: `${pick.winner} -0.5`,
        total: totalAdvice(pick.rate),
        score: pick.rate >= 0.6 ? "2：1" : "1：1",
        totalGoals: pick.rate >= 0.6 ? "3球" : "2球",
        halfTime: pick.rate >= 0.6 ? "1：0" : "0：0",
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
      if (new Date(game.gameDate) >= new Date()) upcoming.push({ date, game });
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

    return {
      league: "MLB",
      date: date.date,
      home: home.name,
      away: away.name,
      startTime: formatTaiwanTime(game.gameDate),
      prediction: pick.winner,
      spread: `${pick.winner} -1.5`,
      total: totalAdvice(pick.rate),
      score: pick.rate >= 0.6 ? "主勝高分" : "低比分拉鋸",
      totalGoals: pick.rate >= 0.6 ? "偏高" : "偏低",
      halfTime: "前半段保守觀察",
      updatedAt: new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }),
    };
  });
}

function parseNbaRecord(record) {
  const [wins, losses] = String(record || "0-0").split("-").map((x) => parseInt(x, 10));
  return { wins: Number.isFinite(wins) ? wins : 0, losses: Number.isFinite(losses) ? losses : 0 };
}

async function loadNbaMatches() {
  const data = await requestJson("https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json", {}, {
    Accept: "application/json",
    Referer: "https://www.nba.com/",
    "User-Agent": "Mozilla/5.0",
  });

  return (data?.scoreboard?.games || [])
    .filter((game) => game.gameStatus === 1)
    .slice(0, MAX_MATCHES)
    .map((game) => {
      const homeRecord = parseNbaRecord(`${game.homeTeam?.wins || 0}-${game.homeTeam?.losses || 0}`);
      const awayRecord = parseNbaRecord(`${game.awayTeam?.wins || 0}-${game.awayTeam?.losses || 0}`);
      const home = { name: NBA_TEAMS_ZH[game.homeTeam?.teamTricode] || game.homeTeam?.teamName || "主隊", ...homeRecord };
      const away = { name: NBA_TEAMS_ZH[game.awayTeam?.teamTricode] || game.awayTeam?.teamName || "客隊", ...awayRecord };
      const pick = pickByRecord(home, away);

      return {
        league: "NBA",
        date: formatDate(taiwanNow()),
        home: home.name,
        away: away.name,
        startTime: formatTaiwanTime(game.gameTimeUTC),
        prediction: pick.winner,
        spread: `${pick.winner} -3.5`,
        total: totalAdvice(pick.rate),
        score: "主勝方向較佳",
        totalGoals: pick.rate >= 0.6 ? "總分偏高" : "總分偏低",
        halfTime: "上半場節奏偏快",
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
