const { askSportsAI, askSportsPredictionAI } = require("../../services/openai");
const { MLB_TEAMS_ZH, NBA_TEAMS_ZH } = require("./constants");

const REQUEST_TIMEOUT = 3000;
const NO_DATA_TEXT = "目前尚無可分析賽事";
const MAX_MATCHES = 5;

const CPBL_SCHEDULE_API = "https://stats.cpbl.com.tw/api/proxy/v1/games/schedule";

function taiwanNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

function hashString(value) {
  return Array.from(String(value || "")).reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) >>> 0, 17);
}

function pickVariant(seed, variants) {
  return variants[Math.abs(seed) % variants.length];
}

function matchSeed(...items) {
  return hashString(items.join("|"));
}

function makeScore(homeScore, awayScore) {
  return `${homeScore}：${awayScore}`;
}

function baseballScore(stronger, seed) {
  const variants = stronger >= 0.64
    ? [[7, 3], [6, 2], [6, 4], [5, 2]]
    : stronger >= 0.58
      ? [[5, 3], [4, 2], [6, 5], [5, 4]]
      : [[4, 3], [3, 2], [5, 4], [6, 5]];
  const [fav, dog] = pickVariant(seed, variants);
  const firstFiveFav = Math.max(1, Math.floor(fav * 0.55));
  const firstFiveDog = Math.max(0, Math.floor(dog * 0.5));
  const total = fav + dog;
  return {
    score: makeScore(fav, dog),
    totalGoals: `總分${total}分`,
    halfTime: `前五局 ${firstFiveFav}：${firstFiveDog}`,
    totalAdvice: total >= 8 ? "大分" : "小分",
  };
}

function basketballScore(stronger, seed) {
  const variants = stronger >= 0.64
    ? [[121, 110], [118, 107], [116, 104], [124, 114]]
    : stronger >= 0.58
      ? [[113, 108], [109, 104], [116, 112], [111, 106]]
      : [[106, 103], [110, 108], [104, 101], [112, 110]];
  const [fav, dog] = pickVariant(seed, variants);
  const total = fav + dog;
  return {
    score: makeScore(fav, dog),
    totalGoals: `總分${total}分`,
    halfTime: `半場 ${Math.floor(fav / 2)}：${Math.floor(dog / 2)}`,
    totalAdvice: total >= 220 ? "大分" : "小分",
  };
}

function spreadAdvice(league, winner, stronger, seed) {
  if (["CPBL", "MLB"].includes(league)) {
    if (stronger >= 0.62 || seed % 3 === 0) return `${winner} -1.5`;
    return `${winner} 不讓分`;
  }
  if (league === "NBA") {
    if (stronger >= 0.64) return `${winner} -5.5`;
    if (stronger >= 0.59) return `${winner} -3.5`;
    return `${winner} -1.5`;
  }
  return `${winner} 不讓分`;
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
    total: score.totalAdvice || match.total,
    halfTime: orientTextScoreHomeAway(score.halfTime, match.prediction, match.home, match.away),
  };
}

