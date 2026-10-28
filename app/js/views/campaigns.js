import { api, el, toast, run, modal, confirmBox, promptBox, fmtDate, num, pct, campaignBadge } from '../ui.js';
import { openEditor, chooseStarter, previewHtml, resolveAssets, resolveSrc } from '../editor.js';
import { renderEmail } from '../email-html.js';

export async function campaignsView(page) {
  const list = await api('campaigns');
  page.append(el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'Campagnes'), el('div', { class: 'sub' }, 'E-mails envoyés à une audience en une fois')), el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: async () => { const n = await promptBox('Nouvelle campagne', 'Nom interne (visible par vous seul)', `Campagne du ${new Date().toLocaleDateString('fr-FR')}`); if (n) location.hash = `#/campaigns/${await api('createCampaign', n)}`; } }, 'Créer une campagne')));
  if (!list.length) {
    page.append(el('div', { class: 'card empty' }, el('h3', {}, 'Aucune campagne'), el('p', {}, 'Créez votre première campagne : audience, objet, contenu, puis envoi immédiat ou planifié.')));
    return;
  }
  page.append(el('div', { class: 'card flush' }, el('table', { class: 't' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Campagne'), el('th', {}, 'Statut'), el('th', { class: 'num' }, 'Envoyés'), el('th', { class: 'num' }, 'Ouvertures'), el('th', { class: 'num' }, 'Clics'), el('th', {}, ''))),
    el('tbody', {}, ...list.map((c) => el('tr', { class: 'click', onclick: () => { location.hash = ['draft', 'scheduled', 'failed'].includes(c.status) ? `#/campaigns/${c.id}` : `#/campaigns/${c.id}/report`; } },
      el('td', {}, el('strong', {}, c.name), el('div', { class: 'muted small', dir: 'auto' }, c.subject || 'Sans objet'),
        el('div', { class: 'muted small' }, c.status === 'scheduled' ? `Planifiée le ${fmtDate(c.scheduled_at)}` : c.sent_at ? `Envoyée le ${fmtDate(c.sent_at)}` : `Créée le ${fmtDate(c.created_at)}`)),
      el('td', {}, campaignBadge(c.status), c.error ? el('div', { class: 'small', style: { color: 'var(--danger)', maxWidth: '260px' } }, c.error) : null),
      el('td', { class: 'num' }, c.stats ? num(c.stats.sent) : '—'),
      el('td', { class: 'num' }, c.stats ? pct(c.stats.openRate) : '—'),
      el('td', { class: 'num' }, c.stats ? pct(c.stats.clickRate) : '—'),
      el('td', { class: 'num' }, el('button', { class: 'btn sm ghost', onclick: async (e) => { e.stopPropagation(); location.hash = `#/campaigns/${await api('duplicateCampaign', c.id)}`; } }, 'Dupliquer'),
        c.status !== 'sending' ? el('button', { class: 'btn sm ghost danger', onclick: async (e) => { e.stopPropagation(); if (await confirmBox('Supprimer la campagne ?', 'Ses statistiques seront aussi supprimées de cette liste.', 'Supprimer', true)) { await run(null, () => api('deleteCampaign', c.id)); window.dispatchEvent(new HashChangeEvent('hashchange')); } } }, 'Supprimer') : null)))))));
}

