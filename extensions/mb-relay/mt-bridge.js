(function () {
  "use strict";

  if (window.__blackdomainMtBridgeInstalled) return;
  window.__blackdomainMtBridgeInstalled = true;

  const NativeWebSocket = window.WebSocket;
  const TABLES_ACTION = "/api/v1/gametype/*/game/*/room/*/tables";
  const SOCKET_HOST = /^a1\.(ofalive99|mtx55|mtx66|mtx77|mtx88)\.net$/i;

  function sanitizeTables(value) {
    return Object.values(value || {})
      .filter((table) => table?.table_type === "BAC" || table?.table_type === "BAS")
      .slice(0, 50)
      .map((table) => ({
        table_id: table.table_id,
        table_name: table.table_name,
        table_type: table.table_type,
        game_sn: table.game_sn,
        game_state: table.game_state,
        shoe: table.shoe,
        round: table.round,
        trend: {
          bead_plate2: table.trend?.bead_plate2,
          total_round_banker: table.trend?.total_round_banker,
          total_round_player: table.trend?.total_round_player,
          total_round_tie: table.trend?.total_round_tie,
        },
      }));
  }

  function handleMessage(raw) {
    if (typeof raw !== "string" || raw.length > 512 * 1024) return;
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const action = typeof message.action === "string" ? message.action : message.action?.name;
    if (action !== TABLES_ACTION) return;
    const tables = sanitizeTables(message.msg?.tables);
    if (!tables.length) return;
    window.dispatchEvent(new CustomEvent("BLACKDOMAIN_MT_RELAY", {
      detail: { type: "tables", tables },
    }));
  }

  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(Target, args, NewTarget) {
      const socket = Reflect.construct(Target, args, NewTarget);
      try {
        const url = new URL(String(args[0] || ""));
        if (SOCKET_HOST.test(url.hostname)) {
          socket.addEventListener("message", (event) => handleMessage(event.data));
        }
      } catch {
        // Ignore unrelated sockets.
      }
      return socket;
    },
  });

  console.info("[BLACKDOMAIN MT] table observer active");
}());
