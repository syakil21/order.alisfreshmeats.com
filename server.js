// Production server for hosts that run a normal Node.js app (Hostinger Business/Cloud/VPS, etc.).
// On Vercel this file is not used: Vercel runs api/*.js directly.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, 'public');
const API = path.join(__dirname, 'api');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
const handlers = {};
for (const f of fs.readdirSync(API)) if (f.endsWith('.js')) handlers[f.slice(0, -3)] = require(path.join(API, f));

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const qr = u.pathname.match(/^\/s\/([\w-]+)\/?$/i); // label QR codes: /S/AFM-1006
  if (qr) { req.url = `/api/s?no=${encodeURIComponent(qr[1])}`; return handlers.s(req, res); }
  const m = u.pathname.match(/^\/api\/([\w-]+)\/?$/);
  if (m) {
    const h = handlers[m[1]];
    if (!h) { res.statusCode = 404; return res.end('Not found'); }
    return h(req, res);
  }
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(u.pathname)));
  if (!file.startsWith(PUBLIC)) { res.statusCode = 400; return res.end(); }
  if (u.pathname === '/' || (fs.existsSync(file) && fs.statSync(file).isDirectory())) file = path.join(file, 'index.html');
  if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html';
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.statusCode = 404; res.setHeader('Content-Type', 'text/html'); return res.end('<p>Page not found. <a href="/">Go to the shop</a></p>'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600');
    fs.createReadStream(file).pipe(res);
  });
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => console.log(`Ali's Fresh Meats running on port ${PORT}`));
