// Moteur : préparation des messages, envoi des campagnes avec limite de débit, file d'événements AWS,
// automatisations et planification. Tourne dans le processus principal tant que l'application est ouverte.
const crypto = require('crypto');
const { id, now } = require('./db');
const { safeJson } = require('./model');

const b64u = (s) => Buffer.from(String(s), 'utf8').toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url').toString('utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, txt) => `${txt.replace(/<[^>]+>/g, '').trim()} (${href})`)
    .replace(/<(br|\/p|\/h[1-6]|\/tr|\/div|\/li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

class Engine {
  constructor({ db, gdb, model, getAws, notify, wsId = 'main', router = null }) {
    this.db = db;
    this.gdb = gdb || db; // réglages communs à tous les espaces (AWS, infrastructure, secret)
    this.wsId = wsId;
    this.router = router;
    this.model = model;
    this.getAws = getAws;
    this.notify = notify || (() => {});
    this.sending = new Set();
    this.paused = new Set();
    this.timers = [];
    this.polling = false;
  }

  get cfg() { return this.gdb.getSetting('aws', {}); }
  get infra() { return this.gdb.getSetting('infra', null); }
  get company() { return this.db.getSetting('company', {}); }

  sign(s) { return crypto.createHmac('sha256', this.gdb.getSetting('secret')).update(s).digest('base64url').slice(0, 22); }

  unsubscribeUrl(email, campaign, lang = 'fr') {
    const infra = this.infra;
    if (!infra?.publicUrl) return '';
    // Hors espace principal, l'identifiant de l'espace voyage dans le paramètre c (signé) : « ws~campagne ».
    const e = b64u(email), c = this.wsId === 'main' ? campaign || '-' : `${this.wsId}~${campaign || '-'}`;
    return `${infra.publicUrl}u?e=${e}&c=${encodeURIComponent(c)}&l=${lang === 'ar' ? 'ar' : 'fr'}&s=${this.sign(`u|${e}|${c}`)}`;
  }

  confirmUrl(email, formId, redirect = '') {
    const infra = this.infra;
    const e = b64u(email);
    return `${infra.publicUrl}c?e=${e}&f=${encodeURIComponent(formId)}&s=${this.sign(`c|${e}|${formId}`)}${redirect ? `&r=${encodeURIComponent(redirect)}` : ''}`;
  }

  /** Remplace les balises de personnalisation. Les valeurs sont échappées dans le HTML. */
  merge(tpl, contact, extra = {}, html = true) {
    const f = safeJson(contact.fields, contact.fields || {});
    const vals = {
      email: contact.email, prenom: contact.first_name, first_name: contact.first_name, nom: contact.last_name, last_name: contact.last_name,
      telephone: contact.phone, phone: contact.phone, entreprise: this.company.name || '', adresse: this.company.address || '', ...f, ...extra,
    };
    return String(tpl || '').replace(/\{\{\s*([\p{L}\p{N}_ -]+?)\s*(?:\|\s*([^}]*?))?\s*\}\}/gu, (m, key, fallback) => {
      const k = key.trim();
      const raw = vals[k] ?? vals[k.toLowerCase()];
      const v = raw == null || raw === '' ? (fallback ?? '') : raw;
      return html && !['lien_desinscription', 'lien_confirmation'].includes(k) ? escHtml(v) : String(v);
    });
  }

  /** Construit le message final pour un contact (HTML personnalisé, texte, en-têtes, images intégrées). */
  buildMessage({ html, subject, preheader, fromName, fromEmail, replyTo, contact, campaignId, tags }) {
    const unsub = this.unsubscribeUrl(contact.email, campaignId, contact.lang);
    let body = this.merge(html, contact, { lien_desinscription: unsub });
    if (preheader) {
      const pre = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escHtml(this.merge(preheader, contact, {}, false))}${'&#847;&zwnj;&nbsp;'.repeat(30)}</div>`;
      body = body.replace(/<body([^>]*)>/i, `<body$1>${pre}`);
    }
    // Images de la médiathèque → pièces jointes intégrées (cid:).
    const attachments = [];
    body = body.replace(/src="asset:([A-Za-z0-9_]+)"/g, (m, aid) => {
      const a = this.db.get('SELECT id, name, mime FROM assets WHERE id=?', aid);
      if (!a) return 'src=""';
      if (!attachments.find((x) => x.id === aid)) {
        const data = this.db.get('SELECT data FROM assets WHERE id=?', aid).data;
        const ext = a.mime === 'image/png' ? 'png' : a.mime === 'image/gif' ? 'gif' : 'jpg';
        attachments.push({ id: aid, cid: `${aid}@lynechat`, filename: `${aid}.${ext}`, mime: a.mime, data: new Uint8Array(data) });
      }
      return `src="cid:${aid}@lynechat"`;
    });
    const headers = [];
    if (unsub) headers.push(['List-Unsubscribe', `<${unsub}>`], ['List-Unsubscribe-Post', 'List-Unsubscribe=One-Click']);
    const from = fromName ? `${encodeName(fromName)} <${fromEmail}>` : fromEmail;
    return {
      from, to: contact.email, replyTo: replyTo || undefined, subject: this.merge(subject, contact, {}, false),
      html: body, text: htmlToText(body), headers, attachments, configSet: this.infra?.configSet,
      tags: this.wsId === 'main' ? tags : { ...tags, ws: this.wsId },
    };
  }

  checkReady() {
    if (!this.getAws()) throw new Error('Connectez d’abord votre compte AWS (Paramètres).');
    if (!this.infra?.publicUrl) throw new Error('Installez d’abord l’infrastructure AWS (Paramètres → Installer).');
    const c = this.company;
    if (!c.name || !c.address) throw new Error('Renseignez le nom et l’adresse postale de votre entreprise (Paramètres) : ils sont obligatoires dans le pied de page.');
  }

  // ---------- campagnes ----------
  campaign(cid) {
    const c = this.db.get('SELECT * FROM campaigns WHERE id=?', cid);
    if (!c) return null;
    return { ...c, audience: safeJson(c.audience, {}), design: safeJson(c.design, {}) };
  }

  validateCampaign(c) {
    const errs = [];
    if (!c.subject?.trim()) errs.push('Objet manquant.');
    if (!c.from_email?.trim()) errs.push('Adresse d’expédition manquante.');
    if (!c.html?.trim()) errs.push('Le contenu de l’e-mail est vide.');
    if (c.html && !/\{\{\s*lien_desinscription\s*\}\}/.test(c.html)) errs.push('Le lien de désinscription est absent du contenu (bloc « Pied de page »).');
    if (!this.model.audienceCount(c.audience)) errs.push('Aucun abonné dans l’audience choisie.');
    return errs;
  }

  async sendTest(cid, emails) {
    this.checkReady();
    const c = this.campaign(cid);
    const aws = this.getAws();
    const out = [];
    for (const email of emails) {
      const contact = this.model.contact(email) || { email, first_name: 'Prénom', last_name: 'Nom', fields: {}, lang: 'fr' };
      const msg = this.buildMessage({ html: c.html, subject: `[TEST] ${c.subject}`, preheader: c.preheader, fromName: c.from_name, fromEmail: c.from_email, replyTo: c.reply_to, contact, campaignId: 'test', tags: { kind: 'test' } });
      out.push({ email, messageId: await aws.send(msg) });
    }
    return out;
  }

  /** Démarre l'envoi d'une campagne (ou la reprend). */
  async startCampaign(cid) {
    this.checkReady();
    const c = this.campaign(cid);
    if (!c) throw new Error('Campagne introuvable');
    if (['sent'].includes(c.status)) throw new Error('Cette campagne a déjà été envoyée.');
    if (c.status !== 'sending' && c.status !== 'paused') {
      const errs = this.validateCampaign(c);
      if (errs.length) throw new Error(errs.join(' '));
      const recips = this.model.audienceContacts(c.audience);
      this.db.tx(() => {
        const t = now();
        for (const r of recips) this.db.run('INSERT INTO sends(id,campaign_id,contact_id,email,status,queued_at) VALUES(?,?,?,?,?,?)', id('sd'), cid, r.id, r.email, 'queued', t);
        this.db.run("UPDATE campaigns SET status='sending', started_at=?, total=?, updated_at=? WHERE id=?", t, recips.length, t, cid);
      });
    } else this.db.run("UPDATE campaigns SET status='sending' WHERE id=?", cid);
    this.paused.delete(cid);
    this.runCampaign(cid);
    return true;
  }

  pauseCampaign(cid) { this.paused.add(cid); this.db.run("UPDATE campaigns SET status='paused' WHERE id=? AND status='sending'", cid); this.notify('campaigns'); }

  async runCampaign(cid) {
    if (this.sending.has(cid)) return;
    this.sending.add(cid);
    try {
      const aws = this.getAws();
      const acct = await aws.account().catch(() => ({ maxRate: 1 }));
      const userRate = Number(this.gdb.getSetting('sendRate', 0)) || Infinity;
      const rate = Math.max(1, Math.min(acct.maxRate || 1, userRate));
      const gap = 1000 / rate;
      const c = this.campaign(cid);
      for (;;) {
        if (this.paused.has(cid)) return;
        const batch = this.db.all("SELECT * FROM sends WHERE campaign_id=? AND status='queued' LIMIT 50", cid);
        if (!batch.length) break;
        for (const s of batch) {
          if (this.paused.has(cid)) return;
          const t0 = Date.now();
          const contact = this.db.get('SELECT * FROM contacts WHERE id=?', s.contact_id);
          if (!contact || contact.status !== 'subscribed') { this.db.run("UPDATE sends SET status='failed', error=? WHERE id=?", 'Contact non abonné au moment de l’envoi', s.id); continue; }
          try {
            const msg = this.buildMessage({ html: c.html, subject: c.subject, preheader: c.preheader, fromName: c.from_name, fromEmail: c.from_email, replyTo: c.reply_to, contact, campaignId: cid, tags: { cid, uid: contact.id } });
            const mid = await aws.send(msg);
            this.db.run("UPDATE sends SET status='sent', message_id=?, sent_at=? WHERE id=?", mid, now(), s.id);
          } catch (e) {
            const msg = e.message || String(e);
            if (/Throttl|rate exceeded|TooManyRequests/i.test(msg)) { await sleep(2000); continue; }
            this.db.run("UPDATE sends SET status='failed', error=? WHERE id=?", msg.slice(0, 500), s.id);
            if (/not authorized|AccessDenied|InvalidClientTokenId|SignatureDoesNotMatch|Account.*paused|sending.*disabled/i.test(msg)) {
              this.db.run("UPDATE campaigns SET status='paused', error=? WHERE id=?", msg.slice(0, 500), cid);
              this.notify('campaigns');
              return;
            }
          }
          this.notify('progress', { campaignId: cid });
          const wait = gap - (Date.now() - t0);
          if (wait > 0) await sleep(wait);
        }
      }
      this.db.run("UPDATE campaigns SET status='sent', sent_at=?, updated_at=? WHERE id=?", now(), now(), cid);
      this.notify('campaigns');
    } catch (e) {
      this.db.run("UPDATE campaigns SET status='paused', error=? WHERE id=?", String(e.message || e).slice(0, 500), cid);
      this.notify('campaigns');
    } finally {
      this.sending.delete(cid);
    }
  }

  // ---------- événements (SES + fonction publique) ----------
  async pollOnce() {
    const aws = this.getAws();
    const infra = this.infra;
    if (!aws || !infra?.inboxUrl) return 0;
    const msgs = await aws.receive(infra.inboxUrl);
    const done = [];
    for (const m of msgs) {
      try { (this.router || this).handleMessage(JSON.parse(m.body)); } catch (e) { console.error('Événement ignoré', e.message); }
      done.push(m.handle);
    }
    await aws.ack(infra.inboxUrl, done);
    if (msgs.length) this.notify('events');
    return msgs.length;
  }

  startPolling() {
    // Avec plusieurs espaces, un seul moteur (celui de l'espace principal) lit la file AWS et répartit les événements.
    if (this.router?.primary && this.router.primary !== this) return this.router.primary.startPolling();
    if (this.polling) return;
    this.polling = true;
    const loop = async () => {
      while (this.polling) {
        try {
          const n = await this.pollOnce();
          if (!n) await sleep(3000);
        } catch (e) {
          this.lastPollError = e.message;
          await sleep(30000);
        }
      }
    };
    loop();
  }

  handleMessage(ev) {
    if (ev.kind) return this.handlePublic(ev);
    if (!ev.eventType || !ev.mail) return;
    const type = ev.eventType.toLowerCase().replace('rendering failure', 'rendering_failure');
    const mid = ev.mail.messageId;
    const tags = ev.mail.tags || {};
    const send = this.db.get('SELECT * FROM sends WHERE message_id=?', mid);
    const contactId = send?.contact_id || tags.uid?.[0] || null;
    const campaignId = send?.campaign_id || tags.cid?.[0] || null;
    const at = ev[type]?.timestamp || ev.mail.timestamp || now();
    let url = null, bot = 0, detail = null;
    if (type === 'click') { url = ev.click.link; bot = ev.click.isBotEvent === 'Likely' ? 1 : 0; }
    if (type === 'open') bot = ev.open?.isBotEvent === 'Likely' ? 1 : 0;
    if (type === 'bounce') detail = `${ev.bounce.bounceType}/${ev.bounce.bounceSubType || ''}`;
    if (type === 'complaint') detail = ev.complaint.complaintFeedbackType || '';
    if (!send && tags.kind) return; // e-mails de test et de confirmation : pas de statistiques
    this.db.run('INSERT INTO events(type,message_id,contact_id,campaign_id,automation_id,step_id,url,bot,detail,at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      type, mid, contactId, campaignId, send?.automation_id || null, send?.step_id || null, url, bot, detail, at);
    if (contactId) {
      if (type === 'bounce' && ev.bounce.bounceType === 'Permanent') this.suppress(contactId, 'bounced');
      if (type === 'complaint') this.suppress(contactId, 'complained');
    }
  }

  suppress(contactId, status) {
    this.model.setStatus(contactId, status);
    this.db.run("UPDATE automation_runs SET status='cancelled', finished_at=? WHERE contact_id=? AND status='active'", now(), contactId);
  }

  handlePublic(ev) {
    if (ev.kind === 'unsubscribe') {
      let email;
      try { email = unb64u(ev.email); } catch { return; }
      const c = this.model.contact(email);
      if (!c) return;
      if (c.status === 'subscribed' || c.status === 'pending') this.suppress(c.id, 'unsubscribed');
      this.db.run('INSERT INTO events(type,contact_id,campaign_id,at) VALUES(?,?,?,?)', 'unsubscribe', c.id, ev.campaign && ev.campaign !== '-' ? ev.campaign : null, ev.ts || now());
      this.notify('contacts');
    }
    if (ev.kind === 'form') return this.handleForm(ev);
    if (ev.kind === 'confirm') {
      let email;
      try { email = unb64u(ev.email); } catch { return; }
      const c = this.model.contact(email);
      if (!c) return;
      const wasPending = c.status === 'pending';
      this.db.run("UPDATE contacts SET status='subscribed', consent_at=?, consent_source=?, updated_at=? WHERE id=?", ev.ts || now(), `double opt-in (formulaire ${ev.form})`, now(), c.id);
      if (wasPending) {
        const form = this.db.get('SELECT * FROM forms WHERE id=?', ev.form);
        if (form) this.afterSubscribe(c.id, form);
      }
      this.notify('contacts');
    }
  }

  handleForm(ev) {
    const form = this.db.get('SELECT * FROM forms WHERE id=?', ev.form);
    if (!form) return;
    const f = ev.fields || {};
    this.db.run('INSERT INTO submissions(form_id,email,fields,at) VALUES(?,?,?,?)', form.id, f.email, JSON.stringify(f), ev.ts || now());
    const { email, first_name, prenom, last_name, nom, phone, telephone, ...rest } = f;
    const existing = this.model.contact(email);
    const doi = !!form.double_optin;
    const status = doi ? (existing?.status === 'subscribed' ? 'subscribed' : 'pending') : 'subscribed';
    const tagIds = safeJson(form.tag_ids, []);
    const r = this.model.upsertContact(
      { email, first_name: first_name || prenom, last_name: last_name || nom, phone: phone || telephone, fields: rest, status },
      { listIds: form.list_id ? [form.list_id] : [], tagIds, allowResubscribe: !doi, source: `formulaire : ${form.name}` },
    );
    const c = r.contact;
    if (c.status === 'pending') this.sendConfirmation(c, form).catch((e) => console.error('Confirmation non envoyée', e.message));
    else if (c.status === 'subscribed') this.afterSubscribe(c.id, form, r.added);
    this.notify('contacts');
  }

  async sendConfirmation(contact, form) {
    const conf = safeJson(form.confirm, {});
    const design = safeJson(form.design, {});
    const from = conf.from_email || this.db.getSetting('defaultFrom', {}).email;
    if (!from) throw new Error('Aucune adresse d’expédition par défaut');
    const link = this.confirmUrl(contact.email, form.id, design.redirect || '');
    const ar = (design.lang || 'fr') === 'ar';
    const subject = conf.subject || (ar ? 'يرجى تأكيد اشتراكك' : 'Confirmez votre inscription');
    const btn = conf.button || (ar ? 'تأكيد الاشتراك' : 'Je confirme mon inscription');
    const intro = conf.text || (ar ? 'شكراً لاشتراكك. يرجى الضغط على الزر لتأكيد عنوان بريدك الإلكتروني.' : 'Merci pour votre inscription. Cliquez sur le bouton ci-dessous pour confirmer votre adresse e-mail.');
    const color = design.accent || '#1f6f5c';
    const html = `<!doctype html><html dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"></head><body style="margin:0;background:#f4f4f4"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="560" style="max-width:560px;background:#fff;border-radius:8px" cellpadding="0" cellspacing="0"><tr><td style="padding:32px;font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#222;text-align:${ar ? 'right' : 'left'}">
<p>${escHtml(intro)}</p><p style="text-align:center;margin:28px 0"><a href="{{lien_confirmation}}" ses:no-track style="background:${color};color:#fff;text-decoration:none;padding:14px 24px;border-radius:6px;font-weight:bold;display:inline-block">${escHtml(btn)}</a></p>
<p style="font-size:13px;color:#666">${ar ? 'إذا لم تطلب هذا الاشتراك، تجاهل هذه الرسالة.' : 'Si vous n’êtes pas à l’origine de cette demande, ignorez simplement ce message.'}</p>
<p style="font-size:12px;color:#888">{{entreprise}} — {{adresse}}</p></td></tr></table></td></tr></table></body></html>`;
    const msg = this.buildMessage({ html: this.merge(html, contact, { lien_confirmation: link }), subject, fromName: conf.from_name || this.db.getSetting('defaultFrom', {}).name, fromEmail: from, contact, campaignId: 'confirm', tags: { kind: 'confirm' } });
    msg.headers = []; // pas de lien de désinscription : l'adresse n'est pas encore abonnée
    await this.getAws().send(msg);
  }

  afterSubscribe(contactId, form, added = null) {
    const lists = added ? added.lists : form?.list_id ? [form.list_id] : [];
    const tags = added ? added.tags : safeJson(form?.tag_ids, []);
    this.trigger({ type: 'form', formId: form?.id, contactId });
    for (const l of lists) this.trigger({ type: 'list_join', listId: l, contactId });
    for (const t of tags) this.trigger({ type: 'tag_added', tagId: t, contactId });
  }

  // ---------- automatisations ----------
  automation(aid) {
    const a = this.db.get('SELECT * FROM automations WHERE id=?', aid);
    return a ? { ...a, trigger: safeJson(a.trigger_def, {}), steps: safeJson(a.steps, []) } : null;
  }

  /** Inscrit un contact dans les automatisations actives correspondant à un déclencheur. */
  trigger({ type, listId, tagId, formId, contactId }) {
    const autos = this.db.all("SELECT * FROM automations WHERE status='active'").map((a) => ({ ...a, trigger: safeJson(a.trigger_def, {}) }));
    for (const a of autos) {
      const t = a.trigger;
      if (t.type !== type) continue;
      if (type === 'list_join' && t.listId !== listId) continue;
      if (type === 'tag_added' && t.tagId !== tagId) continue;
      if (type === 'form' && t.formId !== formId) continue;
      this.enroll(a.id, contactId, t.allowReentry ? `${Date.now()}` : 'once');
    }
  }

  enroll(aid, contactId, runKey = 'once') {
    const c = this.db.get('SELECT status FROM contacts WHERE id=?', contactId);
    if (!c || c.status !== 'subscribed') return false;
    const r = this.db.run('INSERT OR IGNORE INTO automation_runs(id,automation_id,contact_id,step_index,next_at,status,run_key,started_at) VALUES(?,?,?,?,?,?,?,?)',
      id('rn'), aid, contactId, 0, now(), 'active', runKey, now());
    return r.changes > 0;
  }

  async tickAutomations() {
    if (!this.getAws() || !this.infra?.publicUrl) return;
    const due = this.db.all("SELECT * FROM automation_runs WHERE status='active' AND next_at<=? ORDER BY next_at LIMIT 100", now());
    for (const run of due) {
      const a = this.automation(run.automation_id);
      if (!a || a.status !== 'active') continue;
      const contact = this.db.get('SELECT * FROM contacts WHERE id=?', run.contact_id);
      if (!contact || contact.status !== 'subscribed') { this.db.run("UPDATE automation_runs SET status='cancelled', finished_at=? WHERE id=?", now(), run.id); continue; }
      let idx = run.step_index;
      let next = now();
      let lastMid = run.last_message_id;
      // Exécute les étapes immédiates jusqu'à une attente.
      while (idx < a.steps.length) {
        const st = a.steps[idx];
        if (st.type === 'wait') {
          const ms = Number(st.amount || 0) * ({ minutes: 6e4, hours: 36e5, days: 864e5 }[st.unit] || 864e5);
          idx++;
          if (ms <= 0) continue;
          next = new Date(Date.now() + ms).toISOString();
          break;
        }
        if (st.type === 'email') {
          let skip = false;
          if (st.condition && st.condition !== 'always' && lastMid) {
            const opened = !!this.db.get("SELECT 1 FROM events WHERE message_id=? AND type IN ('open','click') AND bot=0", lastMid);
            const clicked = !!this.db.get("SELECT 1 FROM events WHERE message_id=? AND type='click' AND bot=0", lastMid);
            skip = (st.condition === 'opened' && !opened) || (st.condition === 'not_opened' && opened) || (st.condition === 'clicked' && !clicked) || (st.condition === 'not_clicked' && clicked);
          }
          if (!skip) {
            try {
              const msg = this.buildMessage({ html: st.html, subject: st.subject, preheader: st.preheader, fromName: a.from_name, fromEmail: a.from_email, replyTo: a.reply_to, contact, campaignId: null, tags: { aid: a.id, stp: st.id, uid: contact.id } });
              const mid = await this.getAws().send(msg);
              this.db.run('INSERT INTO sends(id,automation_id,step_id,contact_id,email,message_id,status,queued_at,sent_at) VALUES(?,?,?,?,?,?,?,?,?)', id('sd'), a.id, st.id, contact.id, contact.email, mid, 'sent', now(), now());
              lastMid = mid;
            } catch (e) {
              this.db.run('INSERT INTO sends(id,automation_id,step_id,contact_id,email,status,error,queued_at) VALUES(?,?,?,?,?,?,?,?)', id('sd'), a.id, st.id, contact.id, contact.email, 'failed', String(e.message).slice(0, 500), now());
              if (/Throttl|rate/i.test(e.message)) { next = new Date(Date.now() + 60000).toISOString(); break; }
            }
          }
        }
        if (st.type === 'tag' && st.tagId) {
          if (st.action === 'remove') this.model.removeTag(contact.id, st.tagId);
          else if (this.model.addTag(contact.id, st.tagId)) this.trigger({ type: 'tag_added', tagId: st.tagId, contactId: contact.id });
        }
        if (st.type === 'list' && st.listId) {
          if (st.action === 'remove') this.model.removeFromList(contact.id, st.listId);
          else if (this.model.addToList(contact.id, st.listId)) this.trigger({ type: 'list_join', listId: st.listId, contactId: contact.id });
        }
        idx++;
      }
      if (idx >= a.steps.length && next <= now()) this.db.run("UPDATE automation_runs SET status='done', step_index=?, finished_at=?, last_message_id=? WHERE id=?", idx, now(), lastMid, run.id);
      else this.db.run('UPDATE automation_runs SET step_index=?, next_at=?, last_message_id=? WHERE id=?', idx, next, lastMid, run.id);
    }
    if (due.length) this.notify('automations');
  }

  /** Déclencheur « date anniversaire » : une fois par jour et par an pour chaque contact. */
  tickDates() {
    const today = new Date();
    const md = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const autos = this.db.all("SELECT * FROM automations WHERE status='active'").map((a) => ({ ...a, trigger: safeJson(a.trigger_def, {}) })).filter((a) => a.trigger.type === 'date' && a.trigger.field);
    for (const a of autos) {
      const key = a.trigger.field.replace(/"/g, '');
      const rows = this.db.all(`SELECT id, json_extract(fields, '$."${key}"') d FROM contacts WHERE status='subscribed' AND json_extract(fields, '$."${key}"') IS NOT NULL`);
      for (const r of rows) {
        const m = String(r.d).match(/(\d{4})-(\d{2})-(\d{2})|(\d{2})\/(\d{2})(?:\/(\d{2,4}))?/);
        if (!m) continue;
        const rmd = m[1] ? `${m[2]}-${m[3]}` : `${m[5]}-${m[4]}`;
        if (rmd === md) this.enroll(a.id, r.id, String(today.getFullYear()));
      }
    }
  }

  async tickScheduled() {
    const due = this.db.all("SELECT id FROM campaigns WHERE status='scheduled' AND scheduled_at<=?", now());
    for (const c of due) {
      this.db.run("UPDATE campaigns SET status='draft' WHERE id=?", c.id);
      try { await this.startCampaign(c.id); } catch (e) { this.db.run("UPDATE campaigns SET status='failed', error=? WHERE id=?", e.message, c.id); }
      this.notify('campaigns');
    }
  }

  start({ poll = true } = {}) {
    if (poll) this.startPolling();
    // Reprise des campagnes interrompues (fermeture de l'application pendant un envoi).
    for (const c of this.db.all("SELECT id FROM campaigns WHERE status='sending'")) this.runCampaign(c.id);
    const tick = async () => {
      try { await this.tickScheduled(); } catch (e) { console.error(e); }
      try { await this.tickAutomations(); } catch (e) { console.error(e); }
    };
    this.timers.push(setInterval(tick, 20000));
    this.timers.push(setInterval(() => { try { this.tickDates(); } catch (e) { console.error(e); } }, 3600000));
    setTimeout(tick, 2000);
    setTimeout(() => { try { this.tickDates(); } catch (e) { console.error(e); } }, 5000);
  }

  stop() { this.polling = false; for (const t of this.timers) clearInterval(t); }
}

function encodeName(name) {
  // Nom d'expéditeur : encodage MIME si caractères non ASCII (arabe, accents).
  if (/^[\x20-\x7e]*$/.test(name)) return `"${name.replace(/"/g, '')}"`;
  return `=?UTF-8?B?${Buffer.from(name, 'utf8').toString('base64')}?=`;
}

module.exports = { Engine, htmlToText, b64u, unb64u };
