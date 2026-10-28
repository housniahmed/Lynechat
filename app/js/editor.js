// Éditeur d'e-mail par blocs (glisser-déposer, édition directe du texte, propriétés).
import { api, el, modal, toast, confirmBox, promptBox } from './ui.js';
import { BLOCKS, newBlock, blockInner, blockCellStyle, settingsOf, renderEmail, sanitize, FONTS, starterDesigns, defaultSettings } from './email-html.js';

const assetCache = new Map();
export async function resolveAssets(design) {
  const ids = new Set();
  for (const b of design.blocks || []) if (typeof b.src === 'string' && b.src.startsWith('asset:')) ids.add(b.src.slice(6));
  await Promise.all([...ids].filter((i) => !assetCache.has(i)).map(async (i) => assetCache.set(i, await api('asset', i))));
}
export const resolveSrc = (src) => (src && src.startsWith('asset:') ? assetCache.get(src.slice(6)) || '' : src);

export const MERGE_TAGS = [
  ['{{prenom|}}', 'Prénom'], ['{{nom}}', 'Nom'], ['{{email}}', 'E-mail'], ['{{entreprise}}', 'Votre entreprise'],
];

/** Image locale → redimensionnée (1200 px max) → enregistrée dans la médiathèque. */
export async function uploadImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const keepPng = file.type === 'image/png' || file.type === 'image/gif';
  const mime = keepPng ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((r) => c.toBlob(r, mime, 0.86));
  const data = new Uint8Array(await blob.arrayBuffer());
  if (data.length > 1.5e6) toast('Image lourde (plus de 1,5 Mo) : elle sera jointe à chaque e-mail. Préférez une image plus légère.', 'warn', 7000);
  const aid = await api('saveAsset', { name: file.name, mime, data, width: c.width, height: c.height });
  assetCache.set(aid, URL.createObjectURL(blob));
  return `asset:${aid}`;
}

export function pickImage() {
  return new Promise(async (resolve) => {
    let done = false;
    const assets = await api('assets');
    const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px' } });
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: true });
    const url = el('input', { type: 'url', placeholder: 'https://… (image hébergée sur votre site)' });
    let m;
    file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      const src = await uploadImage(file.files[0]);
      done = true; resolve(src); m.close();
    });
    for (const a of assets) {
      const img = el('img', { style: { width: '100%', height: '100px', objectFit: 'cover', borderRadius: '6px', background: '#eee' } });
      api('asset', a.id).then((d) => { img.src = d; assetCache.set(a.id, d); });
      grid.append(el('button', { class: 'btn', style: { padding: '4px', display: 'block' }, title: `${a.name} · ${a.width}×${a.height}`, onclick: () => { done = true; resolve(`asset:${a.id}`); m.close(); } }, img));
    }
    m = modal({
      title: 'Choisir une image', size: 'wide',
      body: el('div', { class: 'stack' },
        el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: () => file.click() }, 'Importer depuis l’ordinateur…'), file,
          el('span', { class: 'muted small' }, 'Les images importées sont intégrées au message (aucun hébergement nécessaire).')),
        el('div', { class: 'row' }, url, el('button', { class: 'btn', onclick: () => { if (/^https:\/\//.test(url.value)) { done = true; resolve(url.value.trim()); m.close(); } else toast('Adresse https:// requise', 'warn'); } }, 'Utiliser cette adresse')),
        assets.length ? el('h3', {}, 'Médiathèque') : null, grid),
      onClose: () => { if (!done) resolve(null); },
    });
  });
}

