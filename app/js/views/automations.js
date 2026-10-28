import { api, el, toast, run, modal, confirmBox, promptBox, num, pct } from '../ui.js';
import { openEditor, chooseStarter } from '../editor.js';
import { bid } from '../email-html.js';

const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const TRIGGERS = [
  ['list_join', 'Un contact rejoint une liste'],
  ['tag_added', 'Un tag est ajouté à un contact'],
  ['form', 'Un contact s’inscrit via un formulaire'],
  ['date', 'Date anniversaire (champ date du contact)'],
  ['manual', 'Inscription manuelle uniquement'],
];
const RECIPES = [
  { name: 'Bienvenue (3 e-mails)', trigger: { type: 'list_join' }, steps: () => [
    { id: bid(), type: 'email', subject: 'Bienvenue {{prenom|}} !', condition: 'always' },
    { id: bid(), type: 'wait', amount: 2, unit: 'days' },
    { id: bid(), type: 'email', subject: 'Ce que nous pouvons faire pour vous', condition: 'always' },
    { id: bid(), type: 'wait', amount: 3, unit: 'days' },
    { id: bid(), type: 'email', subject: 'Une offre pour bien commencer', condition: 'always' },
  ] },
  { name: 'Relance des non-ouvreurs', trigger: { type: 'tag_added' }, steps: () => [
    { id: bid(), type: 'email', subject: 'Votre message', condition: 'always' },
    { id: bid(), type: 'wait', amount: 3, unit: 'days' },
    { id: bid(), type: 'email', subject: 'Vous l’avez peut-être manqué', condition: 'not_opened' },
  ] },
  { name: 'Anniversaire', trigger: { type: 'date', field: 'naissance' }, steps: () => [
    { id: bid(), type: 'email', subject: 'Joyeux anniversaire {{prenom|}} 🎉', condition: 'always' },
  ] },
];

export async function automationsView(page) {
  const list = await api('automations');
  page.append(el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'Automatisations'), el('div', { class: 'sub' }, 'Séquences envoyées automatiquement selon un déclencheur')), el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: () => newAutomation() }, 'Créer une automatisation')));
  if (!window.lynechat.web) page.append(el('div', { class: 'note info', style: { marginBottom: '14px' } }, 'Les automatisations tournent tant que Lynechat est ouvert sur cet ordinateur. Si l’application est fermée, les étapes en retard partent à la réouverture.'));
  if (!list.length) { page.append(el('div', { class: 'card empty' }, el('h3', {}, 'Aucune automatisation'), el('p', {}, 'Exemples : e-mail de bienvenue, relance, anniversaire, suivi après un formulaire.'))); return; }
  page.append(el('div', { class: 'card flush' }, el('table', { class: 't' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Automatisation'), el('th', {}, 'Déclencheur'), el('th', {}, 'Statut'), el('th', { class: 'num' }, 'En cours'), el('th', { class: 'num' }, 'Terminés'))),
    el('tbody', {}, ...list.map((a) => el('tr', { class: 'click', onclick: () => { location.hash = `#/automations/${a.id}`; } },
      el('td', {}, el('strong', {}, a.name), el('div', { class: 'muted small' }, `${a.steps.filter((s) => s.type === 'email').length} e-mail(s)`)),
      el('td', { class: 'small' }, TRIGGERS.find(([k]) => k === a.trigger.type)?.[1] || '—'),
      el('td', {}, el('span', { class: `badge ${a.status === 'active' ? 'green' : a.status === 'paused' ? 'amber' : ''}` }, { active: 'Active', paused: 'En pause', draft: 'Brouillon' }[a.status])),
      el('td', { class: 'num' }, num(a.active)), el('td', { class: 'num' }, num(a.done))))))));
}

async function newAutomation() {
  const name = el('input', { type: 'text', value: 'Nouvelle automatisation' });
  let recipe = null;
  const cards = el('div', { class: 'grid3' }, el('button', { class: 'card', style: { textAlign: 'left', cursor: 'pointer', outline: '2px solid var(--accent)' }, onclick: (e) => pick(e, null) }, el('strong', {}, 'Vide'), el('div', { class: 'muted small' }, 'Je construis moi-même')),
    ...RECIPES.map((r) => el('button', { class: 'card', style: { textAlign: 'left', cursor: 'pointer' }, onclick: (e) => pick(e, r) }, el('strong', {}, r.name), el('div', { class: 'muted small' }, `${r.steps().filter((s) => s.type === 'email').length} e-mail(s)`))));
  function pick(e, r) { recipe = r; for (const b of cards.children) b.style.outline = ''; e.currentTarget.style.outline = '2px solid var(--accent)'; if (r) name.value = r.name; }
  modal({
    title: 'Nouvelle automatisation', size: 'wide',
    body: el('div', { class: 'stack' }, el('label', { class: 'f' }, 'Nom', name), el('h3', {}, 'Point de départ'), cards),
    actions: [{ label: 'Annuler' }, { label: 'Créer', kind: 'primary', onClick: async () => { const aid = await api('createAutomation', name.value.trim() || 'Automatisation', recipe?.trigger || { type: 'list_join' }, recipe ? recipe.steps() : []); location.hash = `#/automations/${aid}`; } }],
  });
}

