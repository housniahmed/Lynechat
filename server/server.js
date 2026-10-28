// Lynechat — version serveur (navigateur). Réutilise le moteur de l'application de bureau.
// Démarrage : LYNECHAT_DATA_DIR=/var/lib/lynechat PORT=3000 node server/server.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Hub } = require('../core/hub');
const { makeAws } = require('../core/aws');

const ROOT = path.join(__dirname, '..', 'app');
const DATA = process.env.LYNECHAT_DATA_DIR || path.join(__dirname, '..', 'data');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1'; // derrière Caddy : jamais exposé directement
const SECRETS = path.join(DATA, 'secrets.json');
const MAX_BODY = 25 * 1024 * 1024;
const SESSION_DAYS = 14;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });

// ---------- secrets (clés AWS, mot de passe) : fichier lisible par le seul compte du service ----------
function readSecrets() { try { return JSON.parse(fs.readFileSync(SECRETS, 'utf8')); } catch { return {}; } }
function writeSecrets(s) {
  const tmp = `${SECRETS}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SECRETS);
  fs.chmodSync(SECRETS, 0o600);
}

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${h}`;
}
function checkPassword(pw, stored) {
  if (!stored) return false;
  const [, salt, h] = stored.split('$');
  const a = Buffer.from(hashPassword(pw, salt).split('$')[2], 'hex');
  const b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Commande : node server/server.js --set-password   (lit le mot de passe sur l'entrée standard)
if (process.argv.includes('--set-password')) {
  let input = '';
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    const pw = input.replace(/\r?\n$/, '');
    if (pw.length < 10) { console.error('Mot de passe trop court (10 caractères minimum).'); process.exit(1); }
    const s = readSecrets();
    s.passwordHash = hashPassword(pw);
    s.sessionSalt = crypto.randomBytes(16).toString('hex'); // invalide les sessions existantes
    writeSecrets(s);
    console.log('Mot de passe enregistré.');
    process.exit(0);
  });
  return;
}

// ---------- moteur ----------
let awsClient = null;
const creds = () => { const s = readSecrets(); return s.aws?.accessKeyId ? s.aws : null; };
const getAws = () => (awsClient ||= makeAws(creds()));
const clients = new Set();
const notify = (type, detail) => { const msg = `data: ${JSON.stringify({ type, detail })}\n\n`; for (const res of clients) res.write(msg); };
const hub = new Hub({
  dataDir: DATA, getAws, notify,
  setCreds: ({ region, accessKeyId, secretAccessKey }) => {
    if (!region || !accessKeyId) throw new Error('Région et identifiant de clé obligatoires.');
    const s = readSecrets();
    const secret = secretAccessKey || s.aws?.secretAccessKey;
    if (!secret) throw new Error('Clé secrète obligatoire.');
    s.aws = { region, accessKeyId: accessKeyId.trim(), secretAccessKey: secret };
    writeSecrets(s);
    awsClient = null;
  },
  getCredsInfo: () => {
    const c = creds();
    if (!c) return { configured: process.env.LYNECHAT_FAKE_AWS === '1', region: process.env.LYNECHAT_FAKE_AWS === '1' ? 'simulation' : '' };
    return { configured: true, region: c.region, accessKeyId: c.accessKeyId, encrypted: false, storage: 'serveur' };
  },
});
const db = hub.main;
db.db.exec('CREATE TABLE IF NOT EXISTS web_sessions (id TEXT PRIMARY KEY, expires TEXT, created TEXT, ip TEXT)');
hub.start();

