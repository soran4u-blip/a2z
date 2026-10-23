import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, ROOT } from './lib/config.js';
import { db, one, all, run, now, isPro, isDomainBlocked } from './lib/db.js';
import {
  esc, sha256, hmac, token, randomSlug, RESERVED, hashPassword, verifyPassword, isEmail, validateUrl,
  rateLimit, parseCookies, deviceOf, browserOf, BOT_RE, UNFURL_RE, refHost, localeOf,
} from './lib/util.js';
import * as P from './lib/pages.js';
import { stripeEnabled, createCheckout, createPortal, verifyWebhook } from './lib/stripe.js';

const PUBLIC = path.join(ROOT, 'public');
const DAY = 86400000;
const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp' };

/* ------------------------------------------------------------------ helpers */
const hostnameOf = (req) => String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
const clientIp = (req) => (config.trustProxy && (req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())) || req.socket.remoteAddress || '0.0.0.0';

const BASE_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'";
function secHeaders(extra = {}) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': BASE_CSP,
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...extra,
  };
  if (config.secureCookies) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}
function sendHtml(res, status, html, extra = {}) {
  res.writeHead(status, secHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extra }));
  res.end(html);
}
function sendJson(res, status, obj, extra = {}) {
  res.writeHead(status, secHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }));
  res.end(JSON.stringify(obj));
}
const fail = (res, status, error, extra) => sendJson(res, status, { error }, extra);

async function readBody(req, limit = 100 * 1024) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('Too large'), { code: 413 }); chunks.push(c); }
  return Buffer.concat(chunks);
}
async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw Object.assign(new Error('Bad JSON'), { code: 400 }); }
}
// CSRF: JSON content type + same-origin Origin header on every mutation.
function sameOriginOk(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  if (!String(req.headers['content-type'] || '').includes('application/json')) return false;
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === String(req.headers.host).toLowerCase(); } catch { return false; }
}

function setCookie(res, name, value, { maxAge, strict } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', `SameSite=${strict ? 'Strict' : 'Lax'}`];
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  if (config.secureCookies) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, parts.join('; ')) : parts.join('; '));
}

function startSession(res, kind, subject) {
  const tok = token();
  const ttl = kind === 'admin' ? 12 * 3600e3 : 30 * DAY;
  run('INSERT INTO sessions (id, kind, subject, expires) VALUES (?,?,?,?)', sha256(tok), kind, subject, now() + ttl);
  setCookie(res, kind === 'admin' ? 'a2z_a' : 'a2z_s', tok, { maxAge: ttl / 1000, strict: kind === 'admin' });
}
function sessionFor(req, kind) {
  const tok = parseCookies(req.headers.cookie)[kind === 'admin' ? 'a2z_a' : 'a2z_s'];
  if (!tok) return null;
  const s = one('SELECT * FROM sessions WHERE id = ? AND kind = ? AND expires > ?', sha256(tok), kind, now());
  return s ? { ...s, tok } : null;
}
function currentUser(req) {
  const s = sessionFor(req, 'user');
  if (!s) return null;
  const u = one('SELECT * FROM users WHERE id = ?', s.subject);
  return u && u.status === 'active' ? u : null;
}
function currentAdmin(req) {
  const s = sessionFor(req, 'admin');
  return s ? one('SELECT id, email FROM admins WHERE id = ?', s.subject) : null;
}
function endSession(req, res, kind) {
  const s = sessionFor(req, kind);
  if (s) run('DELETE FROM sessions WHERE id = ?', sha256(s.tok));
  setCookie(res, kind === 'admin' ? 'a2z_a' : 'a2z_s', '', { maxAge: 0, strict: kind === 'admin' });
}

/* ------------------------------------------------------------------ links */
const linkCache = new Map(); // slug(lower) -> { link, owner, t }
const clearCache = () => linkCache.clear();

const toDto = (l) => ({
  id: l.id, slug: l.slug, short: `${config.baseUrl}/${l.slug}`, url: l.url, host: l.host, title: l.title,
  price: l.price, original_price: l.original_price, currency: l.currency, coupon: l.coupon, preview: !!l.preview,
  starts_at: l.starts_at, expires_at: l.expires_at, pixel_meta: l.pixel_meta, pixel_tiktok: l.pixel_tiktok,
  image_url: l.image_url, status: l.status, clicks: l.clicks, created_at: l.created_at, guest: !!l.guest,
});

const num = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) / 100 : NaN; };
const ts = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : NaN; };

async function safeBrowsingBad(url) {
  if (!config.safeBrowsingKey) return false;
  try {
    const r = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${config.safeBrowsingKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(3000),
      body: JSON.stringify({
        client: { clientId: 'a2z-deals', clientVersion: '1.0' },
        threatInfo: { threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'], platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: [{ url }] },
      }),
    });
    const j = await r.json();
    return !!(j.matches && j.matches.length);
  } catch { return false; }
}

