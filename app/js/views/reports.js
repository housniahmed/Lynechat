// Rapports PDF à la marque de l'agence, pour l'espace client actif.
import { api, el, run, fmtDate, pct, num, exportReport, campaignBadge } from '../ui.js';

const iso = (d) => d.toISOString().slice(0, 10);

export async function reportsView(page) {
  const ws = await api('currentWorkspace');
  const agency = await api('agency');
  page.append(el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, 'Rapports PDF'), el('div', { class: 'sub', dir: 'auto' }, `Espace : ${ws.name}`))));
  if (!agency.name) {
    page.append(el('div', { class: 'note info', style: { marginBottom: '14px' } }, 'Astuce : renseignez le nom et le logo de votre agence dans ', el('a', { href: '#/workspaces' }, 'Espaces clients'), ' pour qu’ils apparaissent sur les rapports.'));
  }

  // ---------- rapport de période ----------
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const from = el('input', { type: 'date', value: iso(first) });
  const to = el('input', { type: 'date', value: iso(last) });
  const comment = el('textarea', { rows: 3, dir: 'auto', placeholder: 'Facultatif : analyse, recommandations pour le mois prochain…' });
  const preset = (label, a, b) => el('button', { class: 'btn sm ghost', type: 'button', onclick: () => { from.value = iso(a); to.value = iso(b); } }, label);
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  page.append(el('div', { class: 'card' },
    el('h2', {}, 'Rapport d’activité sur une période'),
    el('p', { class: 'muted', style: { marginTop: 0 } }, 'Synthèse de toutes les campagnes envoyées sur la période, des e-mails d’automatisation, des nouveaux contacts, des désinscriptions et des inscriptions par formulaire.'),
    el('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '10px' } },
      preset('Mois dernier', first, last),
      preset('Mois en cours', new Date(Date.UTC(y, m, 1)), now),
      preset('3 derniers mois', new Date(Date.UTC(y, m - 3, 1)), last),
      preset('Année en cours', new Date(Date.UTC(y, 0, 1)), now)),
    el('div', { class: 'grid2' }, el('label', { class: 'f' }, 'Du', from), el('label', { class: 'f' }, 'Au', to)),
    el('label', { class: 'f', style: { marginTop: '10px' } }, 'Commentaire de l’agence (affiché dans le rapport)', comment),
    el('div', { class: 'row', style: { marginTop: '12px' } },
      el('button', { class: 'btn primary', onclick: (e) => run(e.target, () => exportReport('period', { from: from.value, to: to.value, comment: comment.value.trim() })) }, 'Générer le PDF'))));

  // ---------- rapports par campagne ----------
  const camps = (await api('campaigns')).filter((c) => ['sent', 'sending', 'paused'].includes(c.status) && c.stats?.sent);
  page.append(el('div', { class: 'card' },
    el('h2', {}, 'Rapport d’une campagne'),
    camps.length
      ? el('table', { class: 't' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Campagne'), el('th', {}, 'Envoi'), el('th', { class: 'num' }, 'Envoyés'), el('th', { class: 'num' }, 'Ouverture'), el('th', { class: 'num' }, 'Clic'), el('th', {}, ''))),
        el('tbody', {}, ...camps.map((c) => el('tr', {},
          el('td', { dir: 'auto' }, el('b', {}, c.name), el('div', { class: 'muted small' }, c.subject)),
          el('td', {}, campaignBadge(c.status), el('div', { class: 'muted small' }, fmtDate(c.sent_at || c.started_at))),
          el('td', { class: 'num' }, num(c.stats.sent)),
          el('td', { class: 'num' }, pct(c.stats.openRate)),
          el('td', { class: 'num' }, pct(c.stats.clickRate)),
          el('td', { class: 'num' }, el('button', { class: 'btn sm', onclick: (e) => run(e.target, () => exportReport('campaign', { campaignId: c.id })) }, 'PDF'))))))
      : el('p', { class: 'muted' }, 'Aucune campagne envoyée dans cet espace pour le moment.')));
}
