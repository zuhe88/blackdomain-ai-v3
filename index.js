const { app } = require("./app");
const { handleEvent } = require("./routes/webhook");

module.exports = {
  app,
  handleEvent,
};
