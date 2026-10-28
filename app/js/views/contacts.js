import { api, el, toast, run, modal, confirmBox, promptBox, fmtDate, num, statusBadge, STATUS_LABEL, parseCsv } from '../ui.js';

let tab = 'contacts';
const state = { search: '', listId: '', tagId: '', segmentId: '', status: '', offset: 0, limit: 50 };

export async function contactsView(page) {
  const head = el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'Contacts'), el('div', { class: 'sub' }, 'Vos audiences, listes, tags et segments')), el('span', { class: 'spacer' }),
    el('button', { class: 'btn', onclick: () => importWizard(redraw) }, 'Importer un fichier CSV'),
    el('button', { class: 'btn primary', onclick: () => editContact(null, redraw) }, 'Ajouter un contact'));
  const tabs = el('div', { class: 'tabs' });
  const body = el('div');
  page.append(head, tabs, body);
  const redraw = async () => {
    tabs.innerHTML = '';
    for (const [k, l] of [['contacts', 'Tous les contacts'], ['lists', 'Listes'], ['tags', 'Tags'], ['segments', 'Segments']]) {
      tabs.append(el('button', { class: tab === k ? 'active' : '', onclick: () => { tab = k; redraw(); } }, l));
    }
    body.innerHTML = '';
    if (tab === 'contacts') await drawContacts(body, redraw);
    if (tab === 'lists') await drawLists(body, redraw);
    if (tab === 'tags') await drawTags(body, redraw);
    if (tab === 'segments') await drawSegments(body, redraw);
  };
  await redraw();
  return window.lynechat.on((m) => { if (m.type === 'contacts' && tab === 'contacts' && !document.querySelector('dialog, .drawer')) redraw(); });
}

