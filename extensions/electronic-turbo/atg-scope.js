"use strict";

(() => {
  const knownPath = /^\/egames\/(?:22020103b31b7390f07b1551e8538589b5e51967|cfca28d832b0ae2c364caae4b6de4e11aa22f0c4|88d5a6c6b3ebe4c6410b52b1c1aba71f2fad6de0|361d567d94ac569664c82068a30b762e8d8438b8|2b4c37c532b5e60f542a29c23e602748c06fd426|9c0ec83253193a1c672c2906b83e88e29a61a826|e19fdb8f5121a0abeecca7638e92d010dbe496c1)\/game\/?$/i;
  const knownName = /^(?:g100[15789]|egyptian-mythology|golden-seth|hades|scarlet-three-kingdoms|tiger-princess|(?:slot-)?erase-(?:any-times-[12]|cluster-times-1))$/i;
  const query = new URLSearchParams(location.search);
  const names = [query.get("gn") || "", query.get("gt") || ""];
  if (!knownPath.test(location.pathname) && !names.some(value => knownName.test(value))) return;
  const root = document.documentElement;
  root.setAttribute("data-blackdomain-supported-atg", "");
  const seth2Path = /^\/egames\/(?:22020103b31b7390f07b1551e8538589b5e51967|361d567d94ac569664c82068a30b762e8d8438b8)\/game\/?$/i;
  if (seth2Path.test(location.pathname) || names.some(value => /^g1005$/i.test(value))) {
    root.setAttribute("data-blackdomain-seth2-game", "");
  }
})();
