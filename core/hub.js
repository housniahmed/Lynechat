// Espaces clients : chaque client (ou marque) a sa propre base de données — contacts, campagnes, modèles,
// automatisations, formulaires, expéditeur et informations légales. Le compte AWS, l'infrastructure d'envoi
// et le secret de signature sont communs et restent dans la base principale (lynechat.sqlite).
const fs = require('fs');
const path = require('path');
const { Db, id, now } = require('./db');
const { Model } = require('./model');
const { Engine } = require('./engine');
const { makeApi } = require('./api');
const report = require('./report');

const COLORS = ['#1f6f5c', '#2f5fb3', '#b0472e', '#7a4bb3', '#b3871f', '#2e8a9a', '#a83a6c', '#4f6b2e'];
const MAX_LOGO = 400 * 1024; // logo en data URL

class Hub {
  constructor({ dataDir, getAws, notify, setCreds, getCredsInfo }) {
    this.dir = dataDir;
    this.wsDir = path.join(dataDir, 'workspaces');
    fs.mkdirSync(this.wsDir, { recursive: true });
    this.main = new Db(path.join(dataDir, 'lynechat.sqlite'));
    this.getAws = getAws;
    this.notifyRaw = notify || (() => {});
    this.setCreds = setCreds;
    this.getCredsInfo = getCredsInfo;
    this.open = new Map();
    this.started = false;
    this.hubApi = this.makeHubApi();
  }

  // ---------- registre des espaces ----------
  list() {
    let l = this.main.getSetting('workspaces', null);
    if (!Array.isArray(l) || !l.find((w) => w.id === 'main')) {
      l = [{ id: 'main', name: 'Principal', color: COLORS[0], createdAt: now() }, ...(Array.isArray(l) ? l.filter((w) => w.id !== 'main') : [])];
      this.main.setSetting('workspaces', l);
    }
    return l;
  }
  saveList(l) { this.main.setSetting('workspaces', l); }
  has(wid) { return this.list().some((w) => w.id === wid); }
  info(wid) { return this.list().find((w) => w.id === wid) || null; }
  get currentId() { const c = this.main.getSetting('currentWorkspace', 'main'); return this.has(c) ? c : 'main'; }
  file(wid) {
    if (!/^ws_[A-Za-z0-9]+$/.test(wid)) throw new Error('Identifiant d’espace invalide');
    return path.join(this.wsDir, `${wid}.sqlite`);
  }

  /** Ouvre (ou renvoie) la base, le modèle, le moteur et l'API d'un espace. */
  ws(wid) {
    let w = this.open.get(wid);
    if (w) return w;
    if (!this.has(wid)) throw new Error('Espace introuvable');
    const db = wid === 'main' ? this.main : new Db(this.file(wid));
    const model = new Model(db);
    const engine = new Engine({ db, gdb: this.main, model, getAws: this.getAws, wsId: wid, router: this, notify: (type, detail) => this.notifyRaw(type, { ...(detail || {}), ws: wid }) });
    const api = makeApi({ db, gdb: this.main, model, engine, getAws: this.getAws, setCreds: this.setCreds, getCredsInfo: this.getCredsInfo });
    w = { id: wid, db, model, engine, api };
    this.open.set(wid, w);
    if (this.started) engine.start({ poll: wid === 'main' });
    return w;
  }
  get primary() { return this.ws('main').engine; }
  get current() { return this.ws(this.currentId); }

  start() {
    this.started = true;
    for (const w of this.list()) this.ws(w.id).engine.start({ poll: w.id === 'main' });
  }
  stop() { for (const w of this.open.values()) w.engine.stop(); }

  // ---------- répartition des événements AWS vers le bon espace ----------
  route(ev) {
    if (ev.kind === 'unsubscribe') {
      const c = String(ev.campaign || '');
      const i = c.indexOf('~');
      if (i > 0) {
        const wid = c.slice(0, i);
        return this.has(wid) ? [this.ws(wid).engine, { ...ev, campaign: c.slice(i + 1) }] : null;
      }
      return [this.primary, ev];
    }
    if (ev.kind === 'form' || ev.kind === 'confirm') {
      for (const w of this.list()) if (this.ws(w.id).db.get('SELECT 1 FROM forms WHERE id=?', String(ev.form || ''))) return [this.ws(w.id).engine, ev];
      return null;
    }
    if (ev.mail) {
      const t = ev.mail.tags?.ws?.[0];
      if (t && this.has(t)) return [this.ws(t).engine, ev];
      const mid = ev.mail.messageId;
      for (const w of this.list()) if (this.ws(w.id).db.get('SELECT 1 FROM sends WHERE message_id=?', mid)) return [this.ws(w.id).engine, ev];
    }
    return [this.primary, ev];
  }
  handleMessage(ev) {
    const r = this.route(ev);
    if (r) r[0].handleMessage(r[1]);
  }

  /** Appel depuis l'interface : méthodes des espaces, sinon méthodes de l'espace actif. */
  async call(method, args = [], extra = {}) {
    if (Object.hasOwn(this.hubApi, method)) return this.hubApi[method](...args);
    const api = this.current.api;
    const fn = Object.hasOwn(api, method) ? api[method] : null;
    if (typeof fn !== 'function') throw new Error(`Méthode inconnue : ${method}`);
    if (method === 'deployInfra') return fn(extra.onStatus || (() => {}));
    return fn(...args);
  }

