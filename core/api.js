// Fonctions appelées par l'interface (via IPC). Chaque méthode reçoit des données simples et renvoie des données simples.
const crypto = require('crypto');
const { id, now } = require('./db');
const { safeJson } = require('./model');
const { IAM_POLICY } = require('./aws');

function makeApi({ db, gdb = db, model, engine, getAws, setCreds, getCredsInfo }) {
  const touch = (table, rid) => db.run(`UPDATE ${table} SET updated_at=? WHERE id=?`, now(), rid);

  return {
    // ---------- tableau de bord ----------
    overview: () => ({
      ...model.overview(),
      recent: db.all('SELECT id, name, status, sent_at, scheduled_at, total FROM campaigns ORDER BY COALESCE(sent_at, updated_at) DESC LIMIT 6').map((c) => ({ ...c, stats: c.status === 'draft' ? null : model.campaignStats(c.id) })),
      setup: {
        aws: !!getAws(), infra: !!engine.infra?.publicUrl,
        company: !!(engine.company.name && engine.company.address),
        sender: !!db.getSetting('defaultFrom', {}).email,
      },
      pollError: engine.lastPollError || null,
    }),

    // ---------- contacts ----------
    contacts: (f) => model.listContacts(f),
    contact: (cid) => {
      const c = model.parseContact(model.contact(cid));
      if (!c) return null;
      c.activity = db.all(`SELECT e.type, e.url, e.at, e.detail, c.name campaign, a.name automation FROM events e
        LEFT JOIN campaigns c ON c.id=e.campaign_id LEFT JOIN automations a ON a.id=e.automation_id
        WHERE e.contact_id=? AND e.bot=0 ORDER BY e.at DESC LIMIT 100`, cid);
      return c;
    },
    saveContact: (data) => {
      if (data.id) {
        const c = model.updateContact(data.id, data);
        return c;
      }
      const r = model.upsertContact({ ...data, status: data.status || 'subscribed' }, { listIds: data.listIds || [], tagIds: data.tagIds || [], source: 'ajout manuel' });
      for (const l of r.added.lists) engine.trigger({ type: 'list_join', listId: l, contactId: r.contact.id });
      for (const t of r.added.tags) engine.trigger({ type: 'tag_added', tagId: t, contactId: r.contact.id });
      return model.parseContact(r.contact);
    },
    deleteContacts: (ids) => model.deleteContacts(ids),
    setContactStatus: (ids, status) => { for (const x of ids) { if (status === 'unsubscribed') engine.suppress(x, 'unsubscribed'); else model.setStatus(x, status); } },
    bulkList: (ids, listId, remove) => {
      for (const x of ids) {
        if (remove) model.removeFromList(x, listId);
        else if (model.addToList(x, listId)) engine.trigger({ type: 'list_join', listId, contactId: x });
      }
    },
    bulkTag: (ids, tagName, remove) => {
      const tid = model.tagId(tagName);
      for (const x of ids) {
        if (remove) model.removeTag(x, tid);
        else if (model.addTag(x, tid)) engine.trigger({ type: 'tag_added', tagId: tid, contactId: x });
      }
      return tid;
    },
    importContacts: (rows, mapping, opts) => {
      const before = new Set(db.all('SELECT id FROM contacts').map((r) => r.id));
      const report = model.importRows(rows, mapping, opts);
      // Les contacts importés n'entrent pas automatiquement dans les automatisations (évite des envois massifs involontaires).
      report.newIds = db.all('SELECT id FROM contacts').map((r) => r.id).filter((x) => !before.has(x)).length;
      return report;
    },
    exportContacts: (f) => model.exportContacts(f),
    counts: () => model.counts(),
    customFields: () => model.customFieldKeys(),
    addCustomField: (k) => { const s = new Set(db.getSetting('customFields', [])); s.add(k); db.setSetting('customFields', [...s]); },

    lists: () => model.lists(),
    createList: (name, d) => model.createList(name, d),
    renameList: (lid, name, d) => model.renameList(lid, name, d),
    deleteList: (lid) => model.deleteList(lid),
    tags: () => model.tags(),
    createTag: (name) => model.tagId(name),
    deleteTag: (tid) => model.deleteTag(tid),
    segments: () => model.segments(),
    saveSegment: (s) => model.saveSegment(s),
    deleteSegment: (sid) => model.deleteSegment(sid),
    countSegment: (rules) => model.countSegment(rules),
    audienceCount: (aud) => model.audienceCount(aud),

    // ---------- images ----------
    saveAsset: ({ name, mime, data, width, height }) => {
      const aid = id('as');
      db.run('INSERT INTO assets VALUES(?,?,?,?,?,?,?)', aid, name, mime, Buffer.from(data), width || 0, height || 0, now());
      return aid;
    },
    assets: () => db.all('SELECT id, name, mime, width, height, length(data) size, created_at FROM assets ORDER BY created_at DESC'),
    asset: (aid) => { const a = db.get('SELECT mime, data FROM assets WHERE id=?', aid); return a ? `data:${a.mime};base64,${Buffer.from(a.data).toString('base64')}` : null; },
    deleteAsset: (aid) => db.run('DELETE FROM assets WHERE id=?', aid),

    // ---------- modèles ----------
    templates: () => db.all('SELECT id, name, design, updated_at FROM templates ORDER BY updated_at DESC').map((t) => ({ ...t, design: safeJson(t.design, {}) })),
    saveTemplate: (t) => {
      if (t.id) db.run('UPDATE templates SET name=?, design=?, updated_at=? WHERE id=?', t.name, JSON.stringify(t.design), now(), t.id);
      else { t.id = id('tp'); db.run('INSERT INTO templates VALUES(?,?,?,?,?)', t.id, t.name, JSON.stringify(t.design), now(), now()); }
      return t.id;
    },
    deleteTemplate: (tid) => db.run('DELETE FROM templates WHERE id=?', tid),

    // ---------- campagnes ----------
    campaigns: () => db.all('SELECT id, name, subject, status, scheduled_at, sent_at, started_at, total, error, created_at, updated_at FROM campaigns ORDER BY created_at DESC')
      .map((c) => ({ ...c, stats: c.status === 'draft' || c.status === 'scheduled' ? null : model.campaignStats(c.id) })),
    campaign: (cid) => engine.campaign(cid),
    createCampaign: (name) => {
      const cid = id('cp');
      const df = db.getSetting('defaultFrom', {});
      db.run('INSERT INTO campaigns(id,name,from_name,from_email,reply_to,audience,design,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
        cid, name || 'Nouvelle campagne', df.name || '', df.email || '', df.replyTo || '', '{}', '{}', now(), now());
      return cid;
    },
    duplicateCampaign: (cid) => {
      const c = engine.campaign(cid);
      const nid = id('cp');
      db.run('INSERT INTO campaigns(id,name,subject,preheader,from_name,from_email,reply_to,audience,design,html,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        nid, `${c.name} (copie)`, c.subject, c.preheader, c.from_name, c.from_email, c.reply_to, JSON.stringify(c.audience), JSON.stringify(c.design), c.html, now(), now());
      return nid;
    },
    saveCampaign: (c) => {
      const cur = engine.campaign(c.id);
      if (!cur) throw new Error('Campagne introuvable');
      if (['sending', 'sent'].includes(cur.status)) throw new Error('Une campagne envoyée ou en cours d’envoi ne peut plus être modifiée.');
      db.run('UPDATE campaigns SET name=?, subject=?, preheader=?, from_name=?, from_email=?, reply_to=?, audience=?, design=?, html=?, updated_at=? WHERE id=?',
        c.name, c.subject || '', c.preheader || '', c.from_name || '', c.from_email || '', c.reply_to || '', JSON.stringify(c.audience || {}), JSON.stringify(c.design || {}), c.html || '', now(), c.id);
      return true;
    },
    deleteCampaign: (cid) => {
      const c = engine.campaign(cid);
      if (c?.status === 'sending') throw new Error('Mettez d’abord l’envoi en pause.');
      db.run('DELETE FROM campaigns WHERE id=?', cid);
    },
    validateCampaign: (cid) => engine.validateCampaign(engine.campaign(cid)),
    sendTest: (cid, emails) => engine.sendTest(cid, emails),
    sendCampaign: (cid) => engine.startCampaign(cid),
    pauseCampaign: (cid) => engine.pauseCampaign(cid),
    scheduleCampaign: (cid, at) => {
      const c = engine.campaign(cid);
      engine.checkReady();
      const errs = engine.validateCampaign(c);
      if (errs.length) throw new Error(errs.join(' '));
      if (new Date(at) <= new Date()) throw new Error('Choisissez une date dans le futur.');
      db.run("UPDATE campaigns SET status='scheduled', scheduled_at=? WHERE id=?", new Date(at).toISOString(), cid);
    },
    unscheduleCampaign: (cid) => db.run("UPDATE campaigns SET status='draft', scheduled_at=NULL WHERE id=? AND status='scheduled'", cid),
    campaignStats: (cid) => model.campaignStats(cid),
    campaignRecipients: (cid, filter) => {
      const where = { opened: "AND EXISTS (SELECT 1 FROM events e WHERE e.message_id=s.message_id AND e.type='open' AND e.bot=0)", clicked: "AND EXISTS (SELECT 1 FROM events e WHERE e.message_id=s.message_id AND e.type='click' AND e.bot=0)", bounced: "AND EXISTS (SELECT 1 FROM events e WHERE e.message_id=s.message_id AND e.type='bounce')", failed: "AND s.status='failed'" }[filter] || '';
      return db.all(`SELECT s.email, s.status, s.error, s.sent_at FROM sends s WHERE s.campaign_id=? ${where} ORDER BY s.sent_at DESC LIMIT 1000`, cid);
    },

    // ---------- rapports (données brutes ; la mise en page est dans report.js) ----------
    reportData: (cid) => {
      const c = engine.campaign(cid);
      if (!c) throw new Error('Campagne introuvable');
      if (c.status === 'draft' || c.status === 'scheduled') throw new Error('Le rapport est disponible une fois la campagne envoyée.');
      const a = c.audience || {};
      const names = (table, ids) => (ids || []).map((x) => db.get(`SELECT name FROM ${table} WHERE id=?`, x)?.name).filter(Boolean);
      const audience = a.all ? ['Tous les abonnés'] : [...names('lists', a.lists).map((n) => `Liste : ${n}`), ...names('tags', a.tags).map((n) => `Tag : ${n}`)];
      if (a.segmentId) audience.push(`Segment : ${db.get('SELECT name FROM segments WHERE id=?', a.segmentId)?.name || '(supprimé)'}`);
      if (a.excludeTags?.length) audience.push(`Exclus : ${names('tags', a.excludeTags).join(', ')}`);
      return {
        campaign: { id: c.id, name: c.name, subject: c.subject, preheader: c.preheader, from_name: c.from_name, from_email: c.from_email, status: c.status, started_at: c.started_at, sent_at: c.sent_at, total: c.total },
        audience, stats: model.campaignStats(cid), generatedAt: now(),
      };
    },
    periodReportData: (from, to) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw new Error('Choisissez une date de début et de fin.');
      if (from > to) throw new Error('La date de début doit précéder la date de fin.');
      const start = `${from}T00:00:00.000Z`, end = `${to}T23:59:59.999Z`;
      const camps = db.all("SELECT id, name, subject, sent_at, started_at, status FROM campaigns WHERE status IN ('sent','sending','paused') AND COALESCE(sent_at, started_at) BETWEEN ? AND ? ORDER BY COALESCE(sent_at, started_at)", start, end)
        .map((c) => { const s = model.campaignStats(c.id); delete s.links; delete s.timeline; return { ...c, stats: s }; });
      const sum = (k) => camps.reduce((t, c) => t + (c.stats[k] || 0), 0);
      const totals = { campaigns: camps.length, sent: sum('sent'), delivered: sum('delivered'), opens: sum('opens'), clicks: sum('clicks'), bounces: sum('bounces'), complaints: sum('complaints'), unsubscribes: sum('unsubscribes') };
      const base = totals.delivered || totals.sent;
      totals.openRate = base ? totals.opens / base : 0;
      totals.clickRate = base ? totals.clicks / base : 0;
      totals.bounceRate = totals.sent ? totals.bounces / totals.sent : 0;
      const autoSent = db.get("SELECT COUNT(*) n FROM sends WHERE automation_id IS NOT NULL AND status='sent' AND sent_at BETWEEN ? AND ?", start, end).n;
      const newContacts = db.get('SELECT COUNT(*) n FROM contacts WHERE created_at BETWEEN ? AND ?', start, end).n;
      const unsubs = db.get("SELECT COUNT(*) n FROM events WHERE type='unsubscribe' AND at BETWEEN ? AND ?", start, end).n;
      const forms = db.all('SELECT f.name, COUNT(s.id) n FROM forms f JOIN submissions s ON s.form_id=f.id WHERE s.at BETWEEN ? AND ? GROUP BY f.id ORDER BY n DESC', start, end);
      return { from, to, campaigns: camps, totals, automations: { sent: autoSent }, audience: { newContacts, unsubscribes: unsubs, subscribedNow: model.counts().subscribed || 0, forms }, generatedAt: now() };
    },

    // ---------- automatisations ----------
    automations: () => db.all('SELECT * FROM automations ORDER BY created_at DESC').map((a) => ({
      ...a, trigger: safeJson(a.trigger_def, {}), steps: safeJson(a.steps, []),
      active: db.get("SELECT COUNT(*) n FROM automation_runs WHERE automation_id=? AND status='active'", a.id).n,
      done: db.get("SELECT COUNT(*) n FROM automation_runs WHERE automation_id=? AND status='done'", a.id).n,
    })),
    automation: (aid) => {
      const a = engine.automation(aid);
      if (!a) return null;
      a.stepStats = Object.fromEntries(a.steps.filter((s) => s.type === 'email').map((s) => [s.id, {
        sent: db.get("SELECT COUNT(*) n FROM sends WHERE automation_id=? AND step_id=? AND status='sent'", aid, s.id).n,
        opens: db.get("SELECT COUNT(DISTINCT contact_id) n FROM events WHERE automation_id=? AND step_id=? AND type='open' AND bot=0", aid, s.id).n,
        clicks: db.get("SELECT COUNT(DISTINCT contact_id) n FROM events WHERE automation_id=? AND step_id=? AND type='click' AND bot=0", aid, s.id).n,
      }]));
      a.waiting = Object.fromEntries(db.all("SELECT step_index, COUNT(*) n FROM automation_runs WHERE automation_id=? AND status='active' GROUP BY step_index", aid).map((r) => [r.step_index, r.n]));
      return a;
    },
    createAutomation: (name, trigger, steps) => {
      const aid = id('au');
      const df = db.getSetting('defaultFrom', {});
      db.run('INSERT INTO automations(id,name,status,trigger_def,steps,from_name,from_email,reply_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        aid, name, 'draft', JSON.stringify(trigger || { type: 'list_join' }), JSON.stringify(steps || []), df.name || '', df.email || '', df.replyTo || '', now(), now());
      return aid;
    },
    saveAutomation: (a) => {
      db.run('UPDATE automations SET name=?, trigger_def=?, steps=?, from_name=?, from_email=?, reply_to=?, updated_at=? WHERE id=?',
        a.name, JSON.stringify(a.trigger), JSON.stringify(a.steps), a.from_name || '', a.from_email || '', a.reply_to || '', now(), a.id);
      return true;
    },
    setAutomationStatus: (aid, status) => {
      if (status === 'active') {
        const a = engine.automation(aid);
        engine.checkReady();
        if (!a.from_email) throw new Error('Choisissez l’adresse d’expédition de l’automatisation.');
        const emails = a.steps.filter((s) => s.type === 'email');
        if (!emails.length) throw new Error('Ajoutez au moins une étape « E-mail ».');
        for (const s of emails) {
          if (!s.subject) throw new Error('Un e-mail de l’automatisation n’a pas d’objet.');
          if (!/\{\{\s*lien_desinscription\s*\}\}/.test(s.html || '')) throw new Error(`L’e-mail « ${s.subject} » n’a pas de lien de désinscription.`);
        }
      }
      db.run('UPDATE automations SET status=?, updated_at=? WHERE id=?', status, now(), aid);
    },
    enrollExisting: (aid, audience) => {
      let n = 0;
      for (const c of model.audienceContacts(audience)) if (engine.enroll(aid, c.id, 'once')) n++;
      return n;
    },
    deleteAutomation: (aid) => db.run('DELETE FROM automations WHERE id=?', aid),

    // ---------- formulaires ----------
    forms: () => db.all('SELECT * FROM forms ORDER BY created_at DESC').map((f) => ({
      ...f, tag_ids: safeJson(f.tag_ids, []), design: safeJson(f.design, {}), confirm: safeJson(f.confirm, {}),
      submissions: db.get('SELECT COUNT(*) n FROM submissions WHERE form_id=?', f.id).n,
    })),
    createForm: (name) => {
      const fid = id('fm');
      db.run('INSERT INTO forms(id,name,design,confirm,created_at,updated_at) VALUES(?,?,?,?,?,?)', fid, name, '{}', '{}', now(), now());
      return fid;
    },
    saveForm: (f) => {
      db.run('UPDATE forms SET name=?, list_id=?, tag_ids=?, double_optin=?, design=?, confirm=?, updated_at=? WHERE id=?',
        f.name, f.list_id || null, JSON.stringify(f.tag_ids || []), f.double_optin ? 1 : 0, JSON.stringify(f.design || {}), JSON.stringify(f.confirm || {}), now(), f.id);
      return true;
    },
    deleteForm: (fid) => db.run('DELETE FROM forms WHERE id=?', fid),
    formEndpoint: (fid) => (engine.infra?.publicUrl ? `${engine.infra.publicUrl}f/${fid}` : null),
    submissions: (fid) => db.all('SELECT * FROM submissions WHERE form_id=? ORDER BY at DESC LIMIT 200', fid),

    // ---------- paramètres et AWS ----------
    settings: () => ({
      aws: getCredsInfo(),
      infra: engine.infra,
      company: engine.company,
      defaultFrom: db.getSetting('defaultFrom', {}),
      sendRate: gdb.getSetting('sendRate', 0),
      iamPolicy: IAM_POLICY,
    }),
    saveSettings: (s) => {
      if (s.company) db.setSetting('company', s.company);
      if (s.defaultFrom) db.setSetting('defaultFrom', s.defaultFrom);
      if (s.sendRate != null) gdb.setSetting('sendRate', Number(s.sendRate) || 0);
    },
    saveAwsCreds: async (creds) => {
      setCreds(creds);
      const aws = getAws();
      try { return await aws.account(); } catch (e) { throw new Error(`Connexion refusée par AWS : ${e.message}`); }
    },
    awsAccount: async () => { const aws = getAws(); if (!aws) return null; return aws.account(); },
    deployInfra: async (onStatus) => {
      const aws = getAws();
      if (!aws) throw new Error('Connectez d’abord votre compte AWS.');
      if (!gdb.getSetting('secret')) gdb.setSetting('secret', crypto.randomBytes(32).toString('base64url'));
      const out = await aws.deploy(gdb.getSetting('secret'), 'lynechat', onStatus);
      gdb.setSetting('infra', { ...out, region: aws.region, deployedAt: now() });
      engine.startPolling();
      return out;
    },
    identities: async () => { const aws = getAws(); return aws ? aws.identities() : []; },
    identity: async (name) => getAws().identity(name),
    createIdentity: async (name) => getAws().createIdentity(name.trim().toLowerCase()),
    deleteIdentity: async (name) => getAws().deleteIdentity(name),
    pollNow: () => engine.pollOnce(),
  };
}

module.exports = { makeApi };
