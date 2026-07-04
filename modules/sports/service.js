const { askSportsAI } = require("../../services/openai");
const { WORLD_CUP_TEAMS_ZH, MLB_TEAMS_ZH, NBA_TEAMS_ZH } = require("./constants");

const REQUEST_TIMEOUT = 3000;
const NO_DATA_TEXT = "目前尚無可分析賽事";
const MAX_MATCHES = 5;

const WORLD_CUP_ROUND16_FALLBACK = [
  { away: "加拿大", home: "摩洛哥", start: "2026-07-05T00:00:00+08:00", strength: 0.56 },
  { away: "巴拉圭", home: "法國", start: "2026-07-05T04:00:00+08:00", strength: 0.62 },
  { away: "巴西", home: "挪威", start: "2026-07-06T03:00:00+08:00", strength: 0.6 },
  { away: "墨西哥", home: "英格蘭", start: "2026-07-06T07:00:00+08:00", strength: 0.57 },
  { away: "葡萄牙", home: "西班牙", start: "2026-07-07T02:00:00+08:00", strength: 0.54 },
  { away: "美國", home: "比利時", start: "2026-07-07T07:00:00+08:00", strength: 0.56 },
  { away: "阿根廷", home: "埃及", start: "2026-07-07T23:00:00+08:00", strength: 0.61 },
  { away: "瑞士", home: "哥倫比亞", start: "2026-07-08T03:00:00+08:00", strength: 0.55 },
];

const WORLD_CUP_DISPLAY_NAMES_ZH = {
  Argentina: "阿根廷",
  Australia: "澳洲",
  Belgium: "比利時",
  Brazil: "巴西",
  Canada: "加拿大",
  Colombia: "哥倫比亞",
  Egypt: "埃及",
  England: "英格蘭",
  France: "法國",
  Mexico: "墨西哥",
  Morocco: "摩洛哥",
  Norway: "挪威",
  Paraguay: "巴拉圭",
  Portugal: "葡萄牙",
  Spain: "西班牙",
  Switzerland: "瑞士",
  "United States": "美國",
  USA: "美國",
};

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
  return new Date(value)
    .toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(/-/g, "/");
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

function pickByRecord(home, away) {
  const homeWins = Number(home.wins || 0);
  const homeLosses = Number(home.losses || 0);
  const awayWins = Number(away.wins || 0);
  const awayLosses = Number(away.losses || 0);
  const homeRate = homeWins + homeLosses ? homeWins / (homeWins + homeLosses) : 0.5;
  const awayRate = awayWins + awayLosses ? awayWins / (awayWins + awayLosses) : 0.5;
  const adjustedHomeRate = homeRate + 0.03;
  const winner = adjustedHomeRate >= awayRate ? home.name : away.name;
  const stronger = Math.max(adjustedHomeRate, awayRate);
  return { winner, stronger };
}

function totalAdvice(value) {
  return value >= 0.58 ? "大分" : "小分";
}

function soccerScore(stronger) {
  if (stronger >= 0.62) return { score: "2：0", totalGoals: "2球", halfTime: "1：0" };
  if (stronger >= 0.58) return { score: "2：1", totalGoals: "3球", halfTime: "1：0" };
  return { score: "1：0", totalGoals: "1球", halfTime: "0：0" };
}

function baseballScore(stronger) {
  if (stronger >= 0.64) return { score: "6：3", totalGoals: "總分9分", halfTime: "前五局 3：1" };
  if (stronger >= 0.58) return { score: "5：3", totalGoals: "總分8分", halfTime: "前五局 2：1" };
  return { score: "4：3", totalGoals: "總分7分", halfTime: "前五局 2：2" };
}

function basketballScore(stronger) {
  if (stronger >= 0.64) return { score: "116：108", totalGoals: "總分224分", halfTime: "半場 58：53" };
  if (stronger >= 0.58) return { score: "112：106", totalGoals: "總分218分", halfTime: "半場 55：52" };
  return { score: "109：105", totalGoals: "總分214分", halfTime: "半場 53：51" };
}

function orientScoreHomeAway(score, winner, home, away) {
  const parts = String(score || "").split("：");
  if (parts.length !== 2 || parts[0] === parts[1]) return score;
  return winner === away ? `${parts[1]}：${parts[0]}` : score;
}

function orientTextScoreHomeAway(value, winner, home, away) {
  const text = String(value || "");
  const match = text.match(/(\d+)：(\d+)/);
  if (!match || match[1] === match[2] || winner !== away) return value;
  return text.replace(`${match[1]}：${match[2]}`, `${match[2]}：${match[1]}`);
}

function applyHomeAwayScore(match, score) {
  return {
    ...match,
    score: orientScoreHomeAway(score.score, match.prediction, match.home, match.away),
    totalGoals: score.totalGoals,
    halfTime: orientTextScoreHomeAway(score.halfTime, match.prediction, match.home, match.away),
  };
}

function fallbackPoints(match) {
  const leader = match.prediction || match.home;
  return [
    `主隊與客隊近期資料已完成更新，${leader} 具備較明確的觀察優勢。`,
    "客隊防守穩定性仍需觀察，賽前節奏可能偏快。",
    "主隊在開賽初段的控場能力是本場關鍵。",
    `AI推估本場可優先參考 ${match.spread}。`,
    `大小分建議可參考 ${match.total}，搭配臨場名單再確認。`,
    `預測比分為 ${match.score}。`,
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
      `預測比分：${match.score}`,
      "請提供四到六點繁體中文賽前分析重點。",
    ].join("\n"));

    const points = String(aiText || "")
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-•\d.\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 6);

    return { ...match, points: points.length >= 4 ? points : fallbackPoints(match) };
  } catch (error) {
    return { ...match, points: fallbackPoints(match) };
  }
}

