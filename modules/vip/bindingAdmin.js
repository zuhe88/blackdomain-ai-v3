const supabase = require("../../services/supabase");
const { isAdminLineUserId } = require("../../config/admin");
const { validateAccount3A } = require("./validator");

async function changeVipBinding(oldAccount, newAccount, adminId) {
  if (!isAdminLineUserId(adminId)) return { ok: false, error: "無權限使用此功能。" };
  const oldValue = validateAccount3A(oldAccount);
  const newValue = newAccount === null ? { ok: true, value: null } : validateAccount3A(newAccount);
  if (!oldValue.ok || !newValue.ok) return { ok: false, error: oldValue.error || newValue.error };
  if (oldValue.value === newValue.value) return { ok: false, error: "新帳號與舊帳號相同，未變更。" };
  if (!supabase) return { ok: false, error: "資料庫尚未連線，未變更綁定。" };
  try {
    const { data, error } = await supabase.rpc("admin_change_vip_binding", {
      p_old_account: oldValue.value, p_new_account: newValue.value, p_admin_id: adminId,
    });
    if (error) return { ok: false, error: "綁定更新未能確認，請查詢會員資料後再試。" };
    if (!data || typeof data.ok !== "boolean") return { ok: false, error: "綁定更新結果不明，請查詢會員資料。" };
    return data;
  } catch (error) {
    return { ok: false, error: "綁定更新未能確認，請查詢會員資料後再試。" };
  }
}

module.exports = { changeVipBinding };
