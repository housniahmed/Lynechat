// Espaces clients : isolation des données, routage des événements AWS, rapports.
// Lancer : node test/hub.test.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

process.env.LYNECHAT_FAKE_AWS = '1';
const { Hub } = require('../core/hub');
const { makeAws } = require('../core/aws');

const fakeAws = makeAws();
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@aws-sdk/client-sqs') {
    return {
      SQSClient: class { async send(cmd) { fakeAws.queue.push({ body: cmd.input.MessageBody, handle: 'h' + Math.random() }); return {}; } },
      SendMessageCommand: class { constructor(input) { this.input = input; } },
    };
  }
  return origLoad.call(this, req, ...rest);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynechat-hub-'));
  const hub = new Hub({ dataDir: dir, getAws: () => fakeAws, notify() {}, setCreds() {}, getCredsInfo: () => ({ configured: true }) });
  const call = (m, ...a) => hub.call(m, a);

  await hub.call('deployInfra', [], { onStatus() {} });
  process.env.SECRET = hub.main.getSetting('secret');
  process.env.QUEUE_URL = 'fake-queue';
  const lambda = require('../aws/lambda.js');
  const pub = (method, rawPath, query = {}, body = '', headers = {}) => lambda.handler({ requestContext: { http: { method } }, rawPath, queryStringParameters: query, body, headers });

  // Espace principal
  await call('saveSettings', { company: { name: 'Zenith', address: 'Casablanca' }, defaultFrom: { name: 'Zenith', email: 'news@zenith.test' } });
  await call('saveContact', { email: 'same@x.test', first_name: 'Main' });

  // Nouvel espace client
  const ws = await call('createWorkspace', { name: 'Clinique A', color: '#2f5fb3' });
  assert.match(ws.id, /^ws_[A-Za-z0-9]+$/);
  assert.strictEqual((await call('currentWorkspace')).id, ws.id, 'bascule automatique vers le nouvel espace');
  assert.deepStrictEqual(await call('contacts', {}).then((r) => r.rows?.length ?? r.length), 0, 'nouvel espace vide');
  const s = await call('settings');
  assert.ok(s.infra?.publicUrl, 'infrastructure commune visible');
  assert.ok(!s.company?.name, 'informations légales propres à l’espace');
  await call('saveSettings', { company: { name: 'Clinique A', address: 'Rabat' }, defaultFrom: { name: 'Clinique A', email: 'info@clinique.test' } });
  const list = await call('createList', 'Patients');
  const lid = typeof list === 'string' ? list : list.id;
  await call('saveContact', { email: 'same@x.test', first_name: 'Client', listIds: [lid] });
  await call('saveContact', { email: 'b@x.test', first_name: 'B', listIds: [lid] });

  // Campagne dans l'espace client
  const cid = await call('createCampaign', 'Rappel dépistage');
  const c = await call('campaign', cid);
  await call('saveCampaign', { ...c, subject: 'Bonjour {{prenom}}', audience: { lists: [lid] }, html: '<html><body><a href="https://clinique.test/rdv">RDV</a> {{lien_desinscription}}</body></html>' });
  fakeAws.sent.length = 0;
  await call('sendCampaign', cid);
  for (let i = 0; i < 50 && (await call('campaign', cid)).status !== 'sent'; i++) await sleep(100);
  assert.strictEqual((await call('campaign', cid)).status, 'sent');
  assert.strictEqual(fakeAws.sent.length, 2);
  assert.ok(fakeAws.sent.every((m) => m.tags.ws === ws.id), 'étiquette ws sur chaque envoi');
  const msg = fakeAws.sent.find((m) => m.to === 'same@x.test');

  // Lien de désinscription → espace client uniquement
  const u = new URL(msg.headers.find(([k]) => k === 'List-Unsubscribe')[1].slice(1, -1));
  const q = Object.fromEntries(u.searchParams);
  assert.ok(q.c.startsWith(`${ws.id}~`), 'identifiant de l’espace dans le lien');
  const r = await pub('POST', '/u', q);
  assert.strictEqual(r.statusCode, 200);
  // Traite toute la file (événements SES + désinscription) via le moteur principal.
  for (let i = 0; i < 5; i++) await hub.primary.pollOnce();
  const wsDb = hub.ws(ws.id).db;
  assert.strictEqual(wsDb.get("SELECT status FROM contacts WHERE email='same@x.test'").status, 'unsubscribed', 'désinscrit dans l’espace client');
  assert.strictEqual(hub.main.get("SELECT status FROM contacts WHERE email='same@x.test'").status, 'subscribed', 'reste abonné dans l’espace principal');
  assert.ok(wsDb.get("SELECT COUNT(*) n FROM events WHERE type='delivery'").n >= 1, 'événements SES rangés dans l’espace client');
  assert.strictEqual(hub.main.get("SELECT COUNT(*) n FROM events").n, 0, 'aucun événement dans l’espace principal');
  assert.strictEqual(wsDb.get("SELECT campaign_id FROM events WHERE type='unsubscribe'").campaign_id, cid);

  // Formulaire de l'espace client
  const fid = await call('createForm', 'Inscription');
  await call('saveForm', { id: fid, name: 'Inscription', list_id: lid, double_optin: false });
  await pub('POST', `/f/${fid}`, {}, 'email=new%40x.test&prenom=N', { 'content-type': 'application/x-www-form-urlencoded' });
  await hub.primary.pollOnce();
  assert.ok(wsDb.get("SELECT 1 FROM contacts WHERE email='new@x.test'"), 'inscription rangée dans l’espace du formulaire');
  assert.ok(!hub.main.get("SELECT 1 FROM contacts WHERE email='new@x.test'"));

  // Lien de désinscription de l'espace principal (format historique, sans ~)
  await call('switchWorkspace', 'main');
  const mainUrl = hub.primary.unsubscribeUrl('same@x.test', 'cp_old');
  assert.ok(!new URL(mainUrl).searchParams.get('c').includes('~'), 'liens de l’espace principal inchangés');

  // Rapports
  await call('switchWorkspace', ws.id);
  await call('saveAgency', { name: 'Zenith Advertising', color: '#b0472e', website: 'https://zenith.test' });
  const rep = await call('reportHtml', 'campaign', { campaignId: cid, comment: 'Très bon <test>' });
  assert.ok(rep.html.includes('Zenith Advertising') && rep.html.includes('Clinique A') && rep.html.includes('Rappel dépistage'));
  assert.ok(rep.html.includes('Très bon &#60;test&#62;'), 'commentaire échappé');
  assert.ok(!/<script/i.test(rep.html));
  assert.match(rep.name, /^Rapport-Clinique-A-Rappel-depistage\.pdf$/);
  const today = new Date().toISOString().slice(0, 10);
  const per = await call('reportHtml', 'period', { from: '2020-01-01', to: today });
  assert.ok(per.html.includes('Rappel dépistage') && per.html.includes('Inscription'));
  await assert.rejects(call('reportHtml', 'period', { from: today, to: '2020-01-01' }));
  await assert.rejects(call('updateWorkspace', ws.id, { logo: 'data:text/html;base64,AAAA' }));

  // Liste des espaces
  const all = await call('workspaces');
  assert.strictEqual(all.length, 2);
  assert.strictEqual(all.find((w) => w.id === ws.id).campaigns, 1);

  // Suppression : impossible pour l'espace principal ; sinon fichier déplacé en corbeille
  await assert.rejects(call('deleteWorkspace', 'main'));
  await call('deleteWorkspace', ws.id);
  assert.strictEqual((await call('currentWorkspace')).id, 'main');
  assert.ok(!fs.existsSync(path.join(dir, 'workspaces', `${ws.id}.sqlite`)));
  assert.ok(fs.readdirSync(path.join(dir, 'workspaces', 'corbeille')).some((f) => f.startsWith(ws.id)));
  // Un événement tardif pour l'espace supprimé est ignoré sans erreur
  hub.handleMessage({ kind: 'unsubscribe', email: Buffer.from('same@x.test').toString('base64url'), campaign: `${ws.id}~${cid}` });
  assert.strictEqual(hub.main.get("SELECT status FROM contacts WHERE email='same@x.test'").status, 'subscribed');

  hub.stop();
  console.log('hub.test.js : OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
