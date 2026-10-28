// Espaces clients : un espace par client ou par marque, avec ses propres contacts, campagnes,
// modèles, automatisations, formulaires, expéditeur et informations légales.
import { api, el, run, modal, confirmBox, toast, fmtDate, num, pickLogo } from '../ui.js';

export const WS_COLORS = ['#1f6f5c', '#2f5fb3', '#b0472e', '#7a4bb3', '#b3871f', '#2e8a9a', '#a83a6c', '#4f6b2e'];

function logoField(state, key, label) {
  const box = el('div', { class: 'logo-pick' });
  const draw = () => {
    box.innerHTML = '';
    box.append(...[state[key] ? el('img', { src: state[key], alt: '' }) : el('div', { class: 'none' }, 'Aucun'),
      el('button', { class: 'btn sm', type: 'button', onclick: async () => { const d = await pickLogo(); if (d) { state[key] = d; draw(); } } }, state[key] ? 'Changer' : 'Choisir une image'),
      state[key] ? el('button', { class: 'btn sm ghost', type: 'button', onclick: () => { state[key] = ''; draw(); } }, 'Retirer') : null].filter(Boolean));
  };
  draw();
  return el('div', { class: 'f' }, label, box);
}

function colorField(state) {
  const box = el('div', { class: 'swatches' });
  const custom = el('input', { type: 'color', value: state.color, style: { width: '36px', height: '28px', padding: 0, border: 0 } });
  const draw = () => {
    box.innerHTML = '';
    for (const c of WS_COLORS) box.append(el('button', { type: 'button', class: state.color === c ? 'on' : '', style: { background: c }, title: c, onclick: () => { state.color = c; custom.value = c; draw(); } }));
    box.append(custom);
  };
  custom.addEventListener('input', () => { state.color = custom.value; draw(); });
  draw();
  return el('div', { class: 'f' }, 'Couleur', box);
}

/** Création ou modification d'un espace. Renvoie l'espace enregistré (ou null). */
export function editWorkspace(ws = null) {
  return new Promise((resolve) => {
    const state = { name: ws?.name || '', color: ws?.color || WS_COLORS[1], logo: ws?.logo || '', note: ws?.note || '' };
    const name = el('input', { type: 'text', value: state.name, dir: 'auto', placeholder: 'Ex. Centre de Radiologie, StoryKids…' });
    const note = el('textarea', { rows: 2, dir: 'auto', placeholder: 'Facultatif : interlocuteur, contrat, remarques…' }, state.note);
    const copy = el('input', { type: 'checkbox' });
    let done = false;
    modal({
      title: ws ? `Modifier « ${ws.name} »` : 'Nouvel espace client',
      body: el('div', { class: 'stack' },
        el('label', { class: 'f' }, 'Nom du client ou de la marque', name),
        colorField(state),
        logoField(state, 'logo', 'Logo (utilisé dans les rapports PDF)'),
        el('label', { class: 'f' }, 'Note interne', note),
        ws ? null : el('label', { class: 'check' }, copy, ' Reprendre les modèles d’e-mail de l’espace actuel'),
        ws ? null : el('div', { class: 'note info small' }, 'Le nouvel espace démarre vide : contacts, campagnes, automatisations et formulaires lui sont propres. Le compte AWS et le domaine vérifiés restent communs ; vous choisirez l’expéditeur et les informations légales de ce client dans Paramètres.')),
      actions: [
        { label: 'Annuler', onClick: () => { done = true; resolve(null); } },
        {
          label: ws ? 'Enregistrer' : 'Créer l’espace', kind: 'primary',
          onClick: async () => {
            const p = { name: name.value, color: state.color, logo: state.logo, note: note.value };
            const r = ws ? await api('updateWorkspace', ws.id, p) : await api('createWorkspace', { ...p, copyTemplates: copy.checked });
            done = true;
            resolve(r);
          },
        },
      ],
      onClose: () => { if (!done) resolve(null); },
    });
    setTimeout(() => name.focus(), 30);
  });
}

export async function switchTo(wid) {
  await api('switchWorkspace', wid);
  window.dispatchEvent(new CustomEvent('lynechat:workspace'));
  if (location.hash === '#/' || location.hash === '') window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = '#/';
}

