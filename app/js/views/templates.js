import { api, el, toast, confirmBox, promptBox, fmtDate } from '../ui.js';
import { openEditor, chooseStarter, resolveAssets, resolveSrc } from '../editor.js';
import { renderEmail } from '../email-html.js';

const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

export async function templatesView(page) {
  const list = await api('templates');
  page.append(el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'Modèles d’e-mail'), el('div', { class: 'sub' }, 'Mises en page réutilisables pour vos campagnes et automatisations')), el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: async () => {
      const design = await chooseStarter();
      if (!design) return;
      const r = await openEditor({ design, title: 'Nouveau modèle', onSaveTemplate: false });
      if (!r) return;
      const name = await promptBox('Nom du modèle', 'Nom', 'Mon modèle');
      if (name) { await api('saveTemplate', { name, design: r.design }); rerender(); }
    } }, 'Créer un modèle')));
  if (!list.length) { page.append(el('div', { class: 'card empty' }, el('h3', {}, 'Aucun modèle enregistré'), el('p', {}, 'Dans l’éditeur, utilisez « Enregistrer comme modèle » pour réutiliser une mise en page (logo, couleurs, pied de page).'))); return; }
  const grid = el('div', { class: 'grid3' });
  page.append(grid);
  for (const t of list) {
    await resolveAssets(t.design);
    const f = el('iframe', { class: 'preview-frame', sandbox: '', style: { height: '260px', pointerEvents: 'none' } });
    f.srcdoc = renderEmail(t.design, { resolve: resolveSrc });
    grid.append(el('div', { class: 'card' }, f, el('div', { class: 'row', style: { marginTop: '10px' } }, el('div', {}, el('strong', {}, t.name), el('div', { class: 'muted small' }, fmtDate(t.updated_at))), el('span', { class: 'spacer' }),
      el('button', { class: 'btn sm', onclick: async () => { const r = await openEditor({ design: t.design, title: `Modèle : ${t.name}`, onSaveTemplate: false }); if (r) { await api('saveTemplate', { id: t.id, name: t.name, design: r.design }); toast('Modèle enregistré.'); rerender(); } } }, 'Modifier'),
      el('button', { class: 'btn sm ghost danger', onclick: async () => { if (await confirmBox('Supprimer le modèle ?', 'Les campagnes qui l’ont utilisé ne sont pas modifiées.', 'Supprimer', true)) { await api('deleteTemplate', t.id); rerender(); } } }, 'Supprimer'))));
  }
}
