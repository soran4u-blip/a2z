const form = $('#auth-form');
const err = $('#auth-error');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true;
  const btn = $('button[type=submit]', form);
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Please wait…';
  try {
    const fd = new FormData(form);
    await api(form.dataset.mode === 'login' ? '/api/login' : '/api/signup', 'POST', { email: fd.get('email'), password: fd.get('password') });
    location.href = '/dashboard' + (new URLSearchParams(location.search).get('plan') === 'pro' ? '?tab=billing' : '');
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
    btn.disabled = false; btn.textContent = orig;
  }
});
