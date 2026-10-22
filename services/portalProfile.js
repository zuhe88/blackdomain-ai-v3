// Project only the signed-in member's existing access result; never grant access here.
function portalProfile(access, expiresAt) {
  const allowed = access?.allowed === true;
  const member = access?.user;
  const accessType = !allowed ? "none" : access.isAdmin ? "admin" : access.globalAccess ? "global"
    : member && !member.expiresAt && member.aiPermission === true ? "permanent" : "member";
  return {
    account: member?.account3A || null,
    accountPlatform: member?.accountPlatform || "3A",
    accessType,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : member?.expiresAt || null,
    features: allowed ? ["百家樂分析", "電子遊戲分析", "彩票分析", "體育數據"] : [],
  };
}
module.exports = { portalProfile };