/** Choix d'un modèle de départ (ou d'un modèle enregistré). */
export async function chooseStarter(lang = 'fr') {
  const saved = await api('templates');
  return new Promise((resolve) => {
    let done = false;
    let m;
    let curLang = lang;
    const body = el('div');
    const draw = () => {
      body.innerHTML = '';
      body.append(
        el('div', { class: 'row', style: { marginBottom: '14px' } }, el('span', { class: 'muted' }, 'Langue du modèle :'),
          ...[['fr', 'Français'], ['ar', 'العربية']].map(([k, l]) => el('button', { class: `btn sm ${curLang === k ? 'primary' : ''}`, onclick: () => { curLang = k; draw(); } }, l))),
        el('div', { class: 'grid4' }, ...starterDesigns(curLang).map((t) => el('button', { class: 'card', style: { textAlign: 'left', cursor: 'pointer' }, onclick: () => { done = true; resolve(structuredClone(t.design)); m.close(); } },
          el('strong', {}, t.name), el('div', { class: 'muted small' }, `${t.design.blocks.length} blocs`)))),
        saved.length ? el('h3', { style: { marginTop: '18px' } }, 'Mes modèles') : null,
        saved.length ? el('div', { class: 'grid4' }, ...saved.map((t) => el('button', { class: 'card', style: { textAlign: 'left', cursor: 'pointer' }, onclick: () => { done = true; resolve(structuredClone(t.design)); m.close(); } }, el('strong', {}, t.name)))) : null,
      );
    };
    draw();
    m = modal({ title: 'Choisir une mise en page', size: 'wide', body, onClose: () => { if (!done) resolve(null); } });
  });
}

/**
 * Ouvre l'éditeur plein écran. Résout avec { design, html } ou null si annulé.
 */
