import { api, el, toast, run, modal, confirmBox, promptBox, fmtDate, num, esc } from '../ui.js';

const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

const TEXTS = {
  fr: {
    title: 'Inscrivez-vous à notre newsletter', text: 'Recevez nos offres et nouveautés. Pas de spam, désinscription en un clic.', button: 'Je m’inscris',
    success: 'Merci ! Vérifiez votre boîte de réception pour confirmer votre inscription.',
    consent: (n) => `J’accepte de recevoir les e-mails de ${n || '[votre entreprise]'}. Je peux me désinscrire à tout moment.`,
    labels: { first_name: 'Prénom', last_name: 'Nom', phone: 'Téléphone' },
  },
  ar: {
    title: 'اشترك في نشرتنا الإخبارية', text: 'توصل بعروضنا وجديدنا. بدون رسائل مزعجة، ويمكنك إلغاء الاشتراك بنقرة واحدة.', button: 'اشترك الآن',
    success: 'شكراً! تحقق من بريدك الإلكتروني لتأكيد اشتراكك.',
    consent: (n) => `أوافق على تلقي رسائل ${n || '[اسم الشركة]'} عبر البريد الإلكتروني، ويمكنني إلغاء الاشتراك في أي وقت.`,
    labels: { first_name: 'الاسم', last_name: 'النسب', phone: 'الهاتف' },
  },
};

function defaults(f, company) {
  const T = TEXTS[f.design?.lang] || TEXTS.fr;
  return {
    lang: 'fr', title: T.title, text: T.text, button: T.button, success: T.success, consent: T.consent(company.name),
    accent: '#1f6f5c', bg: '#ffffff', redirect: '', image: '', pageBg: '#f3f1ec',
    fields: [{ key: 'first_name', label: T.labels.first_name, on: true, required: false }, { key: 'last_name', label: T.labels.last_name, on: false, required: false }, { key: 'phone', label: T.labels.phone, on: false, required: false }],
    custom: [],
    ...(f.design || {}),
  };
}

export async function formsView(page) {
  const [forms, settings] = await Promise.all([api('forms'), api('settings')]);
  page.append(el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'Formulaires et pages d’inscription'), el('div', { class: 'sub' }, 'À intégrer sur votre site, ou à publier comme page autonome')), el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: async () => { const n = await promptBox('Nouveau formulaire', 'Nom', 'Newsletter du site'); if (n) location.hash = `#/forms/${await api('createForm', n)}`; } }, 'Créer un formulaire')));
  if (!settings.infra?.publicUrl) page.append(el('div', { class: 'note', style: { marginBottom: '14px' } }, 'Installez d’abord l’infrastructure AWS (Paramètres) : elle reçoit les inscriptions de vos formulaires.'));
  if (!forms.length) { page.append(el('div', { class: 'card empty' }, el('h3', {}, 'Aucun formulaire'), el('p', {}, 'Créez un formulaire d’inscription : vous obtiendrez un code à coller sur votre site (WordPress, Metaforma…) ou une page complète à héberger.'))); return; }
  page.append(el('div', { class: 'card flush' }, el('table', { class: 't' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Formulaire'), el('th', {}, 'Double opt-in'), el('th', { class: 'num' }, 'Inscriptions'))),
    el('tbody', {}, ...forms.map((f) => el('tr', { class: 'click', onclick: () => { location.hash = `#/forms/${f.id}`; } },
      el('td', {}, el('strong', {}, f.name)), el('td', {}, f.double_optin ? el('span', { class: 'badge green' }, 'Oui') : el('span', { class: 'badge' }, 'Non')), el('td', { class: 'num' }, num(f.submissions))))))));
}

