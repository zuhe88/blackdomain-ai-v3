function isVipStatus(value) {
  return ["已開通", "未開通", "已到期", "待審核"].includes(String(value || "").trim());
}

const ACCOUNT_3A_PATTERN = /^[A-Za-z0-9]+$/;

function validateAccount3A(value) {
  const account = String(value || "").trim();
  if (!account) {
    return { ok: false, error: "請輸入您的3A帳號。" };
  }
  if (!ACCOUNT_3A_PATTERN.test(account)) {
    return {
      ok: false,
      error: "3A帳號只能使用半形英文字母與數字，不可包含中文、空白或其他符號。",
    };
  }
  return { ok: true, value: account.toLowerCase() };
}

module.exports = {
  ACCOUNT_3A_PATTERN,
  isVipStatus,
  validateAccount3A,
};
