const supabase = require("../../services/supabase");
const { isAdminLineUserId } = require("../../config/admin");
const { validateAccount3A } = require("./validator");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function unavailable() {
  const error = new Error("LINE 轉移狀態暫時無法確認，請稍後重試。");
  error.status = 503;
  error.code = "VIP_ACCESS_UNAVAILABLE";
  return error;
}
async function isLineRevoked(userId) {
  if (!userId || !supabase) return false;
  const { data, error } = await supabase.from("lottery_settings").select("value")
    .eq("key", `vip_line_revoked:${userId}`).maybeSingle();
  if (error) throw unavailable();
  return data?.value?.revoked === true;
}
async function call(name, args) {
  if (!supabase) return { ok: false, error: "資料庫尚未連線。" };
  try {
    const { data, error } = await supabase.rpc(name, args);
    if (error || typeof data?.ok !== "boolean") return { ok: false, error: "轉移尚未確認，請查詢申請狀態後再試。" };
    return data;
  } catch { return { ok: false, error: "轉移尚未確認，請查詢申請狀態後再試。" }; }
}
async function requestTransfer(account, userId, lineName) {
  const valid = validateAccount3A(account);
  if (!valid.ok) return { ok: false, error: valid.error };
  if (!/^U[0-9a-f]{32}$/i.test(userId) || isAdminLineUserId(userId)) return { ok: false, error: "請使用新會員 LINE 提出申請。" };
  return call("request_vip_line_transfer", { p_account: valid.value, p_new_line: userId, p_name: String(lineName || "未取得").slice(0, 100) });
}
async function reviewTransfer(id, account, adminId, approve) {
  if (!isAdminLineUserId(adminId)) return { ok: false, error: "無權限使用此功能。" };
  const valid = validateAccount3A(account);
  if (!UUID.test(id) || !valid.ok) return { ok: false, error: "請提供完整申請編號與 3A 帳號。" };
  const detail = await listTransfers(adminId, id);
  if (!detail.ok) return detail;
  const row = detail.rows[0];
  if (!row || isAdminLineUserId(row.old_line_user_id) || isAdminLineUserId(row.new_line_user_id)) return { ok: false, error: "找不到申請或不允許轉移管理員帳號。" };
  return call("review_vip_line_transfer", { p_id: id, p_account: valid.value, p_admin: adminId, p_approve: approve });
}
async function listTransfers(adminId, id = null) {
  if (!isAdminLineUserId(adminId)) return { ok: false, error: "無權限使用此功能。" };
  if (!supabase || (id && !UUID.test(id))) return { ok: false, error: "請確認申請編號與資料庫連線。" };
  let query = supabase.from("vip_line_transfers").select("id,three_a_account,old_line_user_id,new_line_user_id,old_line_name,new_line_name,status,created_at,expires_at");
  query = id ? query.eq("id", id) : query.eq("status", "pending").gt("expires_at", new Date().toISOString());
  const { data, error } = await query.order("created_at", { ascending: false }).limit(10);
  return error ? { ok: false, error: "無法讀取轉移申請，請稍後再試。" } : { ok: true, rows: data || [] };
}
module.exports = { requestTransfer, reviewTransfer, listTransfers, isLineRevoked };
