// Rapports clients (HTML autonome au format A4, converti en PDF par l'application).
// Aucune ressource externe : polices système, graphiques en SVG intégré, logos en data URL.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (x) => `${(Math.round((x || 0) * 1000) / 10).toLocaleString('fr-FR')} %`;
const num = (n) => Number(n || 0).toLocaleString('fr-FR');
const safeColor = (c, d = '#1f6f5c') => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : d);
const safeImg = (u) => (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(u || '') ? u : '');
const fmtDate = (iso, time = true) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', time ? { dateStyle: 'long', timeStyle: 'short' } : { dateStyle: 'long' });
};
const ratio = (a, b) => (b ? a / b : 0);

function shell({ title, subtitle, brand, body }) {
  const ag = brand.agency || {};
  const cl = brand.client || {};
  const accent = safeColor(ag.color);
  const agLogo = safeImg(ag.logo);
  const clLogo = ag.showClientLogo === false ? '' : safeImg(cl.logo);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { size: A4; margin: 16mm 14mm 18mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #1d2320; font-size: 10.5pt; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 12px; border-bottom: 3px solid ${accent}; }
.top .side { display: flex; align-items: center; gap: 10px; min-height: 40px; }
.top img { max-height: 44px; max-width: 160px; object-fit: contain; }
.top .ag { font-weight: 700; font-size: 12pt; }
.top .cl { font-weight: 600; color: #4a524e; text-align: right; }
h1 { font-size: 19pt; margin: 18px 0 2px; }
.sub { color: #5d6661; margin: 0 0 16px; }
h2 { font-size: 12pt; margin: 22px 0 8px; color: ${accent}; break-after: avoid; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.kpi { border: 1px solid #e3e6e4; border-radius: 8px; padding: 10px 12px; break-inside: avoid; }
.kpi b { display: block; font-size: 17pt; line-height: 1.2; }
.kpi span { color: #5d6661; font-size: 9pt; }
.kpi small { display: block; color: #7b847f; font-size: 8.5pt; }
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
th { text-align: left; font-weight: 600; color: #5d6661; border-bottom: 1px solid #d6dbd8; padding: 6px 6px; }
td { border-bottom: 1px solid #eef0ef; padding: 6px; vertical-align: top; }
td.n, th.n { text-align: right; white-space: nowrap; }
tr { break-inside: avoid; }
.url { word-break: break-all; color: #2f5fb3; }
.meta { display: grid; grid-template-columns: 150px 1fr; gap: 4px 12px; font-size: 9.5pt; }
.meta div:nth-child(odd) { color: #5d6661; }
.chart { border: 1px solid #e3e6e4; border-radius: 8px; padding: 10px; break-inside: avoid; }
.note { color: #5d6661; font-size: 8.5pt; margin-top: 18px; border-top: 1px solid #e3e6e4; padding-top: 8px; }
.foot { color: #7b847f; font-size: 8.5pt; margin-top: 10px; display: flex; justify-content: space-between; }
.empty { color: #7b847f; font-style: italic; }
[dir=auto] { unicode-bidi: plaintext; }
</style></head><body>
<div class="top">
  <div class="side">${agLogo ? `<img src="${agLogo}" alt="">` : ''}<span class="ag" dir="auto">${esc(ag.name || '')}</span></div>
  <div class="side"><span class="cl" dir="auto">${esc(cl.name || '')}</span>${clLogo ? `<img src="${clLogo}" alt="">` : ''}</div>
</div>
<h1 dir="auto">${esc(title)}</h1>
<p class="sub" dir="auto">${esc(subtitle)}</p>
${body}
<div class="foot"><span>Rapport généré le ${esc(fmtDate(new Date().toISOString()))}${ag.name ? ` par ${esc(ag.name)}` : ''}</span><span>${esc([ag.website, ag.email].filter(Boolean).join(' · '))}</span></div>
</body></html>`;
}

const kpi = (label, value, small = '') => `<div class="kpi"><b>${value}</b><span>${esc(label)}</span>${small ? `<small>${small}</small>` : ''}</div>`;

/** Barres horizontales : envoyés → délivrés → ouverts → cliqués. */
function funnelSvg(rows, color) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  const h = 26, w = 660, lab = 150, bw = w - lab - 90;
  const bars = rows.map(([label, v], i) => {
    const len = Math.max(v ? 2 : 0, Math.round((v / max) * bw));
    const y = i * (h + 8);
    return `<text x="0" y="${y + 17}" font-size="12" fill="#4a524e">${esc(label)}</text>
<rect x="${lab}" y="${y}" width="${bw}" height="${h}" rx="4" fill="#f0f2f1"/>
<rect x="${lab}" y="${y}" width="${len}" height="${h}" rx="4" fill="${color}" opacity="${1 - i * 0.18}"/>
<text x="${lab + bw + 8}" y="${y + 17}" font-size="12" fill="#1d2320" font-weight="600">${esc(num(v))}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${rows.length * (h + 8)}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, Tahoma, Arial, sans-serif">${bars}</svg>`;
}

/** Activité dans le temps (ouvertures et clics), par heure sur les 72 premières heures, sinon par jour. */
function timelineSvg(timeline, startIso, color) {
  if (!timeline?.length) return '<p class="empty">Aucune ouverture ni aucun clic enregistré pour le moment.</p>';
  const t0 = new Date(startIso || `${timeline[0].hour}:00:00Z`).getTime();
  const lastH = new Date(`${timeline[timeline.length - 1].hour}:00:00Z`).getTime();
  const hourly = (lastH - t0) / 36e5 <= 72;
  const key = (h) => (hourly ? h : h.slice(0, 10));
  const buckets = new Map();
  for (const r of timeline) {
    const k = key(r.hour);
    const b = buckets.get(k) || { open: 0, click: 0 };
    b[r.type] += r.n;
    buckets.set(k, b);
  }
  const keys = [...buckets.keys()].sort();
  const max = Math.max(1, ...keys.map((k) => Math.max(buckets.get(k).open, buckets.get(k).click)));
  const w = 660, h = 150, left = 34, bottom = 22, n = keys.length;
  const step = (w - left) / Math.max(n, 1);
  const bw = Math.max(1.5, Math.min(12, step * 0.38)); // deux barres côte à côte par période
  const y = (v) => h - bottom - (v / max) * (h - bottom - 8);
  const bars = keys.map((k, i) => {
    const b = buckets.get(k);
    const x = left + i * step + step / 2 - bw;
    return `<rect x="${x.toFixed(1)}" y="${y(b.open).toFixed(1)}" width="${bw.toFixed(1)}" height="${(h - bottom - y(b.open)).toFixed(1)}" fill="${color}"/>`
      + `<rect x="${(x + bw).toFixed(1)}" y="${y(b.click).toFixed(1)}" width="${bw.toFixed(1)}" height="${(h - bottom - y(b.click)).toFixed(1)}" fill="#1d2320"/>`;
  }).join('');
  const every = Math.ceil(n / 8);
  const labels = keys.map((k, i) => (i % every ? '' : `<text x="${(left + i * step + step / 2).toFixed(1)}" y="${h - 6}" font-size="10" fill="#5d6661" text-anchor="middle">${esc(hourly ? `${k.slice(8, 10)}/${k.slice(5, 7)} ${k.slice(11, 13)}h` : `${k.slice(8, 10)}/${k.slice(5, 7)}`)}</text>`)).join('');
  const axis = `<line x1="${left}" y1="${h - bottom}" x2="${w}" y2="${h - bottom}" stroke="#d6dbd8"/><text x="${left - 6}" y="${y(max) + 4}" font-size="10" fill="#5d6661" text-anchor="end">${esc(num(max))}</text><text x="${left - 6}" y="${h - bottom}" font-size="10" fill="#5d6661" text-anchor="end">0</text>`;
  const legend = `<p style="margin:6px 0 0;font-size:8.5pt;color:#5d6661"><span style="display:inline-block;width:10px;height:10px;background:${color};margin-right:4px"></span>Ouvertures <span style="display:inline-block;width:10px;height:10px;background:#1d2320;margin:0 4px 0 12px"></span>Clics — ${hourly ? 'par heure (heure UTC)' : 'par jour'}</p>`;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, Tahoma, Arial, sans-serif">${axis}${bars}${labels}</svg>${legend}`;
}

const METHOD_NOTE = 'Méthode : les chiffres proviennent des événements transmis par Amazon SES. Les ouvertures et les clics sont comptés une fois par destinataire ; ceux qu’AWS signale comme probablement automatiques (robots, antivirus) sont exclus. Le taux d’ouverture est une estimation : certaines messageries chargent les images automatiquement (ouvertures surestimées) ou les bloquent (ouvertures sous-estimées). Les taux sont calculés sur les e-mails délivrés.';

function campaignReport(d, brand, opts = {}) {
  const s = d.stats;
  const c = d.campaign;
  const accent = safeColor(brand.agency?.color);
  const base = s.delivered || s.sent;
  const body = `
<div class="kpis">
${kpi('E-mails envoyés', num(s.sent), s.failed ? `${num(s.failed)} en échec` : '')}
${kpi('Délivrés', num(s.delivered), pct(ratio(s.delivered, s.sent)))}
${kpi('Taux d’ouverture', pct(s.openRate), `${num(s.opens)} destinataires`)}
${kpi('Taux de clic', pct(s.clickRate), `${num(s.clicks)} destinataires`)}
${kpi('Clics / ouvertures', pct(ratio(s.clicks, s.opens)), 'parmi ceux qui ont ouvert')}
${kpi('Rebonds', num(s.bounces), pct(s.bounceRate))}
${kpi('Désinscriptions', num(s.unsubscribes), pct(s.unsubRate))}
${kpi('Plaintes (spam)', num(s.complaints), pct(ratio(s.complaints, base)))}
</div>
<h2>Parcours des destinataires</h2>
<div class="chart">${funnelSvg([['Envoyés', s.sent], ['Délivrés', s.delivered], ['Ont ouvert', s.opens], ['Ont cliqué', s.clicks]], accent)}</div>
<h2>Activité dans le temps</h2>
<div class="chart">${timelineSvg(s.timeline, c.started_at, accent)}</div>
<h2>Liens les plus cliqués</h2>
${s.links?.length ? `<table><thead><tr><th>Lien</th><th class="n">Clics</th><th class="n">Personnes</th></tr></thead><tbody>${s.links.slice(0, 15).map((l) => `<tr><td class="url">${esc(l.url)}</td><td class="n">${num(l.total)}</td><td class="n">${num(l.uniq)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Aucun clic enregistré.</p>'}
<div style="break-inside: avoid"><h2>Détails de la campagne</h2>
<div class="meta">
<div>Objet</div><div dir="auto">${esc(c.subject)}</div>
${c.preheader ? `<div>Texte d’aperçu</div><div dir="auto">${esc(c.preheader)}</div>` : ''}
<div>Expéditeur</div><div dir="auto">${esc(c.from_name ? `${c.from_name} <${c.from_email}>` : c.from_email)}</div>
<div>Audience</div><div dir="auto">${esc(d.audience.join(' · ') || '—')}</div>
<div>Début de l’envoi</div><div>${esc(fmtDate(c.started_at))}</div>
<div>Fin de l’envoi</div><div>${c.status === 'sent' ? esc(fmtDate(c.sent_at)) : 'envoi non terminé'}</div>
</div></div>
${opts.comment ? `<h2>Commentaire</h2><p dir="auto" style="white-space:pre-wrap">${esc(opts.comment)}</p>` : ''}
<p class="note">${esc(METHOD_NOTE)} Données arrêtées au ${esc(fmtDate(d.generatedAt))}.</p>`;
  return shell({ title: c.name, subtitle: `Rapport de campagne · ${c.sent_at ? `envoyée le ${fmtDate(c.sent_at)}` : `envoi commencé le ${fmtDate(c.started_at)}`}`, brand, body });
}

function periodReport(d, brand, opts = {}) {
  const t = d.totals;
  const body = `
<div class="kpis">
${kpi('Campagnes envoyées', num(t.campaigns))}
${kpi('E-mails de campagne', num(t.sent), `${num(t.delivered)} délivrés`)}
${kpi('Taux d’ouverture moyen', pct(t.openRate), 'pondéré par les envois')}
${kpi('Taux de clic moyen', pct(t.clickRate), 'pondéré par les envois')}
${kpi('E-mails automatiques', num(d.automations.sent), 'séquences d’automatisation')}
${kpi('Nouveaux contacts', num(d.audience.newContacts))}
${kpi('Désinscriptions', num(d.audience.unsubscribes))}
${kpi('Abonnés actuels', num(d.audience.subscribedNow), 'à la date du rapport')}
</div>
<h2>Campagnes de la période</h2>
${d.campaigns.length ? `<table><thead><tr><th>Campagne</th><th>Date</th><th class="n">Envoyés</th><th class="n">Ouverture</th><th class="n">Clic</th><th class="n">Rebonds</th><th class="n">Désinscr.</th></tr></thead><tbody>
${d.campaigns.map((c) => `<tr><td dir="auto"><b>${esc(c.name)}</b><br><span style="color:#5d6661">${esc(c.subject)}</span></td><td>${esc(fmtDate(c.sent_at || c.started_at, false))}</td><td class="n">${num(c.stats.sent)}</td><td class="n">${pct(c.stats.openRate)}</td><td class="n">${pct(c.stats.clickRate)}</td><td class="n">${num(c.stats.bounces)}</td><td class="n">${num(c.stats.unsubscribes)}</td></tr>`).join('')}
</tbody></table>` : '<p class="empty">Aucune campagne envoyée sur cette période.</p>'}
<h2>Formulaires d’inscription</h2>
${d.audience.forms.length ? `<table><thead><tr><th>Formulaire</th><th class="n">Inscriptions reçues</th></tr></thead><tbody>${d.audience.forms.map((f) => `<tr><td dir="auto">${esc(f.name)}</td><td class="n">${num(f.n)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Aucune inscription par formulaire sur cette période.</p>'}
${opts.comment ? `<h2>Commentaire</h2><p dir="auto" style="white-space:pre-wrap">${esc(opts.comment)}</p>` : ''}
<p class="note">${esc(METHOD_NOTE)} Les moyennes de la période additionnent les destinataires de toutes les campagnes (un même contact peut compter dans plusieurs campagnes). Les « nouveaux contacts » comptent les contacts créés pendant la période, quel que soit leur statut actuel.</p>`;
  return shell({ title: 'Rapport d’activité e-mailing', subtitle: `Du ${fmtDate(`${d.from}T12:00:00Z`, false)} au ${fmtDate(`${d.to}T12:00:00Z`, false)}`, brand, body });
}

function fileName(brand, label) {
  const clean = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `Rapport-${clean(brand.client?.name) || 'client'}-${clean(label) || 'lynechat'}.pdf`;
}

module.exports = { campaignReport, periodReport, fileName };
