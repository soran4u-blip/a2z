const app = $('#app');
let me = null, links = [], tab = new URLSearchParams(location.search).get('tab') === 'billing' ? 'billing' : 'links', filter = '';

const toLocal = (ts) => { if (!ts) return ''; const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const fromLocal = (v) => (v ? new Date(v).getTime() : null);
const money2 = (n, c) => (n == null ? '' : new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD' }).format(n));
const store = (host) => {
  const map = { 'amzn.to': 'Amazon', 'amzn.eu': 'Amazon' };
  if (map[host]) return map[host];
  const p = String(host || '').replace(/^www\./, '').split('.');
  const b = (p.length > 2 && p[p.length - 2].length <= 3 ? p[p.length - 3] : p[p.length - 2]) || host;
  return b.charAt(0).toUpperCase() + b.slice(1);
};
const dur = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); if (m < 60) return m + 'm'; const h = Math.round(m / 60); return h < 48 ? h + 'h' : Math.round(h / 24) + 'd'; };
const price$ = (c) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

async function boot() {
  try { me = await api('/api/me'); } catch { location.href = '/login'; return; }
  await loadLinks();
  if (new URLSearchParams(location.search).get('upgraded')) { toast('🎉 Welcome to Pro! It may take a few seconds to activate.'); history.replaceState(null, '', '/dashboard'); setTimeout(async () => { me = await api('/api/me'); render(); }, 3500); }
  render();
}
async function loadLinks() { links = (await api('/api/links')).links; }

function render() {
  app.innerHTML = `
  <header class="topbar"><div class="topbar-in">
    <a class="logo" href="/"><span class="logo-mark">a2z</span><span class="logo-text">a2z<i>.deals</i></span></a>
    <nav class="tabs">
      <button class="tab ${tab === 'links' ? 'on' : ''}" data-tab="links">Links</button>
      <button class="tab ${tab === 'billing' ? 'on' : ''}" data-tab="billing">Plan &amp; billing</button>
      <button class="tab ${tab === 'account' ? 'on' : ''}" data-tab="account">Account</button>
    </nav>
    <div class="who"><span class="badge ${me.plan === 'pro' ? 'pro' : ''}">${me.plan === 'pro' ? 'PRO' : 'FREE'}</span><span class="em">${esc(me.email)}</span><button class="btn sm ghost" id="logout">Log out</button></div>
  </div></header>
  <main class="main" id="view"></main>`;
  $$('.tab').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(); }));
  $('#logout').onclick = async () => { await api('/api/logout', 'POST'); location.href = '/'; };
  ({ links: viewLinks, billing: viewBilling, account: viewAccount })[tab]();
}

/* ---------------------------------------------------------------- links */
function viewLinks() {
  const total = links.reduce((a, l) => a + l.clicks, 0);
  const week = links.reduce((a, l) => a + l.clicks_7d, 0);
  const active = links.filter((l) => l.status === 'active' && (!l.expires_at || l.expires_at > Date.now())).length;
  const pro = me.plan === 'pro';
  const atLimit = !pro && me.link_count >= me.link_limit;
  $('#view').innerHTML = `
  ${!pro ? `<div class="upgrade"><div><b>Unlock Pro</b><span>Unlimited links, custom slugs, Meta &amp; TikTok pixels, 1-year analytics and no a2z branding.</span></div><button class="btn primary" id="up">Upgrade from ${price$(me.monthly)}/mo</button></div>` : ''}
  <div class="cards">
    <div class="stat"><span>Total clicks</span><b>${fmt(total)}</b></div>
    <div class="stat"><span>Clicks (7 days)</span><b>${fmt(week)}</b></div>
    <div class="stat"><span>Active links</span><b>${fmt(active)}</b></div>
    ${pro ? '' : `<div class="stat"><span>Free plan usage</span><b>${me.link_count}/${me.link_limit}</b><div class="meter"><i style="width:${Math.min(100, me.link_count / me.link_limit * 100)}%"></i></div></div>`}
  </div>
  <div class="panel">
    <form id="new" class="create" autocomplete="off">
      <input id="new-url" placeholder="Paste a link to create a deal link…" required ${atLimit ? 'disabled' : ''}>
      <button class="btn primary" ${atLimit ? 'disabled' : ''}>Create link</button>
      <button class="btn" type="button" id="more">Add deal details</button>
    </form>
    ${atLimit ? '<p class="tiny" style="color:var(--warn);margin:.4em 0 0">You reached the free limit. Upgrade to Pro for unlimited links.</p>' : ''}
  </div>
  <div class="page-head"><h1 style="font-size:1.25rem">Your links</h1>
    <input class="search" id="flt" placeholder="Search links…" value="${esc(filter)}"></div>
  <div class="panel tbl" style="padding:6px 10px"><table><thead><tr><th>Link</th><th>Short URL</th><th>Clicks</th><th>7d</th><th>Status</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>`;
  $('#up')?.addEventListener('click', () => { tab = 'billing'; render(); });
  $('#new').onsubmit = async (e) => {
    e.preventDefault();
    const b = $('#new button.primary'); b.disabled = true;
    try { const r = await api('/api/links', 'POST', { url: $('#new-url').value }); toast('Link created'); await loadLinks(); viewLinks(); copyText(r.link.short); }
    catch (ex) { toast(ex.message, true); b.disabled = false; if (ex.status === 402) { tab = 'billing'; render(); } }
  };
  $('#more').onclick = () => editor(null, $('#new-url').value);
  $('#flt').oninput = (e) => { filter = e.target.value; rows(); };
  rows();
}

