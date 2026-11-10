const { createRoadSource } = require("./dgSource");
const { AB_ROOMS } = require("./constants");

module.exports = createRoadSource({
  platform: "歐博",
  rooms: AB_ROOMS,
  roomPattern: /^((?:B|Q|C|IB|V)\d{3})$/,
  freshnessSetting: "AB_DATA_FRESHNESS_MS",
  defaultFreshnessMs: 45000,
});
