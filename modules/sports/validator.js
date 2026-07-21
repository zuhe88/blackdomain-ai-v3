function isSupportedLeague(value) {
  return ["CPBL", "MLB", "NBA"].includes(String(value || "").trim());
}

module.exports = {
  isSupportedLeague,
};
