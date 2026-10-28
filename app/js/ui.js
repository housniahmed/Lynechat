// Outils d'interface partagés.
export const api = (method, ...args) => window.lynechat.call(method, ...args).catch((e) => {
  // Electron préfixe les erreurs IPC : on garde le message utile.
  const msg = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  throw new Error(msg);
});

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function toast(msg, kind = '', ms = 3800) {
  const t = el('div', { class: `toast ${kind}` }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

/** Exécute une action asynchrone avec gestion d'erreur et bouton désactivé. */
export async function run(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message, 'err', 7000);
    return undefined;
  } finally { if (btn) btn.disabled = false; }
}

export function modal({ title, body, actions = [], size = '', onClose } = {}) {
  const d = el('dialog', { class: `modal ${size}` });
  const close = () => { d.close(); };
  d.addEventListener('close', () => { d.remove(); onClose?.(); });
  const foot = el('div', { class: 'modal-foot' }, ...actions.map((a) => {
    const b = el('button', { class: `btn ${a.kind || ''}` }, a.label);
    b.addEventListener('click', async () => {
      if (!a.onClick) return close();
      b.disabled = true;
      try { const r = await a.onClick(close); if (r !== false && a.close !== false) close(); } catch (e) { toast(e.message, 'err', 7000); } finally { b.disabled = false; }
    });
    return b;
  }));
  d.append(el('div', { class: 'modal-head' }, title, el('span', { class: 'spacer' }), el('button', { class: 'icon-btn', title: 'Fermer', onclick: close }, '✕')),
    el('div', { class: 'modal-body' }, body), actions.length ? foot : null);
  document.body.append(d);
  d.showModal();
  return { dialog: d, close };
}

export function confirmBox(title, text, okLabel = 'Confirmer', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title, body: el('p', { style: { margin: 0 } }, text),
      actions: [{ label: 'Annuler', onClick: () => { done = true; resolve(false); } }, { label: okLabel, kind: danger ? 'primary danger' : 'primary', onClick: () => { done = true; resolve(true); } }],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

export function promptBox(title, label, value = '', okLabel = 'Valider') {
  return new Promise((resolve) => {
    const input = el('input', { type: 'text', value, dir: 'auto' });
    let done = false;
    modal({
      title, body: el('label', { class: 'f' }, label, input),
      actions: [{ label: 'Annuler', onClick: () => { done = true; resolve(null); } }, { label: okLabel, kind: 'primary', onClick: () => { done = true; resolve(input.value.trim()); } }],
      onClose: () => { if (!done) resolve(null); },
    });
    setTimeout(() => { input.focus(); input.select(); }, 30);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.closest('dialog').querySelector('.btn.primary').click(); });
  });
}

export const fmtDate = (s, withTime = true) => {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleString('fr-FR', withTime ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', year: 'numeric' });
};
export const pct = (x) => `${(x * 100).toFixed(1).replace('.', ',')} %`;
export const num = (n) => Number(n || 0).toLocaleString('fr-FR');

export const STATUS_LABEL = {
  subscribed: ['Abonné', 'green'], pending: ['En attente de confirmation', 'amber'], unsubscribed: ['Désinscrit', ''],
  bounced: ['Adresse invalide', 'red'], complained: ['Signalé comme spam', 'red'],
};
export const statusBadge = (s) => { const [l, c] = STATUS_LABEL[s] || [s, '']; return el('span', { class: `badge ${c}` }, l); };

export const CAMPAIGN_STATUS = {
  draft: ['Brouillon', ''], scheduled: ['Planifiée', 'blue'], sending: ['Envoi en cours', 'amber'], paused: ['En pause', 'amber'], sent: ['Envoyée', 'green'], failed: ['Échec', 'red'],
};
export const campaignBadge = (s) => { const [l, c] = CAMPAIGN_STATUS[s] || [s, '']; return el('span', { class: `badge ${c}` }, l); };

/** Lecteur CSV (virgule, point-virgule ou tabulation ; guillemets ; BOM). */
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [';', ',', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const clean = rows.filter((r) => r.some((c) => c.trim() !== ''));
  const head = (clean.shift() || []).map((h, i) => h.trim() || `Colonne ${i + 1}`);
  return { head, rows: clean.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))), delim };
}

export function svgBars(data, { height = 140, color = '#1f6f5c', label = (d) => d.x } = {}) {
  const max = Math.max(1, ...data.map((d) => d.y));
  const w = 100 / Math.max(1, data.length);
  const svg = `<svg class="chart" viewBox="0 0 100 ${height / 4}" preserveAspectRatio="none" role="img">${data.map((d, i) => {
    const h = (d.y / max) * (height / 4 - 2);
    return `<rect x="${i * w + w * 0.15}" y="${height / 4 - h}" width="${w * 0.7}" height="${h}" rx="0.6" fill="${color}"><title>${esc(label(d))} : ${d.y}</title></rect>`;
  }).join('')}</svg>`;
  return el('div', { html: svg });
}
