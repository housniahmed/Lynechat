// Test bout en bout du moteur avec AWS simulé et la vraie fonction Lambda (SQS simulé).
// Lancer : LYNECHAT_FAKE_AWS=1 node test/backend.test.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

process.env.LYNECHAT_FAKE_AWS = '1';
const { Db } = require('../core/db');
const { Model } = require('../core/model');
const { Engine, unb64u } = require('../core/engine');
const { makeAws } = require('../core/aws');
const { makeApi } = require('../core/api');

// --- Lambda réelle, avec un faux client SQS qui pousse dans la file simulée ---
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

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynechat-'));
  const db = new Db(path.join(dir, 't.sqlite'));
  const model = new Model(db);
  const events = [];
  const engine = new Engine({ db, model, getAws: () => fakeAws, notify: (t) => events.push(t) });
  const api = makeApi({ db, model, engine, getAws: () => fakeAws, setCreds() {}, getCredsInfo: () => ({}) });

  // Infrastructure (simulée) + réglages obligatoires
  await api.deployInfra(() => {});
  process.env.SECRET = db.getSetting('secret');
  process.env.QUEUE_URL = 'fake-queue';
  delete require.cache[require.resolve('../aws/lambda.js')];
  const lambda = require('../aws/lambda.js');
  const call = (method, rawPath, query = {}, body = '', headers = {}) => lambda.handler({ requestContext: { http: { method } }, rawPath, queryStringParameters: query, body, headers });

  api.saveSettings({ company: { name: 'Zenith Test', address: '1 rue Test, Casablanca' }, defaultFrom: { name: 'Équipe Zénith', email: 'news@example.com' } });
  assert.throws(() => model.upsertContact({ email: 'pas-un-email' }), /invalide/);

  // Contacts / import
  const L = api.createList('Clients');
  const rep = api.importContacts([
    { Email: 'a@x.com', Prenom: 'Amine', Ville: 'Rabat', Tags: 'vip;promo' },
    { Email: 'B@X.com', Prenom: 'Sara', Ville: 'Casa', Tags: '' },
    { Email: 'bad', Prenom: 'X', Ville: '', Tags: '' },
    { Email: 'bounce@x.com', Prenom: 'Bo', Ville: '', Tags: '' },
    { Email: 'fail@x.com', Prenom: 'Fa', Ville: '', Tags: '' },
  ], { Email: 'email', Prenom: 'first_name', Ville: 'custom:ville', Tags: 'tags' }, { listIds: [L] });
  assert.equal(rep.created, 4); assert.equal(rep.invalid.length, 1);
  assert.equal(model.contact('b@x.com').first_name, 'Sara');
  const vip = db.get("SELECT id FROM tags WHERE name='vip'").id;

  // Segment : ville = Rabat
  assert.equal(model.countSegment({ match: 'all', conditions: [{ field: 'custom', key: 'ville', op: 'eq', value: 'rabat' }] }), 1);
  assert.equal(model.countSegment({ match: 'all', conditions: [{ field: 'tag', op: 'has', value: vip }] }), 1);
  assert.equal(api.audienceCount({ lists: [L] }), 4);
  assert.equal(api.audienceCount({ lists: [L], excludeTags: [vip] }), 3);

  // Campagne
  const cid = api.createCampaign('Promo');
  const html = '<!doctype html><html><head></head><body><p>Bonjour {{prenom|ami}} <script>x</script></p><a href="https://shop.example.com/promo">Voir</a><p><a href="{{lien_desinscription}}" ses:no-track>Se désinscrire</a> — {{entreprise}}</p></body></html>';
  api.saveCampaign({ id: cid, name: 'Promo', subject: 'Offre pour {{prenom}}', preheader: 'Jusqu’à -30 %', from_name: 'Équipe Zénith', from_email: 'news@example.com', audience: { lists: [L] }, design: {}, html });
  assert.deepEqual(api.validateCampaign(cid), []);
  const noUnsub = api.createCampaign('Sans lien');
  api.saveCampaign({ id: noUnsub, name: 'x', subject: 's', from_email: 'news@example.com', audience: { lists: [L] }, html: '<p>x</p>' });
  assert.ok(api.validateCampaign(noUnsub).some((e) => /désinscription/.test(e)));

  await api.sendCampaign(cid);
  for (let i = 0; i < 50 && engine.sending.size; i++) await new Promise((r) => setTimeout(r, 100));
  const camp = api.campaign(cid);
  assert.equal(camp.status, 'sent');
  const sent = fakeAws.sent.filter((m) => m.tags.cid === cid);
  assert.equal(sent.length, 3, 'fail@ doit échouer');
  const m0 = sent.find((m) => m.to === 'a@x.com');
  assert.equal(m0.subject, 'Offre pour Amine');
  assert.ok(m0.from.startsWith('=?UTF-8?B?'), 'nom d’expéditeur encodé');
  assert.ok(m0.headers.find(([k]) => k === 'List-Unsubscribe-Post'));
  assert.ok(m0.html.includes('Bonjour Amine'));
  assert.ok(m0.html.includes('Jusqu’à -30 %'));
  assert.ok(m0.text.includes('https://shop.example.com/promo'));
  const sB = fakeAws.sent.find((m) => m.to === 'b@x.com');
  assert.ok(sB.html.includes('Bonjour Sara'));

  // Événements SES
  while (await engine.pollOnce()) { /* vide la file */ }
  const st = api.campaignStats(cid);
  assert.equal(st.sent, 3); assert.equal(st.failed, 1); assert.equal(st.bounces, 1);
  assert.equal(model.contact('bounce@x.com').status, 'bounced');
  console.log('Stats campagne :', { sent: st.sent, delivered: st.delivered, opens: st.opens, clicks: st.clicks, bounces: st.bounces });

  // Désinscription via la vraie fonction Lambda
  const unsubUrl = new URL(m0.headers.find(([k]) => k === 'List-Unsubscribe')[1].slice(1, -1));
  const q = Object.fromEntries(unsubUrl.searchParams);
  let r = await call('GET', '/u', q);
  assert.ok(r.body.includes('<form method="post">'), 'GET affiche une confirmation sans désinscrire');
  r = await call('GET', '/u', { ...q, s: 'faux' });
  assert.ok(r.body.includes('invalide'));
  r = await call('POST', '/u', q, 'List-Unsubscribe=One-Click', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.ok(r.body.includes('Désinscription confirmée'));
  while (await engine.pollOnce()) { /* */ }
  assert.equal(model.contact('a@x.com').status, 'unsubscribed');
  assert.equal(api.campaignStats(cid).unsubscribes, 1);
  // Réimport : ne réabonne pas
  api.importContacts([{ e: 'a@x.com' }], { e: 'email' }, {});
  assert.equal(model.contact('a@x.com').status, 'unsubscribed');

  // Automatisation : formulaire (double opt-in) → bienvenue
  const fid = api.createForm('Newsletter site');
  api.saveForm({ id: fid, name: 'Newsletter site', list_id: L, tag_ids: [vip], double_optin: true, design: { lang: 'fr' }, confirm: {} });
  const aid = api.createAutomation('Bienvenue', { type: 'form', formId: fid }, [
    { id: 's1', type: 'email', subject: 'Bienvenue {{prenom}}', html: '<html><body>Salut {{prenom}} <a href="{{lien_desinscription}}">désinscription</a></body></html>' },
    { id: 's2', type: 'wait', amount: 0, unit: 'days' },
    { id: 's3', type: 'tag', action: 'add', tagId: api.createTag('bienvenue-ok') },
  ]);
  api.saveAutomation({ ...api.automation(aid), from_email: 'news@example.com', from_name: 'Zénith' });
  api.setAutomationStatus(aid, 'active');

  r = await call('POST', `/f/${fid}`, {}, 'email=new%40x.com&first_name=Nadia&ville=Fes&_hp=', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(r.statusCode, 200);
  r = await call('POST', `/f/${fid}`, {}, JSON.stringify({ email: 'pasbon' }), { 'content-type': 'application/json' });
  assert.equal(r.statusCode, 400);
  r = await call('POST', `/f/${fid}`, {}, 'email=bot%40x.com&_hp=1', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(r.statusCode, 204, 'pot de miel');
  while (await engine.pollOnce()) { /* */ }
  const nadia = model.contact('new@x.com');
  assert.equal(nadia.status, 'pending');
  assert.equal(JSON.parse(nadia.fields).ville, 'Fes');
  assert.equal(model.contact('bot@x.com'), undefined);
  await new Promise((res) => setTimeout(res, 50));
  const conf = fakeAws.sent.find((m) => m.to === 'new@x.com');
  assert.ok(conf && /Confirmez/.test(conf.subject), 'e-mail de confirmation envoyé');
  const link = new URL(conf.html.match(/href="([^"]*\/c\?[^"]*)"/)[1].replace(/&amp;/g, '&'));
  r = await call('GET', '/c', Object.fromEntries(link.searchParams));
  assert.ok(r.body.includes('confirmée'));
  while (await engine.pollOnce()) { /* */ }
  assert.equal(model.contact('new@x.com').status, 'subscribed');
  await engine.tickAutomations();
  const welcome = fakeAws.sent.find((m) => m.to === 'new@x.com' && m.subject === 'Bienvenue Nadia');
  assert.ok(welcome, 'e-mail de bienvenue envoyé');
  assert.ok(welcome.tags.aid === aid);
  const ndetail = api.contact(model.contact('new@x.com').id);
  assert.ok(ndetail.tags.some((t) => t.name === 'bienvenue-ok'));
  assert.ok(ndetail.lists.some((l) => l.id === L));
  assert.equal(api.automations()[0].done, 1);

  // Date anniversaire
  const today = new Date();
  const bday = `1990-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  api.saveContact({ email: 'anniv@x.com', first_name: 'Ali', fields: { naissance: bday } });
  const bid = api.createAutomation('Anniv', { type: 'date', field: 'naissance' }, [{ id: 'b1', type: 'email', subject: 'Joyeux anniversaire', html: '<p>{{lien_desinscription}}</p>' }]);
  api.saveAutomation({ ...api.automation(bid), from_email: 'news@example.com' });
  api.setAutomationStatus(bid, 'active');
  engine.tickDates(); engine.tickDates();
  await engine.tickAutomations();
  assert.equal(fakeAws.sent.filter((m) => m.subject === 'Joyeux anniversaire').length, 1, 'une seule fois par an');

  // Planification
  const c2 = api.duplicateCampaign(cid);
  assert.throws(() => api.scheduleCampaign(c2, new Date(Date.now() - 1000).toISOString()), /futur/);
  api.scheduleCampaign(c2, new Date(Date.now() + 50).toISOString());
  await new Promise((res) => setTimeout(res, 100));
  await engine.tickScheduled();
  for (let i = 0; i < 50 && engine.sending.size; i++) await new Promise((res) => setTimeout(res, 100));
  assert.equal(api.campaign(c2).status, 'sent');
  assert.ok(!fakeAws.sent.some((m) => m.tags.cid === c2 && m.to === 'a@x.com'), 'désinscrit exclu');

  // Export CSV
  const csv = api.exportContacts({});
  assert.ok(csv.split('\n')[0].includes('ville'));
  console.log('Vue d’ensemble :', JSON.stringify(api.overview().contacts));
  console.log('TOUS LES TESTS DU MOTEUR SONT PASSÉS');
  process.exit(0);
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