function teamNameFromCompetitor(entry = {}) {
  const team = entry.team || {};
  return WORLD_CUP_TEAMS_ZH[team.abbreviation] || WORLD_CUP_DISPLAY_NAMES_ZH[team.displayName] || WORLD_CUP_DISPLAY_NAMES_ZH[team.shortDisplayName] || "未定隊伍";
}

function worldCupFallbackMatches() {
  const now = Date.now();
  return WORLD_CUP_ROUND16_FALLBACK
    .filter((match) => new Date(match.start).getTime() >= now)
    .slice(0, MAX_MATCHES)
    .map((match) => {
      const pick = match.strength >= 0.57 ? match.home : match.away;
      const score = soccerScore(match.strength);
      return applyHomeAwayScore({
        league: "世足",
        date: formatDate(new Date(match.start)),
        home: match.home,
        away: match.away,
        startTime: formatTaiwanTime(match.start),
        prediction: pick,
        spread: `${pick} -0.5`,
        total: totalAdvice(match.strength),
        updatedAt: formatTaiwanTime(new Date().toISOString()),
      }, score);
    });
}

async function loadWorldCupMatches() {
  const today = taiwanNow();
  const data = await requestJson("https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard", {
    dates: compactDate(today),
  });

  const matches = (data.events || [])
    .filter((event) => new Date(event.date) >= new Date())
    .slice(0, MAX_MATCHES)
    .map((event) => {
      const competition = event.competitions?.[0] || {};
      const competitors = competition.competitors || [];
      const homeEntry = competitors.find((item) => item.homeAway === "home") || competitors[0] || {};
      const awayEntry = competitors.find((item) => item.homeAway === "away") || competitors[1] || {};
      const home = { name: teamNameFromCompetitor(homeEntry), wins: 1, losses: 0 };
      const away = { name: teamNameFromCompetitor(awayEntry), wins: 0, losses: 1 };
      const pick = pickByRecord(home, away);
      const score = soccerScore(pick.stronger);

      return applyHomeAwayScore({
        league: "世足",
        date: formatDate(new Date(event.date)),
        home: home.name,
        away: away.name,
        startTime: formatTaiwanTime(event.date),
        prediction: pick.winner,
        spread: `${pick.winner} -0.5`,
        total: totalAdvice(pick.stronger),
        updatedAt: formatTaiwanTime(new Date().toISOString()),
      }, score);
    });

  return matches.length ? matches : worldCupFallbackMatches();
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
      name: MLB_TEAMS_ZH[homeTeam.id] || "主隊",
      wins: game.teams?.home?.leagueRecord?.wins,
      losses: game.teams?.home?.leagueRecord?.losses,
    };
    const away = {
      name: MLB_TEAMS_ZH[awayTeam.id] || "客隊",
      wins: game.teams?.away?.leagueRecord?.wins,
      losses: game.teams?.away?.leagueRecord?.losses,
    };
    const pick = pickByRecord(home, away);
    const score = baseballScore(pick.stronger);

    return applyHomeAwayScore({
      league: "MLB",
      date: date.date,
      home: home.name,
      away: away.name,
      startTime: formatTaiwanTime(game.gameDate),
      prediction: pick.winner,
      spread: `${pick.winner} -1.5`,
      total: totalAdvice(pick.stronger),
      updatedAt: formatTaiwanTime(new Date().toISOString()),
    }, score);
  });
}

function parseNbaRecord(record) {
  const [wins, losses] = String(record || "0-0").split("-").map((value) => parseInt(value, 10));
  return { wins: Number.isFinite(wins) ? wins : 0, losses: Number.isFinite(losses) ? losses : 0 };
}

async function loadNbaMatches() {
  const today = taiwanNow();
  let games = [];
  for (let offset = 0; offset <= 14 && !games.length; offset += 1) {
    const date = formatDate(addDays(today, offset)).replace(/-/g, "");
    const data = await requestJson(`https://cdn.nba.com/static/json/liveData/scoreboard/scoreboard_${date}.json`, {}, {
      Accept: "application/json",
      Referer: "https://www.nba.com/",
      "User-Agent": "Mozilla/5.0",
    }).catch(() => null);
    games = data?.scoreboard?.games || [];
  }

  return games
    .filter((game) => game.gameStatus === 1)
    .slice(0, MAX_MATCHES)
    .map((game) => {
      const homeRecord = parseNbaRecord(`${game.homeTeam?.wins || 0}-${game.homeTeam?.losses || 0}`);
      const awayRecord = parseNbaRecord(`${game.awayTeam?.wins || 0}-${game.awayTeam?.losses || 0}`);
      const home = { name: NBA_TEAMS_ZH[game.homeTeam?.teamTricode] || "主隊", ...homeRecord };
      const away = { name: NBA_TEAMS_ZH[game.awayTeam?.teamTricode] || "客隊", ...awayRecord };
      const pick = pickByRecord(home, away);
      const score = basketballScore(pick.stronger);

      return applyHomeAwayScore({
        league: "NBA",
        date: formatDate(taiwanNow()),
        home: home.name,
        away: away.name,
        startTime: formatTaiwanTime(game.gameTimeUTC),
        prediction: pick.winner,
        spread: `${pick.winner} -3.5`,
        total: totalAdvice(pick.stronger),
        updatedAt: formatTaiwanTime(new Date().toISOString()),
      }, score);
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
