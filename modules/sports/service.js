const { WORLD_CUP_TEAMS_ZH, MLB_TEAMS_ZH, NBA_TEAMS_ZH } = require("./constants");

const REQUEST_TIMEOUT = 3000;
const NO_DATA_TEXT = "目前尚無可分析賽事";

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

async function loadWorldCupMatches() {
  const today = taiwanNow();
  const data = await requestJson("https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard", {
    dates: compactDate(today),
  });

  const events = data.events || [];
  return events
    .filter((event) => new Date(event.date) >= new Date())
    .slice(0, 3)
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
      const stage = competition.altGameNote || event.season?.slug || "FIFA World Cup";

      return {
        league: "世足",
        date: formatDate(new Date(event.date)),
        home: home.name,
        away: away.name,
        startTime: formatTaiwanTime(event.date),
        h2h: `${stage}，近期狀態 ${home.name} ${homeEntry.form || "無"} / ${away.name} ${awayEntry.form || "無"}`,
        prediction: pick.winner,
        spread: pick.winner,
        total: pick.rate >= 0.6 ? "Over" : "Under",
        score: pick.rate >= 0.6 ? "預估 2-1" : "預估 1-1",
        confidence: pick.confidence,
        updatedAt: new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }),
      };
    });
}

async function loadMlbHeadToHead(homeId, awayId) {
  const endDate = taiwanNow();
  const startDate = addDays(endDate, -1095);
  const data = await requestJson("https://statsapi.mlb.com/api/v1/schedule", {
    sportId: 1,
    teamId: homeId,
    opponentId: awayId,
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    gameTypes: "R,P,F,D,L,W",
  });

  let homeWins = 0;
  let awayWins = 0;
  let totalRuns = 0;
  let games = 0;

  for (const date of data.dates || []) {
    for (const game of date.games || []) {
      const home = game.teams?.home;
      const away = game.teams?.away;
      if (!home || !away) continue;
      if (home.score === undefined || away.score === undefined) continue;

      games += 1;
      totalRuns += Number(home.score || 0) + Number(away.score || 0);

      const winnerId = Number(home.score) >= Number(away.score) ? home.team?.id : away.team?.id;
      if (winnerId === homeId) homeWins += 1;
      if (winnerId === awayId) awayWins += 1;
    }
  }

  return {
    games,
    homeWins,
    awayWins,
    averageTotal: games ? totalRuns / games : null,
  };
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

  const games = [];
  for (const item of upcoming.slice(0, 3)) {
    const { date, game } = item;
    const homeTeam = game.teams?.home?.team || {};
    const awayTeam = game.teams?.away?.team || {};
    const h2h = await loadMlbHeadToHead(homeTeam.id, awayTeam.id).catch(() => ({
      games: 0,
      homeWins: 0,
      awayWins: 0,
      averageTotal: null,
    }));

    const home = {
      id: homeTeam.id,
      name: MLB_TEAMS_ZH[homeTeam.id] || homeTeam.name || "主隊",
      wins: game.teams?.home?.leagueRecord?.wins,
      losses: game.teams?.home?.leagueRecord?.losses,
    };
    const away = {
      id: awayTeam.id,
      name: MLB_TEAMS_ZH[awayTeam.id] || awayTeam.name || "客隊",
      wins: game.teams?.away?.leagueRecord?.wins,
      losses: game.teams?.away?.leagueRecord?.losses,
    };
    const pick = pickByRecord(home, away);
    const totalLine = h2h.averageTotal && h2h.averageTotal >= 8.5 ? "Over" : "Under";

    games.push({
      league: "MLB",
      date: date.date,
      home: home.name,
      away: away.name,
      startTime: formatTaiwanTime(game.gameDate),
      h2h: `${home.name} ${h2h.homeWins} 勝 / ${away.name} ${h2h.awayWins} 勝 / 共 ${h2h.games} 場`,
      prediction: pick.winner,
      spread: pick.winner,
      total: totalLine,
      score: h2h.averageTotal ? `預估總分 ${Math.round(h2h.averageTotal)}` : "官方資料不足",
      confidence: pick.confidence,
      updatedAt: new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }),
    });
  }

  return games;
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
    .slice(0, 3)
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
        h2h: "NBA官方即時資料未提供本場對戰紀錄",
        prediction: pick.winner,
        spread: pick.winner,
        total: pick.rate >= 0.6 ? "Over" : "Under",
        score: "依官方戰績推估",
        confidence: pick.confidence,
        updatedAt: new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }),
      };
    });
}

async function loadAvailableMatches(league) {
  try {
    if (league === "世足") return await loadWorldCupMatches();
    if (league === "MLB") return await loadMlbMatches();
    if (league === "NBA") return await loadNbaMatches();
    return [];
  } catch (error) {
    return [];
  }
}

module.exports = {
  NO_DATA_TEXT,
  loadAvailableMatches,
};
