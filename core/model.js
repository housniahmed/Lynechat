// Contacts, listes, tags, segments, audiences et statistiques.
const { id, now } = require('./db');

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const CORE_FIELDS = ['email', 'first_name', 'last_name', 'phone', 'lang', 'status', 'source'];
const STATUSES = ['subscribed', 'pending', 'unsubscribed', 'bounced', 'complained'];

function normEmail(e) { return String(e || '').trim().toLowerCase(); }

class Model {
  constructor(db) { this.db = db; }

  // ---------- contacts ----------
  contact(idOrEmail) {
    return this.db.get('SELECT * FROM contacts WHERE id=? OR email=?', idOrEmail, normEmail(idOrEmail));
  }

  parseContact(c) {
    if (!c) return null;
    return {
      ...c,
      fields: safeJson(c.fields, {}),
      lists: this.db.all('SELECT l.id, l.name FROM list_members m JOIN lists l ON l.id=m.list_id WHERE m.contact_id=?', c.id),
      tags: this.db.all('SELECT t.id, t.name FROM contact_tags ct JOIN tags t ON t.id=ct.tag_id WHERE ct.contact_id=?', c.id),
    };
  }

  /**
   * Crée ou met à jour un contact. Ne réabonne jamais un contact désinscrit ou en échec,
   * sauf si `allowResubscribe` (nouveau consentement explicite, ex. double opt-in confirmé).
   */
  upsertContact(data, { listIds = [], tagIds = [], allowResubscribe = false, source = '' } = {}) {
    const email = normEmail(data.email);
    if (!EMAIL_RE.test(email)) throw new Error(`Adresse e-mail invalide : ${data.email || '(vide)'}`);
    const t = now();
    let c = this.db.get('SELECT * FROM contacts WHERE email=?', email);
    let created = false;
    if (!c) {
      const cid = id('ct');
      const status = STATUSES.includes(data.status) ? data.status : 'subscribed';
      this.db.run(`INSERT INTO contacts(id,email,first_name,last_name,phone,lang,status,fields,source,consent_at,consent_source,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, cid, email, data.first_name || '', data.last_name || '', data.phone || '', data.lang || 'fr',
      status, JSON.stringify(data.fields || {}), source || data.source || '', status === 'subscribed' ? t : null, status === 'subscribed' ? (source || 'import') : null, t, t);
      c = this.db.get('SELECT * FROM contacts WHERE id=?', cid);
      created = true;
    } else {
      const fields = { ...safeJson(c.fields, {}), ...(data.fields || {}) };
      let status = c.status;
      if (data.status && STATUSES.includes(data.status)) {
        const blocked = ['unsubscribed', 'bounced', 'complained'].includes(c.status);
        if (!blocked || allowResubscribe || data.status !== 'subscribed') status = data.status;
      }
      this.db.run(`UPDATE contacts SET first_name=?, last_name=?, phone=?, lang=?, status=?, fields=?, updated_at=? WHERE id=?`,
        data.first_name ?? c.first_name, data.last_name ?? c.last_name, data.phone ?? c.phone, data.lang ?? c.lang, status, JSON.stringify(fields), t, c.id);
      if (status === 'subscribed' && c.status !== 'subscribed') this.db.run('UPDATE contacts SET consent_at=?, consent_source=? WHERE id=?', t, source || 'manuel', c.id);
      c = this.db.get('SELECT * FROM contacts WHERE id=?', c.id);
    }
    const added = { lists: [], tags: [] };
    for (const l of listIds) if (this.addToList(c.id, l)) added.lists.push(l);
    for (const tg of tagIds) if (this.addTag(c.id, tg)) added.tags.push(tg);
    return { contact: c, created, added };
  }

  updateContact(cid, patch) {
    const c = this.db.get('SELECT * FROM contacts WHERE id=?', cid);
    if (!c) throw new Error('Contact introuvable');
    if (patch.email && normEmail(patch.email) !== c.email) {
      if (!EMAIL_RE.test(normEmail(patch.email))) throw new Error('Adresse e-mail invalide');
      this.db.run('UPDATE contacts SET email=? WHERE id=?', normEmail(patch.email), cid);
    }
    const fields = patch.fields ? patch.fields : safeJson(c.fields, {});
    const status = patch.status && STATUSES.includes(patch.status) ? patch.status : c.status;
    this.db.run('UPDATE contacts SET first_name=?, last_name=?, phone=?, lang=?, status=?, fields=?, updated_at=? WHERE id=?',
      patch.first_name ?? c.first_name, patch.last_name ?? c.last_name, patch.phone ?? c.phone, patch.lang ?? c.lang, status, JSON.stringify(fields), now(), cid);
    if (status === 'subscribed' && c.status !== 'subscribed') this.db.run('UPDATE contacts SET consent_at=?, consent_source=? WHERE id=?', now(), 'manuel', cid);
    return this.parseContact(this.db.get('SELECT * FROM contacts WHERE id=?', cid));
  }

  setStatus(cid, status) {
    this.db.run('UPDATE contacts SET status=?, updated_at=? WHERE id=?', status, now(), cid);
  }

  deleteContacts(ids) {
    this.db.tx(() => { for (const x of ids) this.db.run('DELETE FROM contacts WHERE id=?', x); });
  }

  /** Liste paginée avec recherche et filtres. */
  listContacts({ search = '', listId = '', tagId = '', segmentId = '', status = '', limit = 100, offset = 0 } = {}) {
    const where = [];
    const args = [];
    if (search) {
      where.push('(c.email LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.phone LIKE ?)');
      const s = `%${search}%`; args.push(s, s, s, s);
    }
    if (listId) { where.push('EXISTS (SELECT 1 FROM list_members m WHERE m.contact_id=c.id AND m.list_id=?)'); args.push(listId); }
    if (tagId) { where.push('EXISTS (SELECT 1 FROM contact_tags t WHERE t.contact_id=c.id AND t.tag_id=?)'); args.push(tagId); }
    if (status) { where.push('c.status=?'); args.push(status); }
    if (segmentId) {
      const seg = this.db.get('SELECT * FROM segments WHERE id=?', segmentId);
      if (seg) { const s = this.segmentSql(safeJson(seg.rules, {})); where.push(s.sql); args.push(...s.args); }
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.db.get(`SELECT COUNT(*) n FROM contacts c ${w}`, ...args).n;
    const rows = this.db.all(`SELECT c.* FROM contacts c ${w} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`, ...args, limit, offset);
    const tagRows = rows.length ? this.db.all(`SELECT ct.contact_id, t.name FROM contact_tags ct JOIN tags t ON t.id=ct.tag_id WHERE ct.contact_id IN (${rows.map(() => '?').join(',')})`, ...rows.map((r) => r.id)) : [];
    const tagMap = {};
    for (const r of tagRows) (tagMap[r.contact_id] ||= []).push(r.name);
    return { total, rows: rows.map((r) => ({ ...r, fields: safeJson(r.fields, {}), tags: tagMap[r.id] || [] })) };
  }

  counts() {
    const by = Object.fromEntries(this.db.all('SELECT status, COUNT(*) n FROM contacts GROUP BY status').map((r) => [r.status, r.n]));
    return { total: Object.values(by).reduce((a, b) => a + b, 0), ...by };
  }

  customFieldKeys() {
    const keys = new Set();
    for (const r of this.db.all("SELECT fields FROM contacts WHERE fields != '{}' LIMIT 5000")) for (const k of Object.keys(safeJson(r.fields, {}))) keys.add(k);
    for (const k of this.db.getSetting('customFields', [])) keys.add(k);
    return [...keys].sort();
  }

  // ---------- listes ----------
  lists() {
    return this.db.all(`SELECT l.*, (SELECT COUNT(*) FROM list_members m JOIN contacts c ON c.id=m.contact_id WHERE m.list_id=l.id) AS count,
      (SELECT COUNT(*) FROM list_members m JOIN contacts c ON c.id=m.contact_id WHERE m.list_id=l.id AND c.status='subscribed') AS subscribed
      FROM lists l ORDER BY l.created_at`);
  }
  createList(name, description = '') { const lid = id('ls'); this.db.run('INSERT INTO lists VALUES(?,?,?,?)', lid, name, description, now()); return lid; }
  renameList(lid, name, description) { this.db.run('UPDATE lists SET name=?, description=? WHERE id=?', name, description || '', lid); }
  deleteList(lid) { this.db.run('DELETE FROM lists WHERE id=?', lid); }
  addToList(cid, lid) { return this.db.run('INSERT OR IGNORE INTO list_members VALUES(?,?,?)', lid, cid, now()).changes > 0; }
  removeFromList(cid, lid) { this.db.run('DELETE FROM list_members WHERE list_id=? AND contact_id=?', lid, cid); }

  // ---------- tags ----------
  tags() { return this.db.all('SELECT t.*, (SELECT COUNT(*) FROM contact_tags ct WHERE ct.tag_id=t.id) AS count FROM tags t ORDER BY t.name'); }
  tagId(name) {
    const n = String(name).trim();
    if (!n) return null;
    const t = this.db.get('SELECT id FROM tags WHERE name=?', n);
    if (t) return t.id;
    const tid = id('tg'); this.db.run('INSERT INTO tags VALUES(?,?)', tid, n); return tid;
  }
  deleteTag(tid) { this.db.run('DELETE FROM tags WHERE id=?', tid); }
  addTag(cid, tid) { return this.db.run('INSERT OR IGNORE INTO contact_tags VALUES(?,?,?)', cid, tid, now()).changes > 0; }
  removeTag(cid, tid) { this.db.run('DELETE FROM contact_tags WHERE contact_id=? AND tag_id=?', cid, tid); }

  // ---------- segments ----------
  segments() { return this.db.all('SELECT * FROM segments ORDER BY created_at').map((s) => ({ ...s, rules: safeJson(s.rules, {}), count: this.countSegment(safeJson(s.rules, {})) })); }
  saveSegment(seg) {
    if (seg.id) this.db.run('UPDATE segments SET name=?, rules=? WHERE id=?', seg.name, JSON.stringify(seg.rules), seg.id);
    else { seg.id = id('sg'); this.db.run('INSERT INTO segments VALUES(?,?,?,?)', seg.id, seg.name, JSON.stringify(seg.rules), now()); }
    return seg.id;
  }
  deleteSegment(sid) { this.db.run('DELETE FROM segments WHERE id=?', sid); }
  countSegment(rules) { const s = this.segmentSql(rules); return this.db.get(`SELECT COUNT(*) n FROM contacts c WHERE ${s.sql}`, ...s.args).n; }

  /** Traduit des règles de segment en clause SQL paramétrée (aucune valeur n'est concaténée). */
  segmentSql(rules) {
    const conds = (rules.conditions || []).map((c) => this.condSql(c)).filter(Boolean);
    if (!conds.length) return { sql: '1=1', args: [] };
    const joiner = rules.match === 'any' ? ' OR ' : ' AND ';
    return { sql: `(${conds.map((c) => c.sql).join(joiner)})`, args: conds.flatMap((c) => c.args) };
  }

  condSql(c) {
    const v = c.value ?? '';
    const textOp = (col) => {
      switch (c.op) {
        case 'eq': return { sql: `LOWER(COALESCE(${col},''))=LOWER(?)`, args: [v] };
        case 'neq': return { sql: `LOWER(COALESCE(${col},''))!=LOWER(?)`, args: [v] };
        case 'contains': return { sql: `COALESCE(${col},'') LIKE ?`, args: [`%${v}%`] };
        case 'not_contains': return { sql: `COALESCE(${col},'') NOT LIKE ?`, args: [`%${v}%`] };
        case 'starts': return { sql: `COALESCE(${col},'') LIKE ?`, args: [`${v}%`] };
        case 'ends': return { sql: `COALESCE(${col},'') LIKE ?`, args: [`%${v}`] };
        case 'empty': return { sql: `COALESCE(${col},'')=''`, args: [] };
        case 'not_empty': return { sql: `COALESCE(${col},'')!=''`, args: [] };
        default: return null;
      }
    };
    if (CORE_FIELDS.includes(c.field)) return textOp(`c.${c.field}`);
    if (c.field === 'custom') {
      if (!/^[\p{L}\p{N}_ -]{1,64}$/u.test(c.key || '')) return null;
      return textOp(`json_extract(c.fields, '$."${c.key.replace(/"/g, '')}"')`);
    }
    if (c.field === 'list') return { sql: `${c.op === 'not_in' ? 'NOT ' : ''}EXISTS (SELECT 1 FROM list_members m WHERE m.contact_id=c.id AND m.list_id=?)`, args: [v] };
    if (c.field === 'tag') return { sql: `${c.op === 'not_has' ? 'NOT ' : ''}EXISTS (SELECT 1 FROM contact_tags t WHERE t.contact_id=c.id AND t.tag_id=?)`, args: [v] };
    if (c.field === 'created_at') {
      if (c.op === 'within_days') return { sql: `c.created_at >= ?`, args: [new Date(Date.now() - Number(v) * 864e5).toISOString()] };
      if (c.op === 'before') return { sql: `c.created_at < ?`, args: [new Date(v).toISOString()] };
      if (c.op === 'after') return { sql: `c.created_at >= ?`, args: [new Date(v).toISOString()] };
      return null;
    }
    if (c.field === 'activity') {
      const type = c.op.includes('click') ? 'click' : 'open';
      const neg = c.op.startsWith('not_');
      const scope = v && v !== 'any' ? 'AND e.campaign_id=?' : '';
      const days = Number(c.days) > 0 ? 'AND e.at >= ?' : '';
      const args = [];
      if (scope) args.push(v);
      if (days) args.push(new Date(Date.now() - Number(c.days) * 864e5).toISOString());
      return { sql: `${neg ? 'NOT ' : ''}EXISTS (SELECT 1 FROM events e WHERE e.contact_id=c.id AND e.type='${type}' AND e.bot=0 ${scope} ${days})`, args };
    }
    return null;
  }

  /** Résout l'audience d'une campagne : abonnés uniquement, sans doublons. */
  audienceSql(aud = {}) {
    const parts = [];
    const args = [];
    const lists = aud.lists || [], tags = aud.tags || [];
    if (lists.length || tags.length) {
      const ors = [];
      if (lists.length) { ors.push(`EXISTS (SELECT 1 FROM list_members m WHERE m.contact_id=c.id AND m.list_id IN (${lists.map(() => '?').join(',')}))`); args.push(...lists); }
      if (tags.length) { ors.push(`EXISTS (SELECT 1 FROM contact_tags t WHERE t.contact_id=c.id AND t.tag_id IN (${tags.map(() => '?').join(',')}))`); args.push(...tags); }
      parts.push(`(${ors.join(' OR ')})`);
    } else if (!aud.all && !aud.segmentId) parts.push('0=1');
    if (aud.segmentId) {
      const seg = this.db.get('SELECT rules FROM segments WHERE id=?', aud.segmentId);
      const s = this.segmentSql(seg ? safeJson(seg.rules, {}) : {});
      parts.push(s.sql); args.push(...s.args);
    }
    const ex = aud.excludeTags || [];
    if (ex.length) { parts.push(`NOT EXISTS (SELECT 1 FROM contact_tags t WHERE t.contact_id=c.id AND t.tag_id IN (${ex.map(() => '?').join(',')}))`); args.push(...ex); }
    parts.push("c.status='subscribed'");
    return { sql: parts.join(' AND '), args };
  }
  audienceCount(aud) { const s = this.audienceSql(aud); return this.db.get(`SELECT COUNT(*) n FROM contacts c WHERE ${s.sql}`, ...s.args).n; }
  audienceContacts(aud) { const s = this.audienceSql(aud); return this.db.all(`SELECT c.* FROM contacts c WHERE ${s.sql}`, ...s.args); }

  // ---------- import CSV ----------
  /**
   * @param rows tableau d'objets (en-têtes déjà associés aux champs)
   * @param mapping { colonne: 'email'|'first_name'|...|'custom:clé'|'tags'|'' }
   */
  importRows(rows, mapping, { listIds = [], tagIds = [], status = 'subscribed', source = 'import', updateExisting = true } = {}) {
    const report = { created: 0, updated: 0, skipped: 0, invalid: [], blocked: 0 };
    this.db.tx(() => {
      for (const [i, row] of rows.entries()) {
        const data = { fields: {} };
        const extraTags = [];
        for (const [col, target] of Object.entries(mapping)) {
          if (!target) continue;
          const val = String(row[col] ?? '').trim();
          if (target.startsWith('custom:')) { if (val) data.fields[target.slice(7)] = val; } else if (target === 'tags') extraTags.push(...val.split(/[;,|]/).map((x) => x.trim()).filter(Boolean));
          else data[target] = val;
        }
        if (!EMAIL_RE.test(normEmail(data.email))) { report.invalid.push({ line: i + 2, email: data.email || '' }); continue; }
        const exists = this.db.get('SELECT id, status FROM contacts WHERE email=?', normEmail(data.email));
        if (exists && !updateExisting) { report.skipped++; continue; }
        if (exists && ['unsubscribed', 'bounced', 'complained'].includes(exists.status)) report.blocked++;
        data.status = status;
        const tags = [...tagIds, ...extraTags.map((n) => this.tagId(n))];
        const r = this.upsertContact(data, { listIds, tagIds: tags, source });
        r.created ? report.created++ : report.updated++;
      }
    });
    return report;
  }

  exportContacts(filter) {
    const { rows } = this.listContacts({ ...filter, limit: 1e9, offset: 0 });
    const keys = this.customFieldKeys();
    const head = ['email', 'first_name', 'last_name', 'phone', 'lang', 'status', 'tags', 'created_at', ...keys];
    const esc = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [head.join(','), ...rows.map((r) => [r.email, r.first_name, r.last_name, r.phone, r.lang, r.status, r.tags.join('|'), r.created_at, ...keys.map((k) => r.fields[k])].map(esc).join(','))].join('\n');
  }

  // ---------- statistiques ----------
  campaignStats(cid) {
    const sent = this.db.get("SELECT COUNT(*) n FROM sends WHERE campaign_id=? AND status='sent'", cid).n;
    const failed = this.db.get("SELECT COUNT(*) n FROM sends WHERE campaign_id=? AND status='failed'", cid).n;
    const queued = this.db.get("SELECT COUNT(*) n FROM sends WHERE campaign_id=? AND status='queued'", cid).n;
    const uniq = (type, bot = false) => this.db.get(`SELECT COUNT(DISTINCT contact_id) n FROM events WHERE campaign_id=? AND type=? ${bot ? '' : 'AND bot=0'}`, cid, type).n;
    const total = (type) => this.db.get('SELECT COUNT(*) n FROM events WHERE campaign_id=? AND type=? AND bot=0', cid, type).n;
    const s = {
      sent, failed, queued,
      delivered: uniq('delivery', true),
      opens: uniq('open'), opensTotal: total('open'),
      clicks: uniq('click'), clicksTotal: total('click'),
      bounces: uniq('bounce', true), complaints: uniq('complaint', true), unsubscribes: uniq('unsubscribe', true),
      botOpens: this.db.get("SELECT COUNT(*) n FROM events WHERE campaign_id=? AND type='open' AND bot=1", cid).n,
    };
    const base = s.delivered || s.sent || 0;
    s.openRate = base ? s.opens / base : 0;
    s.clickRate = base ? s.clicks / base : 0;
    s.bounceRate = s.sent ? s.bounces / s.sent : 0;
    s.unsubRate = base ? s.unsubscribes / base : 0;
    s.links = this.db.all("SELECT url, COUNT(*) total, COUNT(DISTINCT contact_id) uniq FROM events WHERE campaign_id=? AND type='click' AND bot=0 GROUP BY url ORDER BY total DESC LIMIT 50", cid);
    s.timeline = this.db.all("SELECT substr(at,1,13) hour, type, COUNT(*) n FROM events WHERE campaign_id=? AND type IN ('open','click') AND bot=0 GROUP BY hour, type ORDER BY hour", cid);
    return s;
  }

  overview() {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const sent = this.db.get("SELECT COUNT(*) n FROM sends WHERE status='sent' AND sent_at>=?", since).n;
    const ev = Object.fromEntries(this.db.all("SELECT type, COUNT(DISTINCT message_id) n FROM events WHERE at>=? AND (bot=0 OR type NOT IN ('open','click')) GROUP BY type", since).map((r) => [r.type, r.n]));
    const growth = this.db.all("SELECT substr(created_at,1,10) day, COUNT(*) n FROM contacts WHERE created_at>=? GROUP BY day ORDER BY day", since);
    const unsubs = this.db.get("SELECT COUNT(*) n FROM events WHERE type='unsubscribe' AND at>=?", since).n;
    return { sent, delivered: ev.delivery || 0, opens: ev.open || 0, clicks: ev.click || 0, bounces: ev.bounce || 0, complaints: ev.complaint || 0, unsubs, growth, contacts: this.counts() };
  }
}

function safeJson(s, def) { try { return s ? JSON.parse(s) : def; } catch { return def; } }

module.exports = { Model, safeJson, normEmail, EMAIL_RE, STATUSES };