// Validate + normalise link input for create/update. Returns { error } or { data }.
async function normalizeLink(user, input, existing) {
  const pro = isPro(user);
  const d = {};
  const urlIn = input.url !== undefined ? input.url : existing?.url;
  const v = validateUrl(urlIn);
  if (v.error) return { error: v.error };
  if (isDomainBlocked(v.host)) return { error: 'This website is not allowed on a2z.deals.' };
  if (!existing || v.url !== existing.url) {
    if (await safeBrowsingBad(v.url)) return { error: 'This link was flagged as unsafe.' };
  }
  d.url = v.url; d.host = v.host;

  const str = (k, max) => (input[k] !== undefined ? String(input[k] ?? '').trim().slice(0, max) || null : existing?.[k] ?? null);
  d.title = str('title', 120);
  d.coupon = str('coupon', 40);
  // Optional product image shown on the deal card (https only, never fetched by the server)
  const imgIn = input.image_url !== undefined ? String(input.image_url ?? '').trim() : existing?.image_url ?? '';
  if (imgIn) {
    let iu; try { iu = new URL(imgIn); } catch { return { error: 'The image link is not valid.' }; }
    if (iu.protocol !== 'https:' || iu.username || iu.password || !iu.hostname.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(iu.hostname) || imgIn.length > 500) {
      return { error: 'Use a public https:// image link (max 500 characters).' };
    }
    d.image_url = iu.toString();
  } else d.image_url = null;
  d.currency = input.currency !== undefined ? (/^[A-Z]{3}$/.test(String(input.currency)) ? input.currency : 'USD') : existing?.currency || 'USD';

  const price = input.price !== undefined ? num(input.price) : existing?.price ?? null;
  const orig = input.original_price !== undefined ? num(input.original_price) : existing?.original_price ?? null;
  if (Number.isNaN(price) || Number.isNaN(orig)) return { error: 'Prices must be valid numbers.' };
  d.price = price; d.original_price = orig;
  d.preview = input.preview !== undefined ? (input.preview ? 1 : 0) : existing?.preview ?? 1;

  const starts = input.starts_at !== undefined ? ts(input.starts_at) : existing?.starts_at ?? null;
  const expires = input.expires_at !== undefined ? ts(input.expires_at) : existing?.expires_at ?? null;
  if (Number.isNaN(starts) || Number.isNaN(expires)) return { error: 'Invalid date.' };
  if (starts && !pro && starts !== existing?.starts_at) return { error: 'Scheduled start is a Pro feature.' };
  if (starts && expires && expires <= starts) return { error: 'Expiry must be after the start time.' };
  d.starts_at = starts; d.expires_at = expires;

  for (const [k, re, label] of [['pixel_meta', /^\d{5,20}$/, 'Meta Pixel ID (digits only)'], ['pixel_tiktok', /^[A-Za-z0-9]{8,32}$/, 'TikTok Pixel ID']]) {
    const val = input[k] !== undefined ? String(input[k] ?? '').trim() : existing?.[k] ?? '';
    if (val && !re.test(val)) return { error: `Invalid ${label}.` };
    if (val && !pro && val !== existing?.[k]) return { error: 'Retargeting pixels are a Pro feature.' };
    d[k] = val || null;
  }

  // slug
  const want = input.slug !== undefined ? String(input.slug ?? '').trim() : '';
  if (existing) {
    if (want && want.toLowerCase() !== existing.slug.toLowerCase()) {
      if (!pro) return { error: 'Custom slugs are a Pro feature.' };
      d.slug = want;
    }
  } else if (want) {
    if (!pro) return { error: 'Custom slugs are a Pro feature.' };
    d.slug = want;
  }
  if (d.slug) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/.test(d.slug)) return { error: 'Slug: 3-40 letters, numbers, - or _.' };
    if (RESERVED.has(d.slug.toLowerCase())) return { error: 'That slug is reserved.' };
    const taken = one('SELECT id FROM links WHERE slug = ?', d.slug);
    if (taken && taken.id !== existing?.id) return { error: 'That slug is already taken.' };
  }
  return { data: d };
}