function rows() {
  const q = filter.trim().toLowerCase();
  const list = links.filter((l) => !q || [l.slug, l.title, l.url, l.host].join(' ').toLowerCase().includes(q));
  const tb = $('#rows');
  if (!list.length) {
    tb.innerHTML = `<tr><td colspan="6"><div class="empty"><span class="big-emoji">🔗</span>${links.length ? 'No links match your search.' : 'No links yet. Paste your first link above.'}</div></td></tr>`;
    return;
  }
  const now = Date.now();
  tb.innerHTML = list.map((l) => {
    const ended = l.expires_at && l.expires_at < now, soon = l.starts_at && l.starts_at > now;
    const st = l.status !== 'active' ? ['bad', 'Disabled'] : ended ? ['warn', 'Ended'] : soon ? ['warn', 'Starts in ' + dur(l.starts_at - now)] : ['ok', 'Live'];
    return `<tr data-id="${l.id}">
      <td><div class="cell-flex">${l.image_url ? `<img class="thumb" src="${esc(l.image_url)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ''}<div class="cell-link"><b>${esc(l.title || l.host)}<span class="store-chip">${esc(store(l.host))}</span></b><span title="${esc(l.url)}">${esc(l.url)}</span></div></div></td>
      <td><span class="short">${esc(l.short.replace(/^https?:\/\//, ''))}</span></td>
      <td data-l="Clicks">${fmt(l.clicks)}</td><td data-l="Last 7 days">${fmt(l.clicks_7d)}</td>
      <td><span class="badge ${st[0]}">${st[1]}</span></td>
      <td><div class="actions"><button class="btn sm" data-a="copy">Copy</button><button class="btn sm" data-a="stats">Stats</button><button class="btn sm" data-a="edit">Edit</button><button class="btn sm danger" data-a="del">✕</button></div></td></tr>`;
  }).join('');
  $$('#rows [data-a]').forEach((b) => (b.onclick = () => {
    const l = links.find((x) => x.id === Number(b.closest('tr').dataset.id));
    ({ copy: () => copyText(l.short), stats: () => stats(l), edit: () => editor(l), del: () => del(l) })[b.dataset.a]();
  }));
}

async function del(l) {
  if (!confirm(`Delete a2z.deals/${l.slug}? Anyone who has this link will see "not found".`)) return;
  try { await api('/api/links/' + l.id, 'DELETE'); toast('Link deleted'); await loadLinks(); me = await api('/api/me'); viewLinks(); } catch (ex) { toast(ex.message, true); }
}

function modal(html, narrow) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${narrow ? 'narrow' : ''}">${html}</div>`;
  const close = () => bg.remove();
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  document.body.appendChild(bg);
  const x = $('.x', bg); if (x) x.onclick = close;
  return { el: bg, close };
}

/* ---------------------------------------------------------------- editor */
function editor(l, prefillUrl) {
  const pro = me.plan === 'pro';
  const lock = (t) => (pro ? '' : `<small> 🔒 Pro</small>`);
  const m = modal(`
  <div class="modal-head"><h2>${l ? 'Edit link' : 'New deal link'}</h2><button class="x" type="button">×</button></div>
  <form id="ef" autocomplete="off"><div class="adv" style="border:0;margin:0;padding:0">
    <label class="full">Destination link<input name="url" required value="${esc(l?.url || prefillUrl || '')}" placeholder="https://www.amazon.com/dp/..."></label>
    <label class="full">Deal title<input name="title" maxlength="120" value="${esc(l?.title || '')}" placeholder="e.g. Wireless Headphones, 57% off"></label>
    <label class="full">Product image link (optional)<input name="image_url" maxlength="500" value="${esc(l?.image_url || '')}" placeholder="https://… .jpg or .png"><span class="field-hint">Shown on the deal card and in social previews. Must be a public https link.</span></label>
    <label>Deal price<input name="price" type="number" step="0.01" min="0" value="${l?.price ?? ''}" placeholder="129.99"></label>
    <label>Original price<input name="original_price" type="number" step="0.01" min="0" value="${l?.original_price ?? ''}" placeholder="299.99"></label>
    <label>Currency<select name="currency">${['USD', 'EUR', 'GBP', 'AED', 'IQD', 'TRY', 'CAD', 'AUD', 'SAR', 'INR'].map((c) => `<option ${((l?.currency) || 'USD') === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <label>Coupon code (optional)<input name="coupon" maxlength="40" value="${esc(l?.coupon || '')}" placeholder="SAVE20"></label>
    <label>Deal ends<input name="expires_at" type="datetime-local" value="${toLocal(l?.expires_at)}"></label>
    <label class="${pro ? '' : 'lock'}">Deal starts${lock()}<input name="starts_at" type="datetime-local" value="${toLocal(l?.starts_at)}" ${pro ? '' : 'disabled'}></label>
    <label class="${pro ? '' : 'lock'}">Custom slug${lock()}<input name="slug" maxlength="40" value="${esc(l?.slug || '')}" placeholder="black-friday" ${pro ? '' : 'disabled'}></label>
    <label class="chk full"><input type="checkbox" name="preview" ${l && !l.preview ? '' : 'checked'}> Show the 2-second deal card before redirecting <span class="muted tiny">(off = instant redirect)</span></label>
    <label class="${pro ? '' : 'lock'}">Meta (Facebook) Pixel ID${lock()}<input name="pixel_meta" value="${esc(l?.pixel_meta || '')}" placeholder="1234567890123" ${pro ? '' : 'disabled'}></label>
    <label class="${pro ? '' : 'lock'}">TikTok Pixel ID${lock()}<input name="pixel_tiktok" value="${esc(l?.pixel_tiktok || '')}" placeholder="C1ABCDEF2GHIJ3" ${pro ? '' : 'disabled'}></label>
  </div>
  <div id="ee" class="error" hidden></div>
  <div class="actions" style="margin-top:8px"><button class="btn" type="button" id="cancel">Cancel</button><button class="btn primary" type="submit">${l ? 'Save changes' : 'Create link'}</button></div>
  </form>`);
  $('#cancel', m.el).onclick = m.close;
  $('#ef', m.el).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      url: fd.get('url'), title: fd.get('title'), price: fd.get('price'), original_price: fd.get('original_price'),
      currency: fd.get('currency'), coupon: fd.get('coupon'), image_url: fd.get('image_url'), expires_at: fromLocal(fd.get('expires_at')), preview: fd.get('preview') === 'on',
    };
    if (pro) Object.assign(body, { starts_at: fromLocal(fd.get('starts_at')), slug: fd.get('slug'), pixel_meta: fd.get('pixel_meta'), pixel_tiktok: fd.get('pixel_tiktok') });
    const btn = $('button[type=submit]', m.el); btn.disabled = true;
    try {
      const r = l ? await api('/api/links/' + l.id, 'PATCH', body) : await api('/api/links', 'POST', body);
      m.close(); toast(l ? 'Saved' : 'Link created'); await loadLinks(); me = await api('/api/me'); viewLinks();
      if (!l) copyText(r.link.short);
    } catch (ex) { const b = $('#ee', m.el); b.textContent = ex.message; b.hidden = false; btn.disabled = false; }
  };
}

/* ---------------------------------------------------------------- stats */
async function stats(l, days = 7) {
  const m = modal(`<div class="boot">Loading…</div>`);
  async function load(d) {
    try {
      const s = await api(`/api/links/${l.id}/stats?days=${d}`);
      const opts = [7, 30, 90, 365].filter((x) => x <= s.max_days);
      m.el.querySelector('.modal').innerHTML = `
      <div class="modal-head"><div><h2>${esc(l.title || l.host)}</h2><span class="short">${esc(l.short.replace(/^https?:\/\//, ''))}</span></div><button class="x" type="button">×</button></div>
      <div class="tools"><div class="seg">${opts.map((x) => `<button data-d="${x}" class="${x === s.days ? 'on' : ''}">${x === 365 ? '1y' : x + 'd'}</button>`).join('')}</div>
        ${me.plan === 'pro' ? `<a class="btn sm" href="/api/links/${l.id}/export.csv">Export CSV</a>` : '<span class="tiny muted" style="align-self:center">🔒 Pro: 90-day and 1-year analytics + CSV export</span>'}</div>
      <div class="cards" style="margin-bottom:14px"><div class="stat"><span>Clicks</span><b>${fmt(s.total)}</b></div><div class="stat"><span>Unique visitors</span><b>${fmt(s.unique)}</b></div></div>
      <div class="panel">${barChart(s.series)}</div>
      <div class="two"><div class="panel"><h3>Traffic sources</h3>${barList(s.referrers)}</div><div class="panel"><h3>Devices</h3>${barList(s.devices)}</div>
      <div class="panel"><h3>Browsers / apps</h3>${barList(s.browsers)}</div><div class="panel"><h3>Visitor language</h3>${barList(s.locales)}</div></div>`;
      $('.x', m.el).onclick = m.close;
      $$('.seg button', m.el).forEach((b) => (b.onclick = () => load(Number(b.dataset.d))));
    } catch (ex) { m.close(); toast(ex.message, true); }
  }
  load(days);
}

/* ---------------------------------------------------------------- billing */
function viewBilling() {
  const pro = me.plan === 'pro';
  const periodEnd = me.period_end ? new Date(me.period_end).toLocaleDateString() : null;
  const save = Math.round((1 - me.yearly / (me.monthly * 12)) * 100);
  $('#view').innerHTML = `
  <div class="page-head"><h1>Plan &amp; billing</h1></div>
  <div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <div><span class="muted tiny">Current plan</span><h2 style="margin:.1em 0">${pro ? 'Pro' : 'Free'} ${me.comped ? '<span class="badge">complimentary</span>' : ''} ${me.sub_status === 'canceling' ? '<span class="badge warn">cancels ' + esc(periodEnd || 'soon') + '</span>' : me.sub_status === 'past_due' ? '<span class="badge bad">payment failed</span>' : ''}</h2>
        <span class="muted">${pro ? (periodEnd && !me.comped ? 'Renews / ends on ' + esc(periodEnd) : 'Unlimited links and all Pro features.') : `${me.link_count} of ${me.link_limit} free links used.`}</span></div>
      ${pro && me.has_customer ? '<button class="btn" id="portal">Manage subscription</button>' : ''}
    </div></div>
  ${pro ? '' : `
  <div class="plans" style="max-width:none;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
    <div class="plan best"><span class="ribbon">Pro</span>
      <div class="seg" style="margin-bottom:12px"><button class="on" data-i="month">Monthly</button><button data-i="year">Yearly <span class="badge ok">-${save}%</span></button></div>
      <div class="price" id="pp">${price$(me.monthly)}<small>/month</small></div>
      <ul><li><b>Unlimited</b> links</li><li>Custom slugs (a2z.deals/your-name)</li><li>Meta &amp; TikTok retargeting pixels</li><li>Scheduled start &amp; end</li><li>1-year analytics + CSV export</li><li>No a2z branding on deal cards</li></ul>
      <button class="btn primary block lg" id="buy" ${me.stripe ? '' : 'disabled'}>${me.stripe ? 'Upgrade to Pro' : 'Pro is coming soon'}</button>
      <p class="tiny muted center" style="margin:.8em 0 0">${me.stripe ? 'Secure checkout by Stripe. Cancel any time.' : 'Online payments are being set up. Everything on the Free plan works today.'}</p>
    </div></div>`}`;
  $('#portal')?.addEventListener('click', async () => { try { location.href = (await api('/api/billing/portal', 'POST')).url; } catch (ex) { toast(ex.message, true); } });
  if (!pro) {
    let iv = 'month';
    $$('.seg button').forEach((b) => (b.onclick = () => {
      iv = b.dataset.i; $$('.seg button').forEach((x) => x.classList.toggle('on', x === b));
      $('#pp').innerHTML = iv === 'year' ? `${price$(me.yearly)}<small>/year</small>` : `${price$(me.monthly)}<small>/month</small>`;
    }));
    $('#buy').onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'Opening checkout…';
      try { location.href = (await api('/api/billing/checkout', 'POST', { interval: iv })).url; }
      catch (ex) { toast(ex.message, true); e.target.disabled = false; e.target.textContent = 'Upgrade to Pro'; }
    };
  }
}

/* ---------------------------------------------------------------- account */
function viewAccount() {
  $('#view').innerHTML = `
  <div class="page-head"><h1>Account</h1></div>
  <div class="panel"><h3>Email</h3><p class="muted">${esc(me.email)}</p></div>
  <div class="panel"><h3>Delete account</h3><p class="muted">Permanently removes your account, links and analytics. ${me.has_customer && me.plan === 'pro' ? 'Cancel your subscription in Plan &amp; billing first.' : ''}</p><button class="btn danger" id="delacc">Delete my account</button></div>`;
  $('#delacc').onclick = async () => {
    if (!confirm('This permanently deletes your account and all links. Continue?')) return;
    try { await api('/api/account/delete', 'POST'); location.href = '/'; } catch (ex) { toast(ex.message, true); }
  };
}

boot();
