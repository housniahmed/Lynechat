import { api, el, toast, run, num, modal, confirmBox } from '../ui.js';
import { refreshConn } from '../app.js';

const REGIONS = [
  ['eu-west-3', 'Europe — Paris (eu-west-3)'], ['eu-west-1', 'Europe — Irlande (eu-west-1)'], ['eu-central-1', 'Europe — Francfort (eu-central-1)'],
  ['eu-west-2', 'Europe — Londres (eu-west-2)'], ['eu-south-1', 'Europe — Milan (eu-south-1)'], ['eu-north-1', 'Europe — Stockholm (eu-north-1)'],
  ['us-east-1', 'États-Unis — Virginie (us-east-1)'], ['us-west-2', 'États-Unis — Oregon (us-west-2)'],
];

export async function settingsView(page) {
  const s = await api('settings');
  page.append(el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'Paramètres'), el('div', { class: 'sub' }, 'Connexion à Amazon SES, identité d’envoi et informations légales'))));

  // ---------- 1. AWS ----------
  const region = el('select', {}, ...REGIONS.map(([v, l]) => el('option', { value: v }, l)));
  region.value = s.aws.region && REGIONS.some(([v]) => v === s.aws.region) ? s.aws.region : 'eu-west-3';
  const keyId = el('input', { type: 'text', value: s.aws.accessKeyId || '', placeholder: 'AKIA…', autocomplete: 'off' });
  const secret = el('input', { type: 'password', placeholder: s.aws.accessKeyId ? '•••••••• (inchangée)' : 'Clé secrète', autocomplete: 'off' });
  const acct = el('div');
  const showAccount = (a) => {
    acct.innerHTML = '';
    if (!a) return;
    acct.append(el('div', { class: 'grid4', style: { marginTop: '12px' } },
      el('div', { class: 'kpi' }, el('div', { class: 'l' }, 'Mode'), el('div', { class: 'v', style: { fontSize: '18px' } }, a.production ? 'Production' : 'Bac à sable')),
      el('div', { class: 'kpi' }, el('div', { class: 'l' }, 'Quota 24 h'), el('div', { class: 'v', style: { fontSize: '18px' } }, num(a.max24h)), el('div', { class: 's' }, `${num(a.sent24h)} utilisés`)),
      el('div', { class: 'kpi' }, el('div', { class: 'l' }, 'Débit max'), el('div', { class: 'v', style: { fontSize: '18px' } }, `${num(a.maxRate)}/s`)),
      el('div', { class: 'kpi' }, el('div', { class: 'l' }, 'Envoi'), el('div', { class: 'v', style: { fontSize: '18px' } }, a.sendingEnabled ? 'Actif' : 'Suspendu'))),
    !a.production ? el('div', { class: 'note', style: { marginTop: '12px' } },
      'Votre compte SES est en « bac à sable » : vous ne pouvez écrire qu’à des adresses vérifiées, avec un petit quota. Pour envoyer à vos contacts, demandez l’accès production dans la console AWS : Amazon SES → Tableau de bord du compte → « Demander l’accès production » (décrivez vos listes, le consentement et la gestion des désinscriptions).') : null);
  };
  if (s.aws.configured) api('awsAccount').then(showAccount).catch((e) => acct.append(el('div', { class: 'note err', style: { marginTop: '10px' } }, e.message)));
  const policy = JSON.stringify(s.iamPolicy, null, 2);

  page.append(el('div', { class: 'card' },
    el('div', { class: 'section-title' }, el('h2', { style: { margin: 0 } }, '1. Compte Amazon Web Services'), el('span', { class: 'spacer' }), s.aws.configured ? el('span', { class: 'badge green' }, 'Connecté') : el('span', { class: 'badge red' }, 'Non connecté')),
    el('p', { class: 'muted', style: { marginTop: 0 } }, `Créez dans la console AWS (IAM) un utilisateur réservé à Lynechat, attachez-lui la politique ci-dessous, puis créez une clé d’accès. ${window.lynechat.web ? 'La clé secrète est enregistrée sur le serveur dans un fichier lisible uniquement par le service Lynechat.' : 'La clé secrète est chiffrée par Windows sur cet ordinateur.'}`),
    el('div', { class: 'grid3' }, el('label', { class: 'f' }, 'Région', region), el('label', { class: 'f' }, 'ID de clé d’accès', keyId), el('label', { class: 'f' }, 'Clé d’accès secrète', secret)),
    el('div', { class: 'row', style: { marginTop: '12px' } },
      el('button', { class: 'btn primary', onclick: (e) => run(e.target, async () => { const a = await api('saveAwsCreds', { region: region.value, accessKeyId: keyId.value, secretAccessKey: secret.value }); secret.value = ''; showAccount(a); refreshConn(); }, 'Connexion à AWS réussie.') }, 'Tester et enregistrer'),
      el('button', { class: 'btn ghost', onclick: () => modal({ title: 'Politique IAM pour l’utilisateur Lynechat', body: el('div', { class: 'stack' }, el('p', { class: 'muted', style: { margin: 0 } }, 'IAM → Utilisateurs → (votre utilisateur) → Ajouter des autorisations → Créer une politique en ligne → onglet JSON.'), el('div', { class: 'code-box' }, policy), el('button', { class: 'btn', onclick: () => { navigator.clipboard.writeText(policy); toast('Copié.'); } }, 'Copier')) }) }, 'Voir la politique IAM à utiliser')),
    acct));

  // ---------- 2. Infrastructure ----------
  const infraBox = el('div');
  const drawInfra = (infra) => {
    infraBox.innerHTML = '';
    infraBox.append(infra?.publicUrl
      ? el('div', { class: 'stack' }, el('div', { class: 'row' }, el('span', { class: 'badge green' }, 'Installée'), el('span', { class: 'muted small' }, `Région ${infra.region} · ${new Date(infra.deployedAt).toLocaleString('fr-FR')}`)),
        el('div', { class: 'small' }, 'Adresse publique (désinscription, confirmation, formulaires) : ', el('code', {}, infra.publicUrl)))
      : el('p', { class: 'muted', style: { margin: 0 } }, 'Pas encore installée.'));
  };
  drawInfra(s.infra);
  const deployMsg = el('div', { class: 'small muted' });
  const off = window.lynechat.on((m) => { if (m.type === 'deploy') deployMsg.textContent = `État : ${m.detail}`; });
  page.append(el('div', { class: 'card' },
    el('h2', {}, '2. Infrastructure d’envoi (dans votre compte AWS)'),
    el('p', { class: 'muted', style: { marginTop: 0 } }, 'Lynechat crée automatiquement : un jeu de configuration SES (suivi des remises, ouvertures, clics, rebonds et plaintes), une file SQS qui reçoit ces événements, et une petite fonction Lambda publique pour les liens de désinscription, la confirmation d’inscription et les formulaires de votre site. Coût : généralement très faible à ce volume (tarifs AWS non vérifiés ici, voir la page de tarification AWS).'),
    infraBox,
    el('div', { class: 'row', style: { marginTop: '12px' } },
      el('button', { class: 'btn primary', onclick: (e) => run(e.target, async () => { deployMsg.textContent = 'Démarrage… (1 à 3 minutes)'; const out = await api('deployInfra'); drawInfra({ ...out, region: region.value, deployedAt: new Date().toISOString() }); deployMsg.textContent = ''; refreshConn(); }, 'Infrastructure prête.') }, s.infra?.publicUrl ? 'Mettre à jour l’infrastructure' : 'Installer l’infrastructure'),
      deployMsg)));

  // ---------- 3. Identités ----------
  const idBox = el('div', { class: 'stack' }, el('p', { class: 'muted' }, s.aws.configured ? 'Chargement…' : 'Connectez d’abord AWS.'));
  const showIdentities = async () => {
    if (!s.aws.configured) return;
    try {
      const ids = await api('identities');
      idBox.innerHTML = '';
      if (!ids.length) idBox.append(el('p', { class: 'muted', style: { margin: 0 } }, 'Aucune identité. Ajoutez votre domaine (recommandé) ou une adresse e-mail.'));
      for (const i of ids) {
        idBox.append(el('div', { class: 'row', style: { padding: '8px 0', borderBottom: '1px solid var(--line)' } },
          el('strong', {}, i.name), el('span', { class: 'muted small' }, i.type === 'DOMAIN' ? 'Domaine' : 'Adresse'),
          i.verified ? el('span', { class: 'badge green' }, 'Vérifiée') : el('span', { class: 'badge amber' }, 'En attente'),
          el('span', { class: 'spacer' }),
          i.type === 'DOMAIN' ? el('button', { class: 'btn sm', onclick: () => showDns(i.name) }, 'Enregistrements DNS') : null,
          el('button', { class: 'btn sm ghost danger', onclick: async () => { if (await confirmBox('Supprimer l’identité ?', `${i.name} ne pourra plus servir d’expéditeur.`, 'Supprimer', true)) { await run(null, () => api('deleteIdentity', i.name)); showIdentities(); } } }, 'Supprimer')));
      }
    } catch (e) { idBox.innerHTML = ''; idBox.append(el('div', { class: 'note err' }, e.message)); }
  };
  const showDns = async (name) => {
    const i = await run(null, () => api('identity', name));
    if (!i) return;
    const rows = i.dkimTokens.map((t) => ['CNAME', `${t}._domainkey.${name}`, `${t}.dkim.amazonses.com`]);
    rows.push(['TXT', `_dmarc.${name}`, 'v=DMARC1; p=none; rua=mailto:postmaster@' + name]);
    modal({
      title: `DNS de ${name}`, size: 'wide',
      body: el('div', { class: 'stack' },
        el('p', { style: { margin: 0 } }, 'Ajoutez ces enregistrements chez votre hébergeur de domaine (OVH, GoDaddy, Cloudflare…). La vérification prend de quelques minutes à 72 heures.'),
        el('div', { class: 'row' }, el('span', {}, 'DKIM : '), i.dkimStatus === 'SUCCESS' ? el('span', { class: 'badge green' }, 'Vérifié') : el('span', { class: 'badge amber' }, i.dkimStatus || 'En attente')),
        el('table', { class: 't dns-table' }, el('thead', {}, el('tr', {}, el('th', {}, 'Type'), el('th', {}, 'Nom'), el('th', {}, 'Valeur'))),
          el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((c) => el('td', {}, c)))))),
        el('div', { class: 'note info small' }, 'Les 3 enregistrements CNAME (DKIM) sont exigés par SES. L’enregistrement DMARC est recommandé : Gmail et Yahoo l’exigent pour les expéditeurs en volume. Si vous avez déjà un enregistrement DMARC, gardez le vôtre.')),
    });
  };
  const newId = el('input', { type: 'text', placeholder: 'mondomaine.com ou contact@mondomaine.com' });
  page.append(el('div', { class: 'card' },
    el('h2', {}, '3. Domaine ou adresse d’envoi (Amazon SES)'),
    el('div', { class: 'row', style: { marginBottom: '12px' } }, newId, el('button', { class: 'btn', onclick: (e) => run(e.target, async () => { const i = await api('createIdentity', newId.value); newId.value = ''; await showIdentities(); if (i.type === 'DOMAIN') showDns(i.name); else toast('AWS a envoyé un e-mail de vérification à cette adresse.'); }) }, 'Ajouter')),
    idBox));
  showIdentities();

  // ---------- 4. Entreprise + expéditeur ----------
  const co = { name: '', address: '', website: '', ...s.company };
  const df = { name: '', email: '', replyTo: '', ...s.defaultFrom };
  const f = (obj, key, label, hint, type = 'text') => {
    const i = el('input', { type, value: obj[key] || '', dir: 'auto' });
    i.addEventListener('input', () => { obj[key] = i.value.trim(); });
    return el('label', { class: 'f' }, label, i, hint ? el('span', { class: 'hint' }, hint) : null);
  };
  const rate = el('input', { type: 'number', min: 0, step: 1, value: s.sendRate || 0 });
  page.append(el('div', { class: 'card' },
    el('h2', {}, '4. Informations légales et expéditeur par défaut'),
    el('div', { class: 'grid2' },
      el('div', { class: 'stack' }, el('h3', {}, 'Votre entreprise'),
        f(co, 'name', 'Nom de l’entreprise', 'Affiché dans le pied de page ({{entreprise}}).'),
        f(co, 'address', 'Adresse postale', 'Obligatoire dans les e-mails commerciaux dans de nombreux pays ({{adresse}}).'),
        f(co, 'website', 'Site web')),
      el('div', { class: 'stack' }, el('h3', {}, 'Expéditeur par défaut'),
        f(df, 'name', 'Nom affiché', 'Ex. « Zenith Advertising » ou « مركز ... »'),
        f(df, 'email', 'Adresse d’expédition', 'Doit appartenir à un domaine ou une adresse vérifié(e) ci-dessus.', 'email'),
        f(df, 'replyTo', 'Adresse de réponse (facultatif)', '', 'email'),
        el('label', { class: 'f' }, 'Vitesse d’envoi maximale (e-mails/seconde)', rate, el('span', { class: 'hint' }, '0 = le maximum autorisé par votre compte SES.')))),
    el('div', { class: 'row', style: { marginTop: '14px' } }, el('button', { class: 'btn primary', onclick: (e) => run(e.target, async () => { await api('saveSettings', { company: co, defaultFrom: df, sendRate: Number(rate.value) }); }, 'Paramètres enregistrés.') }, 'Enregistrer'))));

  page.append(el('div', { class: 'card' },
    el('h2', {}, 'Bonnes pratiques et obligations'),
    el('ul', { class: 'muted', style: { margin: 0, paddingLeft: '18px', lineHeight: 1.7 } },
      el('li', {}, 'N’écrivez qu’à des personnes qui ont donné leur accord. Au Maroc, la loi 09-08 et la CNDP encadrent les données personnelles ; en Europe, le RGPD. Je ne suis pas juriste : vérifiez vos obligations.'),
      el('li', {}, 'Chaque e-mail contient un lien de désinscription en un clic ; les désinscrits, rebonds et plaintes sont exclus automatiquement des envois suivants.'),
      window.lynechat.web ? el('li', {}, 'Version serveur : les envois, campagnes planifiées et automatisations tournent en continu, même navigateur fermé.') : el('li', {}, 'Les e-mails sont envoyés uniquement quand Lynechat est ouvert : laissez l’application ouverte pendant les envois, les campagnes planifiées et les automatisations.'))));

  return () => off();
}
