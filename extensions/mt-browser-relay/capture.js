(() => {
  "use strict";
  const NativeWebSocket = window.WebSocket;
  const TABLES_ACTION = "/api/v1/gametype/*/game/*/room/*/tables";
  const TYPE = "BLACKDOMAIN_MT_BROWSER_TABLES_V1";
  let pollCurrent = null;
  let requiresLogin = false;
  function reportState() {
    window.postMessage({ type: "BLACKDOMAIN_MT_SOCKET_STATE", requiresLogin }, location.origin);
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin
      || event.data?.type !== "BLACKDOMAIN_MT_REQUEST_TABLES") return;
    if (pollCurrent) pollCurrent();
    reportState();
  });

  function tablesFrom(message) {
    const action = typeof message.action === "string" ? message.action : message.action?.name;
    if (action !== TABLES_ACTION) return [];
    return Object.values(message.msg?.tables || {})
      .filter((table) => table?.table_type === "BAC" || table?.table_type === "BAS")
      .slice(0, 50)
      .map((table) => ({
        table_id: table.table_id, table_name: table.table_name, table_type: table.table_type,
        game_sn: table.game_sn, game_state: table.game_state, shoe: table.shoe, round: table.round,
        trend: {
          bead_plate2: table.trend?.bead_plate2,
          total_round_banker: table.trend?.total_round_banker,
          total_round_player: table.trend?.total_round_player,
          total_round_tie: table.trend?.total_round_tie,
        },
      }));
  }

  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(Target, args, newTarget) {
      const socket = Reflect.construct(Target, args, newTarget);
      let url;
      try { url = new URL(String(args[0]), location.href); } catch { return socket; }
      if (url.protocol !== "wss:" || !/(^|\.)ofalive99\.net$/i.test(url.hostname)
        || url.pathname !== "/game/ws") return socket;
      let timer = null;
      let authenticated = false;
      let lastRequestAt = 0;
      let lastRequestReason = "none";
      let requestCount = 0;
      const requestTables = (reason = "timer", minimumGap = 4500) => {
        if (socket.readyState !== NativeWebSocket.OPEN) return;
        if (!authenticated || Date.now() - lastRequestAt < minimumGap) return;
        lastRequestAt = Date.now();
        lastRequestReason = reason;
        requestCount += 1;
        socket.send(JSON.stringify({ method: "GET", action: {
          name: TABLES_ACTION, data: { gametype_id: 3, game_id: 1, room_id: 1 },
        } }));
      };
      const startPolling = () => {
        authenticated = true;
        requiresLogin = false;
        if (!timer) timer = window.setInterval(() => requestTables("timer"), 5000);
      };
      const pollThisSocket = () => requestTables("watchdog", 1000);
      pollCurrent = pollThisSocket;
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string" || event.data.length > 750 * 1024) return;
        try {
          const message = JSON.parse(event.data);
          const action = typeof message.action === "string" ? message.action : message.action?.name;
          if (message.name === "/api/v1/member/logout"
            || (action === "/api/v1/authenticate" && message.err != null && Number(message.err) !== 0)) {
            authenticated = false;
            if (pollCurrent === pollThisSocket) { requiresLogin = true; reportState(); }
            return;
          }
          // Use the application's already authenticated socket. Never send a login or a wager.
          if (action === "/api/v1/authenticate" && Number(message.err) === 0) {
            startPolling();
            requestTables("authenticated");
            reportState();
          }
          const tables = tablesFrom(message);
          if (tables.length) {
            // Some MT clients authenticate through a different response shape.
            // A real table response also proves that this socket can read tables.
            startPolling();
            window.postMessage({ type: TYPE, tables, diagnostics: {
              version: "1.2.0",
              capturedAt: new Date().toISOString(),
              visibility: document.visibilityState,
              pollingActive: Boolean(timer),
              lastRequestAt: lastRequestAt ? new Date(lastRequestAt).toISOString() : null,
              lastRequestReason,
              requestCount,
            } }, location.origin);
          }
          if (message.body?.table_id != null) requestTables("table-event", 1000);
          // Incoming network events still drive refreshes when background timers
          // are throttled. Only request new snapshots; never replay cached tables.
          else if (authenticated) requestTables("socket-event");
        } catch { /* Ignore other application messages. */ }
      });
      const onVisible = () => {
        if (document.visibilityState === "visible") requestTables("visible", 1000);
      };
      document.addEventListener("visibilitychange", onVisible);
      socket.addEventListener("close", () => {
        authenticated = false;
        if (timer) window.clearInterval(timer);
        document.removeEventListener("visibilitychange", onVisible);
        if (pollCurrent === pollThisSocket) pollCurrent = null;
      });
      return socket;
    },
  });
})();
