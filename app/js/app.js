// Point d'entrée : navigation entre les écrans et état de connexion.
import { api, el } from './ui.js';
import { dashboardView } from './views/dashboard.js';
import { contactsView } from './views/contacts.js';
import { campaignsView, campaignView, reportView } from './views/campaigns.js';
import { automationsView, automationView } from './views/automations.js';
import { formsView, formView } from './views/forms.js';
import { templatesView } from './views/templates.js';
import { settingsView } from './views/settings.js';

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
refreshConn();
setInterval(refreshConn, 60000);
if (window.lynechat.web) { const b = document.getElementById('logoutBtn'); b.hidden = false; b.addEventListener('click', () => window.lynechat.logout()); }
render();
export { refreshConn };
