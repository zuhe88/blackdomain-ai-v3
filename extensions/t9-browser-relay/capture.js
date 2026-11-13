(() => {
  if (location.pathname !== "/VideoBaccarat/index.html") return;
  let previousSignature = "";
  let lastUpdate = Date.now();

  setInterval(() => {
    const game = window.HttpHandler_Lobby?.Ins?.GetParams("AppData")?.GetGameData("Baccarat");
    if (!Array.isArray(game?.Tables?.Values)) return;
    const tables = [];
    const activity = [];
    for (const table of game.Tables.Values) {
      const id = table.TableID;
      const round = table.CurRound?.GetValue();
      const state = table.CurState?.GetValue();
      const road = table.RoadData;
      if (!Number.isInteger(id) || !Number.isInteger(round) || typeof road !== "string") continue;
      const shuffling = state === 104;
      if (road && round !== road.split(",").length + 1) continue;
      if (state === 105 || state === 109 || (!road && round !== 1 && !shuffling)) continue;
      const countdownEndsAt = state === 101 ? table.EndBetTime?.getTime() ?? null : null;
      tables.push({ id, round, road, shuffling, countdownEndsAt });
      activity.push([id, round, state, road, countdownEndsAt]);
    }
    const signature = JSON.stringify(activity);
    if (signature !== previousSignature) {
      previousSignature = signature;
      lastUpdate = Date.now();
    }
    if (tables.length && Date.now() - lastUpdate < 45000) {
      window.postMessage({ type: "BLACKDOMAIN_T9_ROADS", tables }, location.origin);
    }
  }, 3000);
})();
