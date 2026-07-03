const supabase = require("../../services/supabase");
const {
  VIP_TABLES,
  THREE_A_FIELDS,
  LINE_USER_FIELDS,
  LINE_NAME_FIELDS,
  STATUS_FIELDS,
  EXPIRES_AT_FIELDS,
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
      if (Object.prototype.hasOwnProperty.call(record, field)) {
        return field;
      }
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
    lineUserId: firstValue(record, LINE_USER_FIELDS),
    lineName: firstValue(record, LINE_NAME_FIELDS),
    account3A: firstValue(record, THREE_A_FIELDS),
    status: firstValue(record, STATUS_FIELDS),
    expiresAt: firstValue(record, EXPIRES_AT_FIELDS),
    updatedAt: record?.updated_at || record?.updatedAt || record?.last_updated || record?.created_at || null,
  };
}

function buildWritablePayload(existingRecord, data) {
  const threeAField = detectField(existingRecord, THREE_A_FIELDS, "three_a_account");
  const lineUserField = detectField(existingRecord, LINE_USER_FIELDS, "line_user_id");
  const statusField = detectField(existingRecord, STATUS_FIELDS, "vip_status");
  const expiresField = detectField(existingRecord, EXPIRES_AT_FIELDS, "vip_expires_at");
  const lineNameField = detectField(existingRecord, LINE_NAME_FIELDS, "line_name");

  const payload = {
    [threeAField]: data.account3A,
    [statusField]: data.status,
    [expiresField]: data.expiresAt,
    updated_at: new Date().toISOString(),
  };

  if (data.lineUserId) payload[lineUserField] = data.lineUserId;
  if (data.lineName) payload[lineNameField] = data.lineName;
  return payload;
}

async function updateExistingVip(result, data) {
  if (!supabase || !result?.table || !result?.record) return { ok: false, error: "資料不存在" };

  const record = result.record;
  const accountField = detectField(record, THREE_A_FIELDS, "three_a_account");
  const accountValue = firstValue(record, THREE_A_FIELDS) || data.account3A;
  const payload = buildWritablePayload(record, data);

  const { data: updated, error } = await supabase
    .from(result.table)
    .update(payload)
    .eq(accountField, accountValue)
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  return { ok: true, table: result.table, record: updated || { ...record, ...payload } };
}

async function insertVip(data) {
  if (!supabase) return { ok: false, error: "Supabase未連線" };

  const table = VIP_TABLES[0];
  const payload = buildWritablePayload(null, data);
  const { data: inserted, error } = await supabase.from(table).insert(payload).select("*").maybeSingle();

  if (error) return { ok: false, error: error.message };
  return { ok: true, table, record: inserted || payload };
}

async function openVipBy3AAccount({ account3A, days, expiresAt, lineUserId, lineName }) {
  const existing = await findVipBy3AAccount(account3A);
  const finalExpiresAt =
    expiresAt ||
    new Date(Date.now() + Math.max(1, Number(days || 30)) * 86400000).toISOString();

  const payload = {
    account3A,
    lineUserId,
    lineName,
    status: "已開通",
    expiresAt: finalExpiresAt,
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
    status: "已開通",
    expiresAt,
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
    status: "已過期",
    expiresAt: new Date().toISOString(),
  });
}

module.exports = {
  findVipByLineUserId,
  findVipBy3AAccount,
  normalizeVipRecord,
  openVipBy3AAccount,
  extendVipBy3AAccount,
  cancelVipBy3AAccount,
};
