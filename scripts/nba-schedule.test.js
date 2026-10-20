const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadNbaSchedule, dateInZone } = require("../modules/sports/nbaSchedule");
const now = Date.parse("2026-10-20T02:00:00Z");
const game = (id, time, status = 1) => ({ gameId: id, gameStatus: status, gameDateTimeUTC: time,
  homeTeam: { teamTricode: "DET" }, awayTeam: { teamTricode: "BOS" } });
const event = (id, time, name = "STATUS_SCHEDULED", state = "pre") => ({ id, date: time,
  status: { type: { name, state } }, competitions: [{ date: time, competitors: [
    { homeAway: "home", team: { abbreviation: "NY" }, records: [{ type: "total", summary: "2-1" }] },
    { homeAway: "away", team: { abbreviation: "GS" }, records: [{ type: "total", summary: "1-2" }] },
  ] }] });

test("official full schedule skips finished dates, sorts future games and uses Taiwan game date", async () => {
  const calls = [];
  const games = await loadNbaSchedule(async (url) => {
    calls.push(url);
    return { leagueSchedule: { gameDates: [
      { games: [game("old", "2026-10-19T01:00:00Z", 3)] },
      { games: [game("later", "2026-10-21T01:30:00Z"), game("first", "2026-10-20T19:00:00Z"),
        game("started", "2026-10-20T01:00:00Z"), game("live", "2026-10-20T20:00:00Z", 2),
        game("invalid", "not-a-date"), game("far", "2026-12-01T20:00:00Z")] },
    ] } };
  }, now);
  assert.deepEqual(games.map((item) => item.gameId), ["first", "later"]);
  assert.equal(calls.length, 1);
  assert.equal(dateInZone(games[0].gameTimeUTC, "Asia/Taipei"), "2026-10-21");
});

test("CDN 403 falls back to US game dates and normalizes ESPN team codes", async () => {
  const dates = [];
  const games = await loadNbaSchedule(async (url, params) => {
    if (url.includes("cdn.nba.com")) throw new Error("403");
    dates.push(params.dates);
    return { events: params.dates === "20261020" ? [event("tomorrow-taiwan", "2026-10-20T19:00:00Z")] : [] };
  }, now);
  assert.ok(dates.includes("20261019"), "Taiwan morning is still the previous US date");
  assert.equal(games.length, 1);
  assert.equal(games[0].homeTeam.teamTricode, "NYK");
  assert.equal(games[0].awayTeam.teamTricode, "GSW");
  assert.equal(games[0].homeTeam.wins, 2);
  assert.equal(dateInZone(games[0].gameTimeUTC, "Asia/Taipei"), "2026-10-21");
});

test("finished or postponed fixtures do not prevent looking ahead; duplicates are removed", async () => {
  const dates = [];
  const games = await loadNbaSchedule(async (url, params) => {
    if (url.includes("cdn.nba.com")) return {};
    dates.push(params.dates);
    return { events: params.dates === "20261022"
      ? [event("future", "2026-10-22T23:00:00Z"), event("future", "2026-10-22T23:00:00Z")]
      : [event("finished", "2026-10-19T01:00:00Z", "STATUS_FINAL", "post"),
        event("postponed", "2026-10-23T01:00:00Z", "STATUS_POSTPONED"),
        event("past", "2026-10-20T01:00:00Z")] };
  }, now);
  assert.ok(dates.includes("20261022"));
  assert.deepEqual(games.map((item) => item.gameId), ["future"]);
});

test("upstream failures are not represented as no games, including partially failed dates", async () => {
  await assert.rejects(loadNbaSchedule(async () => { throw new Error("offline"); }, now), /NBA_SCHEDULE_UNAVAILABLE/);
  await assert.rejects(loadNbaSchedule(async (url, params) => {
    if (url.includes("cdn.nba.com") || params.dates === "20261019") throw new Error("timeout");
    return { events: [event("later", "2026-10-20T19:00:00Z")] };
  }, now), /NBA_SCHEDULE_UNAVAILABLE/);
});

test("a successfully checked empty schedule returns no games", async () => {
  assert.deepEqual(await loadNbaSchedule(async () => ({ leagueSchedule: { gameDates: [] } }), now), []);
  let requests = 0;
  assert.deepEqual(await loadNbaSchedule(async (url) => {
    if (url.includes("cdn.nba.com")) throw new Error("403");
    requests++;
    return { events: [] };
  }, now), []);
  assert.equal(requests, 15);
});
