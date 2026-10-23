// Shared helpers (no framework). Everything user-supplied goes through textContent / esc().
window.$ = (s, r = document) => r.querySelector(s);
window.$$ = (s, r = document) => [...r.querySelectorAll(s)];
window.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
window.fmt = (n) => Number(n || 0).toLocaleString('en-US');
window.money = (cents, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase() }).format((cents || 0) / 100);
window.ago = (ts) => {
  if (!ts) return 'never';
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  for (const [n, u] of [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']]) if (s >= n) return Math.floor(s / n) + u + ' ago';
  return 'just now';
};
window.api = async (path, method = 'GET', body) => {
  const r = await fetch(path, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : (method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), body: body !== undefined ? JSON.stringify(body) : (method !== 'GET' ? '{}' : undefined), credentials: 'same-origin' });
  let j = {}; try { j = await r.json(); } catch { /* non-json */ }
  if (!r.ok) { const e = new Error(j.error || 'Something went wrong.'); e.status = r.status; throw e; }
  return j;
};
window.toast = (msg, err) => {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, 3200);
};
window.copyText = async (text) => {
  try { await navigator.clipboard.writeText(text); }
  catch { const i = document.createElement('input'); i.value = text; document.body.appendChild(i); i.select(); document.execCommand('copy'); i.remove(); }
  toast('Copied to clipboard');
};
// SVG bar chart: data = [{d,c}]
window.barChart = (data, h = 160) => {
  const w = 600, pad = 22, max = Math.max(1, ...data.map((x) => x.c));
  const bw = (w - 8) / data.length;
  const bars = data.map((x, i) => {
    const bh = Math.max(x.c ? 3 : 1, (x.c / max) * (h - pad - 8));
    return `<rect class="bar" x="${(4 + i * bw + bw * 0.14).toFixed(1)}" y="${(h - pad - bh).toFixed(1)}" width="${(bw * 0.72).toFixed(1)}" height="${bh.toFixed(1)}" rx="3"><title>${esc(x.d)}: ${x.c}</title></rect>`;
  }).join('');
  const step = Math.ceil(data.length / 6);
  const labels = data.map((x, i) => (i % step === 0 ? `<text x="${(4 + i * bw).toFixed(1)}" y="${h - 6}">${esc(x.d.slice(5))}</text>` : '')).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c24cff"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs>${bars}${labels}</svg>`;
};
window.barList = (rows) => {
  if (!rows || !rows.length) return '<p class="muted tiny">No data yet.</p>';
  const max = Math.max(...rows.map((r) => r.c));
  return `<div class="bars">${rows.map((r) => `<div class="bar-row"><span title="${esc(r.k)}">${esc(r.k || 'Unknown')}</span><div class="track"><i style="width:${(r.c / max * 100).toFixed(0)}%"></i></div><span>${fmt(r.c)}</span></div>`).join('')}</div>`;
};