export async function workspacesView(page) {
  page.append(el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, 'Espaces clients'), el('div', { class: 'sub' }, 'Un espace par client ou par marque : données séparées, un seul compte AWS')),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: async () => { const w = await editWorkspace(); if (w) { toast(`Espace « ${w.name} » créé.`); await switchTo(w.id); location.hash = '#/settings'; } } }, '+ Nouvel espace')));

  const grid = el('div', { class: 'ws-grid' });
  page.append(grid);
  const draw = async () => {
    const list = await api('workspaces');
    grid.innerHTML = '';
    for (const w of list) {
      grid.append(el('div', { class: `card ws-card${w.current ? ' current' : ''}`, style: `--ws:${/^#[0-9a-fA-F]{6}$/.test(w.color) ? w.color : '#1f6f5c'}` },
        el('div', { class: 'head' },
          w.logo ? el('img', { src: w.logo, alt: '' }) : el('div', { class: 'ph' }, (w.name || '?').trim().charAt(0).toUpperCase()),
          el('div', { style: { minWidth: 0 } }, el('h3', { dir: 'auto' }, w.name), w.current ? el('span', { class: 'badge green' }, 'Espace actif') : w.id === 'main' ? el('span', { class: 'badge' }, 'Espace principal') : null)),
        el('div', { class: 'facts' },
          el('span', {}, 'Abonnés'), el('b', {}, num(w.contacts)),
          el('span', {}, 'Campagnes'), el('b', {}, num(w.campaigns)),
          el('span', {}, 'Dernier envoi'), el('div', {}, w.lastSent ? fmtDate(w.lastSent, false) : '—'),
          el('span', {}, 'Expéditeur'), el('div', { style: { wordBreak: 'break-all' } }, w.sender || el('i', { class: 'muted' }, 'à définir'))),
        w.note ? el('div', { class: 'muted small', dir: 'auto' }, w.note) : null,
        el('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } },
          w.current ? null : el('button', { class: 'btn sm primary', onclick: () => switchTo(w.id) }, 'Ouvrir'),
          el('button', { class: 'btn sm', onclick: async () => { if (await editWorkspace(w)) { toast('Espace enregistré.'); window.dispatchEvent(new CustomEvent('lynechat:workspace')); draw(); } } }, 'Modifier'),
          w.id === 'main' ? null : el('button', {
            class: 'btn sm ghost danger',
            onclick: async () => {
              const ok = await confirmBox(`Supprimer « ${w.name} » ?`, `Ses ${num(w.contacts)} abonnés, ses campagnes, ses automatisations et ses formulaires disparaîtront de Lynechat. Les formulaires déjà publiés sur un site cesseront d’enregistrer des inscriptions. Par sécurité, sa base de données est déplacée dans le dossier « workspaces/corbeille » des données de Lynechat au lieu d’être effacée.`, 'Supprimer l’espace', true);
              if (!ok) return;
              await run(null, () => api('deleteWorkspace', w.id), 'Espace supprimé.');
              window.dispatchEvent(new CustomEvent('lynechat:workspace'));
              draw();
            },
          }, 'Supprimer'))));
    }
  };
  await draw();

  // ---------- identité de l'agence (rapports) ----------
  const ag = { name: '', website: '', email: '', color: '#1f6f5c', logo: '', showClientLogo: true, ...(await api('agency')) };
  const f = (k, label, ph = '', type = 'text') => {
    const i = el('input', { type, value: ag[k] || '', placeholder: ph, dir: 'auto' });
    i.addEventListener('input', () => { ag[k] = i.value; });
    return el('label', { class: 'f' }, label, i);
  };
  const showLogo = el('input', { type: 'checkbox', checked: ag.showClientLogo !== false });
  page.append(el('div', { class: 'card', style: { marginTop: '18px' } },
    el('h2', {}, 'Votre agence (en-tête des rapports PDF)'),
    el('p', { class: 'muted', style: { marginTop: 0 } }, 'Ces informations apparaissent en haut et en bas de chaque rapport, à côté du nom et du logo du client.'),
    el('div', { class: 'grid2' },
      el('div', { class: 'stack' }, f('name', 'Nom de l’agence', 'Ex. Zenith Advertising'), f('website', 'Site web', 'https://…'), f('email', 'E-mail de contact', 'contact@…', 'email')),
      el('div', { class: 'stack' }, logoField(ag, 'logo', 'Logo de l’agence'), colorField(ag), el('label', { class: 'check' }, showLogo, ' Afficher aussi le logo du client'))),
    el('div', { class: 'row', style: { marginTop: '12px' } },
      el('button', { class: 'btn primary', onclick: (e) => run(e.target, () => api('saveAgency', { ...ag, showClientLogo: showLogo.checked }), 'Identité de l’agence enregistrée.') }, 'Enregistrer'))));
}
