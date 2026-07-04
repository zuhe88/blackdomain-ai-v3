const supabase = require("../../services/supabase");

const DEFAULT_SPIN_PROBABILITY = {
  "AI權限1天": 45,
  "88": 45,
  "888": 9,
  "2888": 1,
};

const THREE_A_MEMBERS_TABLE = "three_a_members";
const THREE_A_SPIN_LOGS_TABLE = "three_a_spin_logs";
const THREE_A_MARQUEE_TABLE = "three_a_marquee";

function isConnected() {
  return Boolean(supabase);
}

function normalizeMember(row) {
  if (!row) {
    return {
      lineUserId: null,
      lineName: null,
      threeAAccount: null,
      nickname: null,
      status: null,
      keys: 0,
      firstOpened: false,
      vipExpiresAt: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  return {
    lineUserId: row.line_user_id || null,
    lineName: row.line_name || null,
    threeAAccount: row.three_a_account || null,
    nickname: row.nickname || null,
    status: row.status || null,
    keys: Number(row.keys || 0),
    firstOpened: row.first_opened === true,
    vipExpiresAt: row.vip_expires_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function normalizeLog(row) {
  return {
    id: row?.id || null,
    lineUserId: row?.line_user_id || null,
    threeAAccount: row?.three_a_account || null,
    prize: row?.prize || null,
    isAdminTest: row?.is_admin_test === true,
    createdAt: row?.created_at || null,
  };
}

async function findMemberByLineUserId(lineUserId) {
  if (!isConnected() || !lineUserId) return normalizeMember(null);
  const { data, error } = await supabase
    .from(THREE_A_MEMBERS_TABLE)
    .select("*")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (error) return normalizeMember(null);
  return normalizeMember(data);
}

async function findMemberBy3AAccount(threeAAccount) {
  if (!isConnected() || !threeAAccount) return normalizeMember(null);
  const { data, error } = await supabase
    .from(THREE_A_MEMBERS_TABLE)
    .select("*")
    .eq("three_a_account", threeAAccount)
    .maybeSingle();
  if (error) return normalizeMember(null);
  return normalizeMember(data);
}

async function createBindRequest({ lineUserId, lineName, threeAAccount, nickname }) {
  if (!isConnected()) return { ok: false, error: "Supabase尚未連線" };
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from(THREE_A_MEMBERS_TABLE)
    .insert({
      line_user_id: lineUserId,
      line_name: lineName || "未取得",
      three_a_account: threeAAccount,
      nickname: nickname || "未填寫",
      status: "pending",
      keys: 2,
      first_opened: false,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    const message = `${error.code || ""} ${error.message || ""}`;
    return {
      ok: false,
      error: /duplicate|unique|23505/i.test(message)
        ? "此 LINE 或 3A帳號已綁定或申請中，請聯繫管理員確認。"
        : error.message,
    };
  }

  return { ok: true, member: normalizeMember(data) };
}

async function updateMemberBy3AAccount(threeAAccount, payload) {
  if (!isConnected()) return { ok: false, error: "Supabase尚未連線" };
  const { data, error } = await supabase
    .from(THREE_A_MEMBERS_TABLE)
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("three_a_account", threeAAccount)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, member: normalizeMember(data) };
}

async function updateMemberByLineUserId(lineUserId, payload) {
  if (!isConnected()) return { ok: false, error: "Supabase尚未連線" };
  const { data, error } = await supabase
    .from(THREE_A_MEMBERS_TABLE)
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("line_user_id", lineUserId)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, member: normalizeMember(data) };
}

async function addLuckyLog({ lineUserId, threeAAccount, prize, isAdminTest = false }) {
  if (!isConnected()) return { ok: false, error: "Supabase尚未連線" };
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from(THREE_A_SPIN_LOGS_TABLE)
    .insert({
      line_user_id: lineUserId,
      three_a_account: threeAAccount,
      prize,
      is_admin_test: Boolean(isAdminTest),
      created_at: now,
    })
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  if (!isAdminTest) {
    await supabase.from(THREE_A_MARQUEE_TABLE).insert({
      line_user_id: lineUserId,
      three_a_account: threeAAccount,
      prize,
      created_at: now,
    });
  }

  return { ok: true, log: normalizeLog(data) };
}

async function listHistory(lineUserId, limit = 20) {
  if (!isConnected() || !lineUserId) return [];
  const { data, error } = await supabase
    .from(THREE_A_SPIN_LOGS_TABLE)
    .select("*")
    .eq("line_user_id", lineUserId);
  if (error || !Array.isArray(data)) return [];
  return data
    .map(normalizeLog)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

async function listPendingMembers(limit = 20) {
  if (!isConnected()) return [];
  const { data, error } = await supabase.from(THREE_A_MEMBERS_TABLE).select("*").eq("status", "pending");
  if (error || !Array.isArray(data)) return [];
  return data.map(normalizeMember).slice(0, limit);
}

async function listMembers(limit = 200) {
  if (!isConnected()) return [];
  const { data, error } = await supabase.from(THREE_A_MEMBERS_TABLE).select("*");
  if (error || !Array.isArray(data)) return [];
  return data.map(normalizeMember).slice(0, limit);
}

async function listLogs(limit = 200) {
  if (!isConnected()) return [];
  const { data, error } = await supabase.from(THREE_A_SPIN_LOGS_TABLE).select("*");
  if (error || !Array.isArray(data)) return [];
  return data.map(normalizeLog).slice(-limit);
}

function normalizeProbability(value) {
  const source = value && typeof value === "object" ? value : DEFAULT_SPIN_PROBABILITY;
  return {
    "AI權限1天": Number(source["AI權限1天"] ?? source.AI ?? DEFAULT_SPIN_PROBABILITY["AI權限1天"]),
    "88": Number(source["88"] ?? DEFAULT_SPIN_PROBABILITY["88"]),
    "888": Number(source["888"] ?? DEFAULT_SPIN_PROBABILITY["888"]),
    "2888": Number(source["2888"] ?? DEFAULT_SPIN_PROBABILITY["2888"]),
  };
}

async function getSpinProbability() {
  if (!isConnected()) return DEFAULT_SPIN_PROBABILITY;
  const { data, error } = await supabase
    .from("lottery_settings")
    .select("value")
    .eq("key", "spin_probability")
    .maybeSingle();
  if (error || !data?.value) return DEFAULT_SPIN_PROBABILITY;
  return normalizeProbability(data.value);
}

async function setSpinProbability(probability, updatedBy) {
  if (!isConnected()) return { ok: false, error: "Supabase尚未連線" };
  const payload = {
    key: "spin_probability",
    value: normalizeProbability(probability),
    updated_by: updatedBy || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("lottery_settings")
    .upsert(payload, { onConflict: "key" })
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, value: normalizeProbability(data.value) };
}

function addDays(base, days) {
  const start = base && new Date(base).getTime() > Date.now() ? new Date(base).getTime() : Date.now();
  return new Date(start + Math.max(1, Number(days || 1)) * 86400000).toISOString();
}

async function grantBlackdomainAiAccessOneDay(member) {
  return grantBlackdomainAiAccessDays(member, 1);
}

async function grantBlackdomainAiAccessDays(member, days = 1) {
  if (!isConnected() || !member?.threeAAccount) return { ok: false, error: "Supabase尚未連線" };
  const now = new Date().toISOString();
  const { data: existingByLine } = member.lineUserId
    ? await supabase.from("vip_users").select("*").eq("line_user_id", member.lineUserId).maybeSingle()
    : { data: null };
  const { data: existingByAccount } = !existingByLine
    ? await supabase.from("vip_users").select("*").eq("three_a_account", member.threeAAccount).maybeSingle()
    : { data: null };
  const existing = existingByLine || existingByAccount;

  if (existing?.id) {
    const expiresAt = addDays(existing.expires_at, days);
    const { error } = await supabase
      .from("vip_users")
      .update({
        vip_status: "approved",
        ai_permission: true,
        expires_at: expiresAt,
        updated_at: now,
      })
      .eq("id", existing.id);
    return error ? { ok: false, error: error.message } : { ok: true, expiresAt };
  }

  const expiresAt = addDays(null, days);
  const { error } = await supabase.from("vip_users").insert({
    line_user_id: member.lineUserId || null,
    line_name: member.lineName || null,
    three_a_account: member.threeAAccount,
    vip_status: "approved",
    ai_permission: true,
    expires_at: expiresAt,
    is_admin: false,
    created_at: now,
    updated_at: now,
  });
  return error ? { ok: false, error: error.message } : { ok: true, expiresAt };
}

module.exports = {
  DEFAULT_SPIN_PROBABILITY,
  findMemberByLineUserId,
  findMemberBy3AAccount,
  createBindRequest,
  updateMemberBy3AAccount,
  updateMemberByLineUserId,
  addLuckyLog,
  listHistory,
  listPendingMembers,
  listMembers,
  listLogs,
  getSpinProbability,
  setSpinProbability,
  grantBlackdomainAiAccessOneDay,
  grantBlackdomainAiAccessDays,
};
