const form = $('#quick-form');
const out = $('#quick-result');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('button', form);
  btn.disabled = true; btn.textContent = '…';
  out.hidden = true;
  try {
    const r = await api('/api/quick', 'POST', { url: $('#quick-url').value });
    const l = r.link;
    out.innerHTML = `<div class="row"><span class="short">${esc(l.short.replace(/^https?:\/\//, ''))}</span>
      <button class="btn sm" id="qr-copy" type="button">Copy</button></div>
      <p class="tiny muted" style="margin:.7em 0 0">${r.guest
        ? 'Guest links last 30 days. <a href="/signup">Create a free account</a> to keep it, add a price card and see analytics.'
        : 'Saved to your account. <a href="/dashboard">Open dashboard</a> to add a price card.'}</p>`;
    out.hidden = false;
    $('#qr-copy').onclick = () => copyText(l.short);
    $('#quick-url').value = '';
  } catch (err) {
    out.innerHTML = `<div class="error" style="margin:0">${esc(err.message)}</div>`;
    out.hidden = false;
    out.style.borderColor = 'transparent';
  } finally { btn.disabled = false; btn.textContent = 'Shorten'; }
});
