// Lynechat — processus principal Electron.
const { app, BrowserWindow, protocol, net, ipcMain, safeStorage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Hub } = require('./core/hub');
const { makeAws } = require('./core/aws');

const ROOT = path.join(__dirname, 'app');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
if (process.platform === 'win32') app.setAppUserModelId('ma.lynechat.app');

let win = null;
let hub, db, awsClient = null;

function credsFromDb() {
  const c = db.getSetting('aws', null);
  if (!c?.accessKeyId || !c?.secret) return null;
  let secretAccessKey;
  try {
    secretAccessKey = c.enc && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(c.secret, 'base64')) : Buffer.from(c.secret, 'base64').toString();
  } catch { return null; }
  return { region: c.region, accessKeyId: c.accessKeyId, secretAccessKey };
}

function getAws() {
  if (awsClient) return awsClient;
  awsClient = makeAws(credsFromDb());
  return awsClient;
}

function setCreds({ region, accessKeyId, secretAccessKey }) {
  if (!region || !accessKeyId) throw new Error('Région et identifiant de clé obligatoires.');
  const prev = db.getSetting('aws', {});
  let secret = prev.secret, enc = prev.enc;
  if (secretAccessKey) {
    enc = safeStorage.isEncryptionAvailable();
    secret = enc ? safeStorage.encryptString(secretAccessKey).toString('base64') : Buffer.from(secretAccessKey).toString('base64');
  }
  if (!secret) throw new Error('Clé secrète obligatoire.');
  db.setSetting('aws', { region, accessKeyId: accessKeyId.trim(), secret, enc });
  awsClient = null;
}

function getCredsInfo() {
  const c = db.getSetting('aws', null);
  if (!c) return { configured: process.env.LYNECHAT_FAKE_AWS === '1', region: process.env.LYNECHAT_FAKE_AWS === '1' ? 'simulation' : '' };
  return { configured: true, region: c.region, accessKeyId: c.accessKeyId, encrypted: !!c.enc };
}

function notify(type, detail) {
  if (win && !win.isDestroyed()) win.webContents.send('lynechat:event', { type, detail });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1080, minHeight: 680, backgroundColor: '#f6f5f1', title: 'Lynechat',
    icon: path.join(ROOT, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadURL('app://lynechat/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
}

app.whenReady().then(() => {
  const dataDir = process.env.LYNECHAT_DATA_DIR || app.getPath('userData');
  fs.mkdirSync(dataDir, { recursive: true });
  hub = new Hub({ dataDir, getAws, notify, setCreds, getCredsInfo });
  db = hub.main; // réglages communs (clés AWS chiffrées, infrastructure)

  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let p = decodeURIComponent(url.pathname);
    if (!p || p === '/') p = '/index.html';
    const filePath = path.normalize(path.join(ROOT, p));
    if (!filePath.startsWith(ROOT)) return new Response('Forbidden', { status: 403 });
    try {
      const res = await net.fetch(pathToFileURL(filePath).toString());
      return new Response(res.body, { status: res.status, headers: { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });

  ipcMain.handle('lynechat:call', async (e, method, args) => hub.call(method, args || [], { onStatus: (st) => notify('deploy', st) }));
  // Rapport PDF : mise en page HTML → PDF A4 dans une fenêtre invisible (sans JavaScript), puis « Enregistrer sous ».
  ipcMain.handle('lynechat:exportReport', async (e, kind, arg) => {
    const { html, name } = hub.hubApi.reportHtml(kind, arg || {});
    // LYNECHAT_TEST_SAVE_DIR : tests automatiques uniquement (pas de boîte de dialogue).
    const r = process.env.LYNECHAT_TEST_SAVE_DIR ? { filePath: path.join(process.env.LYNECHAT_TEST_SAVE_DIR, name) } : await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return null;
    const pdfWin = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { javascript: false, sandbox: true, contextIsolation: true } });
    const tmp = path.join(app.getPath('temp'), `lynechat-rapport-${process.pid}-${Date.now()}.html`);
    fs.writeFileSync(tmp, html);
    try {
      await pdfWin.loadFile(tmp);
      const pdf = await pdfWin.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: 'A4' });
      fs.writeFileSync(r.filePath, pdf);
    } finally { pdfWin.destroy(); fs.rmSync(tmp, { force: true }); }
    if (arg?.open !== false && !process.env.LYNECHAT_TEST_SAVE_DIR) shell.openPath(r.filePath);
    return r.filePath;
  });
  ipcMain.handle('lynechat:saveFile', async (e, { name, content, filters }) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: name, filters });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, content);
    return r.filePath;
  });
  ipcMain.handle('lynechat:openExternal', (e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

  createWindow();
  hub.start();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { hub?.stop(); if (process.platform !== 'darwin') app.quit(); });
