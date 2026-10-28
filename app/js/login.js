document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err');
  const btn = e.target.querySelector('button');
  err.hidden = true;
  btn.disabled = true;
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: document.getElementById('pw').value }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) { location.href = '/'; return; }
    err.textContent = j.error || `Erreur (${r.status})`;
    err.hidden = false;
  } catch {
    err.textContent = 'Serveur injoignable.';
    err.hidden = false;
  } finally { btn.disabled = false; }
});
