function isSupportedLeague(value) {
  return ["世足", "MLB", "NBA"].includes(String(value || "").trim());
}

module.exports = {
  isSupportedLeague,
};
