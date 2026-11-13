const dgSource = require("../modules/baccarat/dgSource");
const t9Source = require("../modules/baccarat/t9Source");
const abSource = require("../modules/baccarat/abSource");
const mtSource = require("../modules/baccarat/mtSource");
const electronicSource = require("../modules/electronic/source");
const electronicAvailability = require("../modules/electronic/availability");
const mbSource = require("../modules/mb/source");
const { lineConfig } = require("./line");
const { isLineWebsiteOnlyMode } = require("../config/lineWebsiteMode");

function ageSeconds(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((Date.now() - timestamp) / 1000));
}

function stateFor(updatedAt, available, freshSeconds) {
  const age = ageSeconds(updatedAt);
  if (!available || age === null) return "offline";
  return age <= freshSeconds ? "healthy" : "stale";
}

function baccaratProvider(id, label, source) {
  const snapshot = source.getSnapshot();
  const tables = Array.isArray(snapshot?.tables) ? snapshot.tables : [];
  const freshTables = tables.filter((table) => source.isRoomFresh(table.room)).length;
  return {
    id,
    label,
    state: freshTables ? "healthy" : snapshot?.updatedAt ? "stale" : "offline",
    lastUpdatedAt: snapshot?.updatedAt || null,
    ageSeconds: ageSeconds(snapshot?.updatedAt),
    metrics: { tables: tables.length, freshTables, roomsWithHistory: tables.filter((table) => table.historyCount > 0).length },
  };
}

function electronicProvider() {
  const games = electronicSource.getSnapshot();
  const details = games.map((game) => ({
    gameName: game.gameName,
    state: electronicSource.hasReadyData(game.gameName)
      ? "healthy"
      : game.updatedAt ? "stale" : "offline",
    lastUpdatedAt: game.updatedAt || null,
    ageSeconds: ageSeconds(game.updatedAt),
    tables: game.tables.length,
    emptyRooms: game.tables.filter((table) => table.status === "Empty" && table.occupied !== true).length,
    pagesCovered: Number(game.sourcePagesCovered) || 0,
  }));
  const newest = details.map((game) => game.lastUpdatedAt).filter(Boolean).sort().at(-1) || null;
  const readyGames = details.filter((game) => game.state === "healthy").length;
  return {
    id: "electronic",
    label: "ATG 電子",
    state: readyGames === details.length && readyGames > 0 ? "healthy" : readyGames ? "degraded" : newest ? "stale" : "offline",
    lastUpdatedAt: newest,
    ageSeconds: ageSeconds(newest),
    metrics: { readyGames },
    allGamesEnabled: electronicAvailability.areAllElectronicGamesEnabled(),
    games: details,
  };
}

function mbProvider() {
  const snapshot = mbSource.getSnapshot();
  const tracks = Array.isArray(snapshot.tracks) ? snapshot.tracks : [];
  const newest = tracks.map((track) => track.updatedAt).filter(Boolean).sort().at(-1) || null;
  return {
    id: "mb",
    label: "MB 彈珠",
    state: stateFor(newest, tracks.some((track) => track.historyCount > 0), 180),
    lastUpdatedAt: newest,
    ageSeconds: ageSeconds(newest),
    metrics: { tracks: tracks.length, tracksWithHistory: tracks.filter((track) => track.historyCount > 0).length },
  };
}

function getSystemHealth() {
  const providers = [
    baccaratProvider("dg", "DG 百家樂", dgSource),
    baccaratProvider("mt", "MT 百家樂", mtSource),
    baccaratProvider("ab", "歐博百家樂", abSource),
    baccaratProvider("t9", "T9 百家樂", t9Source),
    electronicProvider(),
    mbProvider(),
  ];
  const unhealthy = providers.filter((provider) => !["healthy", "maintenance"].includes(provider.state)).length;
  return {
    generatedAt: new Date().toISOString(),
    service: {
      state: unhealthy ? "degraded" : "healthy",
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      databaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
    delivery: {
      websitePrimary: true,
      lineWebsiteOnlyMode: isLineWebsiteOnlyMode(),
      lineConfigured: Boolean(lineConfig.channelAccessToken && lineConfig.channelSecret),
    },
    providers,
  };
}

module.exports = { getSystemHealth };