export async function formView(page, fid) {
  const [forms, lists, tags, settings, keys] = await Promise.all([api('forms'), api('lists'), api('tags'), api('settings'), api('customFields')]);
  const f = forms.find((x) => x.id === fid);
  if (!f) { page.append(el('div', { class: 'note err' }, 'Formulaire introuvable.')); return; }
  const endpoint = settings.infra?.publicUrl || null;
  f.design = defaults(f, settings.company);
  let saveT;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { api('saveForm', f).catch((e) => toast(e.message, 'err')); updPreview(); }, 300); };
  const d = f.design;

  const name = el('input', { type: 'text', value: f.name, class: 'title-input' });
  name.addEventListener('change', () => { f.name = name.value.trim() || 'Formulaire'; save(); });
  page.append(el('div', { class: 'page-head' }, el('a', { class: 'btn ghost', href: '#/forms' }, '←'), name, el('span', { class: 'spacer' }),
    el('button', { class: 'btn ghost danger', onclick: async () => { if (await confirmBox('Supprimer le formulaire ?', 'Les formulaires déjà publiés sur votre site cesseront de fonctionner.', 'Supprimer', true)) { await api('deleteForm', fid); location.hash = '#/forms'; } } }, 'Supprimer')));

  const inp = (obj, k, label, type = 'text', hint) => { const i = type === 'textarea' ? el('textarea', { rows: 3, dir: 'auto' }, obj[k] || '') : el('input', { type, value: obj[k] ?? '', dir: type === 'text' ? 'auto' : null }); i.addEventListener('input', () => { obj[k] = type === 'checkbox' ? i.checked : i.value; save(); }); if (type === 'checkbox') i.checked = !!obj[k]; return type === 'checkbox' ? el('label', { class: 'check' }, i, label) : el('label', { class: 'f' }, label, i, hint ? el('span', { class: 'hint' }, hint) : null); };
  const listSel = el('select', {}, el('option', { value: '' }, '— Aucune —'), ...lists.map((l) => el('option', { value: l.id }, l.name)));
  listSel.value = f.list_id || '';
  listSel.addEventListener('change', () => { f.list_id = listSel.value; save(); });
  const tagBox = el('div', { class: 'row wrap' }, ...tags.map((t) => { const cb = el('input', { type: 'checkbox', checked: f.tag_ids.includes(t.id) }); cb.addEventListener('change', () => { if (cb.checked) f.tag_ids.push(t.id); else f.tag_ids.splice(f.tag_ids.indexOf(t.id), 1); save(); }); return el('label', { class: 'check', style: { marginRight: '10px' } }, cb, t.name); }));
  const doi = el('input', { type: 'checkbox', checked: !!f.double_optin });
  doi.addEventListener('change', () => { f.double_optin = doi.checked; save(); });

  const fieldsBox = el('div', { class: 'stack' });
  const drawFields = () => {
    fieldsBox.innerHTML = '';
    fieldsBox.append(el('div', { class: 'row small' }, el('strong', {}, 'E-mail'), el('span', { class: 'muted' }, '(toujours présent et obligatoire)')));
    for (const fl of [...d.fields, ...d.custom]) {
      const on = el('input', { type: 'checkbox', checked: fl.on !== false });
      on.addEventListener('change', () => { fl.on = on.checked; save(); });
      const req = el('input', { type: 'checkbox', checked: !!fl.required });
      req.addEventListener('change', () => { fl.required = req.checked; save(); });
      const lab = el('input', { type: 'text', value: fl.label, dir: 'auto', style: { maxWidth: '200px' } });
      lab.addEventListener('input', () => { fl.label = lab.value; save(); });
      fieldsBox.append(el('div', { class: 'row' }, on, lab, el('span', { class: 'muted small' }, fl.key), el('span', { class: 'spacer' }), el('label', { class: 'check small' }, req, 'obligatoire'),
        d.custom.includes(fl) ? el('button', { class: 'icon-btn', onclick: () => { d.custom.splice(d.custom.indexOf(fl), 1); save(); drawFields(); } }, '✕') : null));
    }
    const addSel = el('select', { style: { width: 'auto' } }, el('option', { value: '' }, '+ Ajouter un champ personnalisé…'), ...keys.filter((k) => !d.custom.some((c) => c.key === k)).map((k) => el('option', { value: k }, k)), el('option', { value: '__new' }, 'Nouveau champ…'));
    addSel.addEventListener('change', async () => {
      let k = addSel.value;
      if (k === '__new') { k = await promptBox('Nouveau champ', 'Nom du champ (ex. ville)'); if (k) await api('addCustomField', k); }
      if (k) { d.custom.push({ key: k, label: k, on: true, required: false }); save(); drawFields(); }
    });
    fieldsBox.append(addSel);
  };
  drawFields();
  const langSel = el('select', {}, el('option', { value: 'fr' }, 'Français'), el('option', { value: 'ar' }, 'العربية'));
  langSel.value = d.lang;
  langSel.addEventListener('change', () => {
    const from = TEXTS[d.lang] || TEXTS.fr, to = TEXTS[langSel.value] || TEXTS.fr;
    // Remplace les textes encore identiques aux textes par défaut de l'ancienne langue.
    for (const k of ['title', 'text', 'button', 'success']) if (!d[k] || d[k] === from[k]) d[k] = to[k];
    if (!d.consent || d.consent === from.consent(settings.company.name)) d.consent = to.consent(settings.company.name);
    for (const fl of d.fields) if (!fl.label || fl.label === from.labels[fl.key]) fl.label = to.labels[fl.key];
    d.lang = langSel.value;
    save();
    rerender();
  });

  const left = el('div', { class: 'stack' },
    el('div', { class: 'card' }, el('h2', {}, 'Où vont les inscrits ?'),
      el('div', { class: 'stack' }, el('label', { class: 'f' }, 'Liste', listSel), el('div', {}, el('h3', {}, 'Tags ajoutés'), tags.length ? tagBox : el('p', { class: 'muted small' }, 'Aucun tag (créez-en dans Contacts → Tags).')),
        el('label', { class: 'check' }, doi, 'Double opt-in : envoyer un e-mail de confirmation avant d’abonner (recommandé)'),
        el('p', { class: 'muted small', style: { margin: 0 } }, 'Sans double opt-in, n’importe qui peut inscrire n’importe quelle adresse. Avec, seules les adresses confirmées reçoivent vos campagnes.'))),
    el('div', { class: 'card' }, el('h2', {}, 'Champs'), fieldsBox),
    el('div', { class: 'card' }, el('h2', {}, 'Textes'), el('div', { class: 'stack' }, el('label', { class: 'f' }, 'Langue', langSel), inp(d, 'title', 'Titre'), inp(d, 'text', 'Description', 'textarea'), inp(d, 'button', 'Texte du bouton'),
      inp(d, 'consent', 'Case de consentement', 'textarea', 'Case à cocher obligatoire. Laissez vide pour ne pas l’afficher.'),
      inp(d, 'success', 'Message après inscription', 'textarea'), inp(d, 'redirect', 'Rediriger vers (facultatif)', 'url', 'Page https:// de votre site affichée après inscription / confirmation.'))),
    el('div', { class: 'card' }, el('h2', {}, 'Apparence'), el('div', { class: 'stack' }, el('div', { class: 'row' }, inp(d, 'accent', 'Couleur principale', 'color'), inp(d, 'bg', 'Fond du formulaire', 'color'), inp(d, 'pageBg', 'Fond de la page', 'color')),
      inp(d, 'image', 'Image de la page autonome (adresse https://, facultatif)', 'url'))),
    el('div', { class: 'card' }, el('h2', {}, 'E-mail de confirmation (double opt-in)'), el('div', { class: 'stack' },
      inp(f.confirm, 'subject', 'Objet', 'text', 'Par défaut : « Confirmez votre inscription »'), inp(f.confirm, 'text', 'Texte', 'textarea'), inp(f.confirm, 'button', 'Texte du bouton'),
      inp(f.confirm, 'from_email', 'Adresse d’expédition', 'email', `Par défaut : ${settings.defaultFrom?.email || 'expéditeur par défaut (Paramètres)'}`))));

  const frame = el('iframe', { class: 'preview-frame', style: { height: '560px' } });
  const updPreview = () => { frame.srcdoc = landingPage(f, endpoint || 'https://exemple.invalid/', { preview: true }); };
  updPreview();
  const subs = el('div');
  api('submissions', fid).then((rows) => subs.append(rows.length ? el('table', { class: 't' }, el('tbody', {}, ...rows.slice(0, 50).map((r) => el('tr', {}, el('td', {}, r.email), el('td', { class: 'small muted' }, fmtDate(r.at))))))
    : el('div', { class: 'empty' }, 'Aucune inscription pour l’instant.')));
  const right = el('div', { class: 'stack' },
    el('div', { class: 'card' }, el('div', { class: 'row', style: { marginBottom: '10px' } }, el('h2', { style: { margin: 0 } }, 'Aperçu'), el('span', { class: 'spacer' }), el('span', { class: 'muted small' }, 'Envoi désactivé dans l’aperçu')), frame),
    el('div', { class: 'card' }, el('h2', {}, 'Publier'),
      endpoint ? el('div', { class: 'stack' },
        el('div', {}, el('h3', {}, '1. Code à intégrer sur votre site'), el('p', { class: 'muted small', style: { marginTop: 0 } }, 'WordPress : bloc « HTML personnalisé ». Metaforma / autres : bloc de code HTML.'),
          el('button', { class: 'btn', onclick: () => { navigator.clipboard.writeText(embedCode(f, endpoint)); toast('Code copié.'); } }, 'Copier le code HTML')),
        el('div', {}, el('h3', {}, '2. Page d’inscription autonome'), el('p', { class: 'muted small', style: { marginTop: 0 } }, 'Fichier .html complet à héberger (Netlify, votre hébergeur, un sous-domaine…).'),
          el('button', { class: 'btn', onclick: async () => { const p = await window.lynechat.saveFile(`${f.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'inscription'}.html`, landingPage(f, endpoint), [{ name: 'Page HTML', extensions: ['html'] }]); if (p) toast(`Page enregistrée : ${p}`); } }, 'Enregistrer la page .html')),
        el('div', { class: 'note info small' }, 'Les inscriptions arrivent dans Lynechat dès qu’il est ouvert (elles sont conservées 14 jours dans votre file AWS).'))
        : el('div', { class: 'note' }, 'Installez l’infrastructure AWS (Paramètres) pour obtenir le code de publication.')),
    el('div', { class: 'card flush' }, el('div', { style: { padding: '16px 18px 6px' } }, el('h2', {}, 'Dernières inscriptions')), subs));
  page.append(el('div', { class: 'grid2', style: { alignItems: 'start' } }, left, right));
}

