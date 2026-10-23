// Deal-card redirect: ~2s countdown, skippable, falls back to a normal link without JS.
const root = $('.go');
const dest = root.dataset.dest;
const ms = Number(root.dataset.ms) || 2200;
const bar = $('#go-bar');
const cnt = $('#go-count');
const st = $('#go-state');
let go = true;
const start = performance.now();

function tick(t) {
  if (!go) return;
  const p = Math.min(1, (t - start) / ms);
  bar.style.width = (p * 100).toFixed(1) + '%';
  const left = Math.max(0, Math.ceil((ms - (t - start)) / 1000));
  cnt.textContent = 'in ' + left + 's';
  st.textContent = p < 1 ? Math.round(p * 100) + '%' : 'Ready';
  if (p < 1) requestAnimationFrame(tick); else location.replace(dest);
}
requestAnimationFrame(tick);

// Any interaction with coupon copy pauses the auto-redirect so people can copy the code.
$$('.copy').forEach((b) => b.addEventListener('click', () => {
  go = false; cnt.textContent = 'paused'; st.textContent = 'Paused';
  navigator.clipboard?.writeText(b.dataset.copy).catch(() => {});
  b.textContent = 'Copied!';
}));

const exp = Number(root.dataset.expires);
const cd = $('#countdown');
if (exp && cd) {
  const upd = () => {
    const s = Math.max(0, Math.floor((exp - Date.now()) / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    cd.textContent = s <= 0 ? 'Deal ended' : `⏱ Ends in ${d ? d + 'd ' : ''}${h}h ${m}m`;
  };
  upd(); setInterval(upd, 30000);
}

// If the seller's image link is dead, fall back to the store initial instead of a broken icon.
const img = $('.go-media img');
if (img) {
  const fallback = () => {
    const m = img.parentElement; img.remove(); m.classList.add('noimg');
    const s = document.createElement('span'); s.className = 'go-initial';
    s.textContent = (root.dataset.host || '?').replace(/^www\./, '').charAt(0).toUpperCase(); m.prepend(s);
  };
  img.addEventListener('error', fallback);
  if (img.complete && img.naturalWidth === 0) fallback();
}
