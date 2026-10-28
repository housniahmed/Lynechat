// Parcours complet de l'interface, avec AWS simulé.
// Bureau : xvfb-run -a node test/ui.test.js <dossier-captures>
// Web    : node test/ui.test.js <dossier-captures> --web   (lance server/server.js et Chromium)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');
const pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));

const WEB = process.argv.includes('--web');
const OUT = process.argv.filter((a) => !a.startsWith('--'))[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'lynechat-shots-'));
fs.mkdirSync(OUT, { recursive: true });
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'lynechat-data-'));
const shot = (page, n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });

async function launch() {
  if (!WEB) {
    const app = await pw._electron.launch({
      executablePath: path.join(__dirname, '../node_modules/electron/dist/electron'),
      args: ['--no-sandbox', path.join(__dirname, '..')],
      env: { ...process.env, LYNECHAT_FAKE_AWS: '1', LYNECHAT_DATA_DIR: DATA },
    });
    return { page: await app.firstWindow(), close: () => app.close() };
  }
  const env = { ...process.env, LYNECHAT_FAKE_AWS: '1', LYNECHAT_DATA_DIR: DATA, PORT: '3917', LYNECHAT_INSECURE_COOKIE: '1' };
  execSync(`node ${path.join(__dirname, '../server/server.js')} --set-password`, { input: 'motdepasse-test-123\n', env });
  const srv = spawn('node', [path.join(__dirname, '../server/server.js')], { env, stdio: 'inherit' });
  process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { /* */ } });
  await new Promise((r) => setTimeout(r, 1500));
  const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto('http://127.0.0.1:3917/');
  await page.waitForURL(/\/login$/);
  await page.fill('#pw', 'mauvais-mot-de-passe');
  await page.click('button[type=submit]');
  await page.waitForSelector('#err:not([hidden])');
  console.log('Connexion refusée avec un mauvais mot de passe : OK');
  const unauth = await page.evaluate(async () => (await fetch('/api/call', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lynechat': '1' }, body: '{"method":"contacts","args":[{}]}' })).status);
  console.log('API sans session :', unauth);
  await page.fill('#pw', 'motdepasse-test-123');
  await page.click('button[type=submit]');
  await page.waitForURL('http://127.0.0.1:3917/');
  const noHeader = await page.evaluate(async () => (await fetch('/api/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"method":"contacts","args":[{}]}' })).status);
  console.log('API sans en-tête anti-CSRF :', noHeader);
  return { page, close: async () => { await browser.close(); srv.kill('SIGTERM'); } };
}

(async () => {
  const { page, close } = await launch();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForSelector('.page-head');
  await shot(page, '01-dashboard-vide');

  // Paramètres : infra + entreprise + expéditeur
  await page.click('a[href="#/settings"]');
  await page.waitForSelector('text=Installer l’infrastructure');
  await page.click('text=Installer l’infrastructure');
  await page.waitForSelector('text=Infrastructure prête.');
  await page.fill('label:has-text("Nom de l’entreprise") input', 'Zenith Advertising');
  await page.fill('label:has-text("Adresse postale") input', '12 bd Anfa, Casablanca, Maroc');
  await page.fill('label:has-text("Nom affiché") input', 'Zenith');
  await page.fill('label:has-text("Adresse d’expédition") input', 'news@zenith.ma');
  await page.click('button:text-is("Enregistrer")');
  await page.waitForSelector('text=Paramètres enregistrés.');
  await page.fill('input[placeholder="mondomaine.com ou contact@mondomaine.com"]', 'zenith.ma');
  await page.click('button:text-is("Ajouter")');
  await page.waitForSelector('text=DNS de zenith.ma');
  await shot(page, '02-dns');
  await page.keyboard.press('Escape');
  await shot(page, '03-parametres');

  // Contacts : liste + import CSV
  await page.click('a[href="#/contacts"]');
  await page.click('button:has-text("Listes")');
  await page.click('button:has-text("Créer une liste")');
  await page.fill('dialog input', 'Clients');
  await page.click('dialog button:has-text("Valider")');
  await page.waitForSelector('td:has-text("Clients")');
  const csv = path.join(DATA, 'contacts.csv');
  fs.writeFileSync(csv, 'Email;Prénom;Nom;Ville;Tags\namine@x.ma;Amine;Alaoui;Rabat;vip\nsara@x.ma;سارة;Bennani;Casablanca;\nbounce@x.ma;Bo;X;Fès;\nmauvais;X;;;\nyoussef@x.ma;Youssef;;Tanger;vip,promo\n');
  await page.click('button:has-text("Importer un fichier CSV")');
  await page.setInputFiles('dialog input[type=file]', csv);
  await page.waitForSelector('text=5 lignes');
  await page.selectOption('dialog select >> nth=5', { label: 'Clients' });
  await shot(page, '04-import');
  await page.click('dialog button:has-text("Importer")');
  await page.waitForSelector('text=Import terminé');
  await shot(page, '05-import-rapport');
  await page.click('dialog:has-text("Import terminé") .modal-head .icon-btn');
  await page.click('button:has-text("Tous les contacts")');
  await page.waitForSelector('td:has-text("amine@x.ma")');
  await shot(page, '06-contacts');
  await page.click('td:has-text("amine@x.ma")');
  await page.waitForSelector('.drawer');
  await shot(page, '07-fiche-contact');
  await page.click('.drawer .icon-btn');

  // Segment
  await page.click('button:has-text("Segments")');
  await page.click('button:has-text("Créer un segment")');
  await page.waitForSelector('dialog:has-text("Nouveau segment")');
  await page.selectOption('dialog .row select >> nth=1', 'custom:Ville');
  await page.fill('dialog .stack .row input[type=text]', 'Casablanca');
  await page.waitForTimeout(400);
  await shot(page, '08-segment');
  await page.click('dialog button:has-text("Enregistrer")');

  // Campagne
  await page.click('a[href="#/campaigns"]');
  await page.click('button:has-text("Créer une campagne")');
  await page.click('dialog button:has-text("Valider")');
  await page.waitForSelector('.wizard');
  await page.click('.wz-item:has-text("Destinataires") button:has-text("Modifier")');
  await page.click('.wz-item:has-text("Destinataires") label:has-text("Clients")');
  await page.click('.wz-item:has-text("Objet") button:has-text("Modifier")');
  await page.fill('.wz-item:has-text("Objet") input >> nth=0', 'Nouveautés d’octobre pour {{prenom|vous}}');
  await page.fill('.wz-item:has-text("Objet") input >> nth=1', 'Nos offres du mois');
  await page.click('.wz-item:has-text("Contenu") button:has-text("Modifier")');
  await page.click('button:has-text("Concevoir l’e-mail")');
  await page.click('dialog .card:has-text("Promotion")');
  await page.waitForSelector('.editor');
  await page.waitForTimeout(300);
  await shot(page, '09-editeur');
  // Ajout d'un bloc par clic + édition directe
  await page.click('.ed-block:has(h1)');
  await page.click('.ed-palette .blk:has-text("Réseaux sociaux")');
  const h1 = page.locator('.ed-block h1').first();
  await h1.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' !');
  await page.click('.ed-block:has-text("Se désinscrire")');
  await shot(page, '10-editeur-pied');
  await page.click('dialog.full button:has-text("Enregistrer") >> nth=-1');
  await page.waitForSelector('.wz-item:has-text("Contenu") iframe');
  await page.waitForTimeout(500);
  await shot(page, '11-campagne');

  // Test puis envoi
  await page.click('button:has-text("Envoyer un test")');
  await page.fill('dialog input', 'moi@zenith.ma');
  await page.click('dialog button:has-text("Envoyer le test")');
  await page.waitForSelector('text=Test envoyé', { timeout: 8000 }).catch(async (e) => { await shot(page, 'echec-test'); throw e; });
  await page.click('button:has-text("Envoyer…")');
  await page.waitForSelector('dialog:has-text("Envoyer maintenant")');
  await shot(page, '12-confirmation-envoi');
  await page.click('dialog button:has-text("Envoyer à")');
  await page.waitForSelector('h2:has-text("Liens cliqués")');
  await page.waitForTimeout(4000);
  await shot(page, '13-rapport');

  // Automatisation
  await page.click('a[href="#/automations"]');
  await page.click('button:has-text("Créer une automatisation")');
  await page.click('dialog .card:has-text("Bienvenue (3 e-mails)")');
  await page.click('dialog button:has-text("Créer")');
  await page.waitForSelector('.flow');
  await page.selectOption('.flow-node.trigger select >> nth=1', { label: 'Clients' });
  await page.click('.flow-node.email >> nth=0 >> button:has-text("Concevoir le contenu")');
  await page.click('dialog .card:has-text("Vide")');
  await page.waitForSelector('.editor');
  await page.click('dialog.full button:has-text("Enregistrer") >> nth=-1');
  await page.waitForSelector('text=E-mail enregistré.');
  await page.waitForTimeout(300);
  await shot(page, '14-automatisation');

  // Formulaire
  await page.click('a[href="#/forms"]');
  await page.click('button:has-text("Créer un formulaire")');
  await page.click('dialog button:has-text("Valider")');
  await page.waitForSelector('text=Où vont les inscrits ?');
  await page.selectOption('.card:has-text("Où vont les inscrits") select', { label: 'Clients' });
  await page.waitForTimeout(600);
  await shot(page, '15-formulaire');

  // Tableau de bord final
  await page.click('a[href="#/"]');
  await page.waitForTimeout(800);
  await shot(page, '16-dashboard');

  if (WEB) {
    await page.click('a[href="#/contacts"]');
    await page.click('button:has-text("Tous les contacts")');
    await page.waitForSelector('td:has-text("amine@x.ma")');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Exporter en CSV")')]);
    const csvPath = path.join(OUT, 'export.csv');
    await dl.saveAs(csvPath);
    console.log('Téléchargement CSV :', dl.suggestedFilename(), fs.readFileSync(csvPath, 'utf8').split('\n').length - 1, 'contacts');
    await page.click('#logoutBtn');
    await page.waitForURL(/\/login$/);
    console.log('Déconnexion : OK');
    await page.fill('#pw', 'motdepasse-test-123');
    await page.click('button[type=submit]');
    await page.waitForURL('http://127.0.0.1:3917/');
  }
  // Vérifications côté données
  const res = await page.evaluate(async () => {
    const camps = await window.lynechat.call('campaigns');
    const counts = await window.lynechat.call('counts');
    const full = await window.lynechat.call('campaign', camps[0].id);
    return { camps: camps.map((c) => ({ status: c.status, sent: c.stats?.sent, failed: c.stats?.failed, opens: c.stats?.opens })), counts,
      titreModifie: full.html.includes('pendant 48 h !'), blocSocial: full.html.includes('Instagram'), lienDesinscription: full.html.includes('{{lien_desinscription}}') };
  });
  console.log('RÉSULTAT', JSON.stringify(res));
  console.log('ERREURS', JSON.stringify(errors));
  console.log('CAPTURES', OUT);
  await close();
})().catch(async (e) => { console.error('ÉCHEC', e); process.exit(1); });
