function isValid539Number(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 39;
}

module.exports = {
  isValid539Number,
};