async function drawContacts(body, redraw) {
  const [lists, tags, segments] = await Promise.all([api('lists'), api('tags'), api('segments')]);
  const data = await api('contacts', state);
  const selected = new Set();
  const search = el('input', { type: 'text', placeholder: 'Rechercher (e-mail, nom, téléphone)…', value: state.search, style: { maxWidth: '320px' } });
  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.search = search.value.trim(); state.offset = 0; redraw(); }, 300); });
  const sel = (key, opts, label) => {
    const s = el('select', { style: { width: 'auto' } }, el('option', { value: '' }, label), ...opts.map(([v, l]) => el('option', { value: v }, l)));
    s.value = state[key];
    s.addEventListener('change', () => { state[key] = s.value; state.offset = 0; redraw(); });
    return s;
  };
  const bulk = el('div', { class: 'row', hidden: true });
  const updBulk = () => { bulk.hidden = !selected.size; bulk.querySelector('b').textContent = `${selected.size} sélectionné(s)`; };
  bulk.append(el('b'),
    el('button', { class: 'btn sm', onclick: async () => { const l = await chooseFrom('Ajouter à la liste', lists.map((x) => [x.id, x.name])); if (l) { await run(null, () => api('bulkList', [...selected], l, false), 'Ajouté à la liste.'); redraw(); } } }, 'Ajouter à une liste'),
    el('button', { class: 'btn sm', onclick: async () => { const n = await promptBox('Ajouter un tag', 'Nom du tag'); if (n) { await run(null, () => api('bulkTag', [...selected], n, false), 'Tag ajouté.'); redraw(); } } }, 'Ajouter un tag'),
    el('button', { class: 'btn sm', onclick: async () => { if (await confirmBox('Désinscrire ?', `${selected.size} contact(s) ne recevront plus vos e-mails.`, 'Désinscrire')) { await run(null, () => api('setContactStatus', [...selected], 'unsubscribed')); redraw(); } } }, 'Désinscrire'),
    el('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox('Supprimer définitivement ?', `${selected.size} contact(s) et leur historique seront supprimés. Pour respecter une désinscription, préférez « Désinscrire ».`, 'Supprimer', true)) { await run(null, () => api('deleteContacts', [...selected])); redraw(); } } }, 'Supprimer'));

  body.append(el('div', { class: 'row wrap', style: { marginBottom: '12px' } }, search,
    sel('listId', lists.map((l) => [l.id, l.name]), 'Toutes les listes'),
    sel('tagId', tags.map((x) => [x.id, x.name]), 'Tous les tags'),
    sel('segmentId', segments.map((x) => [x.id, x.name]), 'Tous les segments'),
    sel('status', Object.entries(STATUS_LABEL).map(([k, [l]]) => [k, l]), 'Tous les statuts'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn sm ghost', onclick: async () => { const csv = await api('exportContacts', state); const p = await window.lynechat.saveFile('contacts.csv', '﻿' + csv, [{ name: 'CSV', extensions: ['csv'] }]); if (p) toast(`Exporté : ${p}`); } }, 'Exporter en CSV')),
  bulk);

  if (!data.total) {
    body.append(el('div', { class: 'card empty' }, el('h3', {}, state.search || state.listId || state.tagId || state.status || state.segmentId ? 'Aucun contact ne correspond.' : 'Aucun contact pour l’instant'),
      el('p', {}, 'Importez un fichier CSV (Excel → Enregistrer sous → CSV), ajoutez des contacts à la main, ou créez un formulaire d’inscription.')));
    return;
  }
  const all = el('input', { type: 'checkbox' });
  all.addEventListener('change', () => { for (const cb of body.querySelectorAll('tbody input[type=checkbox]')) { cb.checked = all.checked; cb.checked ? selected.add(cb.dataset.id) : selected.delete(cb.dataset.id); } updBulk(); });
  const table = el('table', { class: 't' },
    el('thead', {}, el('tr', {}, el('th', { style: { width: '36px' } }, all), el('th', {}, 'E-mail'), el('th', {}, 'Nom'), el('th', {}, 'Statut'), el('th', {}, 'Tags'), el('th', {}, 'Ajouté le'))),
    el('tbody', {}, ...data.rows.map((c) => {
      const cb = el('input', { type: 'checkbox', 'data-id': c.id });
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => { cb.checked ? selected.add(c.id) : selected.delete(c.id); updBulk(); });
      return el('tr', { class: 'click', onclick: () => contactDrawer(c.id, redraw) },
        el('td', {}, cb), el('td', {}, el('strong', {}, c.email)), el('td', { dir: 'auto' }, `${c.first_name} ${c.last_name}`.trim() || '—'),
        el('td', {}, statusBadge(c.status)), el('td', {}, ...c.tags.slice(0, 4).map((x) => el('span', { class: 'chip' }, x)), c.tags.length > 4 ? `+${c.tags.length - 4}` : ''),
        el('td', { class: 'muted small' }, fmtDate(c.created_at, false)));
    })));
  body.append(el('div', { class: 'card flush' }, table));
  const pages = Math.ceil(data.total / state.limit);
  const cur = Math.floor(state.offset / state.limit) + 1;
  body.append(el('div', { class: 'row', style: { marginTop: '10px' } }, el('span', { class: 'muted small' }, `${num(data.total)} contact(s)`), el('span', { class: 'spacer' }),
    el('button', { class: 'btn sm', disabled: cur <= 1, onclick: () => { state.offset -= state.limit; redraw(); } }, '← Précédent'),
    el('span', { class: 'small' }, `Page ${cur} / ${pages}`),
    el('button', { class: 'btn sm', disabled: cur >= pages, onclick: () => { state.offset += state.limit; redraw(); } }, 'Suivant →')));
}

function chooseFrom(title, options) {
  return new Promise((resolve) => {
    if (!options.length) { toast('Créez d’abord une liste (onglet Listes).', 'warn'); resolve(null); return; }
    const s = el('select', {}, ...options.map(([v, l]) => el('option', { value: v }, l)));
    let done = false;
    modal({ title, body: s, actions: [{ label: 'Annuler', onClick: () => { done = true; resolve(null); } }, { label: 'Valider', kind: 'primary', onClick: () => { done = true; resolve(s.value); } }], onClose: () => { if (!done) resolve(null); } });
  });
}

async function editContact(c, after) {
  const [lists, fieldsKeys] = await Promise.all([api('lists'), api('customFields')]);
  const d = c ? { ...c, fields: { ...c.fields } } : { email: '', first_name: '', last_name: '', phone: '', lang: 'fr', status: 'subscribed', fields: {} };
  const inp = (k, label, type = 'text') => { const i = el('input', { type, value: d[k] || '', dir: 'auto' }); i.addEventListener('input', () => { d[k] = i.value; }); return el('label', { class: 'f' }, label, i); };
  const lang = el('select', {}, el('option', { value: 'fr' }, 'Français'), el('option', { value: 'ar' }, 'العربية'), el('option', { value: 'en' }, 'English'));
  lang.value = d.lang; lang.addEventListener('change', () => { d.lang = lang.value; });
  const status = el('select', {}, ...Object.entries(STATUS_LABEL).map(([k, [l]]) => el('option', { value: k }, l)));
  status.value = d.status; status.addEventListener('change', () => { d.status = status.value; });
  const fieldsBox = el('div', { class: 'stack' });
  const drawFields = () => {
    fieldsBox.innerHTML = '';
    const keys = [...new Set([...fieldsKeys, ...Object.keys(d.fields)])];
    for (const k of keys) { const i = el('input', { type: 'text', value: d.fields[k] || '', dir: 'auto' }); i.addEventListener('input', () => { d.fields[k] = i.value; }); fieldsBox.append(el('label', { class: 'f' }, k, i)); }
    fieldsBox.append(el('button', { class: 'btn sm ghost', onclick: async () => { const k = await promptBox('Nouveau champ', 'Nom du champ (ex. ville, naissance)'); if (k) { await api('addCustomField', k); fieldsKeys.push(k); d.fields[k] = ''; drawFields(); } } }, '+ Nouveau champ personnalisé'));
  };
  drawFields();
  const listChecks = c ? null : el('div', { class: 'stack' }, ...lists.map((l) => el('label', { class: 'check' }, el('input', { type: 'checkbox', value: l.id }), l.name)));
  modal({
    title: c ? 'Modifier le contact' : 'Ajouter un contact',
    body: el('div', { class: 'stack' },
      inp('email', 'E-mail *', 'email'),
      el('div', { class: 'grid2' }, inp('first_name', 'Prénom'), inp('last_name', 'Nom')),
      el('div', { class: 'grid2' }, inp('phone', 'Téléphone'), el('label', { class: 'f' }, 'Langue', lang)),
      el('label', { class: 'f' }, 'Statut', status, !c ? el('span', { class: 'hint' }, 'N’ajoutez comme « Abonné » que des personnes ayant donné leur accord.') : null),
      el('h3', {}, 'Champs personnalisés'), fieldsBox,
      listChecks && lists.length ? el('h3', {}, 'Listes') : null, listChecks),
    actions: [{ label: 'Annuler' }, {
      label: 'Enregistrer', kind: 'primary', onClick: async () => {
        if (listChecks) d.listIds = [...listChecks.querySelectorAll('input:checked')].map((x) => x.value);
        await api('saveContact', d);
        toast('Contact enregistré.');
        after?.();
      },
    }],
  });
}

async function contactDrawer(cid, after) {
  document.querySelector('.drawer')?.remove();
  const c = await api('contact', cid);
  const [lists] = await Promise.all([api('lists')]);
  const close = () => { dr.remove(); after?.(); };
  const TYPE = { open: 'Ouverture', click: 'Clic', delivery: 'Remis', send: 'Envoyé', bounce: 'Rebond', complaint: 'Plainte', unsubscribe: 'Désinscription', reject: 'Refusé' };
  const dr = el('div', { class: 'drawer' },
    el('div', { class: 'modal-head' }, el('span', { dir: 'auto' }, `${c.first_name} ${c.last_name}`.trim() || c.email), el('span', { class: 'spacer' }), el('button', { class: 'icon-btn', onclick: close }, '✕')),
    el('div', { class: 'modal-body stack' },
      el('div', {}, el('div', { class: 'row' }, el('strong', {}, c.email), statusBadge(c.status)),
        el('div', { class: 'muted small' }, `Ajouté le ${fmtDate(c.created_at)} · source : ${c.source || '—'}`),
        c.consent_at ? el('div', { class: 'muted small' }, `Consentement : ${fmtDate(c.consent_at)} (${c.consent_source || '—'})`) : null),
      el('div', { class: 'row' }, el('button', { class: 'btn sm', onclick: () => { dr.remove(); editContact(c, after); } }, 'Modifier'),
        c.status === 'subscribed' ? el('button', { class: 'btn sm', onclick: async () => { await api('setContactStatus', [c.id], 'unsubscribed'); toast('Contact désinscrit.'); contactDrawer(cid, after); } }, 'Désinscrire') : null),
      c.phone ? el('div', {}, el('span', { class: 'muted' }, 'Téléphone : '), c.phone) : null,
      Object.keys(c.fields).length ? el('div', {}, el('h3', {}, 'Champs'), ...Object.entries(c.fields).map(([k, v]) => el('div', { class: 'small' }, el('span', { class: 'muted' }, `${k} : `), el('span', { dir: 'auto' }, v)))) : null,
      el('div', {}, el('h3', {}, 'Listes'), ...c.lists.map((l) => el('span', { class: 'chip' }, l.name, el('button', { title: 'Retirer', onclick: async () => { await api('bulkList', [c.id], l.id, true); contactDrawer(cid, after); } }, '✕'))),
        el('select', { style: { width: 'auto', marginTop: '6px' }, onchange: async (e) => { if (e.target.value) { await api('bulkList', [c.id], e.target.value, false); contactDrawer(cid, after); } } }, el('option', { value: '' }, '+ Ajouter à une liste'), ...lists.filter((l) => !c.lists.some((x) => x.id === l.id)).map((l) => el('option', { value: l.id }, l.name)))),
      el('div', {}, el('h3', {}, 'Tags'), ...c.tags.map((tg) => el('span', { class: 'chip' }, tg.name, el('button', { title: 'Retirer', onclick: async () => { await api('bulkTag', [c.id], tg.name, true); contactDrawer(cid, after); } }, '✕'))),
        el('button', { class: 'btn sm ghost', onclick: async () => { const n = await promptBox('Ajouter un tag', 'Nom du tag'); if (n) { await api('bulkTag', [c.id], n, false); contactDrawer(cid, after); } } }, '+ Tag')),
      el('div', {}, el('h3', {}, 'Activité'), c.activity.length ? el('div', { class: 'stack', style: { gap: '6px' } }, ...c.activity.map((a) => el('div', { class: 'small' },
        el('span', { class: 'badge' }, TYPE[a.type] || a.type), ' ', a.campaign || a.automation || '', a.url ? el('div', { class: 'muted', style: { wordBreak: 'break-all' } }, a.url) : null, el('div', { class: 'muted' }, fmtDate(a.at))))) : el('p', { class: 'muted small' }, 'Aucune activité.'))));
  document.body.append(dr);
}

async function drawLists(body, redraw) {
  const lists = await api('lists');
  body.append(el('div', { class: 'row', style: { marginBottom: '12px' } }, el('p', { class: 'muted', style: { margin: 0 } }, 'Une liste regroupe des contacts (ex. « Clients », « Prospects salon 2026 »). Un contact peut être dans plusieurs listes.'), el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: async () => { const n = await promptBox('Nouvelle liste', 'Nom de la liste'); if (n) { await api('createList', n); redraw(); } } }, 'Créer une liste')));
  if (!lists.length) { body.append(el('div', { class: 'card empty' }, 'Aucune liste.')); return; }
  body.append(el('div', { class: 'card flush' }, el('table', { class: 't' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Liste'), el('th', { class: 'num' }, 'Abonnés'), el('th', { class: 'num' }, 'Total'), el('th', {}, ''))),
    el('tbody', {}, ...lists.map((l) => el('tr', {}, el('td', {}, el('strong', {}, l.name)), el('td', { class: 'num' }, num(l.subscribed)), el('td', { class: 'num' }, num(l.count)),
      el('td', { class: 'num' },
        el('button', { class: 'btn sm ghost', onclick: () => { state.listId = l.id; tab = 'contacts'; redraw(); } }, 'Voir'),
        el('button', { class: 'btn sm ghost', onclick: async () => { const n = await promptBox('Renommer', 'Nom', l.name); if (n) { await api('renameList', l.id, n, l.description); redraw(); } } }, 'Renommer'),
        el('button', { class: 'btn sm ghost danger', onclick: async () => { if (await confirmBox('Supprimer la liste ?', 'Les contacts ne sont pas supprimés, ils sont seulement retirés de la liste.', 'Supprimer', true)) { await api('deleteList', l.id); redraw(); } } }, 'Supprimer'))))))));
}

async function drawTags(body, redraw) {
  const tags = await api('tags');
  body.append(el('div', { class: 'row', style: { marginBottom: '12px' } }, el('p', { class: 'muted', style: { margin: 0 } }, 'Les tags qualifient vos contacts (ex. « vip », « intéressé-promo »). Ils servent aux segments, aux campagnes et aux automatisations.'), el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: async () => { const n = await promptBox('Nouveau tag', 'Nom du tag'); if (n) { await api('createTag', n); redraw(); } } }, 'Créer un tag')));
  if (!tags.length) { body.append(el('div', { class: 'card empty' }, 'Aucun tag.')); return; }
  body.append(el('div', { class: 'card flush' }, el('table', { class: 't' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Tag'), el('th', { class: 'num' }, 'Contacts'), el('th', {}, ''))),
    el('tbody', {}, ...tags.map((x) => el('tr', {}, el('td', {}, el('span', { class: 'chip' }, x.name)), el('td', { class: 'num' }, num(x.count)),
      el('td', { class: 'num' }, el('button', { class: 'btn sm ghost', onclick: () => { state.tagId = x.id; tab = 'contacts'; redraw(); } }, 'Voir'),
        el('button', { class: 'btn sm ghost danger', onclick: async () => { if (await confirmBox('Supprimer le tag ?', 'Il sera retiré de tous les contacts.', 'Supprimer', true)) { await api('deleteTag', x.id); redraw(); } } }, 'Supprimer'))))))));
}

