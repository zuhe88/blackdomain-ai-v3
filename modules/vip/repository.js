const supabase = require("../../services/supabase");
const {
  VIP_TABLES,
  THREE_A_FIELDS,
  LINE_USER_FIELDS,
  LINE_NAME_FIELDS,
  STATUS_FIELDS,
  PERMISSION_FIELDS,
  EXPIRES_AT_FIELDS,
  IS_ADMIN_FIELDS,
  STATUSES,
} = require("./constants");

function firstValue(record, fields) {
  if (!record) return null;
  for (const field of fields) {
    if (record[field] !== undefined && record[field] !== null && String(record[field]).trim() !== "") {
      return record[field];
    }
  }
  return null;
}

function detectField(record, fields, fallback) {
  if (record) {
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(record, field)) return field;
    }
  }
  return fallback;
}

async function querySingle(table, field, value) {
  if (!supabase || !value) return null;
  const { data, error } = await supabase.from(table).select("*").eq(field, value).maybeSingle();
  if (error) return null;
  return data || null;
}

async function queryMany(table, field, value) {
  if (!supabase) return [];
  let query = supabase.from(table).select("*");
  if (field && value !== undefined) query = query.eq(field, value);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) return [];
  return data;
}

async function findVipByLineUserId(userId) {
  if (!supabase || !userId) return null;
  for (const table of VIP_TABLES) {
    for (const field of LINE_USER_FIELDS) {
      const record = await querySingle(table, field, userId);
      if (record) return { table, record };
    }
  }
  return null;
}

async function findVipBy3AAccount(account3A) {
  if (!supabase || !account3A) return null;
  for (const table of VIP_TABLES) {
    for (const field of THREE_A_FIELDS) {
      const record = await querySingle(table, field, account3A);
      if (record) return { table, record };
    }
  }
  return null;
}

function normalizeVipRecord(result) {
  const record = result?.record || null;
  return {
    table: result?.table || null,
    raw: record,
    id: record?.id || null,
    lineUserId: firstValue(record, LINE_USER_FIELDS),
    lineName: firstValue(record, LINE_NAME_FIELDS),
    account3A: firstValue(record, THREE_A_FIELDS),
    status: firstValue(record, STATUS_FIELDS),
    aiPermission: firstValue(record, PERMISSION_FIELDS),
    expiresAt: firstValue(record, EXPIRES_AT_FIELDS),
    isAdmin: firstValue(record, IS_ADMIN_FIELDS) === true,
    createdAt: record?.created_at || record?.createdAt || null,
    updatedAt: record?.updated_at || record?.updatedAt || record?.last_updated || null,
  };
}

function normalizeStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "active" || raw === "vip" || raw === "已開通") return STATUSES.ACTIVE;
  if (raw === "pending" || raw === "待審核") return STATUSES.PENDING;
  if (raw === "expired" || raw === "已過期") return STATUSES.EXPIRED;
  if (raw === "cancelled" || raw === "canceled" || raw === "已取消") return STATUSES.CANCELLED;
  return value || STATUSES.PENDING;
}

function buildWritablePayload(existingRecord, data) {
  const threeAField = detectField(existingRecord, THREE_A_FIELDS, "three_a_account");
  const lineUserField = detectField(existingRecord, LINE_USER_FIELDS, "line_user_id");
  const lineNameField = detectField(existingRecord, LINE_NAME_FIELDS, "line_name");
  const statusField = detectField(existingRecord, STATUS_FIELDS, "vip_status");
  const permissionField = detectField(existingRecord, PERMISSION_FIELDS, "ai_permission");
  const expiresField = detectField(existingRecord, EXPIRES_AT_FIELDS, "expires_at");
  const isAdminField = detectField(existingRecord, IS_ADMIN_FIELDS, "is_admin");

  const now = new Date().toISOString();
  const payload = {
    [lineUserField]: data.lineUserId || firstValue(existingRecord, LINE_USER_FIELDS) || null,
    [lineNameField]: data.lineName || firstValue(existingRecord, LINE_NAME_FIELDS) || null,
    [threeAField]: data.account3A,
    [statusField]: data.status,
    [permissionField]: Boolean(data.aiPermission),
    [expiresField]: data.expiresAt || null,
    [isAdminField]: Boolean(data.isAdmin),
    updated_at: now,
  };

  if (!existingRecord) payload.created_at = now;
  return payload;
}

