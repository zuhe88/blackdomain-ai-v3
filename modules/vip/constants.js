const COMMANDS = ["VIP", "vip", "VIP中心", "VIP查詢", "我的VIP", "會員", "查VIP", "會員中心", "👑 VIP中心"];
const BIND_COMMANDS = ["綁定", "綁定3A"];
const ADMIN_COMMANDS = [
  "管理指令",
  "管理員指令",
  "待審核",
  "查會員",
  "開通",
  "取消VIP",
  "延長VIP",
  "扣天數",
  "減少VIP",
  "永久VIP",
  "會員列表",
];

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
  STATUSES,
};
