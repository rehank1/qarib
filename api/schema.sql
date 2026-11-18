-- Qarīb API database (Cloudflare D1 = SQLite at the edge). Apply: npx wrangler d1 execute qarib --remote --file=api/schema.sql
-- Rules the API enforces on top of this: only approved authorities write a masjid's times, every change is audited,
-- and every write path is rate-limited. Usage metrics are anonymous counts: no user ids, no locations.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  salt       TEXT NOT NULL,             -- per-user random salt
  hash       TEXT NOT NULL,             -- SHA-256(salt · client key · server pepper); the phone did the 600k-round PBKDF2
  is_owner   INTEGER NOT NULL DEFAULT 0, -- set by hand once for the app owner: UPDATE users SET is_owner=1 WHERE email='…'
  failed     INTEGER NOT NULL DEFAULT 0,
  lock_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,          -- SHA-256 of the bearer token; the token itself is never stored
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS masjid_admins (
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  osm_id      TEXT NOT NULL CHECK (osm_id GLOB '[nwr]*/[0-9]*'),
  masjid_name TEXT NOT NULL CHECK (length(masjid_name) BETWEEN 1 AND 80),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, osm_id)
);

CREATE TABLE IF NOT EXISTS prayer_times (
  osm_id     TEXT PRIMARY KEY,
  fajr TEXT NOT NULL, dhuhr TEXT NOT NULL, asr TEXT NOT NULL, maghrib TEXT NOT NULL, isha TEXT NOT NULL, jumuah TEXT,
  updated_by INTEGER NOT NULL REFERENCES users (id),
  updated_at INTEGER NOT NULL,
  CHECK (fajr < dhuhr AND dhuhr < asr AND asr < maghrib AND maghrib < isha)
);

CREATE TABLE IF NOT EXISTS prayer_times_history (
  id         INTEGER PRIMARY KEY,
  osm_id     TEXT NOT NULL,
  times      TEXT NOT NULL,             -- JSON of the version that was published
  changed_by INTEGER NOT NULL,
  changed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS history_by_user ON prayer_times_history (changed_by, changed_at);

-- masjid search cache: one OpenStreetMap lookup per ~2 km tile per week, shared by everyone in that tile
CREATE TABLE IF NOT EXISTS masjid_tiles (tile TEXT PRIMARY KEY, body TEXT NOT NULL, fetched_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS masjids (osm_id TEXT PRIMARY KEY, name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL);

-- fixed-window rate limits
CREATE TABLE IF NOT EXISTS hits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);

-- anonymous metrics: daily counters, and daily-rotating hashes for "active today" (cannot be linked across days)
CREATE TABLE IF NOT EXISTS metrics (day TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL DEFAULT '', count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, key));
CREATE TABLE IF NOT EXISTS actives (day TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (day, id));
