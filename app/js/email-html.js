// Conversion du design (blocs) en HTML d'e-mail compatible avec les messageries (tableaux + styles en ligne).
import { esc } from './ui.js';

export const FONTS = [
  ['Arial, Helvetica, sans-serif', 'Arial'],
  ['Helvetica, Arial, sans-serif', 'Helvetica'],
  ['Georgia, "Times New Roman", serif', 'Georgia'],
  ['Tahoma, Verdana, sans-serif', 'Tahoma (arabe lisible)'],
  ['Verdana, Geneva, sans-serif', 'Verdana'],
  ['"Trebuchet MS", Arial, sans-serif', 'Trebuchet'],
];

export function defaultSettings(lang = 'fr') {
  return { bg: '#f3f1ec', contentBg: '#ffffff', width: 600, font: lang === 'ar' ? 'Tahoma, Verdana, sans-serif' : 'Arial, Helvetica, sans-serif', color: '#222222', link: '#1f6f5c', dir: lang === 'ar' ? 'rtl' : 'ltr', lang };
}

let n = 0;
export const bid = () => `b${Date.now().toString(36)}${(n++).toString(36)}`;

export function newBlock(type, lang = 'fr') {
  const ar = lang === 'ar';
  const base = { id: bid(), type, pt: 12, pb: 12, bg: '' };
  switch (type) {
    case 'heading': return { ...base, text: ar ? 'عنوان رئيسي' : 'Votre titre ici', size: 28, align: ar ? 'right' : 'left', color: '' };
    case 'text': return { ...base, html: ar ? 'مرحباً {{prenom}}،<br>اكتب نص رسالتك هنا.' : 'Bonjour {{prenom|}},<br>Écrivez votre message ici.', size: 16, align: ar ? 'right' : 'left' };
    case 'image': return { ...base, src: '', alt: '', width: 100, link: '', align: 'center' };
    case 'button': return { ...base, text: ar ? 'اكتشف المزيد' : 'Découvrir', url: 'https://', bg: '#1f6f5c', color: '#ffffff', align: 'center', radius: 6, full: false };
    case 'divider': return { ...base, color: '#e2ded4', thickness: 1 };
    case 'spacer': return { ...base, height: 24, pt: 0, pb: 0 };
    case 'imagetext': return { ...base, src: '', alt: '', html: ar ? '<b>عنوان</b><br>وصف قصير للمنتج أو الخدمة.' : '<b>Titre</b><br>Une courte description du produit ou du service.', side: 'left' };
    case 'social': return { ...base, align: 'center', links: [{ net: 'Instagram', url: 'https://instagram.com/' }, { net: 'Facebook', url: 'https://facebook.com/' }, { net: 'WhatsApp', url: 'https://wa.me/' }] };
    case 'html': return { ...base, code: '<p>HTML personnalisé</p>' };
    case 'footer': return {
      ...base, pt: 20, pb: 24, size: 12, align: 'center', color: '#777777',
      html: ar ? '{{entreprise}} — {{adresse}}<br>تتلقى هذه الرسالة لأنك مشترك في قائمتنا البريدية.<br><a href="{{lien_desinscription}}">إلغاء الاشتراك</a>'
        : '{{entreprise}} — {{adresse}}<br>Vous recevez cet e-mail car vous êtes inscrit(e) à notre liste.<br><a href="{{lien_desinscription}}">Se désinscrire</a>',
    };
    default: return base;
  }
}

export const BLOCKS = [
  ['heading', 'Titre', 'H'], ['text', 'Texte', '¶'], ['image', 'Image', '▣'], ['button', 'Bouton', '⬭'],
  ['imagetext', 'Image + texte', '◧'], ['divider', 'Séparateur', '—'], ['spacer', 'Espace', '↕'], ['social', 'Réseaux sociaux', '@'], ['html', 'Code HTML', '</>'],
];