// ---------- segments ----------
export async function segmentEditor(seg, after) {
  const [lists, tags, keys, campaigns] = await Promise.all([api('lists'), api('tags'), api('customFields'), api('campaigns')]);
  const s = structuredClone(seg || { name: 'Nouveau segment', rules: { match: 'all', conditions: [{ field: 'email', op: 'contains', value: '' }] } });
  const FIELDS = [['email', 'E-mail'], ['first_name', 'Prénom'], ['last_name', 'Nom'], ['phone', 'Téléphone'], ['lang', 'Langue'], ['source', 'Source'],
    ...keys.map((k) => [`custom:${k}`, `Champ : ${k}`]), ['list', 'Liste'], ['tag', 'Tag'], ['created_at', 'Date d’ajout'], ['activity', 'Activité e-mail']];
  const TEXT_OPS = [['eq', 'est'], ['neq', 'n’est pas'], ['contains', 'contient'], ['not_contains', 'ne contient pas'], ['starts', 'commence par'], ['ends', 'se termine par'], ['empty', 'est vide'], ['not_empty', 'n’est pas vide']];
  const name = el('input', { type: 'text', value: s.name });
  const match = el('select', { style: { width: 'auto' } }, el('option', { value: 'all' }, 'toutes les conditions'), el('option', { value: 'any' }, 'au moins une condition'));
  match.value = s.rules.match;
  const box = el('div', { class: 'stack' });
  const count = el('strong', {}, '…');
  let t;
  const recount = () => { clearTimeout(t); t = setTimeout(async () => { count.textContent = num(await api('countSegment', s.rules)); }, 200); };
  const draw = () => {
    box.innerHTML = '';
    s.rules.conditions.forEach((c, i) => {
      const fieldKey = c.field === 'custom' ? `custom:${c.key}` : c.field;
      const f = el('select', {}, ...FIELDS.map(([v, l]) => el('option', { value: v }, l)));
      f.value = fieldKey;
      f.addEventListener('change', () => {
        const v = f.value;
        if (v.startsWith('custom:')) Object.assign(c, { field: 'custom', key: v.slice(7), op: 'eq', value: '' });
        else Object.assign(c, { field: v, key: undefined, op: { list: 'in', tag: 'has', created_at: 'within_days', activity: 'opened' }[v] || 'eq', value: { list: lists[0]?.id, tag: tags[0]?.id, created_at: 30, activity: 'any' }[v] ?? '' });
        draw(); recount();
      });
      let ops, valInput;
      if (c.field === 'list') { ops = [['in', 'est dans'], ['not_in', 'n’est pas dans']]; valInput = el('select', {}, ...lists.map((l) => el('option', { value: l.id }, l.name))); }
      else if (c.field === 'tag') { ops = [['has', 'a le tag'], ['not_has', 'n’a pas le tag']]; valInput = el('select', {}, ...tags.map((x) => el('option', { value: x.id }, x.name))); }
      else if (c.field === 'created_at') { ops = [['within_days', 'dans les N derniers jours'], ['before', 'avant le'], ['after', 'après le']]; valInput = el('input', { type: c.op === 'within_days' ? 'number' : 'date' }); }
      else if (c.field === 'activity') {
        ops = [['opened', 'a ouvert'], ['not_opened', 'n’a pas ouvert'], ['clicked', 'a cliqué'], ['not_clicked', 'n’a pas cliqué']];
        valInput = el('select', {}, el('option', { value: 'any' }, 'n’importe quelle campagne'), ...campaigns.filter((x) => x.status === 'sent').map((x) => el('option', { value: x.id }, x.name)));
      } else if (c.field === 'lang') { ops = [['eq', 'est'], ['neq', 'n’est pas']]; valInput = el('select', {}, el('option', { value: 'fr' }, 'Français'), el('option', { value: 'ar' }, 'العربية'), el('option', { value: 'en' }, 'English')); }
      else { ops = TEXT_OPS; valInput = el('input', { type: 'text', dir: 'auto' }); }
      const op = el('select', {}, ...ops.map(([v, l]) => el('option', { value: v }, l)));
      op.value = c.op;
      op.addEventListener('change', () => { c.op = op.value; if (c.field === 'created_at') { c.value = c.op === 'within_days' ? 30 : ''; draw(); } recount(); });
      valInput.value = c.value ?? '';
      valInput.addEventListener('input', () => { c.value = valInput.value; recount(); });
      valInput.addEventListener('change', () => { c.value = valInput.value; recount(); });
      if (['empty', 'not_empty'].includes(c.op)) valInput.hidden = true;
      const days = c.field === 'activity' ? (() => { const dI = el('input', { type: 'number', min: 0, value: c.days || '', placeholder: 'sur N jours (vide = toujours)', style: { width: '170px' } }); dI.addEventListener('input', () => { c.days = Number(dI.value) || 0; recount(); }); return dI; })() : null;
      box.append(el('div', { class: 'row' }, f, op, valInput, days, el('button', { class: 'icon-btn', title: 'Retirer', onclick: () => { s.rules.conditions.splice(i, 1); draw(); recount(); } }, '✕')));
    });
    box.append(el('button', { class: 'btn sm', onclick: () => { s.rules.conditions.push({ field: 'email', op: 'contains', value: '' }); draw(); } }, '+ Ajouter une condition'));
  };
  match.addEventListener('change', () => { s.rules.match = match.value; recount(); });
  draw(); recount();
  modal({
    title: seg ? 'Modifier le segment' : 'Nouveau segment', size: 'wide',
    body: el('div', { class: 'stack' }, el('label', { class: 'f' }, 'Nom', name), el('div', { class: 'row' }, 'Contacts qui remplissent', match), box,
      el('div', { class: 'note info' }, 'Contacts correspondants : ', count, ' (tous statuts ; seuls les abonnés reçoivent les campagnes).')),
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', kind: 'primary', onClick: async () => { s.name = name.value.trim() || 'Segment'; await api('saveSegment', s); after?.(); } }],
  });
}

