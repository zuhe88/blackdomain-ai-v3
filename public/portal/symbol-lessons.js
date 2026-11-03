(function (root) {
  "use strict";
  const symbols = {
    scatter: ["SCATTER", "scatter-standard.png"],
    awakening: ["覺醒 SCATTER", "scatter-awakening.png"],
    eye: ["荷魯斯之眼", "extracted/eye.png"],
    staff: ["眼鏡蛇權杖", "extracted/staff.png"],
    bow: ["弓箭", "extracted/bow.png"],
    blade: ["沙漠之刃", "extracted/blade.png"],
    yellow: ["黃寶石", "extracted/yellow.png"],
    red: ["紅寶石", "extracted/red.png"],
    purple: ["紫寶石", "extracted/purple.png"],
    blue: ["藍寶石", "extracted/blue.png"],
    green: ["綠寶石", "extracted/green.png"],
  };
  function catalog(gameName) {
    if (gameName !== "戰神賽特1" && gameName !== "戰神賽特2") return [];
    return Object.entries(symbols).filter(([id]) => gameName === "戰神賽特2" || id !== "awakening")
      .map(([id, [label, image]]) => ({ id, label, image: `/atg-x/assets/symbols/${image}` }));
  }
  function isScatter(symbol) { return symbol.id === "scatter" || symbol.id === "awakening"; }
  // Draw once on the server per recommendation. The client reads that exact
  // group from the delivered message; redisplaying history must not redraw it.
  function forGame(gameName, random = Math.random) {
    const pool = catalog(gameName);
    if (!pool.length) return null;
    const size = 1 + Math.min(2, Math.max(0, Math.floor(random() * 3)));
    const group = [];
    for (let i = 0; i < size; i += 1) {
      const scatterCount = group.filter(isScatter).reduce((sum, symbol) => sum + symbol.count, 0);
      const candidates = pool.filter(symbol => !isScatter(symbol) || scatterCount < 3);
      const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)));
      const symbol = candidates[index];
      pool.splice(pool.findIndex(item => item.id === symbol.id), 1);
      const maximum = symbol.id === "awakening" ? 1 : isScatter(symbol) ? 3 - scatterCount : 6;
      group.push({ ...symbol, count: 1 + Math.min(maximum - 1, Math.max(0, Math.floor(random() * maximum))) });
    }
    return { title: "推薦訊號", symbols: group };
  }
  function fromTexts(gameName, texts) {
    if (!texts.includes("推薦訊號")) return null;
    const group = catalog(gameName).flatMap(symbol => {
      for (let count = 1; count <= 6; count += 1) {
        if (texts.includes(`${symbol.label} ×${count}`)) return [{ ...symbol, count }];
      }
      return [];
    });
    if (group.some(symbol => symbol.id === "awakening" && symbol.count > 1)) return null;
    if (group.filter(isScatter).reduce((sum, symbol) => sum + symbol.count, 0) > 3) return null;
    return group.length >= 1 && group.length <= 3 ? { title: "推薦訊號", symbols: group } : null;
  }
  const api = { forGame, catalog, fromTexts };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BlackdomainSymbolLessons = api;
})(typeof globalThis === "object" ? globalThis : this);