export async function campaignView(page, cid) {
  let c = await api('campaign', cid);
  if (!c) { page.append(el('div', { class: 'note err' }, 'Campagne introuvable.')); return; }
  if (['sending', 'paused', 'sent'].includes(c.status)) { location.hash = `#/campaigns/${cid}/report`; return; }
  const [lists, tags, segments, settings] = await Promise.all([api('lists'), api('tags'), api('segments'), api('settings')]);
  c.audience = { lists: [], tags: [], excludeTags: [], segmentId: '', ...c.audience };
  const locked = c.status === 'scheduled';
  let saveT;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => api('saveCampaign', c).catch((e) => toast(e.message, 'err')), 400); };
  const head = el('div', { class: 'page-head' });
  const wiz = el('div', { class: 'wizard' });
  page.append(head, locked ? el('div', { class: 'note', style: { marginBottom: '14px' } }, `Campagne planifiée le ${fmtDate(c.scheduled_at)}. Annulez la planification pour la modifier.`) : null, wiz);

  const drawHead = () => {
    head.innerHTML = '';
    const name = el('input', { type: 'text', value: c.name, class: 'title-input', disabled: locked });
    name.addEventListener('change', () => { c.name = name.value.trim() || 'Campagne'; save(); });
    head.append(el('a', { class: 'btn ghost', href: '#/campaigns' }, '←'), name, campaignBadge(c.status), el('span', { class: 'spacer' }),
      locked ? el('button', { class: 'btn', onclick: (e) => run(e.target, async () => { await api('unscheduleCampaign', cid); window.dispatchEvent(new HashChangeEvent('hashchange')); }, 'Planification annulée.') }, 'Annuler la planification') : null,
      !locked ? el('button', { class: 'btn', onclick: () => testDialog(c) }, 'Envoyer un test') : null,
      !locked ? el('button', { class: 'btn', onclick: () => scheduleDialog(c) }, 'Planifier') : null,
      !locked ? el('button', { class: 'btn primary', onclick: () => sendDialog(c) }, 'Envoyer…') : null);
  };

  const section = (title, value, ok, content) => {
    let open = false;
    const body = el('div', { class: 'wz-body', hidden: true });
    const valEl = el('div', { class: 'val', dir: 'auto' });
    const okEl = el('span', { class: 'ok' });
    const refresh = () => { const v = value(); valEl.textContent = v; okEl.className = `ok ${ok() ? 'yes' : ''}`; okEl.textContent = ok() ? '✓' : ''; };
    const btn = el('button', { class: 'btn sm', disabled: locked, onclick: () => { open = !open; body.hidden = !open; btn.textContent = open ? 'Fermer' : 'Modifier'; if (open && !body.childNodes.length) content(body, refresh); refresh(); } }, 'Modifier');
    const item = el('div', { class: 'wz-item' }, el('div', { class: 'wz-head' }, okEl, el('div', {}, el('h3', {}, title), valEl), el('span', { class: 'spacer' }), btn), body);
    refresh();
    item.refresh = refresh;
    return item;
  };

  // --- Destinataires ---
  let audCount = await api('audienceCount', c.audience);
  const audText = () => {
    const a = c.audience;
    const parts = [];
    if (a.lists.length) parts.push(`listes : ${a.lists.map((x) => lists.find((l) => l.id === x)?.name).filter(Boolean).join(', ')}`);
    if (a.tags.length) parts.push(`tags : ${a.tags.map((x) => tags.find((t) => t.id === x)?.name).filter(Boolean).join(', ')}`);
    if (a.segmentId) parts.push(`segment : ${segments.find((s) => s.id === a.segmentId)?.name || '?'}`);
    if (a.excludeTags.length) parts.push(`sauf tags : ${a.excludeTags.map((x) => tags.find((t) => t.id === x)?.name).join(', ')}`);
    return parts.length ? `${num(audCount)} abonné(s) — ${parts.join(' · ')}` : 'Choisissez à qui envoyer';
  };
  const audSec = section('Destinataires', audText, () => audCount > 0, (body, refresh) => {
    const recount = async () => { audCount = await api('audienceCount', c.audience); refresh(); save(); };
    const checks = (arr, items, label) => el('div', {}, el('h3', {}, label), items.length ? el('div', { class: 'row wrap' }, ...items.map(([v, l]) => {
      const cb = el('input', { type: 'checkbox', checked: arr.includes(v) });
      cb.addEventListener('change', () => { if (cb.checked) arr.push(v); else arr.splice(arr.indexOf(v), 1); recount(); });
      return el('label', { class: 'check', style: { marginRight: '14px' } }, cb, l);
    })) : el('p', { class: 'muted small' }, 'Aucun élément.'));
    const segSel = el('select', { style: { maxWidth: '320px' } }, el('option', { value: '' }, '— Aucun filtre —'), ...segments.map((s) => el('option', { value: s.id }, `${s.name} (${num(s.count)})`)));
    segSel.value = c.audience.segmentId || '';
    segSel.addEventListener('change', () => { c.audience.segmentId = segSel.value; recount(); });
    body.append(el('div', { class: 'stack' },
      checks(c.audience.lists, lists.map((l) => [l.id, `${l.name} (${num(l.subscribed)})`]), 'Listes'),
      checks(c.audience.tags, tags.map((t) => [t.id, `${t.name} (${num(t.count)})`]), 'Ou contacts ayant le tag'),
      el('div', {}, el('h3', {}, 'Filtrer avec un segment'), segSel),
      checks(c.audience.excludeTags, tags.map((t) => [t.id, t.name]), 'Exclure les contacts ayant le tag'),
      el('p', { class: 'muted small', style: { margin: 0 } }, 'Seuls les contacts « Abonné » reçoivent la campagne, une seule fois chacun même s’ils sont dans plusieurs listes.')));
  });

  // --- Expéditeur ---
  const fromSec = section('Expéditeur', () => (c.from_email ? `${c.from_name || ''} <${c.from_email}>${c.reply_to ? ` · réponse à ${c.reply_to}` : ''}` : 'Nom et adresse d’envoi'), () => !!c.from_email, (body, refresh) => {
    const f = (k, label, type = 'text') => { const i = el('input', { type, value: c[k] || '', dir: 'auto' }); i.addEventListener('input', () => { c[k] = i.value.trim(); refresh(); save(); }); return el('label', { class: 'f' }, label, i); };
    body.append(el('div', { class: 'grid3' }, f('from_name', 'Nom affiché'), f('from_email', 'Adresse d’expédition', 'email'), f('reply_to', 'Répondre à (facultatif)', 'email')),
      el('p', { class: 'muted small' }, 'L’adresse doit appartenir à un domaine vérifié dans Amazon SES (Paramètres → 3).'));
  });

  // --- Objet ---
  const subjSec = section('Objet', () => (c.subject ? `${c.subject}${c.preheader ? ` — ${c.preheader}` : ''}` : 'Objet et texte d’aperçu'), () => !!c.subject, (body, refresh) => {
    const subj = el('input', { type: 'text', value: c.subject, dir: 'auto', maxlength: 150 });
    const pre = el('input', { type: 'text', value: c.preheader, dir: 'auto', maxlength: 150 });
    const counter = el('span', { class: 'hint' });
    const upd = () => { counter.textContent = `${subj.value.length} caractères${subj.value.length > 60 ? ' — au-delà de ~60, l’objet est souvent tronqué sur mobile' : ''}`; };
    subj.addEventListener('input', () => { c.subject = subj.value; upd(); refresh(); save(); });
    pre.addEventListener('input', () => { c.preheader = pre.value; refresh(); save(); });
    upd();
    body.append(el('div', { class: 'stack' }, el('label', { class: 'f' }, 'Objet', subj, counter),
      el('label', { class: 'f' }, 'Texte d’aperçu', pre, el('span', { class: 'hint' }, 'Affiché après l’objet dans la boîte de réception.')),
      el('p', { class: 'muted small', style: { margin: 0 } }, 'Personnalisation possible : {{prenom}}, {{prenom|ami}} (valeur par défaut), {{nom}}, ou un champ personnalisé {{ville}}.')));
  });

  // --- Contenu ---
  const thumb = el('div');
  const drawThumb = async () => {
    thumb.innerHTML = '';
    if (!c.design?.blocks) return;
    await resolveAssets(c.design);
    const f = el('iframe', { class: 'preview-frame', sandbox: '', style: { height: '420px', pointerEvents: 'none' } });
    f.srcdoc = renderEmail(c.design, { resolve: resolveSrc });
    thumb.append(f);
  };
  const contentSec = section('Contenu', () => (c.design?.blocks ? `${c.design.blocks.length} blocs` : 'Concevez votre e-mail'), () => !!c.html, (body) => {
    body.append(el('div', { class: 'row', style: { marginBottom: '10px' } },
      el('button', { class: 'btn primary', onclick: async () => {
        let design = c.design?.blocks ? c.design : await chooseStarter();
        if (!design) return;
        const r = await openEditor({ design, title: `Contenu — ${c.name}` });
        if (!r) return;
        c.design = r.design; c.html = r.html;
        await api('saveCampaign', c);
        contentSec.refresh(); drawThumb();
      } }, c.design?.blocks ? 'Modifier le contenu' : 'Concevoir l’e-mail'),
      c.design?.blocks ? el('button', { class: 'btn', onclick: async () => { await resolveAssets(c.design); previewHtml(renderEmail(c.design, { resolve: resolveSrc })); } }, 'Aperçu') : null,
      c.design?.blocks ? el('button', { class: 'btn ghost', onclick: async () => { const d = await chooseStarter(); if (d && await confirmBox('Remplacer le contenu ?', 'Le contenu actuel sera remplacé.', 'Remplacer', true)) { c.design = d; c.html = renderEmail(d); await api('saveCampaign', c); window.dispatchEvent(new HashChangeEvent('hashchange')); } } }, 'Changer de mise en page') : null), thumb);
    drawThumb();
  });

  wiz.append(audSec, fromSec, subjSec, contentSec);
  drawHead();
  if (!settings.infra?.publicUrl) wiz.prepend(el('div', { class: 'note' }, 'L’infrastructure AWS n’est pas encore installée : vous pouvez préparer la campagne, mais pas l’envoyer. ', el('a', { href: '#/settings' }, 'Paramètres')));
}

