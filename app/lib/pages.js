import { config } from './config.js';
import { esc, storeName } from './util.js';

const fmtPrice = (n, cur = 'USD') => {
  if (n == null || n === '') return '';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD' }).format(n); } catch { return `$${Number(n).toFixed(2)}`; }
};

export function layout({ title, desc = '', body, scripts = [], head = '', cls = '', nonce = '' }) {
  const t = esc(title);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0b0b14">
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/app.css">
${head}
</head>
<body class="${cls}">
${body}
${['/static/common.js', ...scripts].map((s) => `<script src="${s}" defer${nonce ? ` nonce="${nonce}"` : ''}></script>`).join('\n')}
</body>
</html>`;
}

const logo = `<a class="logo" href="/"><span class="logo-mark">a2z</span><span class="logo-text">a2z<i>.deals</i></span></a>`;

export function nav(active = '') {
  return `<header class="nav"><div class="wrap nav-in">
  ${logo}
  <nav class="nav-links">
    <a href="/#features">Features</a><a href="/#pricing">Pricing</a><a href="/#faq">FAQ</a>
  </nav>
  <div class="nav-cta"><a class="btn ghost" href="/login">Log in</a><a class="btn primary" href="/signup">Start free</a></div>
</div></header>`;
}

export function footer() {
  return `<footer class="foot"><div class="wrap foot-in">
  ${logo}
  <p class="muted">Smart links for people who share deals.</p>
  <div class="foot-links"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="mailto:${esc(config.supportEmail)}">Contact</a></div>
</div></footer>`;
}

export function landing() {
  const free = config.freeLinkLimit;
  const monthly = (config.proMonthlyCents / 100).toFixed(0);
  const yearly = (config.proYearlyCents / 100).toFixed(0);
  const body = `${nav()}
<main>
<section class="hero"><div class="orb o1"></div><div class="orb o2"></div>
  <div class="wrap hero-in">
    <div class="hero-copy">
      <span class="pill">⚡ Built for deal creators &amp; affiliate marketers</span>
      <h1>Turn any link into a <span class="grad">deal people click</span>.</h1>
      <p class="lead">Paste a long affiliate link. Get a short <b>a2z.deals</b> link with a beautiful price card, expiry timer and click analytics. No design skills. No setup.</p>
      <form id="quick-form" class="quick" autocomplete="off">
        <input id="quick-url" type="text" inputmode="url" placeholder="Paste your link, e.g. amazon.com/dp/B0..." aria-label="Link to shorten" required>
        <button class="btn primary lg" type="submit">Shorten</button>
      </form>
      <div id="quick-result" class="quick-result" hidden></div>
      <p class="tiny muted">Free forever for ${free} links · No credit card · Takes 5 seconds</p>
    </div>
    <div class="hero-demo" aria-hidden="true">
      <div class="demo-card">
        <div class="demo-media">
          <img src="https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&q=80" alt="Wireless Noise-Canceling Headphones" referrerpolicy="no-referrer" loading="eager">
          <div class="go-chips"><span class="chip store">Amazon</span><span class="chip hot">-57% OFF</span></div>
          <div class="go-timer">Ends in 2d 5h 12m</div>
        </div>
        <div class="demo-pad">
          <div class="demo-top"><span class="chip">a2z.deals/Xk9pQ2</span><span class="chip live"><i></i> Live</span></div>
          <div class="demo-title">Wireless Noise-Canceling Headphones</div>
          <div class="demo-price"><b>$129.99</b><s>$299.99</s><em>Save $170</em></div>
          <div class="demo-bar"><span></span></div>
          <div class="demo-foot"><span>Taking you to the deal…</span><b>2s</b></div>
        </div>
      </div>
      <div class="demo-stats">
        <div><b>1,284</b><span>clicks today</span></div>
        <div><b>38%</b><span>from Instagram</span></div>
        <div><b>92%</b><span>on mobile</span></div>
      </div>
    </div>
  </div>
</section>

<section class="wrap steps" id="how">
  <div class="step"><span class="num">1</span><h3>Paste</h3><p>Drop in any product or affiliate link.</p></div>
  <div class="step"><span class="num">2</span><h3>Add the deal</h3><p>Title, price, discount and an expiry date. Or skip it.</p></div>
  <div class="step"><span class="num">3</span><h3>Share</h3><p>Post your short link in a bio, story or channel and watch the clicks.</p></div>
</section>

<section class="wrap" id="features">
  <h2 class="center">Everything a deal link needs</h2>
  <p class="center muted sub">Simple on the surface. Powerful when you need it.</p>
  <div class="grid3">
    <article class="feat"><div class="ico">🏷️</div><h3>Deal preview card</h3><p>Visitors see the store, price, strike-through original and savings for 2 seconds before they go. It builds trust and lifts clicks.</p></article>
    <article class="feat"><div class="ico">⏳</div><h3>Expiry &amp; scheduling</h3><p>Set when a deal starts and ends. Expired links show a friendly "deal ended" page instead of a dead end.</p></article>
    <article class="feat"><div class="ico">📊</div><h3>Real analytics</h3><p>Clicks, unique visitors, devices, browsers and where traffic comes from, day by day.</p></article>
    <article class="feat"><div class="ico">🎯</div><h3>Retargeting pixels</h3><p>Add your Meta and TikTok pixel IDs and build audiences from everyone who clicked your deals. <span class="tag">Pro</span></p></article>
    <article class="feat"><div class="ico">✨</div><h3>Custom short links</h3><p>Choose your own slug like a2z.deals/black-friday. Memorable links get more clicks. <span class="tag">Pro</span></p></article>
    <article class="feat"><div class="ico">🛡️</div><h3>Safe by design</h3><p>Every link is screened, abuse is rate-limited and reports are reviewed, so your audience can trust the domain.</p></article>
  </div>
</section>

<section class="wrap" id="pricing">
  <h2 class="center">Simple pricing</h2>
  <p class="center muted sub">Start free. Upgrade when your audience grows.</p>
  <div class="plans">
    <div class="plan">
      <h3>Free</h3><div class="price">$0<small>/forever</small></div>
      <ul><li>${free} active links</li><li>Deal preview cards</li><li>7-day analytics</li><li>Link expiry</li><li class="off">Custom slugs</li><li class="off">Retargeting pixels</li><li class="off">Remove a2z branding</li></ul>
      <a class="btn ghost block" href="/signup">Get started</a>
    </div>
    <div class="plan best">
      <span class="ribbon">Most popular</span>
      <h3>Pro</h3><div class="price">$${monthly}<small>/month</small></div>
      <p class="tiny muted">or $${yearly}/year (save ${Math.round((1 - config.proYearlyCents / (config.proMonthlyCents * 12)) * 100)}%)</p>
      <ul><li><b>Unlimited</b> links</li><li>Custom slugs</li><li>Meta &amp; TikTok pixels</li><li>1-year analytics with CSV export</li><li>Scheduled start &amp; expiry</li><li>No a2z branding on cards</li><li>Priority support</li></ul>
      <a class="btn primary block" href="/signup?plan=pro">Go Pro</a>
    </div>
  </div>
</section>

<section class="wrap faq" id="faq">
  <h2 class="center">Questions</h2>
  <details><summary>Does the preview card slow people down?</summary><p>It shows for about 2 seconds and visitors can skip it with one tap. You can also turn it off per link for an instant redirect.</p></details>
  <details><summary>Will it work with affiliate programs?</summary><p>Yes. The card always shows the real destination store, and we never hide or modify your affiliate tag. Check your program's terms on link redirection.</p></details>
  <details><summary>What is not allowed?</summary><p>Phishing, malware, scams, adult content and anything illegal. Links are screened and violators are removed.</p></details>
  <details><summary>Can I cancel Pro any time?</summary><p>Yes, from your dashboard in one click. You keep Pro until the end of the paid period.</p></details>
</section>

<section class="wrap cta"><h2>Your next deal deserves a better link.</h2><a class="btn primary lg" href="/signup">Create your free account</a></section>
</main>
${footer()}`;
  return layout({
    title: 'a2z.deals: smart links for deal creators',
    desc: 'Shorten affiliate links with a branded deal preview card, expiry timers and analytics. Free to start.',
    body, scripts: ['/static/landing.js'],
  });
}

export function authPage(mode) {
  const login = mode === 'login';
  const google = !!config.googleClientId;
  const body = `<main class="auth"><div class="orb o1"></div><div class="orb o2"></div>
  <div class="auth-card">
    ${logo}
    <h1>${login ? 'Welcome back' : 'Create your account'}</h1>
    <p class="muted">${login ? 'Log in to manage your deal links.' : `Free forever. ${config.freeLinkLimit} links, no card needed.`}</p>
    ${google ? `<div class="oauth-row"><a class="btn google" href="/auth/google"><span class="g-icon">G</span> Continue with Google</a></div>` : ''}
    <form id="auth-form" data-mode="${mode}" novalidate>
      <label>Email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>
      <label>Password<input name="password" type="password" autocomplete="${login ? 'current-password' : 'new-password'}" required minlength="8" placeholder="${login ? 'Your password' : 'At least 8 characters'}"></label>
      <div id="auth-error" class="error" hidden></div>
      <button class="btn primary lg block" type="submit">${login ? 'Log in' : 'Create account'}</button>
    </form>
    <p class="muted center tiny">${login ? `New here? <a href="/signup">Create an account</a>` : `Already have an account? <a href="/login">Log in</a><br>By signing up you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.`}</p>
  </div></main>`;
  return layout({ title: `${login ? 'Log in' : 'Sign up'} · a2z.deals`, body, scripts: ['/static/auth.js'], cls: 'authpage' });
}

export const dashboardShell = () => layout({
  title: 'Dashboard · a2z.deals',
  body: `<div id="app" class="app"><div class="boot">Loading…</div></div><div id="toast" class="toast" hidden></div>`,
  scripts: ['/static/dashboard.js'], cls: 'appbody',
});

export const adminShell = () => layout({
  title: 'Admin · a2z.deals',
  body: `<div id="app" class="app"><div class="boot">Loading…</div></div><div id="toast" class="toast" hidden></div>`,
  scripts: ['/static/admin.js'], cls: 'appbody admin', head: '<meta name="robots" content="noindex,nofollow">',
});

function pixelSnippets(link, nonce) {
  let out = '';
  if (link.pixel_meta && /^\d{5,20}$/.test(link.pixel_meta)) {
    out += `<script nonce="${nonce}">!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${link.pixel_meta}');fbq('track','PageView');</script>`;
  }
  if (link.pixel_tiktok && /^[A-Za-z0-9]{8,32}$/.test(link.pixel_tiktok)) {
    out += `<script nonce="${nonce}">!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var n="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._t=ttq._t||{},ttq._t[e]=+new Date;var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=n+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${link.pixel_tiktok}');ttq.page()}(window,document,'ttq');</script>`;
  }
  return out;
}

