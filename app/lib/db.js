import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(config.dbPath);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',          -- free | pro
  status TEXT NOT NULL DEFAULT 'active',      -- active | suspended
  stripe_customer TEXT,
  stripe_sub TEXT,
  sub_status TEXT,
  period_end INTEGER,
  comped INTEGER NOT NULL DEFAULT 0,          -- admin-granted Pro, not tied to Stripe
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                        -- sha256 of token
  kind TEXT NOT NULL,                         -- user | admin
  subject INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  url TEXT NOT NULL,
  host TEXT NOT NULL,
  title TEXT,
  price REAL,
  original_price REAL,
  currency TEXT DEFAULT 'USD',
  coupon TEXT,
  preview INTEGER NOT NULL DEFAULT 1,
  starts_at INTEGER,
  expires_at INTEGER,
  pixel_meta TEXT,
  pixel_tiktok TEXT,
  status TEXT NOT NULL DEFAULT 'active',      -- active | disabled
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  guest INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_links_user ON links(user_id);
CREATE TABLE IF NOT EXISTS clicks (
  id INTEGER PRIMARY KEY,
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  device TEXT, browser TEXT, referrer TEXT, locale TEXT, visitor TEXT
);
CREATE INDEX IF NOT EXISTS idx_clicks_link_ts ON clicks(link_id, ts);
CREATE INDEX IF NOT EXISTS idx_clicks_ts ON clicks(ts);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  link_id INTEGER REFERENCES links(id) ON DELETE SET NULL,
  slug TEXT, reason TEXT, detail TEXT, reporter TEXT,
  status TEXT NOT NULL DEFAULT 'open',        -- open | resolved
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS blocked_domains (
  domain TEXT PRIMARY KEY COLLATE NOCASE,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  stripe_event TEXT UNIQUE,
  kind TEXT, amount INTEGER, currency TEXT, created_at INTEGER NOT NULL
);
`);

// Lightweight migrations for databases created by earlier versions.
if (!db.prepare('PRAGMA table_info(links)').all().some((c) => c.name === 'image_url')) {
  db.exec('ALTER TABLE links ADD COLUMN image_url TEXT');
}
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'oauth_provider')) {
  db.exec('ALTER TABLE users ADD COLUMN oauth_provider TEXT');
}

export const now = () => Date.now();
export const one = (sql, ...a) => db.prepare(sql).get(...a);
export const all = (sql, ...a) => db.prepare(sql).all(...a);
export const run = (sql, ...a) => db.prepare(sql).run(...a);

export function isPro(u) {
  if (!u) return false;
  if (u.comped) return true;
  if (u.plan !== 'pro') return false;
  return true;
}

export function isDomainBlocked(host) {
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (one('SELECT 1 x FROM blocked_domains WHERE domain = ?', parts.slice(i).join('.'))) return true;
  }
  return false;
}
