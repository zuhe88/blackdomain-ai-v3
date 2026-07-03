const COMMANDS = ["VIP", "vip", "VIP查詢", "我的VIP", "會員", "VIP中心", "👑 VIP中心"];

const VIP_TABLES = ["vip", "vips", "users"];
const THREE_A_FIELDS = ["three_a_account", "account_3a", "account", "member_account", "username"];
const LINE_USER_FIELDS = ["line_user_id", "lineUserId", "user_id"];
const LINE_NAME_FIELDS = ["line_name", "display_name", "displayName", "name"];
const STATUS_FIELDS = ["vip_status", "status", "vipStatus"];
const EXPIRES_AT_FIELDS = ["vip_expires_at", "expires_at", "vip_expire_at", "vip_end_at", "expired_at"];

const STATUSES = {
  ADMIN: "管理員",
  ACTIVE: "已開通",
  PENDING: "待審核",
  EXPIRED: "已過期",
  UNBOUND: "未綁定",
};

module.exports = {
  COMMANDS,
  VIP_TABLES,
  THREE_A_FIELDS,
  LINE_USER_FIELDS,
  LINE_NAME_FIELDS,
  STATUS_FIELDS,
  EXPIRES_AT_FIELDS,
  STATUSES,
};
