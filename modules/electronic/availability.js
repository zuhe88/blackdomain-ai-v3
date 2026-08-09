const supabase = require("../../services/supabase");

const SETTING_KEY = "electronic_games_access";
let allGamesEnabled = true;

function areAllElectronicGamesEnabled() {
  return allGamesEnabled;
}

function isGameEnabled(gameName) {
  return String(gameName || "") === "戰神賽特2" || allGamesEnabled;
}

async function hydrateElectronicGameAccess() {
  if (!supabase) return allGamesEnabled;
  const { data, error } = await supabase
    .from("lottery_settings")
    .select("value")
    .eq("key", SETTING_KEY)
    .maybeSingle();
  if (error) {
    console.error("[Electronic] Game access hydration failed:", error.message);
    return allGamesEnabled;
  }
  if (typeof data?.value?.allGamesEnabled === "boolean") {
    allGamesEnabled = data.value.allGamesEnabled;
  }
  return allGamesEnabled;
}

async function setAllElectronicGamesEnabled(enabled, adminLineUserId = "") {
  const next = Boolean(enabled);
  if (supabase) {
    const { error } = await supabase
      .from("lottery_settings")
      .upsert({
        key: SETTING_KEY,
        value: {
          allGamesEnabled: next,
          updatedAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
        updated_by: String(adminLineUserId || "admin"),
      }, { onConflict: "key" });
    if (error) return { ok: false, changed: false, error: error.message };
  }
  const changed = allGamesEnabled !== next;
  allGamesEnabled = next;
  return { ok: true, changed, allGamesEnabled };
}

module.exports = {
  SETTING_KEY,
  areAllElectronicGamesEnabled,
  hydrateElectronicGameAccess,
  isGameEnabled,
  setAllElectronicGamesEnabled,
};
