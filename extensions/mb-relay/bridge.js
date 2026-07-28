(function () {
  "use strict";

  if (window.__blackdomainMbBridgeInstalled) return;
  window.__blackdomainMbBridgeInstalled = true;

  const NativeWebSocket = window.WebSocket;
  const nativeFetch = window.fetch.bind(window);
  const ALLOWED_EVENTS = new Set(["OPEN", "CLOSE", "RESULT_PUBLIC", "TABLE_STATE_CHANGED"]);
  const GAME_BY_DCS = {
    368: "PK-MBRACE-1",
    369: "PK-MBRACE-2",
    370: "PK-MBRACE-3",
    371: "PK-MBRACE-4",
  };
  const cachedRoadmaps = {};
  let lastSocketEventAt = Date.now();
  let lastReloadAt = 0;

  function emit(body) {
    window.dispatchEvent(new CustomEvent("BLACKDOMAIN_MB_RELAY", { detail: body }));
  }

  function rememberRoadmaps(items) {
    items.forEach((item) => {
      if (!item?.game_name || !Array.isArray(item.roadmap)) return;
      cachedRoadmaps[item.game_name] = item;
    });
  }

  function marbleSide(value) {
    return Number(value) >= 6 ? "OVER" : "UNDER";
  }

  function marbleParity(value) {
    return Number(value) % 2 ? "ODD" : "EVEN";
  }

  function rememberLiveResult(data) {
    if (!Array.isArray(data.result) || data.result.length < 3 || !data.draw_num) return;
    const gameName = data.game_name || GAME_BY_DCS[Number(data.dcs_id)];
    if (!gameName) return;
    const values = data.result.slice(0, 3).map(Number);
    const sum = values[0] + values[1];
    const item = cachedRoadmaps[gameName] || { game_name: gameName, roadmap: [] };
    const record = {
      draw_num: String(data.draw_num),
      champion: {
        rank_value: String(values[0]),
        over_under: marbleSide(values[0]),
        odd_even: marbleParity(values[0]),
      },
      second: {
        rank_value: String(values[1]),
        over_under: marbleSide(values[1]),
        odd_even: marbleParity(values[1]),
      },
      third: {
        rank_value: String(values[2]),
        over_under: marbleSide(values[2]),
        odd_even: marbleParity(values[2]),
      },
      sum: {
        rank_value: String(sum),
        over_under: data.result_display?.over_under || (sum >= 12 ? "OVER" : "UNDER"),
        odd_even: data.result_display?.odd_even || marbleParity(sum),
      },
    };
    item.roadmap = [
      record,
      ...(Array.isArray(item.roadmap) ? item.roadmap : [])
        .filter((row) => String(row.draw_num) !== record.draw_num),
    ].slice(0, 200);
    cachedRoadmaps[gameName] = item;
  }

  function handleGraphql(json) {
    const items = json?.data?.marbleRoadmapBatch?.items;
    if (!Array.isArray(items) || !items.length) return;
    rememberRoadmaps(items);
    emit({ type: "roadmap", items });
  }

  window.fetch = async function blackdomainMbFetch(...args) {
    const response = await nativeFetch(...args);
    try {
      response.clone().json().then(handleGraphql).catch(() => {});
    } catch {
      // Keep the game's original response untouched.
    }
    return response;
  };

  function handleSocketMessage(raw) {
    if (typeof raw !== "string") return;
    let packet;
    try {
      packet = JSON.parse(raw);
    } catch {
      return;
    }
    if (!ALLOWED_EVENTS.has(packet?.event)) return;
    lastSocketEventAt = Date.now();
    const data = packet.data || {};
    if (packet.event === "RESULT_PUBLIC") rememberLiveResult(data);
    emit({
      type: "socket",
      event: packet.event,
      data: {
        dcs_id: data.dcs_id,
        game_name: data.game_name,
        draw_num: data.draw_num,
        next_draw_num: data.next_draw_num,
        current: data.current,
        state: data.state,
        state_string: data.state_string,
        result: data.result,
        result_display: data.result_display,
        result_time: data.result_time,
        sended_at: data.sended_at,
        public_result_at: data.public_result_at,
      },
    });
  }

  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(Target, args) {
      const socket = Reflect.construct(Target, args);
      socket.addEventListener("message", (event) => handleSocketMessage(event.data));
      socket.addEventListener("close", () => {
        lastSocketEventAt = Date.now() - 181000;
      });
      return socket;
    },
  });

  window.addEventListener("BLACKDOMAIN_MB_RELAY_READY", () => {
    const items = Object.values(cachedRoadmaps);
    if (items.length) emit({ type: "roadmap", items });
  });

  setInterval(() => {
    const items = Object.values(cachedRoadmaps);
    if (items.length) emit({ type: "roadmap", items });
    if (Date.now() - lastSocketEventAt > 180000 && Date.now() - lastReloadAt > 300000) {
      lastReloadAt = Date.now();
      window.location.reload();
    }
  }, 60000);

  console.info("[BLACKDOMAIN MB] 3A page bridge active");
}());