export async function automationView(page, aid) {
  const a = await api('automation', aid);
  if (!a) { page.append(el('div', { class: 'note err' }, 'Automatisation introuvable.')); return; }
  const [lists, tags, forms, keys] = await Promise.all([api('lists'), api('tags'), api('forms'), api('customFields')]);
  const active = a.status === 'active';
  let saveT;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => api('saveAutomation', a).catch((e) => toast(e.message, 'err')), 300); };

  const name = el('input', { type: 'text', value: a.name, class: 'title-input' });
  name.addEventListener('change', () => { a.name = name.value.trim() || 'Automatisation'; save(); });
  page.append(el('div', { class: 'page-head' }, el('a', { class: 'btn ghost', href: '#/automations' }, '←'), name,
    el('span', { class: `badge ${active ? 'green' : a.status === 'paused' ? 'amber' : ''}` }, { active: 'Active', paused: 'En pause', draft: 'Brouillon' }[a.status]), el('span', { class: 'spacer' }),
    el('button', { class: 'btn', onclick: () => enrollDialog(a, lists, tags) }, 'Inscrire des contacts existants'),
    active ? el('button', { class: 'btn', onclick: (e) => run(e.target, async () => { await api('setAutomationStatus', aid, 'paused'); rerender(); }) }, 'Mettre en pause')
      : el('button', { class: 'btn primary', onclick: (e) => run(e.target, async () => { await api('saveAutomation', a); await api('setAutomationStatus', aid, 'active'); rerender(); }, 'Automatisation activée.') }, 'Activer'),
    el('button', { class: 'btn ghost danger', onclick: async () => { if (await confirmBox('Supprimer l’automatisation ?', 'Les contacts en cours de séquence n’y recevront plus rien.', 'Supprimer', true)) { await api('deleteAutomation', aid); location.hash = '#/automations'; } } }, 'Supprimer')));
  if (active) page.append(el('div', { class: 'note', style: { marginBottom: '14px' } }, 'Automatisation active : vos modifications s’appliquent immédiatement aux contacts en cours (y compris les e-mails modifiés).'));

  // Expéditeur
  const f = (k, label, type = 'text') => { const i = el('input', { type, value: a[k] || '', dir: 'auto' }); i.addEventListener('input', () => { a[k] = i.value.trim(); save(); }); return el('label', { class: 'f' }, label, i); };
  page.append(el('div', { class: 'card', style: { marginBottom: '16px' } }, el('h2', {}, 'Expéditeur'), el('div', { class: 'grid3' }, f('from_name', 'Nom affiché'), f('from_email', 'Adresse d’expédition', 'email'), f('reply_to', 'Répondre à', 'email'))));

  const flow = el('div', { class: 'flow' });
  page.append(flow);
  const draw = () => {
    flow.innerHTML = '';
    // Déclencheur
    const t = a.trigger;
    const tSel = el('select', {}, ...TRIGGERS.map(([k, l]) => el('option', { value: k }, l)));
    tSel.value = t.type;
    tSel.addEventListener('change', () => { a.trigger = { type: tSel.value }; save(); draw(); });
    const extra = [];
    const sel = (key, items, empty) => { const s = el('select', {}, el('option', { value: '' }, empty), ...items.map(([v, l]) => el('option', { value: v }, l))); s.value = t[key] || ''; s.addEventListener('change', () => { t[key] = s.value; save(); }); return s; };
    if (t.type === 'list_join') extra.push(sel('listId', lists.map((l) => [l.id, l.name]), '— Choisir la liste —'));
    if (t.type === 'tag_added') extra.push(sel('tagId', tags.map((x) => [x.id, x.name]), '— Choisir le tag —'));
    if (t.type === 'form') extra.push(sel('formId', forms.map((x) => [x.id, x.name]), '— Choisir le formulaire —'));
    if (t.type === 'date') extra.push(sel('field', keys.map((k) => [k, k]), '— Champ date du contact —'), el('div', { class: 'muted small' }, 'Format accepté : AAAA-MM-JJ ou JJ/MM. L’e-mail part le jour anniversaire, une fois par an.'));
    if (['list_join', 'tag_added', 'form'].includes(t.type)) {
      const re = el('input', { type: 'checkbox', checked: !!t.allowReentry });
      re.addEventListener('change', () => { t.allowReentry = re.checked; save(); });
      extra.push(el('label', { class: 'check small' }, re, 'Autoriser un contact à refaire la séquence s’il se réinscrit'));
    }
    flow.append(el('div', { class: 'flow-node trigger' }, el('div', { class: 'kind' }, 'Déclencheur'), el('div', { class: 'stack', style: { marginTop: '8px' } }, tSel, ...extra)));
    // Étapes
    flow.append(addBtn(0));
    a.steps.forEach((s, i) => {
      flow.append(stepNode(s, i), addBtn(i + 1));
    });
  };
  const addBtn = (index) => el('div', { style: { display: 'grid', justifyItems: 'center' } }, el('div', { class: 'flow-line' }),
    el('button', { class: 'flow-add', onclick: () => addStepMenu(index) }, '+ Ajouter une étape'), el('div', { class: 'flow-line' }));

  const addStepMenu = (index) => {
    const m = modal({
      title: 'Ajouter une étape',
      body: el('div', { class: 'grid2' }, ...[
        ['email', 'Envoyer un e-mail', 'Un e-mail conçu avec l’éditeur'],
        ['wait', 'Attendre', 'Minutes, heures ou jours'],
        ['tag', 'Ajouter / retirer un tag', 'Qualifier le contact'],
        ['list', 'Ajouter / retirer d’une liste', 'Déplacer le contact'],
      ].map(([type, l, d]) => el('button', { class: 'card', style: { textAlign: 'left', cursor: 'pointer' }, onclick: () => {
        const st = { id: bid(), type };
        if (type === 'email') Object.assign(st, { subject: '', condition: 'always' });
        if (type === 'wait') Object.assign(st, { amount: 1, unit: 'days' });
        if (type === 'tag') Object.assign(st, { action: 'add', tagId: tags[0]?.id || '' });
        if (type === 'list') Object.assign(st, { action: 'add', listId: lists[0]?.id || '' });
        a.steps.splice(index, 0, st); save(); draw(); m.close();
      } }, el('strong', {}, l), el('div', { class: 'muted small' }, d)))),
    });
  };

  const stepNode = (s, i) => {
    const tools = el('div', { class: 'row', style: { position: 'absolute', top: '10px', right: '10px', gap: '2px' } },
      el('button', { class: 'icon-btn', title: 'Monter', onclick: () => { if (i > 0) { [a.steps[i - 1], a.steps[i]] = [a.steps[i], a.steps[i - 1]]; save(); draw(); } } }, '↑'),
      el('button', { class: 'icon-btn', title: 'Descendre', onclick: () => { if (i < a.steps.length - 1) { [a.steps[i + 1], a.steps[i]] = [a.steps[i], a.steps[i + 1]]; save(); draw(); } } }, '↓'),
      el('button', { class: 'icon-btn', title: 'Supprimer', onclick: async () => { if (await confirmBox('Supprimer cette étape ?', 'Les contacts déjà passés par cette étape ne sont pas affectés.', 'Supprimer', true)) { a.steps.splice(i, 1); save(); draw(); } } }, '✕'));
    const waiting = a.waiting?.[i] ? el('div', { class: 'small muted', style: { marginTop: '6px' } }, `${num(a.waiting[i])} contact(s) en attente avant cette étape`) : null;
    if (s.type === 'wait') {
      const amt = el('input', { type: 'number', min: 0, value: s.amount, style: { width: '90px' } });
      const unit = el('select', { style: { width: 'auto' } }, el('option', { value: 'minutes' }, 'minute(s)'), el('option', { value: 'hours' }, 'heure(s)'), el('option', { value: 'days' }, 'jour(s)'));
      unit.value = s.unit;
      amt.addEventListener('input', () => { s.amount = Number(amt.value) || 0; save(); });
      unit.addEventListener('change', () => { s.unit = unit.value; save(); });
      return el('div', { class: 'flow-node wait' }, tools, el('div', { class: 'kind' }, 'Attente'), el('div', { class: 'row', style: { marginTop: '8px' } }, 'Attendre', amt, unit), waiting);
    }
    if (s.type === 'tag' || s.type === 'list') {
      const act = el('select', { style: { width: 'auto' } }, el('option', { value: 'add' }, 'Ajouter'), el('option', { value: 'remove' }, 'Retirer'));
      act.value = s.action;
      act.addEventListener('change', () => { s.action = act.value; save(); });
      const items = s.type === 'tag' ? tags.map((x) => [x.id, x.name]) : lists.map((x) => [x.id, x.name]);
      const target = el('select', {}, ...items.map(([v, l]) => el('option', { value: v }, l)));
      target.value = s.type === 'tag' ? s.tagId : s.listId;
      target.addEventListener('change', () => { if (s.type === 'tag') s.tagId = target.value; else s.listId = target.value; save(); });
      const newTag = s.type === 'tag' ? el('button', { class: 'btn sm ghost', onclick: async () => { const n = await promptBox('Nouveau tag', 'Nom'); if (n) { const tid = await api('createTag', n); tags.push({ id: tid, name: n }); s.tagId = tid; save(); draw(); } } }, '+ Nouveau tag') : null;
      return el('div', { class: 'flow-node action' }, tools, el('div', { class: 'kind' }, s.type === 'tag' ? 'Tag' : 'Liste'), el('div', { class: 'row', style: { marginTop: '8px' } }, act, target, newTag), waiting);
    }
    // e-mail
    const subj = el('input', { type: 'text', value: s.subject || '', placeholder: 'Objet de l’e-mail', dir: 'auto' });
    subj.addEventListener('input', () => { s.subject = subj.value; save(); });
    const cond = el('select', { style: { width: 'auto' } }, ...[['always', 'Toujours'], ['opened', 'Seulement si l’e-mail précédent a été ouvert'], ['not_opened', 'Seulement s’il n’a pas été ouvert'], ['clicked', 'Seulement si un lien a été cliqué'], ['not_clicked', 'Seulement si aucun lien n’a été cliqué']].map(([v, l]) => el('option', { value: v }, l)));
    cond.value = s.condition || 'always';
    cond.addEventListener('change', () => { s.condition = cond.value; save(); });
    const st = a.stepStats?.[s.id];
    return el('div', { class: 'flow-node email' }, tools, el('div', { class: 'kind' }, `E-mail ${a.steps.slice(0, i + 1).filter((x) => x.type === 'email').length}`),
      el('div', { class: 'stack', style: { marginTop: '8px' } }, subj,
        el('div', { class: 'row' }, el('button', { class: `btn sm ${s.html ? '' : 'primary'}`, onclick: async () => {
          const design = s.design?.blocks ? s.design : await chooseStarter();
          if (!design) return;
          const r = await openEditor({ design, title: `E-mail : ${s.subject || 'sans objet'}` });
          if (r) { s.design = r.design; s.html = r.html; await api('saveAutomation', a); draw(); toast('E-mail enregistré.'); }
        } }, s.html ? 'Modifier le contenu' : 'Concevoir le contenu'), s.html ? el('span', { class: 'badge green' }, 'Contenu prêt') : el('span', { class: 'badge amber' }, 'Contenu manquant')),
        i > 0 ? el('label', { class: 'f' }, 'Condition d’envoi', cond) : null,
        st ? el('div', { class: 'small muted' }, `${num(st.sent)} envoyé(s) · ${st.sent ? pct(st.opens / st.sent) : '—'} ouvertures · ${st.sent ? pct(st.clicks / st.sent) : '—'} clics`) : null), waiting);
  };
  draw();
}

