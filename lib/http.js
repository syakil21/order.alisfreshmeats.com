// Small request/response helpers that work the same on Vercel and the local dev server.
const crypto = require('crypto');

function query(req) {
  const u = new URL(req.url, 'http://x');
  return Object.fromEntries(u.searchParams.entries());
}

async function rawBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body;
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
    return null; // already parsed by platform
  }
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function body(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = await rawBody(req);
  if (!raw) return {};
  const type = String(req.headers['content-type'] || '');
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw).entries());
  try { return JSON.parse(raw); } catch { return {}; }
}

function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (data === undefined || data === null) return res.end();
  if (Buffer.isBuffer(data) || typeof data === 'string') return res.end(data);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function ip(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();
}

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

const rid = (n = 12) => crypto.randomBytes(n).toString('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// wraps a handler so thrown errors become JSON 500s instead of crashing
function handler(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, e.status || 500, { error: e.expose ? e.message : (e.status ? e.message : 'Something went wrong. Please try again.') });
    }
  };
}

function httpError(status, message) {
  const e = new Error(message); e.status = status; e.expose = true; return e;
}

module.exports = { query, rawBody, body, send, redirect, ip, siteUrl, rid, safeEqual, handler, httpError };
