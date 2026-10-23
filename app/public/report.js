const f = $('#report-form');
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = $('#report-msg');
  const fd = new FormData(f);
  try {
    await api('/api/report', 'POST', { slug: f.dataset.slug, reason: fd.get('reason'), detail: fd.get('detail') });
    f.innerHTML = '<p>Thank you. Our team will review this link.</p><a class="btn primary" href="/">Back to a2z.deals</a>';
  } catch (ex) { m.textContent = ex.message; m.hidden = false; }
});
