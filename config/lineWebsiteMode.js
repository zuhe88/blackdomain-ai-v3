// LINE member analysis and the website portal are both available in production.
// Keep the test override so website-only fallback behavior can still be regression-tested.
const PRODUCTION_WEBSITE_ONLY_LOCK = false;
const supabase = require("../services/supabase");
const { isAdminLineUserId } = require("./admin");
const SETTING_KEY = "line_website_only_mode";
let savedMode = null;
let loaded = !supabase;
let expiresAt = 0;
let revision = 0;
let pending = null;

async function bounded(query) {
  let timer;
  try {
    return await Promise.race([
      query,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("設定儲存服務逾時，請稍後查詢狀態。")), 4000); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function refreshLineWebsiteMode() {
  if (!supabase || Date.now() < expiresAt) return isLineWebsiteOnlyMode();
  if (pending) return pending;
  const version = revision;
  pending = (async () => {
    try {
      const { data, error } = await bounded(supabase.from("lottery_settings").select("value").eq("key", SETTING_KEY).maybeSingle());
      if (error) throw error;
      if (version === revision) {
        savedMode = typeof data?.value?.websiteOnly === "boolean" ? data.value.websiteOnly : null;
        loaded = true;
      }
    } catch (error) {
      console.error("[LINE mode] Refresh failed:", error.message);
    } finally { expiresAt = Date.now() + 5000; pending = null; }
    return isLineWebsiteOnlyMode();
  })();
  return pending;
}

async function setLineWebsiteOnlyMode(websiteOnly, adminId) {
  if (!isAdminLineUserId(adminId)) return { ok: false, error: "無權限使用此功能。" };
  if (!supabase) return { ok: false, error: "設定儲存服務尚未連線，未變更模式。" };
  try {
    const now = new Date().toISOString();
    const { error } = await bounded(supabase.from("lottery_settings").upsert({
      key: SETTING_KEY,
      value: { websiteOnly: Boolean(websiteOnly) },
      updated_at: now,
      updated_by: adminId,
    }, { onConflict: "key" }));
    if (error) throw error;
    revision += 1;
    savedMode = Boolean(websiteOnly);
    loaded = true;
    expiresAt = Date.now() + 5000;
    return { ok: true };
  } catch (error) {
    expiresAt = 0;
    return { ok: false, error: error.message };
  }
}

function isLineWebsiteOnlyMode() {
  if (!loaded) return true;
  if (savedMode !== null) return savedMode;
  const configured = process.env.LINE_WEBSITE_ONLY_MODE;
  if (configured != null && String(configured).trim() !== "") {
    return String(configured).toLowerCase() !== "false";
  }
  return process.env.NODE_ENV === "test" ? true : PRODUCTION_WEBSITE_ONLY_LOCK;
}

module.exports = {
  isLineWebsiteOnlyMode,
  PRODUCTION_WEBSITE_ONLY_LOCK,
  refreshLineWebsiteMode,
  setLineWebsiteOnlyMode,
};