async function drawSegments(body, redraw) {
  const segs = await api('segments');
  body.append(el('div', { class: 'row', style: { marginBottom: '12px' } }, el('p', { class: 'muted', style: { margin: 0 } }, 'Un segment se met à jour tout seul selon des règles (ex. « a ouvert la dernière campagne » et « ville = Casablanca »).'), el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: () => segmentEditor(null, redraw) }, 'Créer un segment')));
  if (!segs.length) { body.append(el('div', { class: 'card empty' }, 'Aucun segment.')); return; }
  body.append(el('div', { class: 'card flush' }, el('table', { class: 't' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Segment'), el('th', {}, 'Règles'), el('th', { class: 'num' }, 'Contacts'), el('th', {}, ''))),
    el('tbody', {}, ...segs.map((x) => el('tr', {}, el('td', {}, el('strong', {}, x.name)), el('td', { class: 'muted small' }, `${x.rules.conditions.length} condition(s), ${x.rules.match === 'any' ? 'au moins une' : 'toutes'}`), el('td', { class: 'num' }, num(x.count)),
      el('td', { class: 'num' }, el('button', { class: 'btn sm ghost', onclick: () => { state.segmentId = x.id; tab = 'contacts'; redraw(); } }, 'Voir'),
        el('button', { class: 'btn sm ghost', onclick: () => segmentEditor(x, redraw) }, 'Modifier'),
        el('button', { class: 'btn sm ghost danger', onclick: async () => { if (await confirmBox('Supprimer le segment ?', 'Les contacts ne sont pas supprimés.', 'Supprimer', true)) { await api('deleteSegment', x.id); redraw(); } } }, 'Supprimer'))))))));
}