export function openEditor({ design, title = 'Contenu de l’e-mail', onSaveTemplate = true } = {}) {
  return new Promise(async (resolve) => {
    const d = structuredClone(design && design.blocks ? design : { settings: defaultSettings(), blocks: [newBlock('text'), newBlock('footer')] });
    if (!d.blocks.some((b) => b.type === 'footer')) d.blocks.push(newBlock('footer', d.settings?.lang));
    await resolveAssets(d);
    let sel = null;
    let view = 'desktop';
    let lastEditable = null;
    let dirty = false;

    const palette = el('div', { class: 'ed-palette' });
    const canvas = el('div', { class: 'ed-canvas' });
    const props = el('div', { class: 'ed-props' });
    const root = el('div', { class: 'editor' }, palette, canvas, props);

    palette.append(el('h3', {}, 'Blocs'), el('p', { class: 'muted small', style: { marginTop: 0 } }, 'Glissez un bloc dans l’e-mail, ou cliquez pour l’ajouter.'));
    for (const [type, label, icon] of BLOCKS) {
      const b = el('div', { class: 'blk', draggable: 'true' }, el('i', {}, icon), label);
      b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-block', type); e.dataTransfer.effectAllowed = 'copy'; });
      b.addEventListener('click', () => { const nb = newBlock(type, settingsOf(d).lang); const at = sel ? d.blocks.findIndex((x) => x.id === sel) + 1 : d.blocks.length - 1; d.blocks.splice(Math.max(0, at), 0, nb); sel = nb.id; dirty = true; draw(); });
      palette.append(b);
    }

    const s = () => settingsOf(d);

    function dropZone(index) {
      const z = el('div', { class: 'ed-drop' });
      z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
      z.addEventListener('dragleave', () => z.classList.remove('over'));
      z.addEventListener('drop', (e) => {
        e.preventDefault(); z.classList.remove('over');
        const type = e.dataTransfer.getData('text/x-block');
        const moveId = e.dataTransfer.getData('text/x-move');
        const footerIdx = d.blocks.findIndex((x) => x.type === 'footer');
        const target = Math.min(index, footerIdx >= 0 ? footerIdx : d.blocks.length);
        if (type) { const nb = newBlock(type, s().lang); d.blocks.splice(target, 0, nb); sel = nb.id; }
        else if (moveId) {
          const from = d.blocks.findIndex((x) => x.id === moveId);
          if (from < 0) return;
          const [blk] = d.blocks.splice(from, 1);
          d.blocks.splice(from < target ? target - 1 : target, 0, blk);
        }
        dirty = true; draw();
      });
      return z;
    }

    function drawCanvas() {
      const st = s();
      canvas.innerHTML = '';
      const tb = el('div', { class: 'ed-toolbar' },
        ...[['desktop', '🖥 Ordinateur'], ['mobile', '📱 Mobile']].map(([k, l]) => el('button', { class: `btn sm ${view === k ? 'primary' : ''}`, onclick: () => { view = k; drawCanvas(); } }, l)),
        el('button', { class: 'btn sm', onclick: () => { sel = null; draw(); } }, 'Réglages généraux'));
      const doc = el('div', { class: 'ed-doc', style: { width: view === 'mobile' ? '375px' : `${Math.min(st.width, 700)}px`, background: st.contentBg, borderRadius: '8px', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,.08)' }, dir: st.dir });
      canvas.style.background = st.bg;
      canvas.append(tb, doc);
      d.blocks.forEach((b, i) => {
        doc.append(dropZone(i));
        const tools = el('div', { class: 'ed-tools' },
          el('button', { title: 'Monter', onclick: (e) => { e.stopPropagation(); move(b.id, -1); } }, '↑'),
          el('button', { title: 'Descendre', onclick: (e) => { e.stopPropagation(); move(b.id, 1); } }, '↓'),
          b.type !== 'footer' ? el('button', { title: 'Dupliquer', onclick: (e) => { e.stopPropagation(); const c = { ...structuredClone(b), id: `${b.id}c${Date.now() % 1e5}` }; d.blocks.splice(i + 1, 0, c); sel = c.id; dirty = true; draw(); } }, '⧉') : null,
          b.type !== 'footer' ? el('button', { class: 'del', title: 'Supprimer', onclick: (e) => { e.stopPropagation(); d.blocks.splice(i, 1); sel = null; dirty = true; draw(); } }, '✕') : null);
        const wrap = el('div', { class: `ed-block${sel === b.id ? ' sel' : ''}`, draggable: 'true' }, tools,
          el('table', { role: 'presentation', width: '100%', cellpadding: '0', cellspacing: '0', html: `<tr><td style="${blockCellStyle(b)}">${blockInner(st, b, resolveSrc)}</td></tr>` }));
        wrap.addEventListener('dragstart', (e) => { if (e.target !== wrap) return; e.dataTransfer.setData('text/x-move', b.id); });
        wrap.addEventListener('click', (e) => {
          if (e.target.closest('a')) e.preventDefault();
          if (sel === b.id) return;
          // Sélection sans redessiner le bloc (le curseur reste dans le texte cliqué).
          sel = b.id;
          for (const w of doc.querySelectorAll('.ed-block')) w.classList.toggle('sel', w === wrap);
          drawProps();
        });
        // Édition directe du texte
        const editable = b.type === 'text' || b.type === 'footer' ? wrap.querySelector('td > div') : b.type === 'heading' ? wrap.querySelector('h1') : b.type === 'imagetext' ? wrap.querySelector('.it-text') : null;
        if (editable) {
          editable.contentEditable = 'true';
          editable.dir = 'auto';
          editable.addEventListener('focus', () => { lastEditable = { el: editable, block: b }; wrap.draggable = false; });
          editable.addEventListener('blur', () => { wrap.draggable = true; });
          editable.addEventListener('input', () => {
            const clean = sanitize(editable.innerHTML.replace(/ style="color:[^"]*"/g, (m) => m));
            if (b.type === 'heading') b.text = clean; else b.html = clean;
            dirty = true;
          });
          editable.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
        }
        doc.append(wrap);
      });
      doc.append(dropZone(d.blocks.length));
    }

    function move(bidv, dir) {
      const i = d.blocks.findIndex((x) => x.id === bidv);
      const j = i + dir;
      if (j < 0 || j >= d.blocks.length) return;
      [d.blocks[i], d.blocks[j]] = [d.blocks[j], d.blocks[i]];
      dirty = true; draw();
    }

    const field = (label, input, hint) => el('label', { class: 'f' }, label, input, hint ? el('span', { class: 'hint' }, hint) : null);
    const bind = (obj, key, type = 'text', opts = {}) => {
      let i;
      if (type === 'select') {
        i = el('select', {}, ...opts.options.map(([v, l]) => el('option', { value: v }, l)));
        i.value = String(obj[key]);
      } else if (type === 'textarea') i = el('textarea', { rows: opts.rows || 4, dir: 'auto' }, obj[key] ?? '');
      else i = el('input', { type, value: type === 'color' ? (obj[key] || '#ffffff') : (obj[key] ?? ''), min: opts.min, max: opts.max, step: opts.step, dir: type === 'text' ? 'auto' : null });
      const apply = () => {
        let v = type === 'number' || type === 'range' ? Number(i.value) : type === 'checkbox' ? i.checked : i.value;
        if (opts.numeric) v = Number(v);
        obj[key] = v; dirty = true; drawCanvas();
      };
      i.addEventListener(type === 'text' || type === 'textarea' || type === 'url' ? 'change' : 'input', apply);
      if (type === 'checkbox') { i.checked = !!obj[key]; }
      return i;
    }

    function drawProps() {
      props.innerHTML = '';
      const b = d.blocks.find((x) => x.id === sel);
      if (!b) {
        const st = d.settings ||= defaultSettings();
        props.append(el('h3', {}, 'Réglages généraux'),
          field('Langue et sens d’écriture', bind(st, 'lang', 'select', { options: [['fr', 'Français (gauche → droite)'], ['ar', 'العربية (droite → gauche)']] })),
          el('button', { class: 'btn sm', style: { marginBottom: '12px' }, onclick: () => { st.dir = st.lang === 'ar' ? 'rtl' : 'ltr'; for (const x of d.blocks) if ('align' in x && x.type !== 'image' && x.type !== 'button' && x.type !== 'social' && x.type !== 'footer') x.align = st.dir === 'rtl' ? 'right' : 'left'; dirty = true; draw(); } }, 'Appliquer le sens d’écriture'),
          field('Police', bind(st, 'font', 'select', { options: FONTS })),
          el('div', { class: 'row' }, field('Fond', bind(st, 'bg', 'color')), field('Contenu', bind(st, 'contentBg', 'color')), field('Texte', bind(st, 'color', 'color')), field('Liens', bind(st, 'link', 'color'))),
          field('Largeur (px)', bind(st, 'width', 'number', { min: 480, max: 700, step: 10 })),
          el('div', { class: 'note info small' }, 'Le pied de page avec le lien de désinscription est obligatoire : il reste toujours en bas de l’e-mail.'));
        return;
      }
      const label = { heading: 'Titre', text: 'Texte', image: 'Image', button: 'Bouton', divider: 'Séparateur', spacer: 'Espace', imagetext: 'Image + texte', social: 'Réseaux sociaux', html: 'Code HTML', footer: 'Pied de page' }[b.type];
      props.append(el('h3', {}, label));
      const align = () => field('Alignement', bind(b, 'align', 'select', { options: [['left', 'Gauche'], ['center', 'Centre'], ['right', 'Droite']] }));
      if (['heading', 'text', 'footer', 'imagetext'].includes(b.type)) {
        const ex = (cmd, val) => { lastEditable?.el.focus(); document.execCommand(cmd, false, val); lastEditable?.el.dispatchEvent(new Event('input')); };
        props.append(el('p', { class: 'muted small' }, 'Cliquez dans le texte de l’e-mail pour l’écrire directement.'),
          el('div', { class: 'rte-bar' },
            el('button', { title: 'Gras', onmousedown: (e) => { e.preventDefault(); ex('bold'); } }, 'B'),
            el('button', { title: 'Italique', style: { fontStyle: 'italic' }, onmousedown: (e) => { e.preventDefault(); ex('italic'); } }, 'I'),
            el('button', { title: 'Souligné', style: { textDecoration: 'underline' }, onmousedown: (e) => { e.preventDefault(); ex('underline'); } }, 'U'),
            el('button', { title: 'Lien', onmousedown: async (e) => {
              e.preventDefault();
              const selc = window.getSelection();
              const range = selc.rangeCount ? selc.getRangeAt(0).cloneRange() : null;
              const target = lastEditable;
              if (!range || range.collapsed || !target) { toast('Sélectionnez d’abord le texte à transformer en lien.', 'warn'); return; }
              const u = await promptBox('Ajouter un lien', 'Adresse (https://…, mailto:… ou tel:…)', 'https://');
              if (!u || !/^(https?:|mailto:|tel:)/.test(u)) return;
              target.el.focus();
              selc.removeAllRanges(); selc.addRange(range);
              document.execCommand('createLink', false, u);
              target.el.dispatchEvent(new Event('input'));
            } }, '🔗'),
            el('button', { title: 'Retirer le lien', onmousedown: (e) => { e.preventDefault(); ex('unlink'); } }, '⛓'),
            (() => { const c = el('input', { type: 'color', value: '#1f6f5c', title: 'Couleur du texte sélectionné' }); c.addEventListener('mousedown', () => { lastEditable?.el.focus(); }); c.addEventListener('change', () => ex('foreColor', c.value)); return c; })()),
          el('h3', { style: { marginTop: '12px' } }, 'Personnalisation'),
          el('div', { class: 'merge-list' }, ...MERGE_TAGS.map(([tag, l]) => el('button', { title: tag, onmousedown: (e) => { e.preventDefault(); ex('insertText', tag); } }, l))),
          el('p', { class: 'muted small' }, '{{prenom|}} : le texte après | s’affiche si le prénom est vide (ex. {{prenom|cher client}}).'));
      }
      if (b.type === 'heading') props.append(field('Taille (px)', bind(b, 'size', 'number', { min: 16, max: 60 })), align(), field('Couleur', bind(b, 'color', 'color')));
      if (b.type === 'text') props.append(field('Taille (px)', bind(b, 'size', 'number', { min: 11, max: 24 })), align());
      if (b.type === 'footer') props.append(field('Taille (px)', bind(b, 'size', 'number', { min: 10, max: 16 })), align(), field('Couleur', bind(b, 'color', 'color')),
        el('p', { class: 'muted small' }, '{{entreprise}} et {{adresse}} viennent des Paramètres. Ne supprimez pas le lien « Se désinscrire » : l’envoi serait refusé.'));
      if (b.type === 'image' || b.type === 'imagetext') {
        const prev = el('div', { style: { margin: '6px 0 10px' } }, b.src ? el('img', { src: resolveSrc(b.src), style: { maxWidth: '100%', borderRadius: '6px' } }) : null);
        props.append(prev, el('div', { class: 'row', style: { marginBottom: '10px' } }, el('button', { class: 'btn sm primary', onclick: async () => { const src = await pickImage(); if (src) { b.src = src; dirty = true; draw(); } } }, b.src ? 'Changer l’image' : 'Choisir une image'),
          b.src ? el('button', { class: 'btn sm ghost', onclick: () => { b.src = ''; dirty = true; draw(); } }, 'Retirer') : null),
        field('Texte alternatif', bind(b, 'alt'), 'Décrit l’image si elle ne s’affiche pas.'));
        if (b.type === 'image') props.append(field('Lien (facultatif)', bind(b, 'link', 'url')), field(`Largeur : ${b.width} %`, bind(b, 'width', 'range', { min: 20, max: 100, step: 5 })), align());
        else props.append(field('Image', bind(b, 'side', 'select', { options: [['left', 'À gauche'], ['right', 'À droite']] })));
      }
      if (b.type === 'button') props.append(field('Texte', bind(b, 'text')), field('Lien', bind(b, 'url', 'url')),
        el('div', { class: 'row' }, field('Fond', bind(b, 'bg', 'color')), field('Texte', bind(b, 'color', 'color')), field('Arrondi', bind(b, 'radius', 'number', { min: 0, max: 40 }))),
        align(), el('label', { class: 'check', style: { marginBottom: '10px' } }, bind(b, 'full', 'checkbox'), 'Pleine largeur'));
      if (b.type === 'divider') props.append(field('Couleur', bind(b, 'color', 'color')), field('Épaisseur', bind(b, 'thickness', 'number', { min: 1, max: 8 })));
      if (b.type === 'spacer') props.append(field('Hauteur (px)', bind(b, 'height', 'number', { min: 4, max: 120 })));
      if (b.type === 'html') props.append(field('Code HTML', bind(b, 'code', 'textarea', { rows: 10 }), 'Utilisez des styles en ligne. Les scripts sont ignorés par les messageries.'));
      if (b.type === 'social') {
        const nets = ['Instagram', 'Facebook', 'WhatsApp', 'TikTok', 'LinkedIn', 'YouTube', 'X', 'Site web'];
        const list = el('div', { class: 'stack' });
        const redraw = () => {
          list.innerHTML = '';
          b.links.forEach((l, i) => list.append(el('div', { class: 'row' },
            bind(l, 'net', 'select', { options: nets.map((x) => [x, x]) }), bind(l, 'url', 'url'),
            el('button', { class: 'icon-btn', onclick: () => { b.links.splice(i, 1); dirty = true; redraw(); drawCanvas(); } }, '✕'))));
          list.append(el('button', { class: 'btn sm', onclick: () => { b.links.push({ net: 'Instagram', url: 'https://' }); redraw(); } }, '+ Ajouter un réseau'));
        };
        redraw();
        props.append(list, el('div', { style: { height: '10px' } }), align());
      }
      if (b.type !== 'spacer') {
        props.append(el('h3', { style: { marginTop: '14px' } }, 'Bloc'),
          el('div', { class: 'row' }, field('Marge haut', bind(b, 'pt', 'number', { min: 0, max: 80 })), field('Marge bas', bind(b, 'pb', 'number', { min: 0, max: 80 }))),
          el('div', { class: 'row' }, field('Fond du bloc', bind(b, 'bg', 'color')), el('button', { class: 'btn sm ghost', onclick: () => { b.bg = ''; dirty = true; draw(); } }, 'Sans fond')));
      }
    }

    function draw() { drawCanvas(); drawProps(); }
    draw();

    const finish = () => {
      for (const b of d.blocks) { if (b.type === 'heading') b.text = sanitize(b.text); if (b.html && b.type !== 'html') b.html = sanitize(b.html); }
      return { design: d, html: renderEmail(d) };
    };
    let resolved = false;
    const m = modal({
      title, size: 'full', body: root,
      actions: [
        onSaveTemplate ? { label: 'Enregistrer comme modèle', close: false, onClick: async () => { const name = await promptBox('Enregistrer comme modèle', 'Nom du modèle', 'Mon modèle'); if (name) { await api('saveTemplate', { name, design: finish().design }); toast('Modèle enregistré.'); } return false; } } : null,
        { label: 'Aperçu', close: false, onClick: () => { previewHtml(renderEmail(d, { resolve: resolveSrc })); return false; } },
        { label: 'Annuler', onClick: async () => { if (dirty && !(await confirmBox('Quitter sans enregistrer ?', 'Vos modifications seront perdues.', 'Quitter', true))) return false; resolved = true; resolve(null); } },
        { label: 'Enregistrer', kind: 'primary', onClick: () => { resolved = true; resolve(finish()); } },
      ].filter(Boolean),
      onClose: () => { if (!resolved) resolve(null); },
    });
    m.dialog.addEventListener('cancel', (e) => { e.preventDefault(); });
  });
}

export function previewHtml(html, title = 'Aperçu') {
  const frame = el('iframe', { class: 'preview-frame', sandbox: '', style: { height: '70vh' } });
  frame.srcdoc = html;
  let mob = false;
  const wrap = el('div', { style: { display: 'flex', justifyContent: 'center' } }, frame);
  const toggle = el('button', { class: 'btn sm', onclick: () => { mob = !mob; frame.style.width = mob ? '390px' : '100%'; toggle.textContent = mob ? '🖥 Ordinateur' : '📱 Mobile'; } }, '📱 Mobile');
  modal({ title, size: 'wide', body: el('div', { class: 'stack' }, el('div', {}, toggle), wrap) });
}
