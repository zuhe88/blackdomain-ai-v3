const supabase = require("../../services/supabase");

const STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
};

function isConnected() {
  return Boolean(supabase);
}

function normalizeUser(record) {
  if (!record) {
    return {
      lineUserId: null,
      lineName: null,
      account3A: null,
      vipStatus: null,
      aiPermission: false,
      expiresAt: null,
      isAdmin: false,
      createdAt: null,
      updatedAt: null,
    };
  }

  return {
    lineUserId: record.line_user_id || null,
    lineName: record.line_name || null,
    account3A: record.three_a_account || null,
    vipStatus: record.vip_status || null,
    aiPermission: record.ai_permission === true,
    expiresAt: record.expires_at || null,
    isAdmin: record.is_admin === true,
    createdAt: record.created_at || null,
    updatedAt: record.updated_at || null,
  };
}

function normalizeRequest(record) {
  if (!record) return null;
  return {
    id: record.id || null,
    lineUserId: record.line_user_id || null,
    lineName: record.line_name || null,
    account3A: record.three_a_account || null,
    status: record.status || null,
    requestTime: record.request_time || null,
    reviewTime: record.review_time || null,
    reviewAdmin: record.review_admin || null,
    createdAt: record.created_at || null,
    updatedAt: record.updated_at || null,
  };
}

async function findVipUserByLineUserId(lineUserId) {
  if (!isConnected() || !lineUserId) return normalizeUser(null);
  const { data, error } = await supabase
    .from("vip_users")
    .select("*")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (error) return normalizeUser(null);
  return normalizeUser(data);
}

async function findVipUserBy3AAccount(account3A) {
  if (!isConnected() || !account3A) return normalizeUser(null);
  const { data, error } = await supabase
    .from("vip_users")
    .select("*")
    .eq("three_a_account", account3A)
    .maybeSingle();
  if (error) return normalizeUser(null);
  return normalizeUser(data);
}

async function findRequestBy3AAccount(account3A) {
  if (!isConnected() || !account3A) return null;
  const { data, error } = await supabase
    .from("vip_requests")
    .select("*")
    .eq("three_a_account", account3A)
    .maybeSingle();
  if (error) return null;
  return normalizeRequest(data);
}

async function submitVipRequest({ lineUserId, lineName, account3A }) {
  if (!isConnected()) return { ok: false, error: "Supabase未連線" };

  const payload = {
    line_user_id: lineUserId,
    line_name: lineName || "未取得",
    three_a_account: account3A,
    status: STATUS.PENDING,
    request_time: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const existing = await findRequestBy3AAccount(account3A);
  if (existing) {
    const { data, error } = await supabase
      .from("vip_requests")
      .update(payload)
      .eq("three_a_account", account3A)
      .select("*")
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, request: normalizeRequest(data) };
  }

  const { data, error } = await supabase
    .from("vip_requests")
    .insert({
      ...payload,
      created_at: new Date().toISOString(),
    })
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, request: normalizeRequest(data) };
}

function expiresAfterDays(days) {
  return new Date(Date.now() + Math.max(1, Number(days || 30)) * 86400000).toISOString();
}

async function upsertVipUser({ lineUserId, lineName, account3A, vipStatus, aiPermission, expiresAt, isAdmin = false }) {
  if (!isConnected()) return { ok: false, error: "Supabase未連線" };

  const payload = {
    line_user_id: lineUserId || null,
    line_name: lineName || "未取得",
    three_a_account: account3A,
    vip_status: vipStatus,
    ai_permission: Boolean(aiPermission),
    expires_at: expiresAt || null,
    is_admin: Boolean(isAdmin),
    updated_at: new Date().toISOString(),
  };

  const existing = await findVipUserBy3AAccount(account3A);
  if (existing.account3A) {
    const { data, error } = await supabase
      .from("vip_users")
      .update(payload)
      .eq("three_a_account", account3A)
      .select("*")
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, user: normalizeUser(data) };
  }

  const { data, error } = await supabase
    .from("vip_users")
    .insert({
      ...payload,
      created_at: new Date().toISOString(),
    })
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, user: normalizeUser(data) };
}

