const MT_PAUSE_REASON = "MT休息中";

// Temporary entry closure; restore explicitly when MT resumes service.
function isMtEntryEnabled() {
  return process.env.MT_ENTRY_ENABLED === "true";
}

module.exports = { isMtEntryEnabled, MT_PAUSE_REASON };
