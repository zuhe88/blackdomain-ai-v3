function isRoomNumber(value) {
  return /^\d+$/.test(String(value || "").trim());
}

module.exports = {
  isRoomNumber,
};
