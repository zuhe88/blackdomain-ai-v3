const supabase = require("../../services/supabase");

async function findVipByLineUserId(userId) {
  if (!supabase) return null;

  const tables = ["vip", "vips", "users"];

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("*").eq("line_user_id", userId).maybeSingle();
    if (!error && data) return data;
  }

  return null;
}

module.exports = {
  findVipByLineUserId,
};
