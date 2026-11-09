// GET /api/image?id=… — product photos (stored in Upstash, uploaded from the staff dashboard).
// Each upload gets a new id, so photos can be cached by browsers for a year. Recent photos are also
// kept in memory so Upstash isn't asked again on every page view.
const db = require('../lib/db');
const { query, send, handler } = require('../lib/http');

const cache = global.__afmImgCache || (global.__afmImgCache = new Map());
const MAX_CACHED = 80;

module.exports = handler(async (req, res) => {
  const id = String(query(req).id || '');
  if (!/^[\w-]{6,40}$/.test(id)) return send(res, 404, 'Not found');
  let img = cache.get(id);
  if (!img) {
    const rec = await db.get(`img:${id}`);
    if (!rec?.b64) return send(res, 404, 'Not found');
    img = { type: rec.type || 'image/jpeg', buf: Buffer.from(rec.b64, 'base64') };
    cache.set(id, img);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', img.type);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.end(img.buf);
});
