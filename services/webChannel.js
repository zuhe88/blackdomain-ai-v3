const crypto = require("crypto");
const supabase = require("./supabase");

const replies = new Map();
const clients = new Map();
const recentMessages = new Map();
const usedLoginNonces = new Map();
const CODE_TTL = 10 * 60 * 1000;
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

function randomToken(bytes = 24) { return crypto.randomBytes(bytes).toString("base64url"); }
function secret() {
  return String(process.env.WEB_SESSION_SECRET || process.env.LINE_CHANNEL_SECRET || "");
}
function sign(payload) {
  if (!secret()) throw new Error("WEB_SESSION_SECRET is not configured.");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}
function verify(token) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature || !secret()) return null;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const left = Buffer.from(signature); const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try { const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); return value.exp > Date.now() ? value : null; } catch { return null; }
}
function issue(userId) {
  return sign({ kind: "login", userId, exp: Date.now() + CODE_TTL, nonce: randomToken(8) });
}
let warnedNonceFallback = false;
async function redeem(code) {
  const pending = verify(code);
  if (!pending || pending.kind !== "login" || usedLoginNonces.has(pending.nonce)) return null;
  const nonceHash = crypto.createHash("sha256").update(pending.nonce).digest("hex");
  if (supabase) {
    const { error } = await supabase.from("lottery_settings").insert({
      key: `web_login_nonce:${nonceHash}`,
      value: {
        lineUserId: String(pending.userId || ""),
        expiresAt: pending.exp,
        redeemedAt: Date.now(),
      },
      updated_at: new Date().toISOString(),
      updated_by: "web-login",
    });
    if (error?.code === "23505") return null;
    if (error && !warnedNonceFallback) {
      warnedNonceFallback = true;
      console.warn("[WebAuth] Persistent nonce ledger unavailable; using process fallback:", error.message);
    }
    if (!error && Math.random() < 0.02) {
      supabase
        .from("lottery_settings")
        .delete()
        .like("key", "web_login_nonce:%")
        .lt("updated_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .then(() => {})
        .catch(() => {});
    }
  }
  usedLoginNonces.set(pending.nonce, pending.exp);
  for (const [nonce, expiresAt] of usedLoginNonces) {
    if (expiresAt < Date.now()) usedLoginNonces.delete(nonce);
  }
  return sign({ kind: "session", userId: pending.userId, exp: Date.now() + SESSION_TTL });
}
function authenticate(token) {
  const session = verify(token);
  return session?.kind === "session" ? session.userId : null;
}
function waitReply(token, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { replies.delete(token); reject(new Error("Command timeout")); }, timeoutMs);
    replies.set(token, (messages) => { clearTimeout(timer); replies.delete(token); resolve(messages); });
  });
}
function remember(userId, messages, replayable = false, topic = "general") {
  const history = recentMessages.get(userId) || [];
  const entry = { id: randomToken(8), at: Date.now(), messages, replayable, topic };
  history.push(entry);
  recentMessages.set(userId, history.slice(-30));
  return entry;
}
function resolveReply(token, messages) {
  const handler = replies.get(token);
  if (!handler) return false;
  const userId = token.split(":", 3)[1];
  if (userId) remember(userId, messages);
  handler(messages);
  return true;
}
function cancelReply(token) {
  const handler = replies.get(token);
  if (!handler) return false;
  handler([]);
  return true;
}
function eventPayload(entry) {
  return `id: ${entry.id}\nevent: message\ndata: ${JSON.stringify(entry.messages)}\n\n`;
}
function subscribe(userId, response, lastEventId = "") {
  const set = clients.get(userId) || new Set();
  set.add(response); clients.set(userId, set);
  const history = recentMessages.get(userId) || [];
  if (lastEventId) {
    const cursor = history.findIndex((entry) => entry.id === lastEventId);
    const missed = (cursor >= 0 ? history.slice(cursor + 1) : history.slice(-1))
      .filter((entry) => entry.replayable === true);
    missed.forEach((entry) => response.write(eventPayload(entry)));
  } else {
    const latest = [...history].reverse().find((entry) => entry.replayable === true);
    if (latest) response.write(eventPayload(latest));
  }
  return () => { set.delete(response); if (!set.size) clients.delete(userId); };
}
function connected(userId) { return Boolean(clients.get(userId)?.size); }
function publish(userId, messages, topic = "general") {
  const entry = remember(userId, messages, true, topic);
  const set = clients.get(userId);
  if (!set?.size) return false;
  const payload = eventPayload(entry);
  [...set].forEach((response) => { try { response.write(payload); } catch { set.delete(response); } });
  return set.size > 0;
}
function history(userId) { return [...(recentMessages.get(userId) || [])]; }
function latestReplayable(userId, topic = "") {
  return [...(recentMessages.get(userId) || [])]
    .reverse()
    .find((entry) => entry.replayable === true && (!topic || entry.topic === topic)) || null;
}

module.exports = { authenticate, cancelReply, connected, history, issue, latestReplayable, publish, redeem, resolveReply, subscribe, waitReply };
