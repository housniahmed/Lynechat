// Point d'entrée : navigation entre les écrans et état de connexion.
import { api, el } from './ui.js';
import { dashboardView } from './views/dashboard.js';
import { contactsView } from './views/contacts.js';
import { campaignsView, campaignView, reportView } from './views/campaigns.js';
import { automationsView, automationView } from './views/automations.js';
import { formsView, formView } from './views/forms.js';
import { templatesView } from './views/templates.js';
import { settingsView } from './views/settings.js';
import { workspacesView, editWorkspace, switchTo } from './views/workspaces.js';
import { reportsView } from './views/reports.js';

const ROUTES = [
  [/^#?\/?$/, 'dashboard', dashboardView],
  [/^#\/contacts$/, 'contacts', contactsView],
  [/^#\/campaigns$/, 'campaigns', campaignsView],
  [/^#\/campaigns\/([\w-]+)$/, 'campaigns', campaignView],
  [/^#\/campaigns\/([\w-]+)\/report$/, 'campaigns', reportView],
  [/^#\/automations$/, 'automations', automationsView],
  [/^#\/automations\/([\w-]+)$/, 'automations', automationView],
  [/^#\/forms$/, 'forms', formsView],
  [/^#\/forms\/([\w-]+)$/, 'forms', formView],
  [/^#\/templates$/, 'templates', templatesView],
  [/^#\/settings$/, 'settings', settingsView],
  [/^#\/workspaces$/, 'workspaces', workspacesView],
  [/^#\/reports$/, 'reports', reportsView],
];

const main = document.getElementById('view');
let cleanup = null;
let renderId = 0;

export async function render() {
  const hash = location.hash || '#/';
  const r = ROUTES.find(([re]) => re.test(hash)) || ROUTES[0];
  const params = hash.match(r[0]).slice(1);
  for (const a of document.querySelectorAll('.sidebar a')) a.classList.toggle('active', a.dataset.route === r[1]);
  if (cleanup) { try { cleanup(); } catch { /* */ } cleanup = null; }
  const my = ++renderId;
  const page = el('div', { class: 'page' });
  try {
    const res = await r[2](page, ...params);
    if (my !== renderId) return;
    cleanup = typeof res === 'function' ? res : null;
    main.innerHTML = '';
    main.append(page);
    main.scrollTop = 0;
  } catch (e) {
    console.error(e);
    main.innerHTML = '';
    main.append(el('div', { class: 'page' }, el('div', { class: 'note err' }, `Erreur : ${e.message}`)));
  }
}

window.addEventListener('hashchange', render);

async function refreshConn() {
  const box = document.getElementById('connStatus');
  try {
    const s = await api('settings');
    const ok = s.aws.configured && s.infra?.publicUrl;
    box.innerHTML = '';
    box.append(el('div', {}, el('span', { class: `dot ${ok ? 'on' : s.aws.configured ? 'mid' : 'off'}` }), el('b', {}, ok ? 'AWS connecté' : s.aws.configured ? 'Installation à terminer' : 'AWS non connecté')),
      s.aws.region ? el('div', {}, `Région : ${s.aws.region}`) : '');
  } catch { /* */ }
}
window.lynechat.on((m) => { if (m.type === 'settings') refreshConn(); });

// ---------- sélecteur d'espace client ----------
const wsBox = document.getElementById('wsSwitch');
let wsMenu = null;
const closeMenu = () => { wsMenu?.remove(); wsMenu = null; };
const mark = (w) => (w.logo ? el('img', { class: 'ws-logo', src: w.logo, alt: '' }) : el('span', { class: 'ws-dot', style: { background: w.color } }));
async function drawSwitcher() {
  let list;
  try { list = await api('workspaces'); } catch { return; }
  const cur = list.find((w) => w.current) || list[0];
  document.title = list.length > 1 ? `${cur.name} — Lynechat` : 'Lynechat — e-mailing';
  wsBox.innerHTML = '';
  const btn = el('button', { class: 'ws-btn', title: 'Changer d’espace client', 'aria-haspopup': 'menu' }, mark(cur), el('span', { class: 'nm', dir: 'auto' }, cur.name), el('span', { class: 'car' }, '▾'));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (wsMenu) return closeMenu();
    wsMenu = el('div', { class: 'ws-menu', role: 'menu' },
      el('div', { class: 'muted', style: { padding: '4px 9px' } }, 'Espaces clients'),
      ...list.map((w) => el('button', { class: w.current ? 'cur' : '', onclick: async () => { closeMenu(); if (!w.current) await switchTo(w.id); } }, mark(w), el('span', { dir: 'auto', style: { flex: 1 } }, w.name), w.current ? '✓' : '')),
      el('div', { class: 'sep' }),
      el('button', { onclick: async () => { closeMenu(); const w = await editWorkspace(); if (w) { await switchTo(w.id); location.hash = '#/settings'; } } }, '+ Nouvel espace client'),
      el('button', { onclick: () => { closeMenu(); location.hash = '#/workspaces'; } }, 'Gérer les espaces…'));
    wsBox.append(wsMenu);
  });
  wsBox.append(btn);
}
document.addEventListener('click', (e) => { if (wsMenu && !wsBox.contains(e.target)) closeMenu(); });
window.addEventListener('lynechat:workspace', drawSwitcher);
drawSwitcher();
refreshConn();
setInterval(refreshConn, 60000);
if (window.lynechat.web) { const b = document.getElementById('logoutBtn'); b.hidden = false; b.addEventListener('click', () => window.lynechat.logout()); }
render();
export { refreshConn };
