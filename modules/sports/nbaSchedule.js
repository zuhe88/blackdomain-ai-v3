const SCHEDULE_URL = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json";
const ESPN_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const DAY = 86400000;

function dateInZone(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function upcomingGames(games, now) {
  const byId = new Map();
  for (const game of games) {
    const start = Date.parse(game.gameTimeUTC);
    if (Number(game.gameStatus) !== 1 || !Number.isFinite(start) || start <= now) continue;
    if (!game.homeTeam?.teamTricode || !game.awayTeam?.teamTricode) continue;
    byId.set(game.gameId || `${start}-${game.homeTeam.teamTricode}-${game.awayTeam.teamTricode}`, game);
  }
  return [...byId.values()].sort((a, b) => Date.parse(a.gameTimeUTC) - Date.parse(b.gameTimeUTC));
}

function espnTeam(competitor) {
  const aliases = { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS", PHO: "PHX" };
  const abbreviation = String(competitor?.team?.abbreviation || "").toUpperCase();
  const record = competitor?.records?.find((item) => item.type === "total" || item.name === "overall")?.summary || "0-0";
  const [wins, losses] = record.split("-").map(Number);
  return { teamTricode: aliases[abbreviation] || abbreviation, wins, losses };
}

function espnGames(events) {
  return events.flatMap((event) => {
    const competition = event.competitions?.[0];
    const status = competition?.status?.type || event.status?.type;
    // Postponed, cancelled, in-progress and completed events cannot be analysed as upcoming.
    if (status?.name !== "STATUS_SCHEDULED" || status.state !== "pre") return [];
    const home = competition?.competitors?.find((item) => item.homeAway === "home");
    const away = competition?.competitors?.find((item) => item.homeAway === "away");
    return [{ gameId: event.id, gameStatus: 1, gameTimeUTC: competition?.date || event.date,
      homeTeam: espnTeam(home), awayTeam: espnTeam(away), source: "ESPN 賽程" }];
  });
}

async function loadNbaSchedule(requestJson, now = Date.now()) {
  try {
    const data = await requestJson(SCHEDULE_URL, {}, { Accept: "application/json", Referer: "https://www.nba.com/" });
    const dates = data?.leagueSchedule?.gameDates;
    if (!Array.isArray(dates) || !dates.every((date) => Array.isArray(date.games))) throw new Error("Invalid NBA schedule");
    const horizon = now + 15 * DAY;
    return upcomingGames(dates.flatMap((date) => date.games.map((game) => ({ ...game,
      gameTimeUTC: game.gameDateTimeUTC || game.gameTimeUTC, source: "NBA 官方賽程" }))), now)
      .filter((game) => Date.parse(game.gameTimeUTC) < horizon);
  } catch {
    // NBA's CDN can reject server traffic. Query actual US game dates, not Taiwan calendar dates.
    const firstDate = dateInZone(now, "America/New_York");
    const anchor = Date.parse(`${firstDate}T12:00:00Z`);
    const games = [];
    for (let offset = 0; offset < 15; offset += 3) {
      const results = await Promise.allSettled([0, 1, 2].map(async (day) => {
        const date = new Date(anchor + (offset + day) * DAY).toISOString().slice(0, 10).replace(/-/g, "");
        const data = await requestJson(ESPN_URL, { dates: date, limit: 100 });
        if (!Array.isArray(data?.events)) throw new Error("Invalid ESPN schedule");
        return espnGames(data.events);
      }));
      // An incomplete earlier day could hide the earliest upcoming fixture.
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("NBA_SCHEDULE_UNAVAILABLE");
      }
      games.push(...results.flatMap((result) => result.value));
      const upcoming = upcomingGames(games, now);
      if (upcoming.length) return upcoming;
    }
    return [];
  }
}

module.exports = { loadNbaSchedule, dateInZone };
