(() => {
  if (location.origin !== "https://www.ab88.games:8888") return;

  const maxPacketSize = 350000;
  const tableCommands = new Set(["getGameHall", "getRoadData", "pushGameTableResults", "pushGameStatus"]);
  const decoder = new TextDecoder("utf-8", { fatal: true });

  function forward(text) {
    if (text.length >= maxPacketSize || !text.trimStart().startsWith("{")) return;
    let packet;
    try {
      packet = JSON.parse(text);
    } catch {
      return;
    }
    if (!tableCommands.has(packet?.c) || !packet.p || typeof packet.p !== "object") return;
    window.postMessage({ type: "BLACKDOMAIN_AB_PACKET", data: text }, location.origin);
  }

  window.WebSocket = new Proxy(window.WebSocket, {
    construct(Target, args, newTarget) {
      const socket = Reflect.construct(Target, args, newTarget);
      if (!socket.url.startsWith("wss://")) return socket;

      // Identify the table feed by its protocol so a change of server or URL
      // parameters doesn't silently stop forwarding.
      let pending = Promise.resolve();
      socket.addEventListener("message", ({ data }) => {
        const size = typeof data === "string" ? data.length : data?.size ?? data?.byteLength;
        if (!Number.isFinite(size) || size >= maxPacketSize) return;
        pending = pending.then(async () => {
          if (typeof data === "string") return forward(data);
          if (data instanceof Blob) data = await data.arrayBuffer();
          if (data instanceof ArrayBuffer) forward(decoder.decode(data));
        }).catch(() => {});
      });
      return socket;
    },
  });
})();
