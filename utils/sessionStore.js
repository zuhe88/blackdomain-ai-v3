const DEFAULT_TIMEOUT = 30 * 60 * 1000;
const stores = new Map();

function now() {
  return Date.now();
}

function getStore(namespace) {
  if (!stores.has(namespace)) {
    stores.set(namespace, new Map());
  }

  return stores.get(namespace);
}

function getSession(namespace, userId, defaults = {}, timeout = DEFAULT_TIMEOUT) {
  const store = getStore(namespace);
  const key = String(userId || "anonymous");
  const existing = store.get(key);

  if (!existing || now() - existing.updatedAt > timeout) {
    const fresh = {
      ...defaults,
      userId: key,
      createdAt: now(),
      updatedAt: now(),
    };
    store.set(key, fresh);
    return fresh;
  }

  existing.updatedAt = now();
  store.set(key, existing);
  return existing;
}

function updateSession(namespace, userId, data, defaults = {}) {
  const current = getSession(namespace, userId, defaults);
  const next = {
    ...current,
    ...data,
    updatedAt: now(),
  };
  getStore(namespace).set(String(userId || "anonymous"), next);
  return next;
}

function clearSession(namespace, userId) {
  getStore(namespace).delete(String(userId || "anonymous"));
}

function clearUser(userId) {
  const key = String(userId || "anonymous");
  for (const store of stores.values()) {
    store.delete(key);
  }
}

module.exports = {
  DEFAULT_TIMEOUT,
  getSession,
  updateSession,
  clearSession,
  clearUser,
};