async function updateExistingVip(result, data) {
  if (!supabase || !result?.table || !result?.record) return { ok: false, error: "資料不存在" };
  const record = result.record;
  const payload = buildWritablePayload(record, data);

  let query = supabase.from(result.table).update(payload);
  if (record.id !== undefined && record.id !== null) {
    query = query.eq("id", record.id);
  } else {
    const accountField = detectField(record, THREE_A_FIELDS, "three_a_account");
    query = query.eq(accountField, firstValue(record, THREE_A_FIELDS) || data.account3A);
  }

  const { data: updated, error } = await query.select("*").maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, table: result.table, record: updated || { ...record, ...payload } };
}

async function insertVip(data) {
  if (!supabase) return { ok: false, error: "Supabase未連線" };
  const payload = buildWritablePayload(null, data);

  for (const table of VIP_TABLES) {
    const { data: inserted, error } = await supabase.from(table).insert(payload).select("*").maybeSingle();
    if (!error) return { ok: true, table, record: inserted || payload };
  }

  return { ok: false, error: "找不到可寫入的VIP資料表" };
}

async function bind3AAccount({ lineUserId, lineName, account3A }) {
  const byLine = await findVipByLineUserId(lineUserId);
  const byAccount = await findVipBy3AAccount(account3A);
  const existing = byLine || byAccount;
  const payload = {
    lineUserId,
    lineName,
    account3A,
    status: STATUSES.PENDING,
    aiPermission: false,
    expiresAt: null,
    isAdmin: false,
  };
  if (existing) return updateExistingVip(existing, payload);
  return insertVip(payload);
}

async function openVipBy3AAccount({ account3A, days, expiresAt, lineUserId, lineName, permanent = false }) {
  const existing = await findVipBy3AAccount(account3A);
  const finalExpiresAt = permanent
    ? null
    : expiresAt || new Date(Date.now() + Math.max(1, Number(days || 30)) * 86400000).toISOString();
  const normalized = normalizeVipRecord(existing);
  const payload = {
    account3A,
    lineUserId: lineUserId || normalized.lineUserId,
    lineName: lineName || normalized.lineName,
    status: permanent ? "永久VIP" : STATUSES.ACTIVE,
    aiPermission: true,
    expiresAt: finalExpiresAt,
    isAdmin: false,
  };
  if (existing) return updateExistingVip(existing, payload);
  return insertVip(payload);
}

async function extendVipBy3AAccount(account3A, days) {
  const existing = await findVipBy3AAccount(account3A);
  if (!existing) return { ok: false, error: "查無3A帳號" };
  const normalized = normalizeVipRecord(existing);
  const base = normalized.expiresAt && new Date(normalized.expiresAt).getTime() > Date.now()
    ? new Date(normalized.expiresAt).getTime()
    : Date.now();
  const expiresAt = new Date(base + Math.max(1, Number(days || 30)) * 86400000).toISOString();
  return updateExistingVip(existing, {
    account3A,
    lineUserId: normalized.lineUserId,
    lineName: normalized.lineName,
    status: STATUSES.ACTIVE,
    aiPermission: true,
    expiresAt,
    isAdmin: false,
  });
}

async function cancelVipBy3AAccount(account3A) {
  const existing = await findVipBy3AAccount(account3A);
  if (!existing) return { ok: false, error: "查無3A帳號" };
  const normalized = normalizeVipRecord(existing);
  return updateExistingVip(existing, {
    account3A,
    lineUserId: normalized.lineUserId,
    lineName: normalized.lineName,
    status: STATUSES.CANCELLED,
    aiPermission: false,
    expiresAt: new Date().toISOString(),
    isAdmin: false,
  });
}

async function listPendingMembers() {
  for (const table of VIP_TABLES) {
    for (const field of STATUS_FIELDS) {
      const rows = await queryMany(table, field, STATUSES.PENDING);
      if (rows.length) return rows.map((record) => normalizeVipRecord({ table, record }));
      const pendingRows = await queryMany(table, field, "pending");
      if (pendingRows.length) return pendingRows.map((record) => normalizeVipRecord({ table, record }));
    }
  }
  return [];
}

async function listAllMembers() {
  for (const table of VIP_TABLES) {
    const rows = await queryMany(table);
    if (rows.length) return rows.slice(0, 20).map((record) => normalizeVipRecord({ table, record }));
  }
  return [];
}

module.exports = {
  findVipByLineUserId,
  findVipBy3AAccount,
  normalizeVipRecord,
  normalizeStatus,
  bind3AAccount,
  openVipBy3AAccount,
  extendVipBy3AAccount,
  cancelVipBy3AAccount,
  listPendingMembers,
  listAllMembers,
};