function formMarkup(f, endpoint, preview = false) {
  const d = f.design;
  const ar = d.lang === 'ar';
  const fid = f.id;
  const fieldsHtml = [
    { key: 'email', label: ar ? 'البريد الإلكتروني' : 'E-mail', required: true, type: 'email' },
    ...[...d.fields, ...d.custom].filter((x) => x.on !== false).map((x) => ({ ...x, type: x.key === 'phone' ? 'tel' : 'text' })),
  ].map((x) => `<label style="display:block;margin:0 0 12px;font-size:14px;font-weight:600;color:#333">${esc(x.label)}${x.required ? ' *' : ''}
<input name="${esc(x.key)}" type="${x.type}" ${x.required ? 'required' : ''} dir="auto" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:11px 12px;border:1px solid #ccc;border-radius:8px;font-size:15px;font-family:inherit"></label>`).join('\n');
  return `<div id="lynechat-${fid}" dir="${ar ? 'rtl' : 'ltr'}" style="max-width:460px;margin:0 auto;padding:28px;background:${d.bg};border-radius:14px;box-shadow:0 6px 30px rgba(0,0,0,.08);font-family:${ar ? 'Tahoma,' : ''}-apple-system,Segoe UI,Roboto,Arial,sans-serif;text-align:${ar ? 'right' : 'left'}">
<h2 style="margin:0 0 8px;font-size:24px;color:#1d2420">${esc(d.title)}</h2>
<p style="margin:0 0 18px;color:#555;font-size:15px;line-height:1.5">${esc(d.text)}</p>
<form method="post" action="${esc(endpoint)}f/${fid}" ${preview ? 'onsubmit="return false"' : ''}>
${fieldsHtml}
<input type="text" name="_hp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px">
${d.redirect ? `<input type="hidden" name="_redirect" value="${esc(d.redirect)}">` : ''}
${d.consent ? `<label style="display:flex;gap:8px;align-items:flex-start;margin:4px 0 16px;font-size:13px;color:#555;line-height:1.4"><input type="checkbox" required style="margin-top:2px"> <span>${esc(d.consent)}</span></label>` : ''}
<button type="submit" style="width:100%;padding:13px;border:0;border-radius:8px;background:${d.accent};color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit">${esc(d.button)}</button>
<p class="lynechat-msg" style="display:none;margin:14px 0 0;padding:12px;border-radius:8px;background:#eef7f3;color:#1d4d40;font-size:14px"></p>
</form></div>`;
}

