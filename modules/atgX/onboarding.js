const supabase = require("../../services/supabase");

const STATES = Object.freeze({ WELCOME: "WELCOME", CHOICE: "WAITING_3A_CHOICE", ACCOUNT: "WAITING_3A_ACCOUNT", RECEIVED: "ACCOUNT_RECEIVED" });
const cards = require("./onboardingCards");
const { REGISTRATION_URL } = cards;

const store = {
  async get(userId) {
    if (!supabase) throw new Error("Onboarding storage unavailable");
    const { data, error } = await supabase.from("lottery_settings").select("value").eq("key", `atgx_onboarding:${userId}`).maybeSingle();
    if (error) throw new Error("Onboarding state read failed");
    return data?.value || {};
  },
  async save(userId, value) {
    if (!supabase) throw new Error("Onboarding storage unavailable");
    const { error } = await supabase.from("lottery_settings").upsert({
      key: `atgx_onboarding:${userId}`, value,
      updated_at: new Date().toISOString(), updated_by: "atgx-onboarding",
    }, { onConflict: "key" });
    if (error) throw new Error("Onboarding state save failed");
  },
};

// The persisted pending request is the handoff point for transfer requests,
// administrator notifications and account binding. No binding is implied here.
function createOnboarding({ storage = store } = {}) {
  const pending = new Map();
  async function process(event) {
    const userId = event.source?.userId;
    if (!userId || event.source?.type === "group" || event.source?.type === "room") return null;
    const text = event.type === "postback" ? String(event.postback?.data || "") : String(event.message?.text || "").trim();
    if (event.type !== "follow" && event.type !== "postback" && !(event.type === "message" && event.message?.type === "text")) return null;
    const state = await storage.get(userId);
    if (event.webhookEventId && state.lastEventId === event.webhookEventId) return null;
    const save = (changes) => storage.save(userId, { ...state, ...changes, lastEventId: event.webhookEventId || null });
    if (event.type === "follow") {
      await save({ state: STATES.WELCOME });
      return cards.welcome();
    }
    if (/^AI$/i.test(text)) {
      await save({ state: STATES.CHOICE });
      return cards.choice();
    }
    const hasAccount = ["有", "我有", "1️⃣ 有", "atgx:has-account"].includes(text) || (text === "1" && state.state !== STATES.ACCOUNT);
    const noAccount = ["沒有", "我沒有", "2️⃣ 沒有", "atgx:no-account"].includes(text) || (text === "2" && state.state !== STATES.ACCOUNT);
    if (hasAccount) {
      await save({ state: STATES.ACCOUNT, choice: "existing" });
      return cards.existing();
    }
    if (noAccount) {
      await save({ state: STATES.ACCOUNT, choice: "registration" });
      return cards.registration();
    }
    // Numeric accounts (including 1/2) remain valid once an account is requested.
    if (state.state === STATES.ACCOUNT && event.type === "message") {
      if (!/^[A-Za-z0-9]{1,128}$/.test(text)) return cards.invalid();
      await save({ state: STATES.RECEIVED, request: {
        account: text, source: state.choice, status: "pending", userId,
        receivedAt: new Date().toISOString(), eventId: event.webhookEventId || null,
        transferStatus: "pending", notificationStatus: "not_configured", bindingStatus: "unbound",
      } });
      return cards.received(text);
    }
    return null;
  }
  return { handle(event) {
    const key = event.source?.userId || "unknown";
    const task = (pending.get(key) || Promise.resolve()).catch(() => {}).then(() => process(event));
    pending.set(key, task);
    return task.finally(() => { if (pending.get(key) === task) pending.delete(key); });
  } };
}

module.exports = { createOnboarding, STATES, REGISTRATION_URL };
