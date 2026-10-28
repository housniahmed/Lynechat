import { api, el, num, pct, fmtDate, campaignBadge, svgBars } from '../ui.js';

export async function dashboardView(page) {
  const o = await api('overview');
  const steps = [
    [o.setup.aws, 'Connecter votre compte AWS', 'Clés d’accès d’un utilisateur IAM dédié.', '#/settings'],
    [o.setup.infra, 'Installer l’infrastructure d’envoi', 'Un clic : suivi des ouvertures/clics, désinscription, formulaires.', '#/settings'],
    [o.setup.company, 'Renseigner votre entreprise', 'Nom et adresse postale, obligatoires dans chaque e-mail.', '#/settings'],
    [o.setup.sender, 'Choisir l’expéditeur par défaut', 'Une adresse de votre domaine vérifié dans Amazon SES.', '#/settings'],
  ];
  const pending = steps.filter((s) => !s[0]).length;
  page.append(el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'Tableau de bord'), el('div', { class: 'sub' }, '30 derniers jours')), el('span', { class: 'spacer' }),
    el('a', { class: 'btn', href: '#/contacts' }, 'Ajouter des contacts'), el('a', { class: 'btn primary', href: '#/campaigns' }, 'Créer une campagne')));

  if (o.pollError) page.append(el('div', { class: 'note err', style: { marginBottom: '16px' } }, `Lecture des événements AWS impossible : ${o.pollError}`));

  if (pending) {
    page.append(el('div', { class: 'card', style: { marginBottom: '16px' } },
      el('h2', {}, `Pour commencer (${steps.length - pending}/${steps.length})`),
      el('div', { class: 'steps' }, ...steps.map(([done, t, d, href], i) => el('a', { class: `check-item${done ? ' done' : ''}`, href, style: { textDecoration: 'none', color: 'inherit' } },
        el('span', { class: 'n' }, done ? '✓' : i + 1), el('div', {}, el('strong', {}, t), el('div', { class: 'muted small' }, d)))))));
  }

  const c = o.contacts;
  const base = o.delivered || o.sent;
  page.append(el('div', { class: 'grid4', style: { marginBottom: '16px' } },
    el('div', { class: 'kpi' }, el('div', { class: 'l' }, 'Abonnés'), el('div', { class: 'v' }, num(c.subscribed || 0)), el('div', { class: 's' }, `${num(c.total)} contacts au total`)),
    el('div', { class: 'kpi' }, el('div', { class: 'l' }, 'E-mails envoyés'), el('div', { class: 'v' }, num(o.sent)), el('div', { class: 's' }, `${num(o.delivered)} remis`)),
    el('div', { class: 'kpi' }, el('div', { class: 'l' }, 'Taux d’ouverture'), el('div', { class: 'v' }, base ? pct(o.opens / base) : '—'), el('div', { class: 's' }, `${num(o.opens)} ouvertures uniques`)),
    el('div', { class: 'kpi' }, el('div', { class: 'l' }, 'Taux de clic'), el('div', { class: 'v' }, base ? pct(o.clicks / base) : '—'), el('div', { class: 's' }, `${num(o.unsubs)} désinscriptions · ${num(o.bounces)} rebonds`))));

  const growth = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    growth.push({ x: day, y: o.growth.find((g) => g.day === day)?.n || 0 });
  }
  page.append(el('div', { class: 'grid2' },
    el('div', { class: 'card' }, el('h2', {}, 'Nouveaux contacts par jour'), svgBars(growth, { label: (d) => new Date(d.x).toLocaleDateString('fr-FR') }), el('div', { class: 'row muted small' }, el('span', {}, 'il y a 30 jours'), el('span', { class: 'spacer' }), el('span', {}, 'aujourd’hui'))),
    el('div', { class: 'card flush' }, el('div', { style: { padding: '16px 18px 4px' } }, el('h2', {}, 'Campagnes récentes')),
      o.recent.length ? el('table', { class: 't' }, el('tbody', {}, ...o.recent.map((r) => el('tr', { class: 'click', onclick: () => { location.hash = r.status === 'draft' ? `#/campaigns/${r.id}` : `#/campaigns/${r.id}/report`; } },
        el('td', {}, el('strong', {}, r.name), el('div', { class: 'muted small' }, fmtDate(r.sent_at || r.scheduled_at))), el('td', {}, campaignBadge(r.status)),
        el('td', { class: 'num' }, r.stats ? `${pct(r.stats.openRate)} ouv.` : '')))))
        : el('div', { class: 'empty' }, 'Aucune campagne pour l’instant.'))));
}
