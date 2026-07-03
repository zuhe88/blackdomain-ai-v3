function isVipStatus(value) {
  return ["已開通", "未開通", "已到期", "待審核"].includes(String(value || "").trim());
}

module.exports = {
  isVipStatus,
};
