// POST /api/quote — live price for the cart, discounts and delivery fee (shown before paying).
const db = require('../lib/db');
const members = require('../lib/members');
const { body, send, ip, handler } = require('../lib/http');
const { buildQuote } = require('../lib/quote');

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if ((await db.incr(`rl:quote:${ip(req)}`, 600)) > 150) return send(res, 429, { error: 'Too many requests, please wait a few minutes.' });
  const b = await body(req);
  const member = await members.fromRequest(req);
  const { result } = await buildQuote({ items: b.items, phone: b.phone, couponCode: b.couponCode, location: b.location, member });
  send(res, 200, result);
});
