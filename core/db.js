// Base de données locale (SQLite intégré à Node, aucun module natif à compiler).
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');

const id = (p) => `${p}_${crypto.randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x')}`;
const now = () => new Date().toISOString();

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  first_name TEXT DEFAULT '', last_name TEXT DEFAULT '', phone TEXT DEFAULT '', lang TEXT DEFAULT 'fr',
  status TEXT NOT NULL DEFAULT 'subscribed', fields TEXT DEFAULT '{}', source TEXT DEFAULT '',
  consent_at TEXT, consent_source TEXT, created_at TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS contacts_status ON contacts(status);
CREATE TABLE IF NOT EXISTS lists (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', created_at TEXT);
CREATE TABLE IF NOT EXISTS list_members (list_id TEXT REFERENCES lists(id) ON DELETE CASCADE, contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE, added_at TEXT, PRIMARY KEY (list_id, contact_id));
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS contact_tags (contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE, tag_id TEXT REFERENCES tags(id) ON DELETE CASCADE, added_at TEXT, PRIMARY KEY (contact_id, tag_id));
CREATE TABLE IF NOT EXISTS segments (id TEXT PRIMARY KEY, name TEXT NOT NULL, rules TEXT NOT NULL, created_at TEXT);
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, name TEXT, mime TEXT, data BLOB, width INT, height INT, created_at TEXT);
CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, name TEXT, design TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY, name TEXT, subject TEXT DEFAULT '', preheader TEXT DEFAULT '', from_name TEXT DEFAULT '', from_email TEXT DEFAULT '', reply_to TEXT DEFAULT '',
  audience TEXT DEFAULT '{}', design TEXT DEFAULT '{}', html TEXT DEFAULT '', status TEXT DEFAULT 'draft',
  scheduled_at TEXT, started_at TEXT, sent_at TEXT, total INT DEFAULT 0, error TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS sends (
  id TEXT PRIMARY KEY, campaign_id TEXT, automation_id TEXT, step_id TEXT, contact_id TEXT, email TEXT,
  message_id TEXT UNIQUE, status TEXT DEFAULT 'queued', error TEXT, queued_at TEXT, sent_at TEXT);
CREATE INDEX IF NOT EXISTS sends_campaign ON sends(campaign_id, status);
CREATE INDEX IF NOT EXISTS sends_auto ON sends(automation_id, step_id);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, message_id TEXT, contact_id TEXT, campaign_id TEXT, automation_id TEXT, step_id TEXT,
  url TEXT, bot INT DEFAULT 0, detail TEXT, at TEXT);
CREATE INDEX IF NOT EXISTS events_campaign ON events(campaign_id, type);
CREATE INDEX IF NOT EXISTS events_contact ON events(contact_id);
CREATE INDEX IF NOT EXISTS events_auto ON events(automation_id, step_id, type);
CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, name TEXT, status TEXT DEFAULT 'draft', trigger_def TEXT DEFAULT '{}', steps TEXT DEFAULT '[]', from_name TEXT DEFAULT '', from_email TEXT DEFAULT '', reply_to TEXT DEFAULT '', created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY, automation_id TEXT REFERENCES automations(id) ON DELETE CASCADE, contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  step_index INT DEFAULT 0, next_at TEXT, status TEXT DEFAULT 'active', run_key TEXT, started_at TEXT, finished_at TEXT, last_message_id TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS runs_key ON automation_runs(automation_id, contact_id, run_key);
CREATE INDEX IF NOT EXISTS runs_due ON automation_runs(status, next_at);
CREATE TABLE IF NOT EXISTS forms (id TEXT PRIMARY KEY, name TEXT, list_id TEXT, tag_ids TEXT DEFAULT '[]', double_optin INT DEFAULT 1, design TEXT DEFAULT '{}', confirm TEXT DEFAULT '{}', created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, form_id TEXT, email TEXT, fields TEXT, at TEXT);
`;

class Db {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    this.stmts = new Map();
  }

  q(sql) {
    let s = this.stmts.get(sql);
    if (!s) { s = this.db.prepare(sql); this.stmts.set(sql, s); }
    return s;
  }
  all(sql, ...a) { return this.q(sql).all(...a); }
  get(sql, ...a) { return this.q(sql).get(...a); }
  run(sql, ...a) { return this.q(sql).run(...a); }
  tx(fn) {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // --- réglages ---
  getSetting(k, def = null) { const r = this.get('SELECT value FROM settings WHERE key=?', k); return r ? JSON.parse(r.value) : def; }
  setSetting(k, v) { this.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(v)); }
}

module.exports = { Db, id, now };
