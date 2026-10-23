import crypto from 'node:crypto';
import { config } from './config.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const hmac = (s) => crypto.createHmac('sha256', config.secret).update(String(s)).digest('hex').slice(0, 32);
export const token = (n = 32) => crypto.randomBytes(n).toString('base64url');

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomSlug(len = 6) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export const RESERVED = new Set([
  'api', 'admin', 'login', 'signup', 'logout', 'dashboard', 'pricing', 'static', 'assets', 'report', 'terms',
  'privacy', 'stripe', 'health', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'billing', 'account', 'settings',
  'about', 'contact', 'help', 'support', 'www', 'app', 'null', 'undefined', 'a2z', 'deals', 'deal', 'p', 'u',
]);

// Passwords: scrypt
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = await new Promise((res, rej) => crypto.scrypt(pw, salt, 64, (e, k) => (e ? rej(e) : res(k))));
  return `s1$${salt.toString('base64')}$${dk.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  try {
    const [v, s, h] = String(stored).split('$');
    if (v !== 's1') return false;
    const salt = Buffer.from(s, 'base64');
    const want = Buffer.from(h, 'base64');
    const got = await new Promise((res, rej) => crypto.scrypt(pw, salt, 64, (e, k) => (e ? rej(e) : res(k))));
    return crypto.timingSafeEqual(want, got);
  } catch { return false; }
}

export const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

// Destination URL validation (SSRF-style / abuse guard; we never fetch it, but we also never redirect to junk)
export function validateUrl(raw) {
  if (typeof raw !== 'string') return { error: 'Enter a link.' };
  let s = raw.trim();
  if (!s) return { error: 'Enter a link.' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  if (s.length > 2048) return { error: 'That link is too long.' };
  let u;
  try { u = new URL(s); } catch { return { error: 'That does not look like a valid link.' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Only http and https links are allowed.' };
  if (u.username || u.password) return { error: 'Links with embedded logins are not allowed.' };
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || h.endsWith('.local') || h.endsWith('.internal') || h === 'localhost') return { error: 'That link is not publicly reachable.' };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return { error: 'Links to IP addresses are not allowed.' };
  const own = new URL(config.baseUrl).hostname;
  if (h === own || h.endsWith('.' + own)) return { error: 'You cannot shorten an a2z.deals link.' };
  return { url: u.toString(), host: h.replace(/^www\./, '') };
}

const STORE_NAMES = {
  'amazon.com': 'Amazon', 'amazon.co.uk': 'Amazon', 'amazon.de': 'Amazon', 'amazon.ae': 'Amazon', 'amzn.to': 'Amazon', 'amzn.eu': 'Amazon',
  'ebay.com': 'eBay', 'walmart.com': 'Walmart', 'target.com': 'Target', 'bestbuy.com': 'Best Buy', 'aliexpress.com': 'AliExpress',
  'etsy.com': 'Etsy', 'temu.com': 'Temu', 'shein.com': 'SHEIN', 'noon.com': 'Noon', 'apple.com': 'Apple', 'nike.com': 'Nike',
  'udemy.com': 'Udemy', 'gumroad.com': 'Gumroad', 'shopify.com': 'Shopify', 'booking.com': 'Booking.com', 'iherb.com': 'iHerb',
};
export function storeName(host) {
  const h = String(host || '').replace(/^www\./, '');
  if (STORE_NAMES[h]) return STORE_NAMES[h];
  const parts = h.split('.');
  const base = parts.length > 2 && parts[parts.length - 2].length <= 3 ? parts[parts.length - 3] : parts[parts.length - 2] || h;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// Tiny in-memory rate limiter
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count++;
  return b.count <= max;
}
setInterval(() => { const n = Date.now(); for (const [k, b] of buckets) if (b.reset < n) buckets.delete(k); }, 60000).unref();

export function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function deviceOf(ua = '') {
  const u = ua.toLowerCase();
  if (/ipad|tablet/.test(u)) return 'Tablet';
  if (/mobi|iphone|android/.test(u)) return 'Mobile';
  return 'Desktop';
}
export function browserOf(ua = '') {
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\/|opera/i.test(ua)) return 'Opera';
  if (/instagram/i.test(ua)) return 'Instagram app';
  if (/fbav|fban/i.test(ua)) return 'Facebook app';
  if (/tiktok|musical_ly/i.test(ua)) return 'TikTok app';
  if (/telegram/i.test(ua)) return 'Telegram';
  if (/chrome|crios/i.test(ua)) return 'Chrome';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Other';
}
export const BOT_RE = /bot|crawler|spider|facebookexternalhit|slackbot|whatsapp|telegrambot|discordbot|linkedinbot|embedly|preview|curl|wget|python-requests|headless|monitor|pingdom|uptime/i;
export const UNFURL_RE = /facebookexternalhit|twitterbot|slackbot|whatsapp|telegrambot|discordbot|linkedinbot|skypeuripreview|embedly|pinterest|googlebot|bingbot|applebot|iMessage/i;

export function refHost(ref) {
  if (!ref) return 'Direct';
  try { return new URL(ref).hostname.replace(/^www\./, '') || 'Direct'; } catch { return 'Direct'; }
}
export function localeOf(al = '') {
  const m = String(al).split(',')[0].trim().match(/^([a-z]{2,3})(?:-([A-Za-z]{2}))?/i);
  if (!m) return 'unknown';
  return m[2] ? `${m[1].toLowerCase()}-${m[2].toUpperCase()}` : m[1].toLowerCase();
}