function parseJsonObject(value) {
  const text = String(value || "").replace(/```json|```/g, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Sports prediction JSON missing.");
  return JSON.parse(text.slice(start, end + 1));
}

function normalizeScoreText(value) {
  const match = String(value || "").match(/(\d{1,3})\s*[：:]\s*(\d{1,3})/);
  if (!match) return "";
  return `${Number(match[1])}：${Number(match[2])}`;
}

function isValidScoreForLeague(score, league) {
  const parts = String(score || "").split("：").map((item) => Number(item));
  if (parts.length !== 2 || parts.some((item) => !Number.isFinite(item) || item < 0)) return false;
  if (parts[0] === parts[1]) return false;
  if (["CPBL", "MLB"].includes(league)) return parts[0] <= 25 && parts[1] <= 25;
  if (league === "NBA") return parts[0] >= 70 && parts[1] >= 70 && parts[0] <= 180 && parts[1] <= 180;
  return true;
}

function normalizePoints(value, fallback = []) {
  const source = Array.isArray(value) ? value : [];
  const points = source
    .map((item) => String(item || "").replace(/^[-•\d.\s]+/, "").trim())
    .filter(Boolean)
    .filter((item) => !/[A-Za-z]{3,}/.test(item))
    .slice(0, 6);
  return points.length >= 4 ? points : fallback;
}

function normalizeSportsPrediction(match, parsed) {
  const winner = String(parsed.winner || "").trim();
  if (![match.home, match.away].includes(winner)) throw new Error("Sports prediction winner is not in match teams.");

  const score = normalizeScoreText(parsed.score);
  if (!isValidScoreForLeague(score, match.league)) throw new Error("Sports prediction score is invalid.");

  const totalGoals = String(parsed.totalGoals || "").trim() || match.totalGoals;
  const halfTime = String(parsed.halfTime || "").trim() || match.halfTime;
  const spread = String(parsed.spread || "").trim() || match.spread;
  const total = String(parsed.total || "").trim() || match.total;

  return {
    ...match,
    prediction: winner,
    score,
    spread,
    total,
    totalGoals,
    halfTime,
    points: normalizePoints(parsed.points, []),
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

async function attachPrediction(match) {
  try {
    const payload = {
      instruction: "請依照資料做賽前預測，回傳指定 JSON。比分必須主隊在前、客隊在後。",
      league: match.league,
      home: match.home,
      away: match.away,
      startTime: match.startTime,
      baseline: {
        winner: match.prediction,
        score: match.score,
        spread: match.spread,
        total: match.total,
        totalGoals: match.totalGoals,
        halfTime: match.halfTime,
      },
      teamData: match.teamData || null,
    };
    const content = await askSportsPredictionAI(payload);
    const parsed = parseJsonObject(content);
    const predicted = normalizeSportsPrediction(match, parsed);
    return {
      ...predicted,
      points: predicted.points.length >= 4 ? predicted.points : fallbackPoints(predicted),
    };
  } catch (error) {
    console.error("[Sports AI] prediction fallback:", error.message);
    return match;
  }
}

async function attachPreview(match) {
  const predictedMatch = await attachPrediction(match);
  try {
    const aiText = await askSportsAI([
      `聯盟：${predictedMatch.league}`,
      `賽事：${predictedMatch.away} VS ${predictedMatch.home}`,
      `開賽時間：${predictedMatch.startTime}`,
      `AI預測勝方：${predictedMatch.prediction}`,
      `讓分建議：${predictedMatch.spread}`,
      `大小分建議：${predictedMatch.total}`,
      `預測比分：${predictedMatch.score}`,
      "請提供四到六點繁體中文賽前分析重點。",
    ].join("\n"));

    const points = String(aiText || "")
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-•\d.\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 6);

    return { ...predictedMatch, points: points.length >= 4 ? points : predictedMatch.points?.length >= 4 ? predictedMatch.points : fallbackPoints(predictedMatch) };
  } catch (error) {
    return { ...predictedMatch, points: predictedMatch.points?.length >= 4 ? predictedMatch.points : fallbackPoints(predictedMatch) };
  }
}

function cpblStartDate(value) {
  const text = String(value || "").trim();
  if (!text) return new Date(NaN);
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}+08:00`);
}

function monthAtOffset(date, offset) {
  const value = new Date(date);
  value.setDate(1);
  value.setMonth(value.getMonth() + offset);
  return { year: value.getFullYear(), month: value.getMonth() + 1 };
}

async function loadCpblMatches() {
  const today = taiwanNow();
  const gamesById = new Map();

  for (let offset = 0; offset <= 2 && gamesById.size < MAX_MATCHES; offset += 1) {
    const { year, month } = monthAtOffset(today, offset);
    const response = await requestJson(CPBL_SCHEDULE_API, {
      kindCode: "A",
      year,
      month,
    }, {
      Accept: "application/json",
      "User-Agent": "BLACKDOMAIN-Sports/3.0",
    });

    for (const game of response?.Data?.Games || []) {
      const start = cpblStartDate(game.PreExeDate);
      if (game.GameStatus !== "SCHEDULED" || !Number.isFinite(start.getTime()) || start.getTime() < Date.now()) continue;
      gamesById.set(game.GameId || `${game.PreExeDate}-${game.GameSno}`, { game, start });
    }
  }

  return [...gamesById.values()]
    .sort((left, right) => left.start - right.start)
    .slice(0, MAX_MATCHES)
    .map(({ game, start }) => {
      const homeRecord = game.Home?.AccumulationScore || {};
      const awayRecord = game.Visiting?.AccumulationScore || {};
      const home = {
        name: game.Home?.Team?.Name || "主隊",
        wins: homeRecord.W,
        losses: homeRecord.L,
        ties: homeRecord.T,
      };
      const away = {
        name: game.Visiting?.Team?.Name || "客隊",
        wins: awayRecord.W,
        losses: awayRecord.L,
        ties: awayRecord.T,
      };
      const pick = pickByRecord(home, away);
      const seed = matchSeed("CPBL", home.name, away.name, game.PreExeDate);
      const score = baseballScore(pick.stronger, seed);

      return applyHomeAwayScore({
        league: "CPBL",
        date: String(game.PreExeDate || "").slice(0, 10),
        home: home.name,
        away: away.name,
        startTime: formatTaiwanTime(start.toISOString()),
        prediction: pick.winner,
        spread: spreadAdvice("CPBL", pick.winner, pick.stronger, seed),
        total: score.totalAdvice,
        updatedAt: formatTaiwanTime(new Date().toISOString()),
        teamData: {
          home,
          away,
          stronger: pick.stronger,
          gameId: game.GameId,
          venue: game.Field?.Abbe || "",
          source: "CPBL 官方進階數據",
        },
      }, score);
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
    const seed = matchSeed("MLB", home.name, away.name, game.gameDate);
    const score = baseballScore(pick.stronger, seed);

    return applyHomeAwayScore({
      league: "MLB",
      date: date.date,
      home: home.name,
      away: away.name,
      startTime: formatTaiwanTime(game.gameDate),
      prediction: pick.winner,
      spread: spreadAdvice("MLB", pick.winner, pick.stronger, seed),
      total: score.totalAdvice,
      updatedAt: formatTaiwanTime(new Date().toISOString()),
      teamData: { home, away, stronger: pick.stronger },
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
      const seed = matchSeed("NBA", home.name, away.name, game.gameTimeUTC);
      const score = basketballScore(pick.stronger, seed);

      return applyHomeAwayScore({
        league: "NBA",
        date: formatDate(taiwanNow()),
        home: home.name,
        away: away.name,
        startTime: formatTaiwanTime(game.gameTimeUTC),
        prediction: pick.winner,
        spread: spreadAdvice("NBA", pick.winner, pick.stronger, seed),
        total: score.totalAdvice,
        updatedAt: formatTaiwanTime(new Date().toISOString()),
        teamData: { home, away, stronger: pick.stronger },
      }, score);
    });
}

async function loadAvailableMatches(league) {
  try {
    let matches = [];
    if (league === "CPBL") matches = await loadCpblMatches();
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