async function enrollDialog(a, lists, tags) {
  const aud = { lists: [], tags: [], excludeTags: [] };
  const count = el('strong', {}, '0');
  const recount = async () => { count.textContent = num(await api('audienceCount', aud)); };
  const checks = (arr, items) => el('div', { class: 'row wrap' }, ...items.map(([v, l]) => { const cb = el('input', { type: 'checkbox' }); cb.addEventListener('change', () => { if (cb.checked) arr.push(v); else arr.splice(arr.indexOf(v), 1); recount(); }); return el('label', { class: 'check', style: { marginRight: '12px' } }, cb, l); }));
  modal({
    title: 'Inscrire des contacts existants',
    body: el('div', { class: 'stack' }, el('p', { class: 'muted', style: { margin: 0 } }, 'Les abonnés choisis commencent la séquence au début (sauf s’ils l’ont déjà faite).'),
      el('h3', {}, 'Listes'), checks(aud.lists, lists.map((l) => [l.id, l.name])), el('h3', {}, 'Tags'), checks(aud.tags, tags.map((t) => [t.id, t.name])),
      el('div', { class: 'note info' }, 'Abonnés concernés : ', count)),
    actions: [{ label: 'Annuler' }, { label: 'Inscrire', kind: 'primary', onClick: async () => {
      if (a.status !== 'active' && !(await confirmBox('Automatisation inactive', 'Les contacts seront inscrits mais ne recevront rien tant que l’automatisation n’est pas activée. Continuer ?'))) return false;
      const n = await api('enrollExisting', a.id, aud);
      toast(`${num(n)} contact(s) inscrit(s).`);
      rerender();
    } }],
  });
}