/** Nettoie le HTML saisi dans un bloc texte (balises autorisées uniquement). */
export function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'A', 'BR', 'SPAN', 'P', 'DIV', 'UL', 'OL', 'LI', 'FONT']);
  const walk = (node) => {
    for (const ch of [...node.childNodes]) {
      if (ch.nodeType === 1) {
        if (!ALLOWED.has(ch.tagName)) { ch.replaceWith(...ch.childNodes); continue; }
        for (const a of [...ch.attributes]) {
          const keep = (ch.tagName === 'A' && a.name === 'href' && /^(https?:|mailto:|tel:|\{\{)/.test(a.value)) || (a.name === 'style' && /^(\s*(color|font-weight|font-style|text-decoration)\s*:[^;]+;?)+$/.test(a.value)) || (ch.tagName === 'FONT' && a.name === 'color');
          if (!keep) ch.removeAttribute(a.name);
        }
        walk(ch);
      } else if (ch.nodeType !== 3) ch.remove();
    }
  };
  walk(doc.body.firstChild);
  return doc.body.firstChild.innerHTML;
}

const SOCIAL_COLORS = { Instagram: '#c13584', Facebook: '#1877f2', WhatsApp: '#25d366', TikTok: '#111111', LinkedIn: '#0a66c2', YouTube: '#ff0000', X: '#111111', 'Site web': '#555555' };

function pad(b) { return `padding:${Number(b.pt) || 0}px 24px ${Number(b.pb) || 0}px 24px;`; }

/** @param resolve (src) => URL affichable (pour l'aperçu : asset:ID → data:…) */
export function settingsOf(design) { return { ...defaultSettings(), ...(design.settings || {}) }; }

/** HTML intérieur d'un bloc (contenu de sa cellule). */
export function blockInner(s, b, resolve = (x) => x) {
  const link = `color:${s.link};`;
  const fixLinks = (h) => String(h).replace(/<a /g, `<a style="${link}" `);
  switch (b.type) {
    case 'heading':
      return `<h1 style="margin:0;font-family:${s.font};font-size:${b.size}px;line-height:1.25;color:${b.color || s.color};text-align:${b.align};font-weight:bold">${fixLinks(b.text)}</h1>`;
    case 'text':
      return `<div style="font-family:${s.font};font-size:${b.size}px;line-height:1.6;color:${b.color || s.color};text-align:${b.align}">${fixLinks(b.html)}</div>`;
    case 'image': {
      const w = Math.round((s.width - 48) * (b.width / 100));
      const src = b.src ? resolve(b.src) : '';
      const img = src ? `<img src="${esc(src)}" alt="${esc(b.alt)}" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;${b.align === 'center' ? 'margin:0 auto;' : b.align === 'right' ? 'margin-left:auto;' : ''}">`
        : `<div style="background:#ece9e1;color:#8a8a8a;text-align:center;padding:40px 0;font-family:${s.font};font-size:14px">Choisissez une image</div>`;
      return `<div style="text-align:${b.align}">${b.link ? `<a href="${esc(b.link)}">${img}</a>` : img}</div>`;
    }
    case 'button': {
      const a = `<a href="${esc(b.url)}" style="background:${b.bg};color:${b.color};display:${b.full ? 'block' : 'inline-block'};padding:13px 26px;border-radius:${b.radius}px;font-family:${s.font};font-size:16px;font-weight:bold;text-decoration:none;text-align:center">${esc(b.text)}</a>`;
      return `<div style="text-align:${b.align}">${a}</div>`;
    }
    case 'divider': return `<div style="border-top:${b.thickness}px solid ${b.color};font-size:0;line-height:0">&nbsp;</div>`;
    case 'spacer': return `<div style="height:${b.height}px;font-size:0;line-height:0">&nbsp;</div>`;
    case 'imagetext': {
      const src = b.src ? resolve(b.src) : '';
      const img = src ? `<img src="${esc(src)}" alt="${esc(b.alt)}" width="250" style="display:block;width:100%;max-width:250px;height:auto;border:0">` : '<div style="background:#ece9e1;height:150px"></div>';
      const txt = `<div class="it-text" style="font-family:${s.font};font-size:15px;line-height:1.55;color:${s.color};text-align:${s.dir === 'rtl' ? 'right' : 'left'}">${fixLinks(b.html)}</div>`;
      const cells = [`<td width="50%" valign="top" style="padding:0 8px">${img}</td>`, `<td width="50%" valign="top" style="padding:0 8px">${txt}</td>`];
      if (b.side === 'right') cells.reverse();
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells.join('')}</tr></table>`;
    }
    case 'social':
      return `<div style="text-align:${b.align}">${(b.links || []).filter((l) => l.url).map((l) => `<a href="${esc(l.url)}" style="display:inline-block;margin:3px;padding:7px 12px;border-radius:99px;background:${SOCIAL_COLORS[l.net] || '#555'};color:#fff;font-family:${s.font};font-size:13px;font-weight:bold;text-decoration:none">${esc(l.net)}</a>`).join('')}</div>`;
    case 'html': return b.code;
    case 'footer':
      return `<div style="font-family:${s.font};font-size:${b.size}px;line-height:1.6;color:${b.color};text-align:${b.align}">${String(b.html).replace(/<a href="\{\{lien_desinscription\}\}"/g, `<a href="{{lien_desinscription}}" ses:no-track style="color:${b.color};text-decoration:underline"`).replace(/<a (?!href="\{\{lien_desinscription)/g, `<a style="color:${b.color}" `)}</div>`;
    default: return '';
  }
}

export function blockCellStyle(b) { return `${pad(b)}${b.bg ? `background:${b.bg};` : ''}`; }

/** @param resolve (src) => URL affichable (pour l'aperçu : asset:ID → data:…) */
export function renderEmail(design, { resolve = (x) => x } = {}) {
  const s = settingsOf(design);
  const rows = (design.blocks || []).map((b) => `<tr><td style="${blockCellStyle(b)}">${blockInner(s, b, resolve)}</td></tr>`).join('\n');
  return `<!doctype html>
<html lang="${s.lang}" dir="${s.dir}" xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<title>${esc(design.title || '')}</title>
<style>body{margin:0;padding:0}img{border:0;-ms-interpolation-mode:bicubic}table{border-collapse:collapse}a{color:${s.link}}@media (max-width:620px){.wrap{width:100%!important}}</style></head>
<body style="margin:0;padding:0;background:${s.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${s.bg}"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" class="wrap" width="${s.width}" cellpadding="0" cellspacing="0" dir="${s.dir}" style="width:${s.width}px;max-width:100%;background:${s.contentBg};border-radius:8px;overflow:hidden">
${rows}
</table></td></tr></table></body></html>`;
}

/** Modèles de départ. */
export function starterDesigns(lang = 'fr') {
  const ar = lang === 'ar';
  const mk = (blocks) => ({ settings: defaultSettings(lang), blocks: [...blocks, newBlock('footer', lang)] });
  const B = (t, o = {}) => ({ ...newBlock(t, lang), ...o });
  return [
    { name: ar ? 'فارغ' : 'Vide', design: mk([B('text')]) },
    {
      name: ar ? 'نشرة إخبارية' : 'Newsletter',
      design: mk([
        B('heading', { text: ar ? 'أخبار هذا الشهر' : 'Les nouvelles du mois', align: 'center' }),
        B('image'),
        B('text'),
        B('imagetext'),
        B('imagetext', { side: 'right' }),
        B('button'),
        B('divider'),
        B('social'),
      ]),
    },
    {
      name: ar ? 'عرض ترويجي' : 'Promotion',
      design: mk([
        B('heading', { text: ar ? 'خصم 30٪ لمدة 48 ساعة' : '-30 % pendant 48 h', size: 34, align: 'center' }),
        B('text', { html: ar ? 'عرض حصري لمشتركينا. استخدم الرمز <b>PROMO30</b>.' : 'Offre réservée à nos abonnés. Utilisez le code <b>PROMO30</b>.', align: 'center' }),
        B('image'),
        B('button', { text: ar ? 'تسوق الآن' : 'J’en profite', full: true }),
      ]),
    },
    {
      name: ar ? 'إعلان / حدث' : 'Annonce / événement',
      design: mk([
        B('heading', { text: ar ? 'أنتم مدعوون' : 'Vous êtes invité(e)', align: 'center' }),
        B('text', { html: ar ? '<b>التاريخ :</b> [التاريخ]<br><b>المكان :</b> [المكان]' : '<b>Date :</b> [date]<br><b>Lieu :</b> [lieu]', align: 'center' }),
        B('button', { text: ar ? 'أؤكد حضوري' : 'Je m’inscris' }),
      ]),
    },
  ];
}