// ---------- sessions ----------
const cookieName = 'lynechat_session';
const sessionHash = (token) => crypto.createHash('sha256').update(`${readSecrets().sessionSalt || ''}:${token}`).digest('hex');
function getSession(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${cookieName}=([A-Za-z0-9_-]+)`));
  if (!m) return null;
  const row = db.get('SELECT * FROM web_sessions WHERE id=?', sessionHash(m[1]));
  if (!row || row.expires < new Date().toISOString()) return null;
  return row;
}
function newSession(res, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.run('INSERT INTO web_sessions VALUES(?,?,?,?)', sessionHash(token), expires.toISOString(), new Date().toISOString(), clientIp(req));
  db.run('DELETE FROM web_sessions WHERE expires < ?', new Date().toISOString());
  const secure = process.env.LYNECHAT_INSECURE_COOKIE === '1' ? '' : '; Secure';
  res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// Limitation des tentatives de connexion : 8 essais par IP par 15 minutes.
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter((t) => now - t < 15 * 6e4);
  attempts.set(ip, a);
  return a.length >= 8;
}

// ---------- utilitaires HTTP ----------
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  // Les aperçus d'e-mail utilisent des iframes srcdoc et des images data:/blob:.
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SEC_HEADERS, ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('Requête trop volumineuse')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
// Les Uint8Array (images) circulent en JSON sous la forme { __b64: "..." }.
function revive(v) {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === 'object') {
    if (typeof v.__b64 === 'string' && Object.keys(v).length === 1) return new Uint8Array(Buffer.from(v.__b64, 'base64'));
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
  }
  return v;
}
function serveStatic(res, urlPath) {
  let p = decodeURIComponent(urlPath);
  if (p === '/') p = '/index.html';
  const fp = path.normalize(path.join(ROOT, p));
  if (!fp.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(fp, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const type = MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': /\/vendor\//.test(fp) ? 'public, max-age=86400' : 'no-cache', ...SEC_HEADERS });
    res.end(buf);
  });
}

// Méthodes autorisées depuis le navigateur (toutes celles de l'API, sauf indication contraire).
const BLOCKED = new Set([]);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  try {
    // --- connexion ---
    if (p === '/login' && req.method === 'GET') return serveStatic(res, '/login.html');
    if (p === '/api/login' && req.method === 'POST') {
      const ip = clientIp(req);
      if (tooMany(ip)) return send(res, 429, { error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
      const { password } = JSON.parse((await readBody(req)) || '{}');
      const s = readSecrets();
      if (!s.passwordHash) return send(res, 500, { error: 'Aucun mot de passe configuré sur le serveur (voir le guide d’installation).' });
      if (!checkPassword(String(password || ''), s.passwordHash)) {
        attempts.get(ip).push(Date.now());
        await new Promise((r) => setTimeout(r, 600));
        return send(res, 401, { error: 'Mot de passe incorrect.' });
      }
      attempts.delete(ip);
      newSession(res, req);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      const s = getSession(req);
      if (s) db.run('DELETE FROM web_sessions WHERE id=?', s.id);
      return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` });
    }
    // Ressources publiques nécessaires à la page de connexion
    if (/^\/(css|vendor|assets)\//.test(p) || p === '/login.html' || p === '/js/login.js') return serveStatic(res, p);

    // --- tout le reste exige une session ---
    const session = getSession(req);
    if (!session) {
      if (p.startsWith('/api/')) return send(res, 401, { error: 'Session expirée. Reconnectez-vous.' });
      res.writeHead(302, { Location: '/login' }); return res.end();
    }

    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': ok\n\n');
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    if (p === '/api/call' && req.method === 'POST') {
      // Protection CSRF : en-tête personnalisé obligatoire (impossible à envoyer depuis un autre site sans CORS).
      if (req.headers['x-lynechat'] !== '1') return send(res, 403, { error: 'Requête refusée.' });
      const { method, args } = JSON.parse(await readBody(req));
      if (typeof method !== 'string' || BLOCKED.has(method)) return send(res, 404, { error: `Méthode inconnue : ${method}` });
      try {
        const out = await hub.call(method, revive(args || []), { onStatus: (st) => notify('deploy', st) });
        return send(res, 200, { ok: true, result: out === undefined ? null : out });
      } catch (e) {
        return send(res, 200, { ok: false, error: e.message || String(e) });
      }
    }
    if (req.method === 'GET') return serveStatic(res, p);
    return send(res, 405, { error: 'Méthode non autorisée' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'Erreur interne' });
  }
});

server.listen(PORT, HOST, () => console.log(`Lynechat (web) sur http://${HOST}:${PORT} — données : ${DATA}`));
const stop = () => { hub.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
