// Pont vers le moteur. Dans l'application de bureau, window.lynechat est fourni par Electron (preload.js).
// Dans la version web, on le recrée ici avec des requêtes HTTP et un flux d'événements (SSE).
(function () {
  if (window.lynechat) return;
  const toWire = (v) => {
    if (v instanceof Uint8Array) {
      let s = '';
      for (let i = 0; i < v.length; i += 0x8000) s += String.fromCharCode.apply(null, v.subarray(i, i + 0x8000));
      return { __b64: btoa(s) };
    }
    if (Array.isArray(v)) return v.map(toWire);
    if (v && typeof v === 'object' && v.constructor === Object) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toWire(x)]));
    return v;
  };
  const listeners = new Set();
  let es = null;
  const connect = () => {
    es = new EventSource('/api/events');
    es.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } for (const cb of listeners) cb(m); };
    es.onerror = () => { es.close(); setTimeout(connect, 5000); };
  };
  connect();
  window.lynechat = {
    web: true,
    call: async (method, ...args) => {
      const r = await fetch('/api/call', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lynechat': '1' }, credentials: 'same-origin', body: JSON.stringify({ method, args: toWire(args) }) });
      if (r.status === 401) { location.href = '/login'; throw new Error('Session expirée'); }
      const j = await r.json().catch(() => ({ ok: false, error: `Erreur serveur (${r.status})` }));
      if (!j.ok) throw new Error(j.error || 'Erreur');
      return j.result;
    },
    // Téléchargement classique dans le navigateur (remplace la boîte « Enregistrer sous » du bureau).
    saveFile: async (name, content) => {
      const type = /\.html?$/i.test(name) ? 'text/html;charset=utf-8' : /\.csv$/i.test(name) ? 'text/csv;charset=utf-8' : 'application/octet-stream';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([content], { type }));
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      return name;
    },
    openExternal: async (url) => { if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener'); },
    on: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    logout: async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login'; },
  };
})();
