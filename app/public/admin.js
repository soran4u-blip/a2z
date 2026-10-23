const app = $('#app');
let tab = 'overview', admin = null;

async function boot() {
  try { admin = await api('/api/admin/me'); render(); } catch { loginView(); }
}

function loginView() {
  app.innerHTML = `<main class="auth"><div class="orb o1"></div><div class="auth-card">
    <a class="logo" href="/"><span class="logo-mark">a2z</span><span class="logo-text">admin<i>.a2z.deals</i></span></a>
    <h1>Admin sign in</h1><p class="muted">Restricted area. All access is logged.</p>
    <form id="af"><label>Email<input name="email" type="email" required autocomplete="username"></label>
    <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
    <div id="ae" class="error" hidden></div><button class="btn primary lg block">Sign in</button></form></div></main>`;
  $('#af').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try { await api('/api/admin/login', 'POST', { email: fd.get('email'), password: fd.get('password') }); boot(); }
    catch (ex) { const b = $('#ae'); b.textContent = ex.message; b.hidden = false; }
  };
}

const TABS = [['overview', 'Overview'], ['users', 'Users'], ['links', 'Links'], ['reports', 'Reports'], ['blocklist', 'Blocklist']];
function render() {
  app.innerHTML = `<header class="topbar"><div class="topbar-in">
    <a class="logo" href="/"><span class="logo-mark">a2z</span><span class="logo-text">admin</span></a>
    <nav class="tabs">${TABS.map(([k, n]) => `<button class="tab ${tab === k ? 'on' : ''}" data-t="${k}">${n}</button>`).join('')}</nav>
    <div class="who"><span class="em">${esc(admin.email)}</span><button class="btn sm ghost" id="out">Sign out</button></div></div></header>
    <main class="main" id="view"><div class="boot">Loading…</div></main>`;
  $$('.tab').forEach((b) => (b.onclick = () => { tab = b.dataset.t; render(); }));
  $('#out').onclick = async () => { await api('/api/admin/logout', 'POST'); boot(); };
  ({ overview, users, links, reports, blocklist })[tab]().catch((ex) => { if (ex.status === 401) boot(); else toast(ex.message, true); });
}

