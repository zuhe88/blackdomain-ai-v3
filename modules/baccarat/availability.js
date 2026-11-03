const MT_PAUSE_REASON = "MT休息中";

// MT is available by default; retain an explicit maintenance override.
function isMtEntryEnabled() {
  return process.env.MT_ENTRY_ENABLED !== "false";
}

module.exports = { isMtEntryEnabled, MT_PAUSE_REASON };
