const supabase = require("../../services/supabase");

const STATES = Object.freeze({ WELCOME: "WELCOME", CHOICE: "WAITING_3A_CHOICE", ACCOUNT: "WAITING_3A_ACCOUNT", RECEIVED: "ACCOUNT_RECEIVED" });
const REGISTRATION_URL = "https://atg888.3a1788.bet/";
const textMessage = (text) => ({ type: "text", text });

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
      return textMessage("歡迎進入【ATG駭客】💻\n\n我是 ATG駭客\n負責把複雜的遊戲數據，整理成你看得懂的資訊。\n\n想開始了解黑域AI\n直接回覆「AI」即可。");
    }
    if (/^AI$/i.test(text)) {
      await save({ state: STATES.CHOICE });
      return { ...textMessage("請問目前是否有【3A娛樂城】帳號？"), quickReply: { items: [
        { type: "action", action: { type: "postback", label: "1️⃣ 有", data: "atgx:has-account", displayText: "有" } },
        { type: "action", action: { type: "postback", label: "2️⃣ 沒有", data: "atgx:no-account", displayText: "沒有" } },
      ] } };
    }
    // Once waiting, text is the account even if it is literally "1" or "2".
    if (state.state === STATES.ACCOUNT && event.type === "message") {
      if (!text || text.length > 128 || /\s/.test(text)) return textMessage("請只傳送您的 3A 帳號，方便我協助確認。");
      await save({ state: STATES.RECEIVED, request: {
        account: text, source: state.choice, status: "pending", userId,
        receivedAt: new Date().toISOString(), eventId: event.webhookEventId || null,
        transferStatus: "pending", notificationStatus: "not_configured", bindingStatus: "unbound",
      } });
      return textMessage("已收到您的 3A 帳號，看到後會第一時間協助確認。");
    }
    if (["有", "1", "1️⃣ 有", "atgx:has-account"].includes(text)) {
      await save({ state: STATES.ACCOUNT, choice: "existing" });
      return textMessage("請留下您的 3A 帳號，\n看到後會第一時間協助您轉線。");
    }
    if (["沒有", "2", "2️⃣ 沒有", "atgx:no-account"].includes(text)) {
      await save({ state: STATES.ACCOUNT, choice: "registration" });
      return textMessage(`請先完成註冊：\n\n${REGISTRATION_URL}\n\n註冊成功後，請將您的帳號傳給我即可。`);
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