async function overview() {
  const o = await api('/api/admin/overview');
  const s = o.stats;
  const flag = (ok, t) => `<span class="badge ${ok ? 'ok' : 'warn'}">${t}: ${ok ? 'on' : 'off'}</span>`;
  $('#view').innerHTML = `
  <div class="page-head"><h1>Overview</h1><div style="display:flex;gap:8px;flex-wrap:wrap">${flag(o.stripe, 'Stripe')} ${flag(o.webhook, 'Webhook')} ${flag(o.safe_browsing, 'Safe Browsing')}</div></div>
  <div class="cards">
    <div class="stat"><span>Users</span><b>${fmt(s.users)}</b><small>${fmt(s.pro)} on Pro (${fmt(s.paying)} paying)</small></div>
    <div class="stat"><span>Revenue (30 days)</span><b>${money(s.revenue_30d)}</b><small>from paid invoices</small></div>
    <div class="stat"><span>Links</span><b>${fmt(s.links)}</b><small>${fmt(s.guest_links)} guest · ${fmt(s.disabled_links)} disabled</small></div>
    <div class="stat"><span>Clicks (24h)</span><b>${fmt(s.clicks_24h)}</b><small>${fmt(s.clicks_total)} all time</small></div>
    <div class="stat"><span>Open reports</span><b style="color:${s.open_reports ? 'var(--warn)' : 'inherit'}">${fmt(s.open_reports)}</b><small><a href="#" data-go="reports">review</a></small></div>
  </div>
  <div class="two"><div class="panel"><h3>Clicks · last 30 days</h3>${barChart(o.clicks)}</div><div class="panel"><h3>Sign-ups · last 30 days</h3>${barChart(o.signups)}</div></div>
  <div class="panel tbl"><h3>Top links</h3><table><thead><tr><th>Slug</th><th>Title</th><th>Destination</th><th>Owner</th><th>Clicks</th></tr></thead><tbody>
  ${o.top_links.map((l) => `<tr><td><span class="short">${esc(l.slug)}</span></td><td>${esc(l.title || '')}</td><td>${esc(l.host)}</td><td>${esc(l.email || 'guest')}</td><td>${fmt(l.clicks)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No links yet.</td></tr>'}</tbody></table></div>`;
  $('[data-go=reports]')?.addEventListener('click', (e) => { e.preventDefault(); tab = 'reports'; render(); });
}

function searchBox(ph, val, onq, extra = '') {
  return `<div class="tools"><input class="search" id="q" placeholder="${ph}" value="${esc(val)}">${extra}</div>`;
}
let uq = '', lq = '', lst = '';
async function users() {
  const d = await api('/api/admin/users?q=' + encodeURIComponent(uq));
  $('#view').innerHTML = `<div class="page-head"><h1>Users</h1></div>${searchBox('Search by email…', uq)}
  <div class="panel tbl"><table><thead><tr><th>Email</th><th>Plan</th><th>Links</th><th>Clicks</th><th>Joined</th><th>Last login</th><th></th></tr></thead><tbody>
  ${d.users.map((u) => `<tr data-id="${u.id}"><td>${esc(u.email)} ${u.status === 'suspended' ? '<span class="badge bad">suspended</span>' : ''}</td>
    <td>${u.plan === 'pro' || u.comped ? `<span class="badge pro">PRO</span> ${u.comped ? '<span class="badge">comp</span>' : u.sub_status && u.sub_status !== 'active' ? `<span class="badge warn">${esc(u.sub_status)}</span>` : ''}` : '<span class="badge">Free</span>'}</td>
    <td>${fmt(u.links)}</td><td>${fmt(u.clicks)}</td><td>${ago(u.created_at)}</td><td>${ago(u.last_login)}</td>
    <td><div class="actions">
      ${u.comped ? '<button class="btn sm" data-a="free">Remove Pro</button>' : u.stripe_sub ? '' : '<button class="btn sm" data-a="pro">Grant Pro</button>'}
      <button class="btn sm ${u.status === 'active' ? 'danger' : ''}" data-a="${u.status === 'active' ? 'suspend' : 'activate'}">${u.status === 'active' ? 'Suspend' : 'Activate'}</button>
      <button class="btn sm danger" data-a="del">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No users found.</td></tr>'}
  </tbody></table></div>`;
  let t; $('#q').oninput = (e) => { uq = e.target.value; clearTimeout(t); t = setTimeout(() => { users(); }, 300); };
  $('#q').focus(); $('#q').setSelectionRange(uq.length, uq.length);
  $$('[data-a]').forEach((b) => (b.onclick = async () => {
    const id = b.closest('tr').dataset.id, a = b.dataset.a;
    try {
      if (a === 'del') { if (!confirm('Delete this user and all their links?')) return; await api('/api/admin/users/' + id, 'DELETE'); }
      else await api('/api/admin/users/' + id, 'PATCH', a === 'pro' ? { plan: 'pro' } : a === 'free' ? { plan: 'free' } : { status: a === 'suspend' ? 'suspended' : 'active' });
      toast('Done'); users();
    } catch (ex) { toast(ex.message, true); }
  }));
}

async function links() {
  const d = await api(`/api/admin/links?q=${encodeURIComponent(lq)}&status=${lst}`);
  $('#view').innerHTML = `<div class="page-head"><h1>Links</h1></div>
  ${searchBox('Search slug, URL, title, owner…', lq, null, `<select id="st"><option value="">All</option><option value="active" ${lst === 'active' ? 'selected' : ''}>Active</option><option value="disabled" ${lst === 'disabled' ? 'selected' : ''}>Disabled</option></select>`)}
  <div class="panel tbl"><table><thead><tr><th>Short</th><th>Destination</th><th>Owner</th><th>Clicks</th><th>Created</th><th>Status</th><th></th></tr></thead><tbody>
  ${d.links.map((l) => `<tr data-id="${l.id}" data-host="${esc(l.host)}"><td><a class="short" href="${esc(l.short)}" target="_blank" rel="noopener">${esc(l.slug)}</a></td>
    <td class="cell-link"><b>${esc(l.title || l.host)}</b><span title="${esc(l.url)}">${esc(l.url)}</span></td>
    <td>${esc(l.email || 'guest')}</td><td>${fmt(l.clicks)}</td><td>${ago(l.created_at)}</td>
    <td><span class="badge ${l.status === 'active' ? 'ok' : 'bad'}">${l.status}</span></td>
    <td><div class="actions"><button class="btn sm" data-a="${l.status === 'active' ? 'disable' : 'enable'}">${l.status === 'active' ? 'Disable' : 'Enable'}</button>
      <button class="btn sm danger" data-a="block">Block site</button><button class="btn sm danger" data-a="del">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No links found.</td></tr>'}
  </tbody></table></div>`;
  let t; $('#q').oninput = (e) => { lq = e.target.value; clearTimeout(t); t = setTimeout(links, 300); };
  $('#q').focus(); $('#q').setSelectionRange(lq.length, lq.length);
  $('#st').onchange = (e) => { lst = e.target.value; links(); };
  $$('[data-a]').forEach((b) => (b.onclick = async () => {
    const tr = b.closest('tr'), id = tr.dataset.id, a = b.dataset.a;
    try {
      if (a === 'del') { if (!confirm('Delete this link permanently?')) return; await api('/api/admin/links/' + id, 'DELETE'); }
      else if (a === 'block') { if (!confirm(`Block ${tr.dataset.host} and disable every link to it?`)) return; const r = await api('/api/admin/blocklist', 'POST', { domain: tr.dataset.host, reason: 'Blocked from links list' }); toast(`Blocked. ${r.disabled} link(s) disabled.`); links(); return; }
      else await api('/api/admin/links/' + id, 'PATCH', { status: a === 'disable' ? 'disabled' : 'active' });
      toast('Done'); links();
    } catch (ex) { toast(ex.message, true); }
  }));
}

async function reports() {
  const d = await api('/api/admin/reports');
  $('#view').innerHTML = `<div class="page-head"><h1>Abuse reports</h1></div>
  <div class="panel tbl"><table><thead><tr><th>Link</th><th>Reason</th><th>Destination</th><th>Owner</th><th>When</th><th>Status</th><th></th></tr></thead><tbody>
  ${d.reports.map((r) => `<tr data-id="${r.id}"><td><span class="short">${esc(r.slug)}</span> ${r.link_status === 'disabled' ? '<span class="badge bad">disabled</span>' : ''}</td>
    <td><b>${esc(r.reason)}</b><div class="muted tiny">${esc(r.detail || '')}</div></td><td class="cell-link"><span title="${esc(r.url || '')}">${esc(r.host || '(deleted)')}</span></td>
    <td>${esc(r.owner || 'guest')}</td><td>${ago(r.created_at)}</td><td><span class="badge ${r.status === 'open' ? 'warn' : 'ok'}">${r.status}</span></td>
    <td><div class="actions">${r.status === 'open' ? `<button class="btn sm" data-a="ok">Dismiss</button><button class="btn sm danger" data-a="dis">Disable link</button><button class="btn sm danger" data-a="blk">Block site</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No reports. 🎉</td></tr>'}
  </tbody></table></div>`;
  $$('[data-a]').forEach((b) => (b.onclick = async () => {
    const a = b.dataset.a;
    try { await api('/api/admin/reports/' + b.closest('tr').dataset.id, 'PATCH', { disable: a === 'dis', block_domain: a === 'blk' }); toast('Done'); reports(); } catch (ex) { toast(ex.message, true); }
  }));
}

async function blocklist() {
  const d = await api('/api/admin/blocklist');
  $('#view').innerHTML = `<div class="page-head"><h1>Blocked websites</h1></div>
  <div class="panel"><form id="bf" class="create"><input name="domain" placeholder="badsite.com" required><input name="reason" placeholder="Reason (optional)"><button class="btn primary">Block</button></form>
  <p class="tiny muted" style="margin:.5em 0 0">Blocking a site also disables every existing link to it and rejects new ones.</p></div>
  <div class="panel tbl"><table><thead><tr><th>Domain</th><th>Reason</th><th>Added</th><th></th></tr></thead><tbody>
  ${d.domains.map((x) => `<tr data-d="${esc(x.domain)}"><td><b>${esc(x.domain)}</b></td><td>${esc(x.reason || '')}</td><td>${ago(x.created_at)}</td><td><div class="actions"><button class="btn sm">Unblock</button></div></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing blocked yet.</td></tr>'}
  </tbody></table></div>`;
  $('#bf').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try { const r = await api('/api/admin/blocklist', 'POST', { domain: fd.get('domain'), reason: fd.get('reason') }); toast(`Blocked. ${r.disabled} link(s) disabled.`); blocklist(); } catch (ex) { toast(ex.message, true); }
  };
  $$('tbody .btn').forEach((b) => (b.onclick = async () => { await api('/api/admin/blocklist/' + encodeURIComponent(b.closest('tr').dataset.d), 'DELETE'); blocklist(); }));
}

boot();