// The 2-second deal card shown before redirecting.
export function interstitial(link, { nonce, branded, bot }) {
  const store = storeName(link.host);
  const title = link.title || `Deal at ${store}`;
  const hasPrice = link.price != null;
  const pct = link.original_price && link.price != null && link.original_price > link.price
    ? Math.round((1 - link.price / link.original_price) * 100) : 0;
  const left = link.expires_at ? link.expires_at : 0;
  const url = `${config.baseUrl}/${link.slug}`;
  const head = `
<meta name="robots" content="noindex">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(hasPrice ? `${fmtPrice(link.price, link.currency)}${pct ? ` (-${pct}%)` : ''} at ${store}` : `Open this deal at ${store}`)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:site_name" content="a2z.deals">
${link.image_url ? `<meta property="og:image" content="${esc(link.image_url)}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
${bot ? '' : `<noscript><meta http-equiv="refresh" content="3;url=${esc(link.url)}"></noscript>`}
${bot ? '' : pixelSnippets(link, nonce)}`;
  const saved = link.original_price && link.price != null && link.original_price > link.price ? link.original_price - link.price : 0;
  const body = `<main class="go" data-dest="${esc(link.url)}" data-ms="2200" data-expires="${left}" data-host="${esc(link.host)}">
  <div class="orb o1"></div><div class="orb o2"></div>
  <div class="go-card">
    <div class="go-media${link.image_url ? '' : ' noimg'}">
      ${link.image_url ? `<img src="${esc(link.image_url)}" alt="" referrerpolicy="no-referrer" loading="eager">` : `<span class="go-initial">${esc(store.charAt(0))}</span>`}
      <div class="go-chips"><span class="chip store">${esc(store)}</span>${pct ? `<span class="chip hot">-${pct}% OFF</span>` : ''}</div>
      ${left ? `<div class="go-timer" id="countdown">Ends soon</div>` : ''}
    </div>
    <div class="go-body">
      <h1>${esc(title)}</h1>
      ${hasPrice ? `<div class="demo-price big"><b>${esc(fmtPrice(link.price, link.currency))}</b>${link.original_price ? `<s>${esc(fmtPrice(link.original_price, link.currency))}</s>` : ''}${saved ? `<em>Save ${esc(fmtPrice(saved, link.currency))}</em>` : ''}</div>` : ''}
      ${link.coupon ? `<div class="coupon"><div><small>Coupon code</small><b id="coupon-code">${esc(link.coupon)}</b></div><button type="button" class="copy" data-copy="${esc(link.coupon)}">Copy</button></div>` : ''}
      <div class="go-progress"><span>Taking you to <b>${esc(link.host)}</b> <span id="go-count"></span></span><span id="go-state" class="go-state">…</span></div>
      <div class="demo-bar"><span id="go-bar"></span></div>
      <a class="btn primary block lg" id="go-now" href="${esc(link.url)}" rel="nofollow sponsored noopener">Go to deal now →</a>
      <div class="go-meta"><a href="/report/${esc(link.slug)}" rel="nofollow">Report link</a>${branded ? `<span>Powered by <a href="/">a2z.deals</a></span>` : ''}</div>
    </div>
  </div></main>`;
  return layout({ title: `${title} · a2z.deals`, head, body, scripts: ['/static/go.js'], cls: 'gopage', nonce });
}

export function endedPage(link, reason = 'ended') {
  const msg = reason === 'soon' ? 'This deal has not started yet.' : 'This deal has ended.';
  const body = `<main class="auth"><div class="orb o1"></div><div class="auth-card center">${logo}
  <div class="big-emoji">${reason === 'soon' ? '⏳' : '🕒'}</div>
  <h1>${msg}</h1><p class="muted">${esc(link.title || 'The deal')} ${reason === 'soon' ? 'starts soon. Check back shortly.' : 'is no longer available. Great deals come and go.'}</p>
  <a class="btn primary" href="/">Make your own deal links</a></div></main>`;
  return layout({ title: 'Deal unavailable · a2z.deals', body, cls: 'authpage', head: '<meta name="robots" content="noindex">' });
}

export function messagePage(title, text, code = 200) {
  const body = `<main class="auth"><div class="orb o1"></div><div class="auth-card center">${logo}
  <h1>${esc(title)}</h1><p class="muted">${esc(text)}</p><a class="btn primary" href="/">Go to a2z.deals</a></div></main>`;
  return layout({ title: `${title} · a2z.deals`, body, cls: 'authpage', head: '<meta name="robots" content="noindex">' });
}

export function reportPage(slug) {
  const body = `<main class="auth"><div class="orb o1"></div><div class="auth-card">${logo}
  <h1>Report a link</h1><p class="muted">Tell us what is wrong with <b>a2z.deals/${esc(slug)}</b>. We review every report.</p>
  <form id="report-form" data-slug="${esc(slug)}">
    <label>Reason<select name="reason"><option>Phishing or scam</option><option>Malware</option><option>Misleading price or deal</option><option>Adult or illegal content</option><option>Other</option></select></label>
    <label>Details (optional)<textarea name="detail" rows="3" maxlength="500"></textarea></label>
    <div id="report-msg" class="error" hidden></div>
    <button class="btn primary lg block" type="submit">Send report</button>
  </form></div></main>`;
  return layout({ title: 'Report a link · a2z.deals', body, scripts: ['/static/report.js'], cls: 'authpage', head: '<meta name="robots" content="noindex">' });
}

const legalWrap = (title, inner) => layout({
  title: `${title} · a2z.deals`,
  body: `${nav()}<main class="wrap legal"><h1>${title}</h1>${inner}</main>${footer()}`,
});

export const termsPage = () => legalWrap('Terms of Service', `
<p class="muted">Last updated: ${new Date().toISOString().slice(0, 10)}</p>
<p>By using a2z.deals you agree to these terms. a2z.deals provides link shortening, deal preview pages and analytics.</p>
<h3>Acceptable use</h3><p>You may not use the service for phishing, malware, fraud, spam, adult content, illegal goods or anything unlawful, or to mislead people about price or availability. We may disable links or accounts that break these rules without notice.</p>
<h3>Paid plans</h3><p>Pro is billed in advance, monthly or yearly, through Stripe. You can cancel any time from your dashboard and keep access until the end of the paid period. Refunds are handled case by case.</p>
<h3>Your content</h3><p>You are responsible for the links and text you publish and for following the rules of any affiliate program you use.</p>
<h3>Availability and liability</h3><p>The service is provided "as is". To the extent permitted by law we are not liable for indirect losses, including lost commissions or traffic.</p>
<h3>Contact</h3><p>${esc(config.supportEmail)}</p>`);

export const privacyPage = () => legalWrap('Privacy Policy', `
<p class="muted">Last updated: ${new Date().toISOString().slice(0, 10)}</p>
<p>We collect only what is needed to run the service.</p>
<h3>Account data</h3><p>Your email address and a salted hash of your password. Payments are processed by Stripe; we never see or store your card number.</p>
<h3>Click analytics</h3><p>When someone opens a short link we record the time, device type, browser, referring site and browser language. IP addresses are not stored; a one-way hash is used only to count unique visitors.</p>
<h3>Pixels</h3><p>If a link owner adds a Meta or TikTok pixel, that provider receives visits to that link under its own privacy policy.</p>
<h3>Cookies</h3><p>We use one essential session cookie for logged-in users. We do not use advertising cookies ourselves.</p>
<h3>Your rights</h3><p>Email ${esc(config.supportEmail)} to access or delete your data.</p>`);

export { fmtPrice };
