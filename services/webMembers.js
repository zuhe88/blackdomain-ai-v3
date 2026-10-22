const crypto = require("crypto");
const { promisify } = require("util");
const db = require("./supabase");
const { isAdminLineUserId } = require("../config/admin");
const scrypt = promisify(crypto.scrypt);
const buckets = new Map();
const PREFIX = "webmember_";

function unavailable() { return Object.assign(new Error("網站會員服務暫時無法使用。"), { status: 503 }); }
function normalize(value) { return typeof value === "string" ? value.trim().toLowerCase() : ""; }
function validAccount(value) { return /^[a-z0-9]{1,64}$/.test(value); }
function memberId(row) { return `${PREFIX}${row.id}@${row.auth_version}`; }
function isMember(id) { return typeof id === "string" && id.startsWith(PREFIX); }
function allowed(row) { return Boolean(row?.enabled && Date.parse(row.expires_at) > Date.now()); }
function profile(row) {
  return row ? { lineUserId: memberId(row), account3A: row.account, accountPlatform: "OFA", lineName: "OFA 網站會員", vipStatus: "approved", aiPermission: row.enabled === true, expiresAt: row.expires_at, isAdmin: false } : null;
}
async function lookup(field, value) {
  if (!db) throw unavailable();
  const { data, error } = await db.from("web_members").select("*").eq(field, value).maybeSingle();
  if (error) throw unavailable();
  return data;
}
async function access(id) {
  const [uuid, version] = id.slice(PREFIX.length).split("@");
  if (!/^[a-f0-9-]{36}$/.test(uuid)) return { allowed: false, isAdmin: false, user: null };
  const row = await lookup("id", uuid);
  const sessionValid = Boolean(row && row.auth_version === version);
  return { allowed: allowed(row) && sessionValid, sessionValid, isAdmin: false, user: profile(row) };
}
function takeSlot(ip, account) {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
  const keys = [`ip:${ip}`, `account:${account}`].map(value => crypto.createHash("sha256").update(value).digest("hex"));
  if (keys.some(key => (buckets.get(key)?.count || 0) >= 10)) return false;
  if (buckets.size > 10000) return false;
  for (const key of keys) {
    const bucket = buckets.get(key) || { count: 0, until: now + 600000 };
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  return true;
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}
async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  const valid = /^[a-f0-9]{32}$/.test(salt || "") && /^[a-f0-9]{128}$/.test(hash || "");
  const actual = await scrypt(password, valid ? salt : "0".repeat(32), 64);
  return valid && crypto.timingSafeEqual(actual, Buffer.from(hash, "hex"));
}
async function login(account, password, ip) {
  account = normalize(account);
  if (!takeSlot(String(ip || ""), account)) return { ok: false, status: 429, error: "嘗試次數過多，請於 10 分鐘後再試。" };
  if (!validAccount(account) || typeof password !== "string" || password.length > 128) return { ok: false, status: 401, error: "帳號或密碼不正確，或會員權限已到期。" };
  const row = await lookup("account", account);
  const verified = await verifyPassword(password, row?.password_hash);
  if (!verified || !allowed(row)) return { ok: false, status: 401, error: "帳號或密碼不正確，或會員權限已到期。" };
  return { ok: true, userId: memberId(row) };
}
async function save(adminId, input) {
  if (!isAdminLineUserId(adminId)) return { ok: false, status: 403, error: "僅限管理員操作。" };
  const account = normalize(input?.account);
  const password = input?.password;
  const expiry = Date.parse(input?.expiresAt);
  if (!validAccount(account) || typeof input?.enabled !== "boolean" || !Number.isFinite(expiry) || (input.enabled && expiry <= Date.now())) return { ok: false, status: 400, error: "請填寫正確的帳號、開通狀態及有效期限。" };
  if (password !== undefined && password !== "" && (typeof password !== "string" || password.length < 12 || password.length > 128)) return { ok: false, status: 400, error: "AI 專用密碼須為 12 至 128 字元。" };
  const existing = await lookup("account", account);
  if (!existing && !password) return { ok: false, status: 400, error: "新增會員必須設定 AI 專用密碼。" };
  const record = { account, enabled: input.enabled, expires_at: new Date(expiry).toISOString(), auth_version: crypto.randomUUID(), updated_at: new Date().toISOString(), updated_by: adminId };
  if (password) record.password_hash = await hashPassword(password);
  const query = existing ? db.from("web_members").update(record).eq("id", existing.id) : db.from("web_members").insert(record);
  const { error } = await query;
  if (error) throw unavailable();
  return { ok: true };
}
module.exports = { isMember, access, login, save, hashPassword, verifyPassword };
