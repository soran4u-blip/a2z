import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependency). Real environment variables win.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const e = process.env;
const dataDir = path.resolve(ROOT, e.DATA_DIR || 'data');
fs.mkdirSync(dataDir, { recursive: true });

// Persist a generated secret so hashes/sessions survive restarts.
let secret = e.APP_SECRET;
if (!secret) {
  const f = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  secret = fs.readFileSync(f, 'utf8').trim();
}

export const config = {
  port: Number(e.PORT || 3100),
  host: e.HOST || '127.0.0.1',
  baseUrl: (e.BASE_URL || 'http://localhost:3100').replace(/\/$/, ''),
  adminHost: (e.ADMIN_HOST || '').toLowerCase(), // e.g. admin.a2z.deals ; empty = admin at /__admin on any host (dev only)
  dataDir,
  dbPath: path.join(dataDir, 'a2z.db'),
  secret,
  secureCookies: (e.BASE_URL || '').startsWith('https://'),
  trustProxy: e.TRUST_PROXY !== '0',
  stripeKey: e.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: e.STRIPE_WEBHOOK_SECRET || '',
  proMonthlyCents: Number(e.PRO_MONTHLY_CENTS || 900),
  proYearlyCents: Number(e.PRO_YEARLY_CENTS || 7900),
  safeBrowsingKey: e.SAFE_BROWSING_KEY || '',
  freeLinkLimit: Number(e.FREE_LINK_LIMIT || 25),
  supportEmail: e.SUPPORT_EMAIL || 'support@a2z.deals',
  googleClientId: e.GOOGLE_CLIENT_ID || '',
  googleClientSecret: e.GOOGLE_CLIENT_SECRET || '',
};