async function approveVip({ account3A, days, permanent = false, adminLineUserId }) {
  const request = await findRequestBy3AAccount(account3A);
  const existingUser = await findVipUserBy3AAccount(account3A);
  const lineUserId = request?.lineUserId || existingUser.lineUserId;
  const lineName = request?.lineName || existingUser.lineName || "未取得";
  const expiresAt = permanent ? null : expiresAfterDays(days || 30);

  const result = await upsertVipUser({
    lineUserId,
    lineName,
    account3A,
    vipStatus: STATUS.APPROVED,
    aiPermission: true,
    expiresAt,
    isAdmin: false,
  });

  if (!result.ok) return result;

  if (isConnected()) {
    await supabase
      .from("vip_requests")
      .update({
        status: STATUS.APPROVED,
        review_time: new Date().toISOString(),
        review_admin: adminLineUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("three_a_account", account3A);
    await logAdminAction(adminLineUserId, permanent ? "永久VIP" : "開通VIP", account3A, result.ok ? "success" : "failed");
  }

  return result;
}

async function extendVip(account3A, days, adminLineUserId) {
  const user = await findVipUserBy3AAccount(account3A);
  if (!user.account3A) return { ok: false, error: "查無3A帳號" };
  const base = user.expiresAt && new Date(user.expiresAt).getTime() > Date.now()
    ? new Date(user.expiresAt).getTime()
    : Date.now();
  const expiresAt = new Date(base + Math.max(1, Number(days || 30)) * 86400000).toISOString();
  const result = await upsertVipUser({
    lineUserId: user.lineUserId,
    lineName: user.lineName,
    account3A,
    vipStatus: STATUS.APPROVED,
    aiPermission: true,
    expiresAt,
    isAdmin: false,
  });
  await logAdminAction(adminLineUserId, "延長VIP", account3A, result.ok ? "success" : "failed");
  return result;
}

async function cancelVip(account3A, adminLineUserId) {
  const user = await findVipUserBy3AAccount(account3A);
  if (!user.account3A) return { ok: false, error: "查無3A帳號" };
  const result = await upsertVipUser({
    lineUserId: user.lineUserId,
    lineName: user.lineName,
    account3A,
    vipStatus: STATUS.CANCELLED,
    aiPermission: false,
    expiresAt: new Date().toISOString(),
    isAdmin: false,
  });
  await logAdminAction(adminLineUserId, "取消VIP", account3A, result.ok ? "success" : "failed");
  return result;
}

async function listPendingRequests() {
  if (!isConnected()) return [];
  const { data, error } = await supabase
    .from("vip_requests")
    .select("*")
    .eq("status", STATUS.PENDING);
  if (error || !Array.isArray(data)) return [];
  return data.map(normalizeRequest);
}

async function listVipUsers() {
  if (!isConnected()) return [];
  const { data, error } = await supabase.from("vip_users").select("*");
  if (error || !Array.isArray(data)) return [];
  return data.slice(0, 20).map(normalizeUser);
}

async function logAdminAction(adminLineUserId, action, target, result) {
  if (!isConnected()) return;
  await supabase.from("admin_logs").insert({
    admin_line_user_id: adminLineUserId,
    action,
    target,
    result,
    created_at: new Date().toISOString(),
  });
}

async function logAiUsage({ lineUserId, threeAAccount, module }) {
  if (!isConnected()) return;
  await supabase.from("ai_usage_logs").insert({
    line_user_id: lineUserId,
    three_a_account: threeAAccount || null,
    module,
    created_at: new Date().toISOString(),
  });
}

module.exports = {
  STATUS,
  findVipUserByLineUserId,
  findVipUserBy3AAccount,
  submitVipRequest,
  approveVip,
  extendVip,
  cancelVip,
  listPendingRequests,
  listVipUsers,
  logAdminAction,
  logAiUsage,
};
