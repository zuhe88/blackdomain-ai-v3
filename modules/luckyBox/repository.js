const supabase = require("../../services/supabase");

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
    .from("lucky_members")
    .select("*")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (error) return normalizeMember(null);
  return normalizeMember(data);
}

async function findMemberBy3AAccount(threeAAccount) {
  if (!isConnected() || !threeAAccount) return normalizeMember(null);
  const { data, error } = await supabase
    .from("lucky_members")
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
    .from("lucky_members")
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
    .from("lucky_members")
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
    .from("lucky_members")
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
    .from("lucky_box_logs")
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
    await supabase.from("lucky_marquee").insert({
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
    .from("lucky_box_logs")
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
  const { data, error } = await supabase
    .from("lucky_members")
    .select("*")
    .eq("status", "pending");
  if (error || !Array.isArray(data)) return [];
  return data.map(normalizeMember).slice(0, limit);
}

async function listMembers(limit = 200) {
  if (!isConnected()) return [];
  const { data, error } = await supabase.from("lucky_members").select("*");
  if (error || !Array.isArray(data)) return [];
  return data.map(normalizeMember).slice(0, limit);
}

async function listLogs(limit = 200) {
  if (!isConnected()) return [];
  const { data, error } = await supabase.from("lucky_box_logs").select("*");
  if (error || !Array.isArray(data)) return [];
  return data.map(normalizeLog).slice(-limit);
}

module.exports = {
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
};
