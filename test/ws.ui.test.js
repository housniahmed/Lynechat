// Interface des espaces clients et des rapports PDF (application de bureau, AWS simulé).
// Lancer : xvfb-run -a node test/ws.ui.test.js <dossier-captures>
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { execSync } = require('child_process');
const pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));

const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'lynechat-ws-'));
fs.mkdirSync(OUT, { recursive: true });
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'lynechat-wsdata-'));
const SAVE = fs.mkdtempSync(path.join(os.tmpdir(), 'lynechat-pdf-'));
const shot = (page, n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const app = await pw._electron.launch({
    executablePath: path.join(__dirname, '../node_modules/electron/dist/electron'),
    args: ['--no-sandbox', path.join(__dirname, '..')],
    env: { ...process.env, LYNECHAT_FAKE_AWS: '1', LYNECHAT_DATA_DIR: DATA, LYNECHAT_TEST_SAVE_DIR: SAVE },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForSelector('.ws-btn');
  const call = (m, ...a) => page.evaluate(([m, a]) => window.lynechat.call(m, ...a), [m, a]);

  await call('deployInfra');
  await call('saveSettings', { company: { name: 'Zenith', address: 'Casablanca' }, defaultFrom: { name: 'Zenith', email: 'news@zenith.test' } });
  assert.strictEqual((await page.textContent('.ws-btn .nm')).trim(), 'Principal');

  // Création d'un espace depuis le menu
  await page.click('.ws-btn');
  await page.waitForSelector('.ws-menu');
  await shot(page, '01-menu-espaces');
  await page.click('.ws-menu >> text=+ Nouvel espace client');
  await page.fill('dialog input[type=text]', 'Centre de Radiologie Deroua');
  await page.click('dialog .swatches button >> nth=2');
  await shot(page, '02-nouvel-espace');
  await page.click('dialog >> text=Créer l’espace');
  await page.waitForFunction(() => location.hash === '#/settings');
  await page.waitForSelector('text=propre à l’espace');
  assert.strictEqual((await page.textContent('.ws-btn .nm')).trim(), 'Centre de Radiologie Deroua');
  await shot(page, '03-parametres-espace');

  // Données de l'espace client
  await call('saveSettings', { company: { name: 'Centre de Radiologie Deroua', address: 'Deroua, Maroc', website: 'https://radiologie.test' }, defaultFrom: { name: 'Radiologie Deroua', email: 'info@radiologie.test' } });
  const lid = await call('createList', 'Patientes');
  const listId = typeof lid === 'string' ? lid : lid.id;
  for (const e of ['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test', 'e@x.test']) await call('saveContact', { email: e, first_name: 'Test', listIds: [listId] });
  const cid = await call('createCampaign', 'Octobre rose : dépistage');
  const c = await call('campaign', cid);
  await call('saveCampaign', { ...c, subject: 'Prenez rendez-vous', audience: { lists: [listId] }, html: '<html><body><p>Bonjour</p><a href="https://radiologie.test/rdv">Réserver</a> <a href="{{lien_desinscription}}">Se désinscrire</a></body></html>' });
  await call('sendCampaign', cid);
  for (let i = 0; i < 60 && (await call('campaign', cid)).status !== 'sent'; i++) await sleep(200);
  await sleep(2500); // laisse la file d'événements simulée se vider

  // L'espace principal ne voit pas ces données
  await page.click('.ws-btn');
  await page.click('.ws-menu >> text=Principal');
  await page.waitForFunction(() => document.querySelector('.ws-btn .nm')?.textContent.trim() === 'Principal');
  assert.strictEqual((await call('campaigns')).length, 0, 'aucune campagne de l’espace client dans l’espace principal');

  // Page Espaces clients + identité de l'agence
  await page.click('a[href="#/workspaces"]');
  await page.waitForSelector('.ws-card');
  assert.strictEqual(await page.locator('.ws-card').count(), 2);
  await page.fill('input[placeholder="Ex. Zenith Advertising"]', 'Zenith Advertising');
  await page.click('text=Enregistrer >> nth=-1');
  await page.waitForSelector('text=Identité de l’agence enregistrée.');
  await shot(page, '04-espaces-clients');

  // Retour dans l'espace client, rapports
  await page.click('.ws-card:has-text("Deroua") >> text=Ouvrir');
  await page.waitForFunction(() => document.querySelector('.ws-btn .nm')?.textContent.includes('Deroua'));
  await page.click('a[href="#/reports"]');
  await page.waitForSelector('text=Rapport d’une campagne');
  await page.waitForSelector('table.t >> text=Octobre rose');
  await shot(page, '05-rapports');
  await page.click('table.t >> text=PDF');
  for (let i = 0; i < 50 && !fs.readdirSync(SAVE).length; i++) await sleep(200);
  await page.click('text=Mois en cours');
  await page.fill('textarea', 'Bonne mobilisation pour Octobre rose.');
  await page.click('text=Générer le PDF');
  for (let i = 0; i < 50 && fs.readdirSync(SAVE).length < 2; i++) await sleep(200);
  const pdfs = fs.readdirSync(SAVE).sort();
  console.log('PDF :', pdfs);
  assert.strictEqual(pdfs.length, 2);
  for (const f of pdfs) {
    const buf = fs.readFileSync(path.join(SAVE, f));
    assert.strictEqual(buf.subarray(0, 5).toString(), '%PDF-');
    fs.copyFileSync(path.join(SAVE, f), path.join(OUT, f));
  }

  // Bouton « Rapport PDF » sur la page de statistiques
  await page.goto(page.url().replace(/#.*$/, `#/campaigns/${cid}/report`));
  await page.waitForSelector('text=Rapport PDF');
  await shot(page, '06-statistiques-campagne');

  console.log('ERREURS', errors);
  assert.deepStrictEqual(errors, []);
  await app.close();
  console.log('ws.ui.test.js : OK —', OUT);
})().catch(async (e) => { console.error(e); process.exit(1); });
