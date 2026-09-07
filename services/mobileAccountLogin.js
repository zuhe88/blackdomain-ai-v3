const crypto = require('crypto');
const vip = require('../modules/vip');
const { validateAccount3A } = require('../modules/vip/validator');
const { pushLineStrict, text } = require('./line');

const challenges = new Map();
const requestBuckets = new Map();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RESEND_DELAY_MS = 60 * 1000;
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_LIMIT = 6;

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function codeDigest(challengeId, code) {
  const secret = String(process.env.WEB_SESSION_SECRET || process.env.LINE_CHANNEL_SECRET || '');
  return crypto.createHmac('sha256', secret).update(`${challengeId}:${code}`).digest();
}

function safeEqual(left, right) {
  const a = Buffer.isBuffer(left) ? left : Buffer.from(String(left || ''));
  const b = Buffer.isBuffer(right) ? right : Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function prune(now = Date.now()) {
  for (const [id, challenge] of challenges) if (challenge.expiresAt <= now) challenges.delete(id);
  for (const [key, bucket] of requestBuckets) if (bucket.expiresAt <= now) requestBuckets.delete(key);
}

function takeRequestSlot(clientKey, account) {
  const now = Date.now();
  prune(now);
  const ipKey = `ip:${digest(clientKey)}`;
  const ipBucket = requestBuckets.get(ipKey) || { count: 0, expiresAt: now + IP_WINDOW_MS };
  if (ipBucket.count >= IP_LIMIT) return { ok: false, retryAfter: Math.ceil((ipBucket.expiresAt - now) / 1000) };
  ipBucket.count += 1;
  requestBuckets.set(ipKey, ipBucket);

  const accountKey = `account:${digest(account)}`;
  const accountBucket = requestBuckets.get(accountKey);
  if (accountBucket && accountBucket.expiresAt > now) {
    return { ok: false, retryAfter: Math.ceil((accountBucket.expiresAt - now) / 1000) };
  }
  requestBuckets.set(accountKey, { count: 1, expiresAt: now + RESEND_DELAY_MS });
  return { ok: true, retryAfter: 0 };
}

function hasDirectAccess(user) {
  if (!user?.account3A || !user.lineUserId) return false;
  if (user.isAdmin) return true;
  if (user.vipStatus !== vip.STATUS.APPROVED || user.aiPermission !== true) return false;
  if (!user.expiresAt) return true;
  return Date.parse(user.expiresAt) > Date.now();
}

async function authenticateAccount(rawAccount, clientKey) {
  const validation = validateAccount3A(rawAccount);
  if (!validation.ok) return { ok: false, status: 400, error: validation.error };
  const slot = takeRequestSlot(clientKey, validation.value);
  if (!slot.ok) return { ok: false, status: 429, retryAfter: slot.retryAfter, error: `操作過於頻繁，請在 ${slot.retryAfter} 秒後再試。` };

  const user = await vip.findVipUserBy3AAccount(validation.value);
  if (!hasDirectAccess(user)) {
    return { ok: false, status: 403, error: '此帳號目前沒有可用的分析權限，請聯絡管理員確認開通狀態。' };
  }
  return { ok: true, userId: user.lineUserId };
}

async function requestCode(rawAccount, clientKey) {
  const validation = validateAccount3A(rawAccount);
  if (!validation.ok) return { ok: false, status: 400, error: validation.error };
  const slot = takeRequestSlot(clientKey, validation.value);
  if (!slot.ok) return { ok: false, status: 429, retryAfter: slot.retryAfter, error: `操作過於頻繁，請在 ${slot.retryAfter} 秒後再試。` };

  const challengeId = crypto.randomBytes(24).toString('base64url');
  const verificationCode = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const user = await vip.findVipUserBy3AAccount(validation.value);
  const eligible = hasDirectAccess(user);
  const challenge = {
    userId: eligible ? user.lineUserId : null,
    codeHash: codeDigest(challengeId, eligible ? verificationCode : crypto.randomBytes(8).toString('hex')),
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
    attempts: 0,
  };
  challenges.set(challengeId, challenge);

  if (eligible) {
    try {
      await pushLineStrict(user.lineUserId, text(`黑域AI 助手登入驗證碼：${verificationCode}\n\n5 分鐘內有效。若不是您本人操作，請忽略此訊息。`));
    } catch (error) {
      challenges.delete(challengeId);
      console.error('[MobileLogin] LINE verification delivery failed:', error.message);
      return { ok: false, status: 503, error: '驗證碼目前無法送出，請稍後再試。' };
    }
  }

  return {
    ok: true,
    challengeId,
    expiresIn: Math.floor(CHALLENGE_TTL_MS / 1000),
    message: '若此帳號已開通並綁定 LINE，驗證碼會傳送至原綁定帳號。',
  };
}

async function verifyCode(challengeId, code) {
  prune();
  const challenge = challenges.get(String(challengeId || ''));
  if (!challenge || !/^\d{6}$/.test(String(code || ''))) return { ok: false, status: 401, error: '驗證碼無效或已過期。' };
  challenge.attempts += 1;
  if (challenge.attempts > 5) {
    challenges.delete(challengeId);
    return { ok: false, status: 401, error: '驗證碼無效或已過期。' };
  }
  if (!challenge.userId || !safeEqual(challenge.codeHash, codeDigest(challengeId, code))) {
    return { ok: false, status: 401, error: '驗證碼無效或已過期。' };
  }
  const access = await vip.checkVipAccess(challenge.userId);
  const directUser = await vip.findVipUserByLineUserId(challenge.userId);
  if (!access.allowed || !hasDirectAccess(directUser)) {
    challenges.delete(challengeId);
    return { ok: false, status: 403, error: '此會員目前沒有可用的分析權限。' };
  }
  challenges.delete(challengeId);
  return { ok: true, userId: challenge.userId };
}

module.exports = { authenticateAccount, requestCode, verifyCode };
