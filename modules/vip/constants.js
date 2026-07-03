const COMMANDS = ["VIP", "vip", "VIP查詢", "我的VIP", "會員", "VIP中心", "會員中心", "👑 VIP中心"];
const BIND_COMMANDS = ["綁定", "綁定3A"];
const ADMIN_COMMANDS = ["管理指令", "管理員指令", "待審核", "查會員", "開通", "取消VIP", "延長VIP", "永久VIP", "會員列表"];

const VIP_TABLES = ["vip_members", "vip", "vips", "users"];
const THREE_A_FIELDS = ["three_a_account", "account_3a", "account", "member_account", "username"];
const LINE_USER_FIELDS = ["line_user_id", "lineUserId", "user_id"];
const LINE_NAME_FIELDS = ["line_name", "display_name", "displayName", "name"];
const STATUS_FIELDS = ["vip_status", "status", "vipStatus"];
const PERMISSION_FIELDS = ["ai_permission", "aiPermission", "can_use_ai"];
const EXPIRES_AT_FIELDS = ["expires_at", "vip_expires_at", "vip_expire_at", "vip_end_at", "expired_at"];
const IS_ADMIN_FIELDS = ["is_admin", "isAdmin"];

const STATUSES = {
  ADMIN: "管理員",
  ACTIVE: "已開通",
  PENDING: "待審核",
  EXPIRED: "已過期",
  UNBOUND: "未綁定",
  CANCELLED: "已取消",
};

module.exports = {
  COMMANDS,
  BIND_COMMANDS,
  ADMIN_COMMANDS,
  VIP_TABLES,
  THREE_A_FIELDS,
  LINE_USER_FIELDS,
  LINE_NAME_FIELDS,
  STATUS_FIELDS,
  PERMISSION_FIELDS,
  EXPIRES_AT_FIELDS,
  IS_ADMIN_FIELDS,
  STATUSES,
};