async function testDialog(c) {
  await api('saveCampaign', c);
  const s = await api('settings');
  const input = el('input', { type: 'text', value: s.defaultFrom?.replyTo || s.defaultFrom?.email || '', placeholder: 'adresse1@…, adresse2@…' });
  modal({
    title: 'Envoyer un e-mail de test',
    body: el('div', { class: 'stack' }, el('label', { class: 'f' }, 'Destinataires (séparés par des virgules, 5 maximum)', input),
      el('p', { class: 'muted small', style: { margin: 0 } }, 'L’objet est préfixé par [TEST]. Si l’adresse n’est pas un contact, la personnalisation affiche « Prénom ». En mode bac à sable SES, l’adresse doit être vérifiée.')),
    actions: [{ label: 'Annuler' }, {
      label: 'Envoyer le test', kind: 'primary', onClick: async () => {
        const emails = input.value.split(/[,;\s]+/).filter(Boolean).slice(0, 5);
        if (!emails.length) throw new Error('Indiquez au moins une adresse.');
        await api('sendTest', c.id, emails);
        toast(`Test envoyé à ${emails.join(', ')}.`);
      },
    }],
  });
}

async function scheduleDialog(c) {
  await api('saveCampaign', c);
  const errs = await api('validateCampaign', c.id);
  if (errs.length) { modal({ title: 'Campagne incomplète', body: el('ul', {}, ...errs.map((e) => el('li', {}, e))) }); return; }
  const d = new Date(Date.now() + 3600e3); d.setMinutes(0, 0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  const input = el('input', { type: 'datetime-local', value: local });
  modal({
    title: 'Planifier l’envoi',
    body: el('div', { class: 'stack' }, el('label', { class: 'f' }, 'Date et heure (heure de cet ordinateur)', input),
      window.lynechat.web ? el('p', { class: 'muted small', style: { margin: 0 } }, 'L’envoi démarre automatiquement à l’heure choisie, même navigateur fermé.') : el('div', { class: 'note small' }, 'Lynechat doit être ouvert à cette heure-là : l’envoi démarre dès que l’application est ouverte si l’heure est dépassée.')),
    actions: [{ label: 'Annuler' }, { label: 'Planifier', kind: 'primary', onClick: async () => { await api('scheduleCampaign', c.id, new Date(input.value).toISOString()); toast('Campagne planifiée.'); location.hash = '#/campaigns'; } }],
  });
}

async function sendDialog(c) {
  await api('saveCampaign', c);
  const errs = await api('validateCampaign', c.id);
  if (errs.length) { modal({ title: 'Campagne incomplète', body: el('ul', {}, ...errs.map((e) => el('li', {}, e))) }); return; }
  const n = await api('audienceCount', c.audience);
  const acct = await api('awsAccount').catch(() => null);
  modal({
    title: 'Envoyer maintenant ?',
    body: el('div', { class: 'stack' },
      el('p', { style: { margin: 0 } }, `« ${c.subject} » sera envoyé à `, el('strong', {}, `${num(n)} abonné(s)`), ` depuis ${c.from_email}.`),
      acct && !acct.production ? el('div', { class: 'note err small' }, 'Compte SES en bac à sable : les adresses non vérifiées seront refusées. Demandez l’accès production avant un envoi réel.') : null,
      acct && acct.max24h && n > acct.max24h - acct.sent24h ? el('div', { class: 'note small' }, `Votre quota restant sur 24 h (${num(acct.max24h - acct.sent24h)}) est inférieur au nombre de destinataires : les envois au-delà échoueront.`) : null,
      el('p', { class: 'muted small', style: { margin: 0 } }, window.lynechat.web ? 'L’envoi continue sur le serveur même si vous fermez le navigateur. Vous pouvez le mettre en pause.' : 'Gardez Lynechat ouvert pendant l’envoi. Vous pouvez le mettre en pause.')),
    actions: [{ label: 'Annuler' }, { label: `Envoyer à ${num(n)} abonné(s)`, kind: 'primary', onClick: async () => { await api('sendCampaign', c.id); location.hash = `#/campaigns/${c.id}/report`; } }],
  });
}

export async function reportView(page, cid) {
  const c = await api('campaign', cid);
  if (!c) { page.append(el('div', { class: 'note err' }, 'Campagne introuvable.')); return; }
  const body = el('div');
  const badge = el('span', {}, campaignBadge(c.status));
  page.append(el('div', { class: 'page-head' }, el('a', { class: 'btn ghost', href: '#/campaigns' }, '←'), el('div', {}, el('h1', {}, c.name), el('div', { class: 'sub', dir: 'auto' }, c.subject)), badge, el('span', { class: 'spacer' }),
    el('button', { class: 'btn', onclick: async () => { await resolveAssets(c.design); previewHtml(renderEmail(c.design, { resolve: resolveSrc })); } }, 'Voir l’e-mail'),
    el('button', { class: 'btn', onclick: async () => { location.hash = `#/campaigns/${await api('duplicateCampaign', cid)}`; } }, 'Dupliquer')), body);

  const draw = async () => {
    const [st, cur] = await Promise.all([api('campaignStats', cid), api('campaign', cid)]);
    badge.innerHTML = ''; badge.append(campaignBadge(cur.status));
    body.innerHTML = '';
    if (['sending', 'paused'].includes(cur.status)) {
      const done = st.sent + st.failed;
      body.append(el('div', { class: 'card', style: { marginBottom: '16px' } },
        el('div', { class: 'row' }, el('h2', { style: { margin: 0 } }, cur.status === 'sending' ? 'Envoi en cours…' : 'Envoi en pause'), el('span', { class: 'spacer' }),
          cur.status === 'sending' ? el('button', { class: 'btn', onclick: (e) => run(e.target, () => api('pauseCampaign', cid)).then(draw) }, 'Mettre en pause') : el('button', { class: 'btn primary', onclick: (e) => run(e.target, () => api('sendCampaign', cid)).then(draw) }, 'Reprendre')),
        el('div', { class: 'progress', style: { margin: '12px 0 6px' } }, el('div', { style: { width: `${cur.total ? (done / cur.total) * 100 : 0}%` } })),
        el('div', { class: 'muted small' }, `${num(done)} / ${num(cur.total)} traités`),
        cur.error ? el('div', { class: 'note err', style: { marginTop: '10px' } }, cur.error) : null));
    }
    const k = (l, v, s) => el('div', { class: 'kpi' }, el('div', { class: 'l' }, l), el('div', { class: 'v' }, v), s ? el('div', { class: 's' }, s) : null);
    body.append(el('div', { class: 'grid4', style: { marginBottom: '14px' } },
      k('Envoyés', num(st.sent), `${num(st.delivered)} remis${st.failed ? ` · ${num(st.failed)} échecs` : ''}`),
      k('Ouvertures', pct(st.openRate), `${num(st.opens)} uniques · ${num(st.opensTotal)} au total`),
      k('Clics', pct(st.clickRate), `${num(st.clicks)} uniques · ${num(st.clicksTotal)} au total`),
      k('Désinscriptions', num(st.unsubscribes), `${num(st.bounces)} rebond(s) · ${num(st.complaints)} plainte(s)`)));
    body.append(el('div', { class: 'note info small', style: { marginBottom: '14px' } },
      'Les ouvertures sont indicatives : certaines messageries (Apple Mail notamment) préchargent les images et comptent des ouvertures automatiques ; d’autres bloquent les images. Les événements marqués comme robots par AWS sont exclus',
      st.botOpens ? ` (${num(st.botOpens)} ici)` : '', '. Les statistiques arrivent avec quelques secondes à quelques minutes de décalage.'));
    body.append(el('div', { class: 'grid2' },
      el('div', { class: 'card flush' }, el('div', { style: { padding: '16px 18px 6px' } }, el('h2', {}, 'Liens cliqués')),
        st.links.length ? el('div', { style: { padding: '0 18px 14px' } }, ...st.links.map((l) => el('div', { class: 'bar-row' },
          el('div', {}, el('div', { class: 'small', style: { wordBreak: 'break-all' } }, l.url), el('div', { class: 'bar', style: { width: `${(l.total / st.links[0].total) * 100}%` } })),
          el('div', { class: 'num small' }, `${num(l.uniq)} pers.`), el('div', { class: 'num small muted' }, `${num(l.total)} clics`)))) : el('div', { class: 'empty' }, 'Aucun clic pour l’instant.')),
      el('div', { class: 'card flush' }, el('div', { style: { padding: '16px 18px 6px' } }, el('h2', {}, 'Destinataires')), recipientsBox(cid))));
  };
  await draw();
  let t;
  const off = window.lynechat.on((m) => { if (['progress', 'events', 'campaigns'].includes(m.type)) { clearTimeout(t); t = setTimeout(draw, 800); } });
  return off;
}

function recipientsBox(cid) {
  const box = el('div');
  let filter = 'all';
  const draw = async () => {
    const rows = await api('campaignRecipients', cid, filter);
    box.innerHTML = '';
    box.append(el('div', { class: 'row wrap', style: { padding: '0 18px 10px' } }, ...[['all', 'Tous'], ['opened', 'Ont ouvert'], ['clicked', 'Ont cliqué'], ['bounced', 'Rebonds'], ['failed', 'Échecs']].map(([k, l]) => el('button', { class: `btn sm ${filter === k ? 'primary' : ''}`, onclick: () => { filter = k; draw(); } }, l))),
      rows.length ? el('div', { style: { maxHeight: '360px', overflow: 'auto' } }, el('table', { class: 't' }, el('tbody', {}, ...rows.map((r) => el('tr', {}, el('td', {}, r.email), el('td', { class: 'small muted' }, r.status === 'failed' ? `Échec : ${r.error || ''}` : r.status === 'queued' ? 'En attente' : fmtDate(r.sent_at)))))))
        : el('div', { class: 'empty' }, 'Personne dans cette catégorie.'));
  };
  draw();
  return box;
}
