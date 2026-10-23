// End-to-end test. Starts its own server on a throwaway database and drives it over HTTP.
//   node scripts/e2e.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3190;
const DATA = path.join(ROOT, 'data-e2e');
const WH = 'whsec_e2e_secret';
fs.rmSync(DATA, { recursive: true, force: true });

const env = {
  ...process.env, PORT: String(PORT), BASE_URL: `http://a2z.test:${PORT}`, ADMIN_HOST: 'admin.a2z.test', DATA_DIR: 'data-e2e',
  FREE_LINK_LIMIT: '3', STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_WEBHOOK_SECRET: WH, APP_SECRET: 'e2e-secret',
};
// admin account (separate process so we reuse the real script)
await new Promise((res, rej) => spawn(process.execPath, ['--no-warnings', 'scripts/create-admin.js', 'root@a2z.test', 'e2e-admin-password-1'], { cwd: ROOT, env, stdio: 'ignore' }).on('exit', (c) => (c ? rej(new Error('admin create failed')) : res())));
const srv = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = '';
srv.stdout.on('data', (d) => (srvLog += d)); srv.stderr.on('data', (d) => (srvLog += d));
for (let i = 0; i < 50; i++) { if (srvLog.includes('listening')) break; await sleep(100); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ---------------- tiny harness ---------------- */
let pass = 0, failN = 0; const failures = [];
const section = (n) => console.log(`\n== ${n}`);
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); } else { failN++; failures.push(name); console.log(`  FAIL ${name} ${extra}`); }
}
const eq = (a, b, name) => ok(a === b, name, `(got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

function raw(method, p, { host = 'a2z.test:' + PORT, cookie, json, body, headers = {}, ip = '10.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const data = json !== undefined ? JSON.stringify(json) : body;
    const h = { Host: host, 'X-Real-IP': ip, 'User-Agent': 'Mozilla/5.0 e2e', ...headers };
    if (json !== undefined) h['Content-Type'] = 'application/json';
    if (cookie) h.Cookie = cookie;
    if (data) h['Content-Length'] = Buffer.byteLength(data);
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: h }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let j; try { j = JSON.parse(text); } catch { /* html */ }
        const sc = [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]);
        resolve({ status: res.statusCode, headers: res.headers, text, json: j, setCookie: sc });
      });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
class Actor {
  constructor(ip, host) { this.ip = ip; this.host = host; this.jar = {}; }
  get cookie() { return Object.entries(this.jar).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; '); }
  async r(method, p, opts = {}) {
    const res = await raw(method, p, { host: this.host, ip: this.ip, cookie: this.cookie, ...opts });
    for (const c of res.setCookie) { const i = c.indexOf('='); this.jar[c.slice(0, i)] = c.slice(i + 1); }
    return res;
  }
  get(p, o) { return this.r('GET', p, o); }
  post(p, json, o) { return this.r('POST', p, { json: json ?? {}, ...o }); }
  patch(p, json) { return this.r('PATCH', p, { json }); }
  del(p) { return this.r('DELETE', p, { json: {} }); }
}
const user = (n) => new Actor(`10.1.0.${n}`);
const adminHost = 'admin.a2z.test:' + PORT;
const hour = 3600e3, day = 24 * hour;
const sign = (rawBody, ts = Math.floor(Date.now() / 1000), secret = WH) => `t=${ts},v1=${crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')}`;
const webhook = (ev, sig) => raw('POST', '/stripe/webhook', { body: JSON.stringify(ev), headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig ?? sign(JSON.stringify(ev)) } });

try {
  /* ================================================================ public pages + security */
  section('Public pages & security headers');
  const anon = user(1);
  let r = await anon.get('/');
  eq(r.status, 200, 'landing 200');
  ok(r.text.includes('Turn any link into a'), 'landing has hero text');
  ok(!/14-day|custom domain|broken link/i.test(r.text), 'landing has no invented claims');
  ok(/frame-ancestors 'none'/.test(r.headers['content-security-policy']), 'CSP frame-ancestors none');
  eq(r.headers['x-frame-options'], 'DENY', 'X-Frame-Options DENY');
  eq(r.headers['x-content-type-options'], 'nosniff', 'nosniff');
  for (const p of ['/login', '/signup', '/terms', '/privacy', '/health', '/robots.txt', '/sitemap.xml']) eq((await anon.get(p)).status, 200, `GET ${p} 200`);
  eq((await anon.get('/pricing')).status, 302, '/pricing redirects to landing#pricing');
  eq((await anon.get('/dashboard')).status, 302, '/dashboard redirects when logged out');
  eq((await anon.get('/static/app.css')).status, 200, 'static css served');
  eq((await anon.get('/static/..%2fserver.js')).status, 404, 'static path traversal blocked (%2f)');
  eq((await anon.get('/static/../server.js')).status, 404, 'static path traversal blocked (..)');
  eq((await anon.get('/static/../.env')).status, 404, 'static .env not reachable');
  eq((await anon.get('/nope-xyz')).status, 404, 'unknown slug 404');
  eq((await anon.get('/api/me')).status, 401, 'api/me requires login');
  eq((await anon.get('/api/admin/overview')).status, 404, 'admin API hidden on public host');
  eq((await anon.get('/', { host: adminHost })).status, 200, 'admin shell on admin host');
  ok(/noindex/.test((await anon.get('/', { host: adminHost })).text), 'admin shell is noindex');
  ok(/Disallow: \//.test((await anon.get('/robots.txt', { host: adminHost })).text), 'admin robots disallows all');
  eq((await anon.get('/login', { host: adminHost })).status, 404, 'user pages not served on admin host');

  /* ================================================================ auth */
  section('Signup / login / logout');
  const A = user(10);
  r = await A.post('/api/signup', { email: 'not-an-email', password: 'password123' });
  eq(r.status, 400, 'signup rejects bad email');
  r = await A.post('/api/signup', { email: 'a@e2e.test', password: 'short' });
  eq(r.status, 400, 'signup rejects short password');
  r = await A.post('/api/signup', { email: 'a@e2e.test', password: 'password123' });
  eq(r.status, 200, 'signup ok');
  ok(r.setCookie.some((c) => c.startsWith('a2z_s=')), 'session cookie set');
  ok(/HttpOnly/i.test(r.headers['set-cookie'][0]) && /SameSite=Lax/i.test(r.headers['set-cookie'][0]), 'cookie HttpOnly + SameSite');
  r = await user(11).post('/api/signup', { email: 'A@E2E.test', password: 'password123' });
  eq(r.status, 409, 'duplicate email (case-insensitive) rejected');
  r = await A.get('/api/me');
  eq(r.json?.plan, 'free', 'new user is free');
  eq(r.json?.link_limit, 3, 'free limit exposed (3 in test)');
  eq((await A.get('/dashboard')).status, 200, 'dashboard accessible when logged in');
  eq((await A.get('/login')).status, 302, '/login redirects when logged in');
  r = await user(12).post('/api/login', { email: 'a@e2e.test', password: 'wrongpass' });
  eq(r.status, 401, 'wrong password rejected');
  r = await user(12).post('/api/login', { email: 'nobody@e2e.test', password: 'password123' });
  eq(r.status, 401, 'unknown email rejected (same error)');
  const A2 = user(13);
  eq((await A2.post('/api/login', { email: 'a@e2e.test', password: 'password123' })).status, 200, 'login ok');
  await A2.post('/api/logout');
  eq((await A2.get('/api/me')).status, 401, 'logout invalidates session');
  // CSRF
  r = await A.r('POST', '/api/links', { json: { url: 'ebay.com/csrf' }, headers: { Origin: 'http://evil.example' } });
  eq(r.status, 403, 'cross-origin POST blocked');
  r = await A.r('POST', '/api/links', { body: 'url=ebay.com', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  eq(r.status, 403, 'non-JSON POST blocked');
  // rate limit on login
  const brute = user(14); let last;
  for (let i = 0; i < 17; i++) last = await brute.post('/api/login', { email: 'a@e2e.test', password: 'bad' + i });
  eq(last.status, 429, 'login brute-force rate limited');

  /* ================================================================ google oauth */
  section('Google OAuth');
  eq((await anon.get('/auth/google')).status, 302, 'google redirect 302');
  ok((await anon.get('/auth/google')).headers.location.includes('accounts.google.com/o/oauth2/v2/auth'), 'redirects to google auth');
  ok((await anon.get('/auth/google')).headers.location.includes('scope=openid+email+profile'), 'requests email+profile scope');
  const stateRes = await anon.get('/auth/google');
  const stateCookie = stateRes.setCookie.find((c) => c.startsWith('oauth_state='));
  ok(!!stateCookie, 'oauth_state cookie set');
  ok(/SameSite=Strict/i.test(stateRes.headers['set-cookie'][0]), 'oauth state cookie SameSite=Strict');
  r = await anon.get('/auth/google/callback');
  eq(r.status, 400, 'callback with no code returns 400');
  r = await anon.get('/auth/google/callback?code=abc');
  eq(r.status, 400, 'callback with code but no state returns 400');
  r = await anon.get('/auth/google/callback?code=abc&state=wrong');
  eq(r.status, 400, 'callback with mismatched state returns 400');

  /* ================================================================ link creation & validation */
  section('Link creation & URL validation');
  r = await A.post('/api/links', { url: 'amazon.com/dp/B0TEST?tag=me-20', title: 'Headphones', price: 129.99, original_price: 299.99, coupon: 'SAVE20' });
  eq(r.status, 200, 'create link');
  const L1 = r.json.link;
  eq(L1.url, 'https://amazon.com/dp/B0TEST?tag=me-20', 'scheme added, affiliate tag preserved');
  ok(/^[A-Za-z0-9]{6}$/.test(L1.slug), 'random 6-char slug');
  eq(L1.short, `http://a2z.test:${PORT}/${L1.slug}`, 'short URL uses BASE_URL');
  const bad = ['http://localhost/x', 'ftp://a.com/x', 'http://10.0.0.1/x', 'javascript:alert(1)', 'https://user:pw@a.com/', 'a', '', 'http://[::1]/x', 'https://x.internal/a', 'https://' + 'a'.repeat(2100) + '.com'];
  for (const u of bad) { r = await A.post('/api/links', { url: u }); ok(r.status === 400, `rejects ${u.slice(0, 40)}`, `(got ${r.status})`); }
  r = await A.post('/api/links', { url: 'a2z.test/self' });
  eq(r.status, 400, 'rejects own domain (no redirect loops)');
  r = await A.post('/api/links', { url: 'ebay.com/a', price: 'abc' });
  eq(r.status, 400, 'rejects non-numeric price');
  r = await A.post('/api/links', { url: 'ebay.com/a', image_url: 'http://x.com/a.jpg' });
  eq(r.status, 400, 'rejects http image');
  r = await A.post('/api/links', { url: 'ebay.com/a', image_url: 'https://1.2.3.4/a.jpg' });
  eq(r.status, 400, 'rejects IP image host');
  r = await A.post('/api/links', { url: 'etsy.com/x', title: '<script>alert(1)</script>', image_url: 'https://cdn.example.com/p.jpg' });
  eq(r.status, 200, 'accepts https image + html in title');
  const L2 = r.json.link;
  // free plan gates
  r = await A.post('/api/links', { url: 'ebay.com/s', slug: 'mine' }); eq(r.status, 400, 'free: custom slug blocked');
  r = await A.post('/api/links', { url: 'ebay.com/s', pixel_meta: '1234567890' }); eq(r.status, 400, 'free: pixel blocked');
  r = await A.post('/api/links', { url: 'ebay.com/s', starts_at: Date.now() + day }); eq(r.status, 400, 'free: scheduled start blocked');
  r = await A.post('/api/links', { url: 'target.com/third' });
  eq(r.status, 200, 'third link ok');
  const L3 = r.json.link;
  r = await A.post('/api/links', { url: 'target.com/fourth' });
  eq(r.status, 402, 'free limit (3) enforced with 402');
  eq((await A.get('/api/me')).json.link_count, 3, 'link_count = 3');
  // list
  r = await A.get('/api/links');
  eq(r.json.links.length, 3, 'list returns 3');
  // update
  r = await A.patch(`/api/links/${L1.id}`, { title: 'Updated', price: 99, url: 'https://amazon.com/dp/NEW' });
  eq(r.status, 200, 'patch ok'); eq(r.json.link.title, 'Updated', 'title updated'); eq(r.json.link.slug, L1.slug, 'slug unchanged on patch');
  r = await A.patch(`/api/links/${L1.id}`, { url: 'http://localhost/x' }); eq(r.status, 400, 'patch validates URL');
  r = await A.patch(`/api/links/${L1.id}`, { image_url: '' }); eq(r.json.link.image_url, null, 'image can be cleared');

  /* ================================================================ isolation */
  section('Ownership isolation');
  const B = user(20);
  await B.post('/api/signup', { email: 'b@e2e.test', password: 'password123' });
  eq((await B.get(`/api/links/${L1.id}/stats`)).status, 404, 'B cannot read A stats');
  eq((await B.patch(`/api/links/${L1.id}`, { title: 'hax' })).status, 404, 'B cannot edit A link');
  eq((await B.del(`/api/links/${L1.id}`)).status, 404, 'B cannot delete A link');
  eq((await B.get('/api/links')).json.links.length, 0, 'B sees none of A links');

  /* ================================================================ redirect & deal card */
  section('Redirect, deal card, bots, scheduling');
  const V = (n) => user(100 + n);
  r = await V(1).get('/' + L1.slug, { headers: { 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.instagram.com/p/x', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari' } });
  eq(r.status, 200, 'deal card 200');
  ok(r.text.includes('data-dest="https://amazon.com/dp/NEW"'), 'card carries destination');
  ok(r.text.includes('Go to deal now'), 'card has Go button');
  ok(r.text.includes('Powered by'), 'free plan shows a2z branding');
  ok(/nonce-/.test(r.headers['content-security-policy']), 'card CSP has nonce');
  ok(r.text.includes('SAVE20') && r.text.includes('Save $'), 'card shows coupon + savings');
  r = await V(2).get('/' + L2.slug);
  ok(r.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !r.text.includes('<script>alert(1)'), 'title is HTML-escaped on card (XSS)');
  ok(r.text.includes('og:image') && r.text.includes('cdn.example.com/p.jpg'), 'og:image from image_url');
  // bots
  const before = (await A.get(`/api/links/${L1.id}/stats?days=7`)).json.total;
  r = await V(3).get('/' + L1.slug, { headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
  eq(r.status, 200, 'unfurl bot gets OG page'); ok(r.text.includes('og:title'), 'bot page has og:title');
  ok(!r.text.includes('refresh'), 'bot page has no meta refresh');
  await V(4).get('/' + L1.slug, { headers: { 'User-Agent': 'curl/8.0' } });
  await sleep(150);
  eq((await A.get(`/api/links/${L1.id}/stats?days=7`)).json.total, before, 'bots do not count as clicks');
  // humans
  await V(5).get('/' + L1.slug, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' } });
  await V(5).get('/' + L1.slug, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' } });
  await sleep(200);
  let st = (await A.get(`/api/links/${L1.id}/stats?days=7`)).json;
  eq(st.total, before + 2, 'human clicks counted');
  ok(st.unique >= 2, 'unique visitors tracked');
  ok(st.series.length === 7, '7-day series');
  ok(st.referrers.some((x) => x.k === 'instagram.com'), 'referrer host recorded');
  ok(st.devices.some((x) => x.k === 'Mobile') && st.devices.some((x) => x.k === 'Desktop'), 'devices recorded');
  ok(st.locales.some((x) => x.k === 'en-US'), 'locale recorded');
  eq((await A.get('/api/links')).json.links.find((l) => l.id === L1.id).clicks, before + 3 - 1, 'link click counter increments');
  // free analytics clamp
  eq((await A.get(`/api/links/${L1.id}/stats?days=90`)).json.days, 7, 'free analytics clamped to 7 days');
  eq((await A.get(`/api/links/${L1.id}/export.csv`)).status, 402, 'CSV export is Pro-only');
  // preview off => 302
  r = await A.patch(`/api/links/${L3.id}`, { preview: false });
  r = await V(6).get('/' + L3.slug);
  eq(r.status, 302, 'preview off redirects instantly'); eq(r.headers.location, 'https://target.com/third', '302 goes to destination');
  ok(/no-store/.test(r.headers['cache-control']), 'redirect not cached (clicks keep counting)');
  // expiry & schedule
  r = await A.patch(`/api/links/${L3.id}`, { preview: true, expires_at: Date.now() - 1000 });
  ok((await V(7).get('/' + L3.slug)).text.includes('This deal has ended'), 'expired link shows ended page');
  await A.patch(`/api/links/${L3.id}`, { expires_at: null });

  /* ================================================================ stripe webhook & Pro */
  section('Stripe webhooks, Pro upgrade/downgrade');
  const meId = (await A.get('/api/me')).json && 1; // user A is id 1
  const ev1 = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: '1', customer: 'cus_A', subscription: 'sub_A' } } };
  eq((await webhook(ev1, 't=1,v1=deadbeef')).status, 400, 'webhook: bad signature rejected');
  eq((await webhook(ev1, sign(JSON.stringify(ev1), Math.floor(Date.now() / 1000) - 3600))).status, 400, 'webhook: stale timestamp rejected');
  eq((await webhook(ev1, sign(JSON.stringify(ev1), undefined, 'wrong'))).status, 400, 'webhook: wrong secret rejected');
  eq((await webhook(ev1)).status, 200, 'webhook: valid checkout.completed accepted');
  r = await A.get('/api/me');
  eq(r.json.plan, 'pro', 'user upgraded to Pro'); eq(r.json.link_limit, null, 'Pro has no link limit'); eq(r.json.analytics_days, 365, 'Pro analytics 365d');
  eq((await A.post('/api/billing/checkout', {})).status, 400, 'already-Pro cannot start checkout');
  // Pro features
  r = await A.post('/api/links', { url: 'ebay.com/pro1', slug: 'black-friday', title: 'BF', pixel_meta: '1234567890', pixel_tiktok: 'C1ABCDEF2GHIJ3', starts_at: Date.now() - 1000, expires_at: Date.now() + day });
  eq(r.status, 200, 'Pro: slug+pixels+schedule accepted');
  const P1 = r.json.link;
  eq(P1.slug, 'black-friday', 'custom slug used');
  eq((await A.post('/api/links', { url: 'ebay.com/dup', slug: 'BLACK-friday' })).status, 400, 'slug uniqueness is case-insensitive');
  for (const s of ['ab', 'has space', 'api', 'admin', 'Login']) eq((await A.post('/api/links', { url: 'ebay.com/s', slug: s })).status, 400, `slug "${s}" rejected`);
  eq((await A.post('/api/links', { url: 'ebay.com/p', pixel_meta: 'abc' })).status, 400, 'invalid meta pixel rejected');
  eq((await A.post('/api/links', { url: 'ebay.com/p', starts_at: Date.now() + day, expires_at: Date.now() + hour })).status, 400, 'expiry before start rejected');
  r = await V(8).get('/black-friday');
  ok(r.text.includes('fbevents.js') && r.text.includes('analytics.tiktok.com'), 'Pro: pixels injected');
  ok(!r.text.includes('Powered by'), 'Pro: no a2z branding');
  ok(/script-src[^;]*facebook\.net/.test(r.headers['content-security-policy']), 'card CSP allows pixel hosts');
  eq((await A.get(`/api/links/${P1.id}/stats?days=90`)).json.days, 90, 'Pro analytics up to 90d+');
  r = await A.get(`/api/links/${P1.id}/export.csv`);
  eq(r.status, 200, 'Pro CSV export'); ok(r.headers['content-type'].includes('text/csv') && r.text.startsWith('time,device'), 'CSV has header');
  await A.post('/api/links', { url: 'ebay.com/pro2' }); await A.post('/api/links', { url: 'ebay.com/pro3' });
  eq((await A.get('/api/me')).json.link_count > 3, true, 'Pro can exceed 3 links');
  // schedule in future
  r = await A.post('/api/links', { url: 'ebay.com/future', title: 'Soon', starts_at: Date.now() + day });
  ok((await V(9).get('/' + r.json.link.slug)).text.includes('has not started'), 'scheduled link shows "not started"');
  // invoice + revenue idempotency
  const inv = { id: 'evt_inv1', type: 'invoice.paid', data: { object: { customer: 'cus_A', amount_paid: 900, currency: 'usd' } } };
  await webhook(inv); await webhook(inv);
  // downgrade
  const del = { id: 'evt_2', type: 'customer.subscription.deleted', data: { object: { id: 'sub_A', customer: 'cus_A' } } };
  eq((await webhook(del)).status, 200, 'subscription.deleted accepted');
  r = await A.get('/api/me'); eq(r.json.plan, 'free', 'downgraded to free');
  r = await V(10).get('/black-friday');
  ok(r.status === 200 && !r.text.includes('fbevents.js'), 'after downgrade pixels stop firing');
  ok(r.text.includes('Powered by'), 'after downgrade branding returns');
  eq((await A.post('/api/links', { url: 'ebay.com/after' })).status, 402, 'after downgrade: cannot create (over limit)');
  eq((await A.get('/api/links')).json.links.some((l) => l.slug === 'black-friday'), true, 'existing Pro links keep working');
  const upd = { id: 'evt_3', type: 'customer.subscription.updated', data: { object: { id: 'sub_A', customer: 'cus_A', status: 'active', current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30, metadata: { user_id: '1' } } } };
  await webhook(upd); eq((await A.get('/api/me')).json.plan, 'pro', 'subscription.updated(active) restores Pro');
  await webhook({ id: 'evt_4', type: 'customer.subscription.updated', data: { object: { id: 'sub_A', customer: 'cus_A', status: 'unpaid', metadata: { user_id: '1' } } } });
  eq((await A.get('/api/me')).json.plan, 'free', 'unpaid subscription -> free');
  eq((await webhook({ id: 'evt_5', type: 'some.unknown.event', data: { object: {} } })).status, 200, 'unknown event ignored safely');

  /* ================================================================ guests & abuse */
  section('Guest shortening, reports, abuse limits');
  const G = user(30);
  r = await G.post('/api/quick', { url: 'etsy.com/listing/1' });
  eq(r.status, 200, 'guest quick shorten'); ok(r.json.guest === true, 'flagged as guest');
  ok(r.json.link.expires_at - Date.now() > 29 * day && r.json.link.expires_at - Date.now() < 31 * day, 'guest link expires in ~30 days');
  let q; for (let i = 0; i < 10; i++) q = await G.post('/api/quick', { url: `etsy.com/listing/${i + 2}` });
  eq(q.status, 429, 'guest limited to 10/hour per IP');
  r = await user(31).post('/api/report', { slug: L1.slug, reason: 'Phishing or scam', detail: 'test' });
  eq(r.status, 200, 'report accepted'); eq((await user(31).post('/api/report', { slug: 'doesnotexist' })).status, 404, 'report of unknown slug 404');
  ok((await anon.get('/report/' + L1.slug)).text.includes('Report a link'), 'report page renders');

  /* ================================================================ admin */
  section('Admin dashboard');
  const ADM = new Actor('10.9.0.1', adminHost);
  eq((await ADM.get('/api/admin/overview')).status, 401, 'admin API needs login');
  eq((await ADM.post('/api/admin/login', { email: 'root@a2z.test', password: 'nope' })).status, 401, 'admin wrong password');
  eq((await ADM.post('/api/admin/login', { email: 'a@e2e.test', password: 'password123' })).status, 401, 'normal user cannot be admin');
  eq((await ADM.post('/api/admin/login', { email: 'root@a2z.test', password: 'e2e-admin-password-1' })).status, 200, 'admin login ok');
  ok(/SameSite=Strict/i.test(ADM.cookie ? 'SameSite=Strict' : ''), 'admin session present');
  // a user session cookie must not unlock admin API
  const cross = new Actor('10.9.0.2', adminHost); cross.jar.a2z_s = A.jar.a2z_s;
  eq((await cross.get('/api/admin/overview')).status, 401, 'user cookie does not open admin API');
  r = await ADM.get('/api/admin/overview');
  eq(r.status, 200, 'overview'); ok(r.json.stats.users >= 2 && r.json.stats.links >= 5, 'overview counts');
  eq(r.json.stats.revenue_30d, 900, 'revenue counted once (idempotent invoice)');
  eq(r.json.signups.length, 30, '30-day signup series'); eq(r.json.stripe, true, 'stripe flag on');
  ok(r.json.stats.open_reports >= 1, 'open report visible');
  // users
  r = await ADM.get('/api/admin/users?q=b@e2e'); eq(r.json.users.length, 1, 'user search');
  const bId = r.json.users[0].id;
  eq((await ADM.r('PATCH', `/api/admin/users/${bId}`, { json: { plan: 'pro' } })).status, 200, 'grant Pro');
  eq((await B.get('/api/me')).json.plan, 'pro', 'B is now Pro (comped)'); ok((await B.get('/api/me')).json.comped, 'B marked comped');
  eq((await B.post('/api/links', { url: 'ebay.com/b1', slug: 'bslug' })).status, 200, 'comped Pro can use Pro features');
  await ADM.r('PATCH', `/api/admin/users/${bId}`, { json: { plan: 'free' } });
  eq((await B.get('/api/me')).json.plan, 'free', 'remove Pro');
  // suspend
  await ADM.r('PATCH', `/api/admin/users/${bId}`, { json: { status: 'suspended' } });
  eq((await B.get('/api/me')).status, 401, 'suspended user session killed');
  eq((await user(40).post('/api/login', { email: 'b@e2e.test', password: 'password123' })).status, 403, 'suspended user cannot log in');
  eq((await V(11).get('/bslug')).status, 410, 'suspended owner links return 410');
  await ADM.r('PATCH', `/api/admin/users/${bId}`, { json: { status: 'active' } });
  eq((await V(12).get('/bslug')).status, 200, 'reactivated owner links work again');
  // links moderation
  r = await ADM.get('/api/admin/links?q=bslug'); const bl = r.json.links[0];
  eq(r.json.links.length, 1, 'link search by slug');
  await ADM.r('PATCH', `/api/admin/links/${bl.id}`, { json: { status: 'disabled' } });
  eq((await V(13).get('/bslug')).status, 410, 'disabled link returns 410');
  eq((await ADM.get('/api/admin/links?status=disabled')).json.links.length, 1, 'filter disabled');
  await ADM.r('PATCH', `/api/admin/links/${bl.id}`, { json: { status: 'active' } });
  eq((await V(14).get('/bslug')).status, 200, 're-enabled');
  // reports
  r = await ADM.get('/api/admin/reports'); const rep = r.json.reports.find((x) => x.status === 'open');
  ok(!!rep, 'report listed');
  await ADM.r('PATCH', `/api/admin/reports/${rep.id}`, { json: { disable: true } });
  eq((await V(15).get('/' + L1.slug)).status, 410, 'resolve+disable takes link down');
  // blocklist
  r = await ADM.post('/api/admin/blocklist', { domain: 'https://www.Etsy.com/foo' });
  eq(r.status, 200, 'block domain (normalised)'); ok(r.json.disabled >= 1, 'existing links to domain disabled');
  const D = user(60);
  await D.post('/api/signup', { email: 'd@e2e.test', password: 'password123' });
  eq((await D.post('/api/links', { url: 'shop.etsy.com/x' })).status, 400, 'subdomain of blocked domain rejected');
  eq((await D.post('/api/links', { url: 'etsy.com/x' })).status, 400, 'blocked domain rejected on create');
  eq((await user(61).post('/api/quick', { url: 'www.etsy.com/x' })).status, 400, 'blocked domain rejected for guests');
  eq((await ADM.get('/api/admin/blocklist')).json.domains.length, 1, 'blocklist listed');
  eq((await ADM.del('/api/admin/blocklist/etsy.com')).status, 200, 'unblock');
  ok((await B.post('/api/login', { email: 'b@e2e.test', password: 'password123' })).status === 200, 'B can log in again');
  // delete user cascades
  const delRes = await ADM.get('/api/admin/users?q=b@e2e'); await ADM.del(`/api/admin/users/${delRes.json.users[0].id}`);
  eq((await V(16).get('/bslug')).status, 404, 'deleting user removes their links');
  eq((await ADM.get('/api/admin/users?q=b@e2e')).json.users.length, 0, 'user gone');
  await ADM.post('/api/admin/logout'); eq((await ADM.get('/api/admin/overview')).status, 401, 'admin logout');

  /* ================================================================ billing endpoints & account */
  section('Billing API & account deletion');
  const C = user(50);
  await C.post('/api/signup', { email: 'c@e2e.test', password: 'password123' });
  r = await C.post('/api/billing/checkout', { interval: 'year' });
  ok(r.status === 502, 'checkout with dummy Stripe key fails gracefully (502)', `(got ${r.status})`);
  eq((await C.post('/api/billing/portal', {})).status, 400, 'portal needs a billing account');
  await C.post('/api/links', { url: 'ebay.com/c1' });
  eq((await C.post('/api/account/delete', {})).status, 200, 'account deletion');
  eq((await C.get('/api/me')).status, 401, 'deleted account session invalid');
  eq((await user(51).post('/api/login', { email: 'c@e2e.test', password: 'password123' })).status, 401, 'deleted account cannot log in');
} catch (e) {
  failN++; failures.push('CRASH: ' + e.message); console.log('\nCRASH', e);
} finally {
  srv.kill();
  await sleep(300);
  fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(`\n==== ${pass} passed, ${failN} failed`);
if (failN) { console.log('Failed:\n - ' + failures.join('\n - ')); console.log('\nServer log:\n' + srvLog.split('\n').filter((l) => !/Warning|trace-warnings/.test(l)).slice(-15).join('\n')); }
process.exit(failN ? 1 : 0);
