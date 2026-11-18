// On-device cache with expiry, a versioned namespace and size limits. Falls back to memory when storage is blocked
// (private mode, Capacitor with storage cleared), so the app never crashes on a storage error.

const NS = 'qarib:v1:';
const MAX_BYTES = 256 * 1024; // one entry; keeps a hostile or buggy response from filling the quota

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

export function safeStorage() {
  try {
    const s = globalThis.localStorage;
    s.setItem(NS + '_probe', '1');
    s.removeItem(NS + '_probe');
    return s;
  } catch { return memoryStorage(); }
}

export function createStore(storage = safeStorage(), now = () => Date.now()) {
  return {
    /** The value, or `fallback` when missing, expired or unreadable. */
    get(key, fallback = null) {
      try {
        const raw = storage.getItem(NS + key);
        if (!raw) return fallback;
        const { v, exp } = JSON.parse(raw);
        if (exp && exp < now()) { storage.removeItem(NS + key); return fallback; }
        return v ?? fallback;
      } catch { return fallback; }
    },
    /** Saved time (ms) of an entry, for "updated 5 min ago" labels. */
    savedAt(key) {
      try { return JSON.parse(storage.getItem(NS + key) || '{}').at || 0; } catch { return 0; }
    },
    set(key, v, ttlMs = 0) {
      const raw = JSON.stringify({ v, at: now(), exp: ttlMs ? now() + ttlMs : 0 });
      if (raw.length > MAX_BYTES) return false;
      try { storage.setItem(NS + key, raw); return true; } catch { return false; }
    },
    del(key) { try { storage.removeItem(NS + key); } catch {} },
    /** Remove everything this app stored (Settings → Clear data). */
    clear() {
      try {
        const keys = [];
        for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith('qarib:')) keys.push(k); }
        keys.forEach((k) => storage.removeItem(k));
      } catch {}
    },
  };
}

export const HOUR = 3600e3, DAY = 24 * HOUR;
