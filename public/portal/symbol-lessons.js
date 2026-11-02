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
  // Fixed teaching examples from ATG X. Never use room statistics to select one
  // as a current symbol signal, purchase instruction or outcome prediction.
  const examples = {
    戰神賽特1: [[["scatter", 3]], [["blade", 5], ["red", 3]], [["eye", 6], ["yellow", 2]], [["staff", 4], ["purple", 4]], [["bow", 5], ["blue", 3]], [["yellow", 4], ["green", 4]]],
    戰神賽特2: [[["scatter", 3]], [["scatter", 2], ["awakening", 1]], [["blade", 5], ["red", 3]], [["eye", 6], ["yellow", 2]], [["staff", 5], ["blue", 3]], [["bow", 4], ["green", 4]]],
  };
  function forGame(gameName) {
    if (!Object.prototype.hasOwnProperty.call(examples, gameName)) return null;
    return {
      title: "圖案觀察教學",
      description: "固定圖案組合範例，請自行對照遊戲盤面；不代表目前房間已出現，也不代表下一轉結果或購買時機。",
      note: "數量僅供辨識與記錄；不同圖案不能相加視為同符號消除，實際觸發與賠付以遊戲規則為準。",
      examples: examples[gameName].map((group, index) => ({
        label: `教學組合 ${index + 1}`,
        symbols: group.map(([id, count]) => ({ id, count, label: symbols[id][0], image: `/atg-x/assets/symbols/${symbols[id][1]}` })),
      })),
    };
  }
  const api = { forGame };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BlackdomainSymbolLessons = api;
})(typeof globalThis === "object" ? globalThis : this);
