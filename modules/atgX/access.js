const crypto = require("crypto");
const supabase = require("../../services/supabase");

const LICENSE_PREFIX = "atgx_license:";
const DEFAULT_DAYS = 30;

function normalizeSerial(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function secret() {
  return String(process.env.ATGX_SESSION_SECRET || process.env.WEB_SESSION_SECRET || process.env.LINE_CHANNEL_SECRET || "");
}

function sign(payload) {
  if (!secret()) throw new Error("ATGX_SESSION_SECRET is not configured.");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verify(token) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature || !secret()) return null;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

async function setting(key) {
  if (!supabase) return null;
  const { data, error } = await supabase.from("lottery_settings").select("*").eq("key", key).maybeSingle();
  if (error) throw new Error(error.message || "授權資料讀取失敗。");
  return data || null;
}

function formatSerial(raw) {
  return `ATGX-${raw.match(/.{1,4}/g).join("-")}`;
}

async function createLicense({ days = DEFAULT_DAYS, label = "", createdBy = "admin" } = {}) {
  if (!supabase) throw new Error("授權資料庫尚未連線。");
  const validDays = Math.min(3650, Math.max(1, Number.parseInt(days, 10) || DEFAULT_DAYS));
  const raw = crypto.randomBytes(12).toString("hex").toUpperCase();
  const serial = formatSerial(raw);
  const normalized = normalizeSerial(serial);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + validDays * 86400000).toISOString();
  const value = {
    product: "atg-x",
    status: "active",
    label: String(label || "").trim().slice(0, 80),
    createdAt: now.toISOString(),
    expiresAt,
    activatedAt: null,
    deviceHash: null,
  };
  const { error } = await supabase.from("lottery_settings").insert({
    key: `${LICENSE_PREFIX}${digest(normalized)}`,
    value,
    updated_at: now.toISOString(),
    updated_by: createdBy,
  });
  if (error) throw new Error(error.message || "序號建立失敗。");
  return { serial, ...value };
}

async function activate(serial, deviceId) {
  if (!supabase) throw new Error("授權服務暫時無法使用。");
  const normalized = normalizeSerial(serial);
  const cleanDevice = String(deviceId || "").trim();
  if (!/^ATGX[A-Z0-9]{24}$/.test(normalized) || cleanDevice.length < 12) return { ok: false, error: "序號格式不正確。" };
  const licenseHash = digest(normalized);
  const row = await setting(`${LICENSE_PREFIX}${licenseHash}`);
  const license = row?.value;
  if (!license || license.product !== "atg-x" || license.status !== "active") return { ok: false, error: "序號不存在或已停用。" };
  const expiresAt = Date.parse(license.expiresAt || "");
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { ok: false, error: "此序號已到期。" };
  const deviceHash = digest(cleanDevice);
  if (license.deviceHash && license.deviceHash !== deviceHash) return { ok: false, error: "此序號已綁定其他裝置。" };
  const updated = { ...license, deviceHash, activatedAt: license.activatedAt || new Date().toISOString() };
  const { error } = await supabase.from("lottery_settings").update({
    value: updated,
    updated_at: new Date().toISOString(),
    updated_by: "atg-x-activation",
  }).eq("key", `${LICENSE_PREFIX}${licenseHash}`);
  if (error) throw new Error(error.message || "序號啟用失敗。");
  return {
    ok: true,
    expiresAt: updated.expiresAt,
    token: sign({ kind: "atg-x", licenseHash, deviceHash, exp: expiresAt }),
  };
}

async function authenticate(token, deviceId) {
  const payload = verify(token);
  if (!payload || payload.kind !== "atg-x" || payload.deviceHash !== digest(String(deviceId || ""))) return null;
  const row = await setting(`${LICENSE_PREFIX}${payload.licenseHash}`);
  const license = row?.value;
  if (!license || license.status !== "active" || license.deviceHash !== payload.deviceHash) return null;
  if (Date.parse(license.expiresAt || "") <= Date.now()) return null;
  return { licenseHash: payload.licenseHash, expiresAt: license.expiresAt, label: license.label || "" };
}

async function listLicenses() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("lottery_settings").select("key,value,updated_at").like("key", `${LICENSE_PREFIX}%`).order("updated_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message || "序號清單讀取失敗。");
  return (data || []).map((row) => ({ id: row.key.slice(LICENSE_PREFIX.length, LICENSE_PREFIX.length + 10), ...row.value }));
}

module.exports = { createLicense, activate, authenticate, listLicenses };
