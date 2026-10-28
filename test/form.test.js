// Teste le code de formulaire généré : page autonome servie localement, envoi réel vers la fonction Lambda
// (exécutée localement derrière un petit serveur HTTP, file SQS simulée).
const http = require('http');
const path = require('path');
const Module = require('module');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));

const queue = [];
const orig = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@aws-sdk/client-sqs') return { SQSClient: class { async send(c) { queue.push(JSON.parse(c.input.MessageBody)); return {}; } }, SendMessageCommand: class { constructor(i) { this.input = i; } } };
  return orig.call(this, req, ...rest);
};
process.env.SECRET = 'x'.repeat(40);
process.env.QUEUE_URL = 'q';
const lambda = require('../aws/lambda.js');

(async () => {
  // Serveur imitant une URL de fonction Lambda (+ CORS, comme la configuration du modèle).
  const api = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const u = new URL(req.url, 'http://x');
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const r = await lambda.handler({ requestContext: { http: { method: req.method } }, rawPath: u.pathname, queryStringParameters: Object.fromEntries(u.searchParams), body: Buffer.concat(chunks).toString(), headers: { 'content-type': req.headers['content-type'] || '' } });
    res.writeHead(r.statusCode, { ...cors, ...(r.headers || {}) });
    res.end(r.body || '');
  }).listen(0);
  const endpoint = `http://127.0.0.1:${api.address().port}/`;

  // Génère la page via le module de l'interface (exécuté dans le navigateur).
  const site = http.createServer((req, res) => {
    const file = req.url === '/' ? '/test/form-harness.html' : req.url.split('?')[0];
    const fp = path.join(__dirname, '..', file);
    try {
      const body = require('fs').readFileSync(fp);
      res.writeHead(200, { 'content-type': fp.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  }).listen(0);
  require('fs').writeFileSync(path.join(__dirname, 'form-harness.html'), `<!doctype html><meta charset="utf-8"><body><script type="module">
    window.lynechat = { call: async () => [] };
    const m = await import('/app/js/views/forms.js');
    window.__done = m;
  </script></body>`);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${site.address().port}/`);
  await page.waitForFunction(() => window.__done);
  // Le module n'exporte pas landingPage : on le reconstruit via l'export de test.
  const html = await page.evaluate(async (ep) => {
    const m = await import('/app/js/views/forms.js');
    return m.__test.landingPage({ id: 'fm_test', name: 'T', design: m.__test.defaults({ design: { lang: 'ar', custom: [{ key: 'ville', label: 'المدينة', on: true }] } }, { name: 'Zenith' }) }, ep);
  }, endpoint);
  await page.setContent(html);
  await page.fill('input[name=email]', 'nouveau@x.ma');
  await page.fill('input[name=first_name]', 'سارة');
  await page.fill('input[name=ville]', 'الدار البيضاء');
  await page.check('input[type=checkbox]');
  await page.click('button[type=submit]');
  await page.waitForSelector('.lynechat-msg', { state: 'visible' });
  const msg = await page.textContent('.lynechat-msg');
  const dir = await page.getAttribute('#lynechat-fm_test', 'dir');
  console.log('Message affiché :', msg.trim(), '| dir =', dir);
  console.log('File :', JSON.stringify(queue));
  if (queue.length !== 1 || queue[0].fields.email !== 'nouveau@x.ma' || queue[0].fields.ville !== 'الدار البيضاء' || queue[0].form !== 'fm_test') throw new Error('Soumission incorrecte');
  if ('_hp' in queue[0].fields) throw new Error('Champ piège transmis');
  if (errs.length) throw new Error(errs.join('; '));
  console.log('TEST FORMULAIRE OK');
  await browser.close(); api.close(); site.close();
  require('fs').unlinkSync(path.join(__dirname, 'form-harness.html'));
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
