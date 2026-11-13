if (location.origin === "https://www.ab88.games:8888") {
  window.WebSocket = new Proxy(window.WebSocket, {
    construct(Target, args, newTarget) {
      const socket = Reflect.construct(Target, args, newTarget);
      if (/^wss:\/\/sfs\d+[a-z]\.(?:51shengce\.com|maofeiyan\.com)(?::8843)?\/websocket$/i.test(String(args[0]))) {
        socket.addEventListener("message", ({data}) => {
          if (typeof data === "string" && data.length < 350000) {
            window.postMessage({type:"BLACKDOMAIN_AB_PACKET", data}, location.origin);
          }
        });
      }
      return socket;
    },
  });
}