// ---------- import CSV ----------
async function importWizard(after) {
  const input = el('input', { type: 'file', accept: '.csv,text/csv,.txt' });
  const stage = el('div', { class: 'stack' });
  let parsed = null;
  const opts = { listIds: [], tagIds: [], status: 'subscribed', updateExisting: true };
  const [lists, keys] = await Promise.all([api('lists'), api('customFields')]);
  const guess = (h) => {
    const x = h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    if (/e-?mail|courriel|mail/.test(x)) return 'email';
    if (/^(prenom|first.?name|firstname|الاسم)$/.test(x) || /prenom/.test(x)) return 'first_name';
    if (/^(nom|last.?name|lastname|nom de famille)$/.test(x)) return 'last_name';
    if (/tel|phone|mobile|gsm|whatsapp/.test(x)) return 'phone';
    if (/^(langue|lang|language)$/.test(x)) return 'lang';
    if (/^tags?$/.test(x)) return 'tags';
    return `custom:${h.trim()}`;
  };
  const mapping = {};
  const TARGETS = [['', '— Ignorer —'], ['email', 'E-mail'], ['first_name', 'Prénom'], ['last_name', 'Nom'], ['phone', 'Téléphone'], ['lang', 'Langue'], ['tags', 'Tags (séparés par ; ou ,)']];
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    let text = await f.text();
    if (text.includes('�')) { // fichier Excel « ANSI » (Windows-1252)
      text = new TextDecoder('windows-1252').decode(await f.arrayBuffer());
    }
    parsed = parseCsv(text);
    stage.innerHTML = '';
    if (!parsed.rows.length) { stage.append(el('div', { class: 'note err' }, 'Fichier vide ou illisible.')); return; }
    for (const h of parsed.head) mapping[h] = guess(h);
    stage.append(el('p', { style: { margin: 0 } }, `${num(parsed.rows.length)} lignes, ${parsed.head.length} colonnes. Associez chaque colonne à un champ :`),
      el('table', { class: 't' }, el('thead', {}, el('tr', {}, el('th', {}, 'Colonne du fichier'), el('th', {}, 'Exemple'), el('th', {}, 'Champ Lynechat'))),
        el('tbody', {}, ...parsed.head.map((h) => {
          const s = el('select', {}, ...TARGETS.map(([v, l]) => el('option', { value: v }, l)), ...[...new Set([...keys, h.trim()])].map((k) => el('option', { value: `custom:${k}` }, `Champ personnalisé : ${k}`)));
          s.value = mapping[h];
          s.addEventListener('change', () => { mapping[h] = s.value; });
          return el('tr', {}, el('td', {}, el('strong', {}, h)), el('td', { class: 'muted small', dir: 'auto' }, String(parsed.rows[0][h] ?? '').slice(0, 40)), el('td', {}, s));
        }))),
      el('div', { class: 'grid2' },
        el('label', { class: 'f' }, 'Ajouter à la liste', (() => { const s = el('select', {}, el('option', { value: '' }, '— Aucune —'), ...lists.map((l) => el('option', { value: l.id }, l.name)), el('option', { value: '__new' }, '+ Nouvelle liste…')); s.addEventListener('change', async () => { if (s.value === '__new') { const n = await promptBox('Nouvelle liste', 'Nom'); if (n) { const lid = await api('createList', n); s.append(el('option', { value: lid }, n)); s.value = lid; } else s.value = ''; } opts.listIds = s.value ? [s.value] : []; }); return s; })()),
        el('label', { class: 'f' }, 'Statut des contacts importés', (() => { const s = el('select', {}, el('option', { value: 'subscribed' }, 'Abonnés (ils ont donné leur accord)'), el('option', { value: 'unsubscribed' }, 'Non abonnés (fichier de référence)')); s.addEventListener('change', () => { opts.status = s.value; }); return s; })())),
      el('label', { class: 'check' }, (() => { const c = el('input', { type: 'checkbox', checked: true }); c.addEventListener('change', () => { opts.updateExisting = c.checked; }); return c; })(), 'Mettre à jour les contacts déjà présents'),
      el('div', { class: 'note small' }, 'N’importez comme « abonnés » que des personnes ayant accepté de recevoir vos e-mails. Les contacts déjà désinscrits ou en échec ne sont jamais réabonnés par un import.'));
  });
  stage.append(el('p', { class: 'muted', style: { margin: 0 } }, 'Depuis Excel : Fichier → Enregistrer sous → « CSV UTF-8 ». Une colonne e-mail est obligatoire.'));
  modal({
    title: 'Importer des contacts', size: 'wide',
    body: el('div', { class: 'stack' }, input, stage),
    actions: [{ label: 'Annuler' }, {
      label: 'Importer', kind: 'primary', onClick: async () => {
        if (!parsed) throw new Error('Choisissez un fichier.');
        if (!Object.values(mapping).includes('email')) throw new Error('Associez une colonne au champ E-mail.');
        for (const v of Object.values(mapping)) if (v.startsWith('custom:')) await api('addCustomField', v.slice(7));
        const r = await api('importContacts', parsed.rows, mapping, opts);
        modal({ title: 'Import terminé', body: el('div', { class: 'stack' },
          el('div', {}, `${num(r.created)} contact(s) créé(s), ${num(r.updated)} mis à jour, ${num(r.skipped)} ignoré(s).`),
          r.blocked ? el('div', { class: 'note small' }, `${num(r.blocked)} contact(s) déjà désinscrits ou en échec : leur statut n’a pas été changé.`) : null,
          r.invalid.length ? el('div', { class: 'note err small' }, `${r.invalid.length} ligne(s) avec une adresse invalide : `, r.invalid.slice(0, 10).map((x) => `ligne ${x.line} (${x.email || 'vide'})`).join(', '), r.invalid.length > 10 ? '…' : '') : null,
          el('div', { class: 'muted small' }, 'Les contacts importés ne déclenchent pas les automatisations. Pour les y inscrire, utilisez « Inscrire des contacts existants » dans l’automatisation.')) });
        after?.();
      },
    }],
  });
}

export { editContact };