function insertLink(userId, d, guest = 0) {
  let slug = d.slug;
  for (let i = 0; i < 8 && !slug; i++) {
    const cand = randomSlug(i < 4 ? 6 : 7);
    if (!RESERVED.has(cand.toLowerCase()) && !one('SELECT 1 x FROM links WHERE slug = ?', cand)) slug = cand;
  }
  if (!slug) throw new Error('Could not allocate a slug');
  const r = run(
    `INSERT INTO links (user_id, slug, url, host, title, price, original_price, currency, coupon, preview, starts_at, expires_at, pixel_meta, pixel_tiktok, image_url, created_at, guest)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    userId, slug, d.url, d.host, d.title, d.price, d.original_price, d.currency || 'USD', d.coupon, d.preview ?? 1,
    d.starts_at ?? null, d.expires_at ?? null, d.pixel_meta ?? null, d.pixel_tiktok ?? null, d.image_url ?? null, now(), guest,
  );
  clearCache();
  return one('SELECT * FROM links WHERE id = ?', r.lastInsertRowid);
}

function planInfo(u) {
  const pro = isPro(u);
  const count = one('SELECT COUNT(*) c FROM links WHERE user_id = ?', u.id).c;
  return {
    plan: pro ? 'pro' : 'free', comped: !!u.comped, sub_status: u.sub_status, period_end: u.period_end,
    link_limit: pro ? null : config.freeLinkLimit, link_count: count, analytics_days: pro ? 365 : 7,
    stripe: stripeEnabled(), has_customer: !!u.stripe_customer,
    monthly: config.proMonthlyCents, yearly: config.proYearlyCents,
  };
}

/* ------------------------------------------------------------------ stats */
function linkStats(link, days) {
  const since = now() - days * DAY;
  const base = 'FROM clicks WHERE link_id = ? AND ts >= ?';
  const total = one(`SELECT COUNT(*) c, COUNT(DISTINCT visitor) u ${base}`, link.id, since);
  const byDay = new Map(all(`SELECT date(ts/1000,'unixepoch') d, COUNT(*) c ${base} GROUP BY d`, link.id, since).map((r) => [r.d, r.c]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) { const d = new Date(now() - i * DAY).toISOString().slice(0, 10); series.push({ d, c: byDay.get(d) || 0 }); }
  const top = (col) => all(`SELECT ${col} k, COUNT(*) c ${base} GROUP BY ${col} ORDER BY c DESC LIMIT 8`, link.id, since);
  return { total: total.c, unique: total.u, series, referrers: top('referrer'), devices: top('device'), browsers: top('browser'), locales: top('locale') };
}

/* ------------------------------------------------------------------ redirect */
function lookup(slug) {
  const key = slug.toLowerCase();
  const c = linkCache.get(key);
  if (c && now() - c.t < 30000) return c;
  const link = one('SELECT * FROM links WHERE slug = ?', slug);
  if (!link) { return null; }
  const owner = link.user_id ? one('SELECT id, plan, comped, status FROM users WHERE id = ?', link.user_id) : null;
  const entry = { link, owner, t: now() };
  linkCache.set(key, entry);
  return entry;
}

function logClick(link, req) {
  const ua = String(req.headers['user-agent'] || '');
  const ip = clientIp(req);
  setImmediate(() => {
    try {
      run('INSERT INTO clicks (link_id, ts, device, browser, referrer, locale, visitor) VALUES (?,?,?,?,?,?,?)',
        link.id, now(), deviceOf(ua), browserOf(ua), refHost(req.headers.referer), localeOf(req.headers['accept-language']), hmac(ip + '|' + ua));
      run('UPDATE links SET clicks = clicks + 1 WHERE id = ?', link.id);
      const c = linkCache.get(link.slug.toLowerCase()); if (c) c.link.clicks++;
    } catch (e) { console.error('click log failed', e.message); }
  });
}

function handleRedirect(req, res, slug) {
  const entry = lookup(slug);
  if (!entry) return sendHtml(res, 404, P.messagePage('Link not found', 'This short link does not exist or was removed.'));
  const { link, owner } = entry;
  if (link.status !== 'active' || (owner && owner.status !== 'active')) {
    return sendHtml(res, 410, P.messagePage('Link disabled', 'This link was disabled for violating our rules or by its owner.'));
  }
  const t = now();
  if (link.starts_at && t < link.starts_at) return sendHtml(res, 200, P.endedPage(link, 'soon'));
  if (link.expires_at && t > link.expires_at) return sendHtml(res, 200, P.endedPage(link, 'ended'));

  const ua = String(req.headers['user-agent'] || '');
  const unfurl = UNFURL_RE.test(ua);
  const bot = unfurl || BOT_RE.test(ua);
  if (!bot) logClick(link, req);

  const ownerPro = isPro(owner);
  if (!link.preview && !unfurl) {
    res.writeHead(302, secHeaders({ Location: link.url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer-when-downgrade' }));
    return res.end();
  }
  const nonce = crypto.randomBytes(16).toString('base64');
  const view = ownerPro ? link : { ...link, pixel_meta: null, pixel_tiktok: null };
  const html = P.interstitial(view, { nonce, branded: !ownerPro, bot: unfurl });
  const csp = `default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'nonce-${nonce}' https://connect.facebook.net https://analytics.tiktok.com; connect-src 'self' https://*.facebook.com https://*.facebook.net https://analytics.tiktok.com https://*.tiktok.com; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`;
  sendHtml(res, 200, html, { 'Content-Security-Policy': csp, 'Referrer-Policy': 'no-referrer-when-downgrade' });
}

/* ------------------------------------------------------------------ billing webhook */
function userFromSub(obj) {
  return (obj.metadata?.user_id && one('SELECT * FROM users WHERE id = ?', Number(obj.metadata.user_id)))
    || (obj.id && one('SELECT * FROM users WHERE stripe_sub = ?', obj.id))
    || (obj.customer && one('SELECT * FROM users WHERE stripe_customer = ?', obj.customer)) || null;
}
function applyStripeEvent(ev) {
  const o = ev.data?.object || {};
  if (ev.type === 'checkout.session.completed' && o.mode === 'subscription') {
    const u = one('SELECT * FROM users WHERE id = ?', Number(o.client_reference_id));
    if (!u) return;
    run("UPDATE users SET stripe_customer = ?, stripe_sub = ?, plan = 'pro', sub_status = 'active' WHERE id = ?", o.customer, o.subscription, u.id);
  } else if (ev.type === 'customer.subscription.created' || ev.type === 'customer.subscription.updated') {
    const u = userFromSub(o); if (!u) return;
    const good = ['active', 'trialing', 'past_due'].includes(o.status);
    const end = (o.current_period_end || o.items?.data?.[0]?.current_period_end || 0) * 1000 || null;
    run('UPDATE users SET stripe_customer = ?, stripe_sub = ?, plan = ?, sub_status = ?, period_end = ? WHERE id = ?',
      o.customer, o.id, good ? 'pro' : 'free', o.cancel_at_period_end && good ? 'canceling' : o.status, end, u.id);
  } else if (ev.type === 'customer.subscription.deleted') {
    const u = userFromSub(o); if (!u) return;
    run("UPDATE users SET plan = 'free', sub_status = 'canceled', stripe_sub = NULL WHERE id = ?", u.id);
  } else if (ev.type === 'invoice.paid') {
    const u = o.customer ? one('SELECT * FROM users WHERE stripe_customer = ?', o.customer) : null;
    try { run('INSERT INTO payments (user_id, stripe_event, kind, amount, currency, created_at) VALUES (?,?,?,?,?,?)', u?.id ?? null, ev.id, 'invoice', o.amount_paid || 0, o.currency, now()); } catch { /* duplicate event */ }
  }
  clearCache();
}

/* ------------------------------------------------------------------ user API */
async function userApi(req, res, url, user) {
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/signup' && m === 'POST') {
    if (!rateLimit('signup:' + clientIp(req), 8, 3600e3)) return fail(res, 429, 'Too many sign-ups from this network. Try again later.');
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const pw = String(b.password || '');
    if (!isEmail(email)) return fail(res, 400, 'Enter a valid email address.');
    if (pw.length < 8 || pw.length > 200) return fail(res, 400, 'Password must be at least 8 characters.');
    if (one('SELECT 1 x FROM users WHERE email = ?', email)) return fail(res, 409, 'An account with this email already exists. Try logging in.');
    const r = run('INSERT INTO users (email, pass_hash, created_at, last_login) VALUES (?,?,?,?)', email, await hashPassword(pw), now(), now());
    startSession(res, 'user', Number(r.lastInsertRowid));
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/login' && m === 'POST') {
    const ip = clientIp(req);
    if (!rateLimit('login:' + ip, 15, 600e3)) return fail(res, 429, 'Too many attempts. Try again in a few minutes.');
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const u = one('SELECT * FROM users WHERE email = ?', email);
    const ok = u ? await verifyPassword(String(b.password || ''), u.pass_hash) : (await verifyPassword('x', 's1$AAAA$AAAA'), false);
    if (!ok) return fail(res, 401, 'Wrong email or password.');
    if (u.status !== 'active') return fail(res, 403, 'This account is suspended. Contact support.');
    run('UPDATE users SET last_login = ? WHERE id = ?', now(), u.id);
    startSession(res, 'user', u.id);
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/logout' && m === 'POST') { endSession(req, res, 'user'); return sendJson(res, 200, { ok: true }); }

  // Public shorten box on the landing page (guest links last 30 days)
  if (p === '/api/quick' && m === 'POST') {
    const ip = clientIp(req);
    if (!rateLimit('quick:' + ip, 10, 3600e3)) return fail(res, 429, 'Free guest limit reached. Create a free account to keep going.');
    const b = await readJson(req);
    if (user) {
      if (!isPro(user) && one('SELECT COUNT(*) c FROM links WHERE user_id = ?', user.id).c >= config.freeLinkLimit) return fail(res, 402, `Free plan limit of ${config.freeLinkLimit} links reached.`);
    }
    const r = await normalizeLink(user, { url: b.url }, null);
    if (r.error) return fail(res, 400, r.error);
    const d = r.data;
    if (!user) d.expires_at = now() + 30 * DAY;
    const link = insertLink(user?.id ?? null, d, user ? 0 : 1);
    return sendJson(res, 200, { link: toDto(link), guest: !user });
  }

  if (p === '/api/report' && m === 'POST') {
    if (!rateLimit('report:' + clientIp(req), 10, 3600e3)) return fail(res, 429, 'Too many reports.');
    const b = await readJson(req);
    const link = one('SELECT id, slug FROM links WHERE slug = ?', String(b.slug || ''));
    if (!link) return fail(res, 404, 'Link not found.');
    run('INSERT INTO reports (link_id, slug, reason, detail, reporter, created_at) VALUES (?,?,?,?,?,?)',
      link.id, link.slug, String(b.reason || 'Other').slice(0, 80), String(b.detail || '').slice(0, 500), hmac(clientIp(req)), now());
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/stripe/webhook' && m === 'POST') {
    const raw = (await readBody(req, 1024 * 1024)).toString('utf8');
    const ev = verifyWebhook(raw, req.headers['stripe-signature']);
    if (!ev) return fail(res, 400, 'Invalid signature');
    try { applyStripeEvent(ev); } catch (e) { console.error('stripe event failed', ev.type, e.message); return fail(res, 500, 'handler error'); }
    return sendJson(res, 200, { received: true });
  }

  // ---- authenticated below
  if (!user) return fail(res, 401, 'Please log in.');

  if (p === '/api/me' && m === 'GET') return sendJson(res, 200, { email: user.email, ...planInfo(user), base: config.baseUrl });

  if (p === '/api/links' && m === 'GET') {
    const rows = all('SELECT * FROM links WHERE user_id = ? ORDER BY id DESC LIMIT 1000', user.id);
    const week = all(`SELECT link_id, COUNT(*) c FROM clicks WHERE ts >= ? AND link_id IN (SELECT id FROM links WHERE user_id = ?) GROUP BY link_id`, now() - 7 * DAY, user.id);
    const wk = new Map(week.map((r) => [r.link_id, r.c]));
    return sendJson(res, 200, { links: rows.map((l) => ({ ...toDto(l), clicks_7d: wk.get(l.id) || 0 })) });
  }
  if (p === '/api/links' && m === 'POST') {
    if (!rateLimit('create:' + user.id, 120, 3600e3)) return fail(res, 429, 'Slow down a little.');
    if (!isPro(user) && one('SELECT COUNT(*) c FROM links WHERE user_id = ?', user.id).c >= config.freeLinkLimit) {
      return fail(res, 402, `Free plan limit of ${config.freeLinkLimit} links reached. Upgrade to Pro for unlimited links.`);
    }
    const r = await normalizeLink(user, await readJson(req), null);
    if (r.error) return fail(res, 400, r.error);
    return sendJson(res, 200, { link: toDto(insertLink(user.id, r.data)) });
  }

  const lm = p.match(/^\/api\/links\/(\d+)(?:\/(stats|export\.csv))?$/);
  if (lm) {
    const link = one('SELECT * FROM links WHERE id = ? AND user_id = ?', Number(lm[1]), user.id);
    if (!link) return fail(res, 404, 'Link not found.');
    if (lm[2] === 'stats' && m === 'GET') {
      const max = isPro(user) ? 365 : 7;
      const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 7, 1), max);
      return sendJson(res, 200, { link: toDto(link), days, max_days: max, ...linkStats(link, days) });
    }
    if (lm[2] === 'export.csv' && m === 'GET') {
      if (!isPro(user)) return fail(res, 402, 'CSV export is a Pro feature.');
      const rows = all('SELECT ts, device, browser, referrer, locale FROM clicks WHERE link_id = ? ORDER BY ts DESC LIMIT 50000', link.id);
      const csv = ['time,device,browser,referrer,locale', ...rows.map((r) => [new Date(r.ts).toISOString(), r.device, r.browser, r.referrer, r.locale].map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
      res.writeHead(200, secHeaders({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="a2z-${link.slug}.csv"` }));
      return res.end(csv);
    }
    if (!lm[2] && m === 'PATCH') {
      const b = await readJson(req);
      const r = await normalizeLink(user, b, link);
      if (r.error) return fail(res, 400, r.error);
      const d = r.data;
      run(`UPDATE links SET slug=?, url=?, host=?, title=?, price=?, original_price=?, currency=?, coupon=?, preview=?, starts_at=?, expires_at=?, pixel_meta=?, pixel_tiktok=?, image_url=? WHERE id = ?`,
        d.slug || link.slug, d.url, d.host, d.title, d.price, d.original_price, d.currency, d.coupon, d.preview, d.starts_at, d.expires_at, d.pixel_meta, d.pixel_tiktok, d.image_url, link.id);
      clearCache();
      return sendJson(res, 200, { link: toDto(one('SELECT * FROM links WHERE id = ?', link.id)) });
    }
    if (!lm[2] && m === 'DELETE') { run('DELETE FROM links WHERE id = ?', link.id); clearCache(); return sendJson(res, 200, { ok: true }); }
  }

  if (p === '/api/billing/checkout' && m === 'POST') {
    if (!stripeEnabled()) return fail(res, 503, 'Payments are not configured yet.');
    if (isPro(user) && user.stripe_sub) return fail(res, 400, 'You are already on Pro.');
    const b = await readJson(req);
    try { return sendJson(res, 200, { url: await createCheckout(user, b.interval === 'year' ? 'year' : 'month') }); }
    catch (e) { console.error('checkout', e.message); return fail(res, 502, 'Could not start checkout. Please try again.'); }
  }
  if (p === '/api/billing/portal' && m === 'POST') {
    if (!stripeEnabled() || !user.stripe_customer) return fail(res, 400, 'No billing account yet.');
    try { return sendJson(res, 200, { url: await createPortal(user) }); }
    catch (e) { console.error('portal', e.message); return fail(res, 502, 'Could not open the billing portal.'); }
  }
  if (p === '/api/account/delete' && m === 'POST') {
    if (user.stripe_sub) return fail(res, 400, 'Cancel your subscription in Billing first.');
    run('DELETE FROM users WHERE id = ?', user.id); clearCache();
    endSession(req, res, 'user');
    return sendJson(res, 200, { ok: true });
  }
  return fail(res, 404, 'Not found');
}

/* ------------------------------------------------------------------ admin API */
async function adminApi(req, res, url, admin) {
  const p = url.pathname; const m = req.method;
  if (p === '/api/admin/login' && m === 'POST') {
    if (!rateLimit('alogin:' + clientIp(req), 8, 900e3)) return fail(res, 429, 'Too many attempts. Wait 15 minutes.');
    const b = await readJson(req);
    const a = one('SELECT * FROM admins WHERE email = ?', String(b.email || '').trim().toLowerCase());
    const ok = a ? await verifyPassword(String(b.password || ''), a.pass_hash) : (await verifyPassword('x', 's1$AAAA$AAAA'), false);
    if (!ok) return fail(res, 401, 'Wrong email or password.');
    startSession(res, 'admin', a.id);
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/admin/logout' && m === 'POST') { endSession(req, res, 'admin'); return sendJson(res, 200, { ok: true }); }
  if (!admin) return fail(res, 401, 'Admin login required.');

  if (p === '/api/admin/me') return sendJson(res, 200, { email: admin.email });

  if (p === '/api/admin/overview' && m === 'GET') {
    const t = now();
    const days = (n) => Array.from({ length: n }, (_, i) => new Date(t - (n - 1 - i) * DAY).toISOString().slice(0, 10));
    const fill = (rows, list) => { const mp = new Map(rows.map((r) => [r.d, r.c])); return list.map((d) => ({ d, c: mp.get(d) || 0 })); };
    const list = days(30);
    const stats = {
      users: one('SELECT COUNT(*) c FROM users').c,
      pro: one("SELECT COUNT(*) c FROM users WHERE plan = 'pro' OR comped = 1").c,
      paying: one("SELECT COUNT(*) c FROM users WHERE stripe_sub IS NOT NULL AND plan = 'pro'").c,
      links: one('SELECT COUNT(*) c FROM links').c,
      guest_links: one('SELECT COUNT(*) c FROM links WHERE guest = 1').c,
      clicks_total: one('SELECT COALESCE(SUM(clicks),0) c FROM links').c,
      clicks_24h: one('SELECT COUNT(*) c FROM clicks WHERE ts >= ?', t - DAY).c,
      revenue_30d: one('SELECT COALESCE(SUM(amount),0) c FROM payments WHERE created_at >= ?', t - 30 * DAY).c,
      open_reports: one("SELECT COUNT(*) c FROM reports WHERE status = 'open'").c,
      disabled_links: one("SELECT COUNT(*) c FROM links WHERE status = 'disabled'").c,
    };
    return sendJson(res, 200, {
      stats,
      signups: fill(all("SELECT date(created_at/1000,'unixepoch') d, COUNT(*) c FROM users WHERE created_at >= ? GROUP BY d", t - 30 * DAY), list),
      clicks: fill(all("SELECT date(ts/1000,'unixepoch') d, COUNT(*) c FROM clicks WHERE ts >= ? GROUP BY d", t - 30 * DAY), list),
      top_links: all('SELECT l.slug, l.title, l.host, l.clicks, u.email FROM links l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.clicks DESC LIMIT 8'),
      stripe: stripeEnabled(), webhook: !!config.stripeWebhookSecret, safe_browsing: !!config.safeBrowsingKey,
    });
  }

  if (p === '/api/admin/users' && m === 'GET') {
    const q = `%${(url.searchParams.get('q') || '').trim()}%`;
    const rows = all(`SELECT u.id, u.email, u.plan, u.comped, u.status, u.sub_status, u.stripe_sub, u.created_at, u.last_login,
        (SELECT COUNT(*) FROM links WHERE user_id = u.id) links, (SELECT COALESCE(SUM(clicks),0) FROM links WHERE user_id = u.id) clicks
      FROM users u WHERE u.email LIKE ? ORDER BY u.id DESC LIMIT 200`, q);
    return sendJson(res, 200, { users: rows });
  }
  const um = p.match(/^\/api\/admin\/users\/(\d+)$/);
  if (um) {
    const u = one('SELECT * FROM users WHERE id = ?', Number(um[1]));
    if (!u) return fail(res, 404, 'User not found.');
    if (m === 'PATCH') {
      const b = await readJson(req);
      if (b.plan === 'pro') run("UPDATE users SET comped = 1, plan = 'pro' WHERE id = ?", u.id);
      else if (b.plan === 'free') run("UPDATE users SET comped = 0, plan = CASE WHEN stripe_sub IS NOT NULL THEN plan ELSE 'free' END WHERE id = ?", u.id);
      if (b.status === 'active' || b.status === 'suspended') {
        run('UPDATE users SET status = ? WHERE id = ?', b.status, u.id);
        if (b.status === 'suspended') run("DELETE FROM sessions WHERE kind = 'user' AND subject = ?", u.id);
      }
      clearCache();
      return sendJson(res, 200, { ok: true });
    }
    if (m === 'DELETE') { run('DELETE FROM users WHERE id = ?', u.id); clearCache(); return sendJson(res, 200, { ok: true }); }
  }

  if (p === '/api/admin/links' && m === 'GET') {
    const q = `%${(url.searchParams.get('q') || '').trim()}%`;
    const st = url.searchParams.get('status');
    const rows = all(`SELECT l.id, l.slug, l.url, l.host, l.title, l.status, l.clicks, l.created_at, l.guest, u.email FROM links l LEFT JOIN users u ON u.id = l.user_id
      WHERE (l.slug LIKE ? OR l.url LIKE ? OR l.title LIKE ? OR u.email LIKE ?) ${st === 'disabled' ? "AND l.status = 'disabled'" : st === 'active' ? "AND l.status = 'active'" : ''}
      ORDER BY l.id DESC LIMIT 200`, q, q, q, q);
    return sendJson(res, 200, { links: rows.map((l) => ({ ...l, short: `${config.baseUrl}/${l.slug}` })) });
  }
  const alm = p.match(/^\/api\/admin\/links\/(\d+)$/);
  if (alm) {
    const l = one('SELECT * FROM links WHERE id = ?', Number(alm[1]));
    if (!l) return fail(res, 404, 'Link not found.');
    if (m === 'PATCH') {
      const b = await readJson(req);
      if (b.status === 'active' || b.status === 'disabled') run('UPDATE links SET status = ? WHERE id = ?', b.status, l.id);
      clearCache();
      return sendJson(res, 200, { ok: true });
    }
    if (m === 'DELETE') { run('DELETE FROM links WHERE id = ?', l.id); clearCache(); return sendJson(res, 200, { ok: true }); }
  }

  if (p === '/api/admin/reports' && m === 'GET') {
    const rows = all(`SELECT r.*, l.url, l.host, l.status link_status, u.email owner FROM reports r LEFT JOIN links l ON l.id = r.link_id LEFT JOIN users u ON u.id = l.user_id
      ORDER BY (r.status = 'open') DESC, r.id DESC LIMIT 200`);
    return sendJson(res, 200, { reports: rows });
  }
  const rm = p.match(/^\/api\/admin\/reports\/(\d+)$/);
  if (rm && m === 'PATCH') {
    const b = await readJson(req);
    const r = one('SELECT * FROM reports WHERE id = ?', Number(rm[1]));
    if (!r) return fail(res, 404, 'Report not found.');
    if (b.disable && r.link_id) run("UPDATE links SET status = 'disabled' WHERE id = ?", r.link_id);
    if (b.block_domain && r.link_id) {
      const l = one('SELECT host FROM links WHERE id = ?', r.link_id);
      if (l) { run('INSERT OR IGNORE INTO blocked_domains (domain, reason, created_at) VALUES (?,?,?)', l.host, 'From report #' + r.id, now()); run("UPDATE links SET status = 'disabled' WHERE host = ?", l.host); }
    }
    run("UPDATE reports SET status = 'resolved' WHERE id = ?", r.id);
    clearCache();
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/admin/blocklist' && m === 'GET') return sendJson(res, 200, { domains: all('SELECT * FROM blocked_domains ORDER BY created_at DESC') });
  if (p === '/api/admin/blocklist' && m === 'POST') {
    const b = await readJson(req);
    const dom = String(b.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) return fail(res, 400, 'Enter a domain like badsite.com');
    run('INSERT OR REPLACE INTO blocked_domains (domain, reason, created_at) VALUES (?,?,?)', dom, String(b.reason || '').slice(0, 120), now());
    const n = run("UPDATE links SET status = 'disabled' WHERE (host = ? OR host LIKE ?) AND status = 'active'", dom, '%.' + dom).changes;
    clearCache();
    return sendJson(res, 200, { ok: true, disabled: n });
  }
  const bm = p.match(/^\/api\/admin\/blocklist\/(.+)$/);
  if (bm && m === 'DELETE') { run('DELETE FROM blocked_domains WHERE domain = ?', decodeURIComponent(bm[1])); return sendJson(res, 200, { ok: true }); }

  return fail(res, 404, 'Not found');
}

/* ------------------------------------------------------------------ google oauth */
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const jwksCache = { keys: [], t: 0 };

async function getGoogleJwks() {
  const now = Date.now();
  if (jwksCache.keys.length && now - jwksCache.t < 3600e3) return jwksCache;
  const r = await fetch(GOOGLE_JWKS_URL);
  const j = await r.json();
  jwksCache.keys = j.keys || [];
  jwksCache.t = now;
  return jwksCache;
}

function b64urlDecode(s) {
  let b = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return Buffer.from(b, 'base64');
}

async function verifyGoogleIdToken(idToken) {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  let header, payload;
  try {
    header = JSON.parse(b64urlDecode(headerB64).toString('utf8'));
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch { return null; }
  if (!header || !payload) return null;
  if (payload.aud !== config.googleClientId) return null;
  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') return null;
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  const jwks = await getGoogleJwks();
  const key = jwks.keys.find((k) => k.kid === header.kid);
  if (!key) return null;
  const publicKey = crypto.createPublicKey({
    kty: key.kty,
    kid: key.kid,
    use: key.use,
    alg: key.alg,
    n: key.n,
    e: key.e,
    ext: true,
  });
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const sig = b64urlDecode(sigB64);
  return verifier.verify(publicKey, sig) ? payload : null;
}

async function authGoogle(req, res) {
  if (!config.googleClientId || !config.googleClientSecret) {
    return sendHtml(res, 500, P.messagePage('Auth not configured', 'Google OAuth is not configured on this server.'));
  }
  const state = token();
  setCookie(res, 'oauth_state', state, { maxAge: 600, strict: true });
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: `${config.baseUrl}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  res.writeHead(302, secHeaders({ Location: `${GOOGLE_AUTH_URL}?${params}`, 'Cache-Control': 'no-store' }));
  return res.end();
}

async function authGoogleCallback(req, res, url) {
  if (!config.googleClientId || !config.googleClientSecret) {
    return sendHtml(res, 500, P.messagePage('Auth not configured', 'Google OAuth is not configured on this server.'));
  }
  const params = new URLSearchParams(url.search);
  const code = params.get('code');
  const state = params.get('state');
  const cookieState = parseCookies(req.headers.cookie)?.oauth_state;
  if (!code || !state || state !== cookieState) {
    setCookie(res, 'oauth_state', '', { maxAge: 0, strict: true });
    return sendHtml(res, 400, P.messagePage('Auth failed', 'Invalid or missing state parameter.'));
  }
  setCookie(res, 'oauth_state', '', { maxAge: 0, strict: true });

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        code,
        redirect_uri: `${config.baseUrl}/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.id_token) {
      return sendHtml(res, 400, P.messagePage('Auth failed', 'Could not exchange code for tokens.'));
    }
    const payload = await verifyGoogleIdToken(tokenJson.id_token);
    if (!payload) {
      return sendHtml(res, 400, P.messagePage('Auth failed', 'Could not verify Google identity token.'));
    }
    if (!payload.email_verified) {
      return sendHtml(res, 400, P.messagePage('Auth failed', 'Google email is not verified.'));
    }
    const email = String(payload.email || '').toLowerCase();
    let user = one('SELECT * FROM users WHERE email = ?', email);
    if (!user) {
      const r = run('INSERT INTO users (email, pass_hash, oauth_provider, created_at, last_login) VALUES (?,?,?,?,?)',
        email, '', 'google', now(), now());
      user = one('SELECT * FROM users WHERE id = ?', Number(r.lastInsertRowid));
    } else {
      run('UPDATE users SET oauth_provider = ? WHERE id = ?', 'google', user.id);
      user = one('SELECT * FROM users WHERE id = ?', user.id);
    }
    run('UPDATE users SET last_login = ? WHERE id = ?', now(), user.id);
    startSession(res, 'user', user.id);
    res.writeHead(302, secHeaders({ Location: '/dashboard', 'Cache-Control': 'no-store' }));
    return res.end();
  } catch (e) {
    console.error('google oauth error', e.message);
    return sendHtml(res, 500, P.messagePage('Auth failed', 'Something went wrong during sign-in.'));
  }
}

/* ------------------------------------------------------------------ static */
function serveStatic(req, res, rel) {
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return sendHtml(res, 404, P.messagePage('Not found', ''));
  fs.stat(file, (serr, st) => {
    if (serr || !st.isFile()) return sendHtml(res, 404, P.messagePage('Not found', 'That file does not exist.'));
    // Revalidate on every load: a deploy is visible immediately, unchanged files cost a tiny 304.
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const hdr = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag };
    // Proxies (Cloudflare) may turn the ETag weak (W/"..."), so compare without the prefix.
    const inm = String(req.headers['if-none-match'] || '').split(',').map((s) => s.trim().replace(/^W\//, ''));
    if (inm.includes(etag)) { res.writeHead(304, secHeaders(hdr)); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) return sendHtml(res, 404, P.messagePage('Not found', 'That file does not exist.'));
      res.writeHead(200, secHeaders(hdr));
      res.end(buf);
    });
  });
}

/* ------------------------------------------------------------------ router */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const host = hostnameOf(req);
    const isAdminHost = !!config.adminHost && host === config.adminHost;

    if (p === '/health') return sendJson(res, 200, { ok: true });
    if (p.startsWith('/static/')) return serveStatic(req, res, p.slice(8));
    if (p === '/favicon.ico') return serveStatic(req, res, 'favicon.svg');
    if (p === '/robots.txt') {
      res.writeHead(200, secHeaders({ 'Content-Type': 'text/plain' }));
      return res.end(isAdminHost ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nDisallow: /dashboard\nDisallow: /api/\nDisallow: /report/\nSitemap: ${config.baseUrl}/sitemap.xml\n`);
    }

    if (isAdminHost) {
      if (p.startsWith('/api/')) {
        if (!sameOriginOk(req)) return fail(res, 403, 'Bad origin');
        return await adminApi(req, res, url, currentAdmin(req));
      }
      if (p === '/' && req.method === 'GET') return sendHtml(res, 200, P.adminShell());
      return sendHtml(res, 404, P.messagePage('Not found', ''));
    }

    if (p.startsWith('/api/') || p === '/stripe/webhook') {
      if (p !== '/stripe/webhook' && !sameOriginOk(req)) return fail(res, 403, 'Bad origin');
      if (p.startsWith('/api/admin')) return fail(res, 404, 'Not found');
      return await userApi(req, res, url, currentUser(req));
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendHtml(res, 405, P.messagePage('Method not allowed', ''));

    if (p === '/auth/google' && req.method === 'GET') return await authGoogle(req, res);
    if (p === '/auth/google/callback' && req.method === 'GET') return await authGoogleCallback(req, res, url);

    switch (p) {
      case '/': return sendHtml(res, 200, P.landing(), { 'Cache-Control': 'public, max-age=60' });
      case '/login': return currentUser(req) ? (res.writeHead(302, { Location: '/dashboard' }), res.end()) : sendHtml(res, 200, P.authPage('login'));
      case '/signup': return currentUser(req) ? (res.writeHead(302, { Location: '/dashboard' }), res.end()) : sendHtml(res, 200, P.authPage('signup'));
      case '/dashboard': return currentUser(req) ? sendHtml(res, 200, P.dashboardShell()) : (res.writeHead(302, { Location: '/login' }), res.end());
      case '/pricing': res.writeHead(302, { Location: '/#pricing' }); return res.end();
      case '/terms': return sendHtml(res, 200, P.termsPage());
      case '/privacy': return sendHtml(res, 200, P.privacyPage());
      case '/sitemap.xml':
        res.writeHead(200, secHeaders({ 'Content-Type': 'application/xml' }));
        return res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/terms', '/privacy'].map((x) => `<url><loc>${config.baseUrl}${x}</loc></url>`).join('')}</urlset>`);
    }
    const rep = p.match(/^\/report\/([A-Za-z0-9_-]{3,40})$/);
    if (rep) return sendHtml(res, 200, P.reportPage(rep[1]));
    const sm = p.match(/^\/([A-Za-z0-9_-]{3,40})$/);
    if (sm) return handleRedirect(req, res, sm[1]);
    return sendHtml(res, 404, P.messagePage('Page not found', 'We could not find that page.'));
  } catch (e) {
    if (e.code === 413) return fail(res, 413, 'Request too large');
    if (e.code === 400) return fail(res, 400, 'Bad request');
    console.error('unhandled', req.method, req.url, e);
    if (!res.headersSent) fail(res, 500, 'Something went wrong. Please try again.');
    else res.end();
  }
});

// Housekeeping
setInterval(() => {
  try {
    run('DELETE FROM sessions WHERE expires < ?', now());
    run('DELETE FROM links WHERE guest = 1 AND expires_at IS NOT NULL AND expires_at < ?', now() - 30 * DAY);
    run('DELETE FROM clicks WHERE ts < ?', now() - 400 * DAY);
  } catch (e) { console.error('cleanup', e.message); }
}, 6 * 3600e3).unref();

server.keepAliveTimeout = 65000;
server.listen(config.port, config.host, () => {
  console.log(`a2z.deals listening on http://${config.host}:${config.port}  base=${config.baseUrl}  admin=${config.adminHost || '(disabled)'}  stripe=${stripeEnabled()}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(() => { try { db.close(); } catch {} process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); });