function formScript(f) {
  const d = f.design;
  const err = d.lang === 'ar' ? 'حدث خطأ، يرجى المحاولة مرة أخرى.' : 'Une erreur est survenue, merci de réessayer.';
  return `<script>(function(){var r=document.getElementById(${JSON.stringify(`lynechat-${f.id}`)});if(!r)return;var f=r.querySelector('form'),m=r.querySelector('.lynechat-msg'),b=f.querySelector('button');
f.addEventListener('submit',function(e){e.preventDefault();var o={};new FormData(f).forEach(function(v,k){o[k]=v});b.disabled=true;
fetch(f.action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(o)}).then(function(x){if(!x.ok)throw 0;
${d.redirect ? `location.href=${JSON.stringify(d.redirect)};` : ''}m.textContent=${JSON.stringify(d.success)};m.style.display='block';f.reset();Array.prototype.forEach.call(f.querySelectorAll('label,button'),function(n){n.style.display='none'})})
.catch(function(){m.textContent=${JSON.stringify(err)};m.style.background='#fbeceb';m.style.color='#8a2a25';m.style.display='block'}).finally(function(){b.disabled=false})});})();</script>`;
}

function embedCode(f, endpoint) {
  return `<!-- Formulaire Lynechat : ${f.name} -->\n${formMarkup(f, endpoint)}\n${formScript(f)}`;
}

function landingPage(f, endpoint, { preview = false } = {}) {
  const d = f.design;
  const ar = d.lang === 'ar';
  return `<!doctype html><html lang="${ar ? 'ar' : 'fr'}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)}</title></head>
<body style="margin:0;background:${d.pageBg};min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 16px;box-sizing:border-box">
<div style="width:100%;max-width:560px">${d.image ? `<img src="${esc(d.image)}" alt="" style="display:block;width:100%;max-height:280px;object-fit:cover;border-radius:14px;margin-bottom:18px">` : ''}
${formMarkup(f, endpoint, preview)}</div>${preview ? '' : formScript(f)}</body></html>`;
}

// Exposé uniquement pour les tests automatisés.
export const __test = { landingPage, embedCode, defaults };