  // ---------- rapports ----------
  brand(wid) {
    const w = this.info(wid) || {};
    const company = this.ws(wid).db.getSetting('company', {});
    return { client: { name: w.name, color: w.color, logo: w.logo || '', website: company.website || '' }, agency: this.main.getSetting('agency', {}) };
  }

  makeHubApi() {
    const hub = this;
    const clean = (p) => {
      const o = {};
      if (p.name != null) { o.name = String(p.name).trim().slice(0, 80); if (!o.name) throw new Error('Donnez un nom à l’espace.'); }
      if (p.color != null) o.color = /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : COLORS[0];
      if (p.logo != null) {
        if (p.logo && !/^data:image\/(png|jpeg|gif|webp);base64,/.test(p.logo)) throw new Error('Logo : image PNG, JPEG, GIF ou WebP uniquement.');
        if (p.logo.length > MAX_LOGO * 1.37) throw new Error('Logo trop lourd (400 Ko maximum).');
        o.logo = p.logo;
      }
      if (p.note != null) o.note = String(p.note).slice(0, 500);
      return o;
    };
    return {
      workspaces: () => hub.list().map((w) => {
        const { db } = hub.ws(w.id);
        return {
          ...w, current: w.id === hub.currentId,
          contacts: db.get("SELECT COUNT(*) n FROM contacts WHERE status='subscribed'").n,
          campaigns: db.get('SELECT COUNT(*) n FROM campaigns').n,
          lastSent: db.get("SELECT MAX(sent_at) d FROM campaigns WHERE status='sent'").d,
          sender: db.getSetting('defaultFrom', {}).email || '',
        };
      }),
      currentWorkspace: () => ({ ...hub.info(hub.currentId), current: true }),
      createWorkspace: (p = {}) => {
        const l = hub.list();
        const w = { id: id('ws'), color: COLORS[l.length % COLORS.length], ...clean({ name: p.name || '', ...p }), createdAt: now() };
        hub.saveList([...l, w]);
        const opened = hub.ws(w.id);
        // Option : reprendre les modèles d'e-mail de l'espace actif.
        if (p.copyTemplates) {
          for (const t of hub.current.db.all('SELECT * FROM templates')) opened.db.run('INSERT INTO templates VALUES(?,?,?,?,?)', id('tp'), t.name, t.design, now(), now());
        }
        if (p.switchTo !== false) hub.main.setSetting('currentWorkspace', w.id);
        return w;
      },
      updateWorkspace: (wid, p = {}) => {
        const l = hub.list();
        const i = l.findIndex((w) => w.id === wid);
        if (i < 0) throw new Error('Espace introuvable');
        l[i] = { ...l[i], ...clean(p) };
        hub.saveList(l);
        return l[i];
      },
      switchWorkspace: (wid) => {
        if (!hub.has(wid)) throw new Error('Espace introuvable');
        hub.main.setSetting('currentWorkspace', wid);
        return hub.info(wid);
      },
      deleteWorkspace: (wid) => {
        if (wid === 'main') throw new Error('L’espace principal ne peut pas être supprimé.');
        if (!hub.has(wid)) throw new Error('Espace introuvable');
        const w = hub.ws(wid);
        if (w.db.get("SELECT 1 FROM campaigns WHERE status='sending'")) throw new Error('Une campagne de cet espace est en cours d’envoi. Mettez-la d’abord en pause.');
        w.engine.stop();
        w.db.close();
        hub.open.delete(wid);
        // La base n'est pas effacée : elle part dans « workspaces/corbeille » (récupérable à la main).
        const trash = path.join(hub.wsDir, 'corbeille');
        fs.mkdirSync(trash, { recursive: true });
        const stamp = now().replace(/[:.]/g, '-');
        for (const suf of ['', '-wal', '-shm']) {
          const f = hub.file(wid) + suf;
          if (fs.existsSync(f)) fs.renameSync(f, path.join(trash, `${wid}-${stamp}.sqlite${suf}`));
        }
        hub.saveList(hub.list().filter((x) => x.id !== wid));
        if (hub.main.getSetting('currentWorkspace') === wid) hub.main.setSetting('currentWorkspace', 'main');
        return true;
      },
      agency: () => hub.main.getSetting('agency', {}),
      saveAgency: (a = {}) => {
        const o = {
          name: String(a.name || '').slice(0, 80), website: String(a.website || '').slice(0, 200),
          email: String(a.email || '').slice(0, 120), color: /^#[0-9a-fA-F]{6}$/.test(a.color || '') ? a.color : '#1f6f5c',
          logo: '', showClientLogo: a.showClientLogo !== false,
        };
        if (a.logo) {
          if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(a.logo)) throw new Error('Logo : image PNG, JPEG, GIF ou WebP uniquement.');
          if (a.logo.length > MAX_LOGO * 1.37) throw new Error('Logo trop lourd (400 Ko maximum).');
          o.logo = a.logo;
        }
        hub.main.setSetting('agency', o);
        return o;
      },
      /** HTML du rapport (campagne ou période) de l'espace actif, prêt à imprimer en PDF. */
      reportHtml: (kind, arg = {}) => {
        const w = hub.current;
        const brand = hub.brand(w.id);
        if (kind === 'campaign') {
          const d = w.api.reportData(arg.campaignId);
          return { html: report.campaignReport(d, brand, arg), name: report.fileName(brand, d.campaign.name) };
        }
        if (kind === 'period') return { html: report.periodReport(w.api.periodReportData(arg.from, arg.to), brand, arg), name: report.fileName(brand, `${arg.from}_${arg.to}`) };
        throw new Error('Type de rapport inconnu');
      },
    };
  }
}

module.exports = { Hub, COLORS };
