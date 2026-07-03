const { USER_ERROR_TEXT, logError } = require("../utils/errorCodes");

function errorHandler(err, req, res, next) {
  if (!err) return next();

  logError("E008", err);
  return res.status(err.status || 500).json({
    ok: false,
    message: USER_ERROR_TEXT,
  });
}

module.exports = {
  errorHandler,
};
