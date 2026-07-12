const supabase = require("../../services/supabase");

const STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
};

const ACTIVE_REQUEST_STATUSES = [STATUS.PENDING, STATUS.APPROVED];

function isConnected() {
  return Boolean(supabase);
}

function normalizeAccount3A(account3A) {
  return String(account3A || "").trim().toLowerCase();
}

async function selectCaseInsensitive(table, field, value) {
  const normalizedValue = normalizeAccount3A(value);
  const query = supabase.from(table).select("*");
  if (typeof query.ilike === "function") {
    return query.ilike(field, normalizedValue);
  }

  const { data, error } = await query;
  if (error || !Array.isArray(data)) return { data: [], error };
  return {
    data: data.filter((row) => normalizeAccount3A(row?.[field]) === normalizedValue),
    error: null,
  };
}

async function maybeSingleCaseInsensitive(table, field, value) {
  const { data, error } = await selectCaseInsensitive(table, field, value);
  return { data: Array.isArray(data) ? data[0] || null : null, error };
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

function isActiveRequest(request) {
  return Boolean(request && ACTIVE_REQUEST_STATUSES.includes(request.status));
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
  const normalizedAccount = normalizeAccount3A(account3A);
  if (!isConnected() || !normalizedAccount) return normalizeUser(null);
  const { data, error } = await supabase
    .from("vip_users")
    .select("*")
    .eq("three_a_account", normalizedAccount)
    .maybeSingle();
  if (!error && data) return normalizeUser(data);

  const { data: ciData, error: ciError } = await maybeSingleCaseInsensitive(
    "vip_users",
    "three_a_account",
    normalizedAccount
  );
  if (ciError) return normalizeUser(null);
  return normalizeUser(ciData);
}

async function listRequestsByField(field, value) {
  const queryValue = field === "three_a_account" ? normalizeAccount3A(value) : value;
  if (!isConnected() || !queryValue) return [];
  const { data, error } = await supabase
    .from("vip_requests")
    .select("*")
    .eq(field, queryValue);
  if (!error && Array.isArray(data) && data.length) return data.map(normalizeRequest);
  if (field !== "three_a_account") return [];

  const { data: ciData, error: ciError } = await selectCaseInsensitive("vip_requests", field, queryValue);
  if (ciError || !Array.isArray(ciData)) return [];
  return ciData.map(normalizeRequest);
}

async function findRequestBy3AAccount(account3A) {
  const requests = await listRequestsByField("three_a_account", account3A);
  return requests[0] || null;
}

async function findActiveRequestByLineUserId(lineUserId) {
  const requests = await listRequestsByField("line_user_id", lineUserId);
  return requests.find(isActiveRequest) || null;
}

async function findActiveRequestBy3AAccount(account3A) {
  const requests = await listRequestsByField("three_a_account", account3A);
  return requests.find(isActiveRequest) || null;
}

function duplicateErrorMessage(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  if (code === "23505" || /duplicate|unique/i.test(message)) {
    return "此 3A帳號已被綁定或申請中，請聯繫管理員確認。";
  }
  return message || "系統忙碌中，請稍後再試。";
}

async function submitVipRequest({ lineUserId, lineName, account3A }) {
  if (!isConnected()) return { ok: false, code: "NO_SUPABASE", error: "Supabase尚未連線" };
  const normalizedAccount = normalizeAccount3A(account3A);

  const boundUser = await findVipUserByLineUserId(lineUserId);
  if (boundUser.account3A) {
    return { ok: false, code: "LINE_ALREADY_BOUND", user: boundUser };
  }

  const activeLineRequest = await findActiveRequestByLineUserId(lineUserId);
  if (activeLineRequest) {
    return {
      ok: false,
      code: activeLineRequest.status === STATUS.PENDING ? "LINE_PENDING" : "LINE_ALREADY_BOUND",
      request: activeLineRequest,
    };
  }

  const accountUser = await findVipUserBy3AAccount(normalizedAccount);
  if (accountUser.account3A) {
    return { ok: false, code: "ACCOUNT_TAKEN", user: accountUser };
  }

  const activeAccountRequest = await findActiveRequestBy3AAccount(normalizedAccount);
  if (activeAccountRequest) {
    return { ok: false, code: "ACCOUNT_TAKEN", request: activeAccountRequest };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("vip_requests")
    .insert({
      line_user_id: lineUserId,
      line_name: lineName || "未取得",
      three_a_account: normalizedAccount,
      status: STATUS.PENDING,
      request_time: now,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, code: "DUPLICATE", error: duplicateErrorMessage(error) };
  return { ok: true, request: normalizeRequest(data) };
}

function expiresAfterDays(days) {
  const count = Number(days);
  if (!Number.isFinite(count) || count <= 0) return null;
  return new Date(Date.now() + count * 86400000).toISOString();
}

async function upsertVipUser({ lineUserId, lineName, account3A, vipStatus, aiPermission, expiresAt, isAdmin = false }) {
  if (!isConnected()) return { ok: false, error: "Supabase尚未連線" };

  const now = new Date().toISOString();
  const normalizedAccount = normalizeAccount3A(account3A);
  const payload = {
    line_user_id: lineUserId || null,
    line_name: lineName || "未取得",
    three_a_account: normalizedAccount,
    vip_status: vipStatus,
    ai_permission: Boolean(aiPermission),
    expires_at: expiresAt || null,
    is_admin: Boolean(isAdmin),
    updated_at: now,
  };

  const existing = await findVipUserBy3AAccount(normalizedAccount);
  if (existing.account3A) {
    const { data, error } = await supabase
      .from("vip_users")
      .update(payload)
      .eq("three_a_account", existing.account3A)
      .select("*")
      .maybeSingle();
    if (error) return { ok: false, error: duplicateErrorMessage(error) };
    return { ok: true, user: normalizeUser(data) };
  }

  const { data, error } = await supabase
    .from("vip_users")
    .insert({ ...payload, created_at: now })
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: duplicateErrorMessage(error) };
  return { ok: true, user: normalizeUser(data) };
}

async function approveVip({ account3A, days, permanent = false, adminLineUserId }) {
  const normalizedAccount = normalizeAccount3A(account3A);
  const request = await findRequestBy3AAccount(normalizedAccount);
  const existingUser = await findVipUserBy3AAccount(normalizedAccount);
  const lineUserId = request?.lineUserId || existingUser.lineUserId;
  const lineName = request?.lineName || existingUser.lineName || "未取得";
  const numericDays = Number(days);
  const hasDays = Number.isFinite(numericDays) && numericDays > 0;
  const expiresAt = permanent ? null : expiresAfterDays(numericDays);
  const aiPermission = permanent || hasDays;

  if (!lineUserId) return { ok: false, error: "找不到此會員的 LINE User ID，無法推送通知。" };

  const result = await upsertVipUser({
    lineUserId,
    lineName,
    account3A: normalizedAccount,
    vipStatus: STATUS.APPROVED,
    aiPermission,
    expiresAt,
    isAdmin: false,
  });

  if (!result.ok) return result;

  if (isConnected()) {
    const requestUpdate = supabase
      .from("vip_requests")
      .update({
        status: STATUS.APPROVED,
        review_time: new Date().toISOString(),
        review_admin: adminLineUserId,
        updated_at: new Date().toISOString(),
      });
    if (typeof requestUpdate.ilike === "function") {
      await requestUpdate.ilike("three_a_account", normalizedAccount);
    } else {
      await requestUpdate.eq("three_a_account", normalizedAccount);
    }
    await logAdminAction(adminLineUserId, permanent ? "永久VIP" : "開通VIP", normalizedAccount, result.ok ? "success" : "failed");
  }

  return result;
}

async function extendVip(account3A, days, adminLineUserId) {
  const normalizedAccount = normalizeAccount3A(account3A);
  const user = await findVipUserBy3AAccount(normalizedAccount);
  if (!user.account3A) return { ok: false, error: "查無3A帳號" };
  const base = user.expiresAt && new Date(user.expiresAt).getTime() > Date.now()
    ? new Date(user.expiresAt).getTime()
    : Date.now();
  const expiresAt = new Date(base + Math.max(1, Number(days || 30)) * 86400000).toISOString();
  const result = await upsertVipUser({
    lineUserId: user.lineUserId,
    lineName: user.lineName,
    account3A: user.account3A,
    vipStatus: STATUS.APPROVED,
    aiPermission: true,
    expiresAt,
    isAdmin: false,
  });
  await logAdminAction(adminLineUserId, "延長VIP", user.account3A, result.ok ? "success" : "failed");
  return result;
}

async function reduceVip(account3A, days, adminLineUserId) {
  const normalizedAccount = normalizeAccount3A(account3A);
  const user = await findVipUserBy3AAccount(normalizedAccount);
  if (!user.account3A) return { ok: false, error: "查無3A帳號" };
  const base = user.expiresAt && new Date(user.expiresAt).getTime() > Date.now()
    ? new Date(user.expiresAt).getTime()
    : Date.now();
  const expiresAt = new Date(Math.max(Date.now(), base - Math.max(1, Number(days || 1)) * 86400000)).toISOString();
  const result = await upsertVipUser({
    lineUserId: user.lineUserId,
    lineName: user.lineName,
    account3A: user.account3A,
    vipStatus: STATUS.APPROVED,
    aiPermission: true,
    expiresAt,
    isAdmin: false,
  });
  await logAdminAction(adminLineUserId, "扣除VIP天數", user.account3A, result.ok ? "success" : "failed");
  return result;
}

async function cancelVip(account3A, adminLineUserId) {
  const normalizedAccount = normalizeAccount3A(account3A);
  const user = await findVipUserBy3AAccount(normalizedAccount);
  if (!user.account3A) return { ok: false, error: "查無3A帳號" };
  const result = await upsertVipUser({
    lineUserId: user.lineUserId,
    lineName: user.lineName,
    account3A: user.account3A,
    vipStatus: STATUS.CANCELLED,
    aiPermission: false,
    expiresAt: new Date().toISOString(),
    isAdmin: false,
  });
  await logAdminAction(adminLineUserId, "取消VIP", user.account3A, result.ok ? "success" : "failed");
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
  findRequestBy3AAccount,
  findActiveRequestByLineUserId,
  findActiveRequestBy3AAccount,
  submitVipRequest,
  approveVip,
  extendVip,
  reduceVip,
  cancelVip,
  listPendingRequests,
  listVipUsers,
  logAdminAction,
  logAiUsage,
  normalizeAccount3A,
};
