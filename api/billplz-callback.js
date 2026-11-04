// POST /api/billplz-callback — Billplz server-to-server payment notice (X Signature verified).
const db = require('../lib/db');
const store = require('../lib/store');
const billplz = require('../lib/billplz');
const { body, send, siteUrl, handler } = require('../lib/http');
const { fulfil } = require('../lib/fulfil');

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, 'POST only');
  const p = await body(req);
  if (!billplz.verify(p)) { console.warn('Billplz callback: bad signature', p.id); return send(res, 401, 'Invalid signature'); }
  const orderId = await db.get(`bill:${p.id}`);
  if (!orderId) return send(res, 200, 'OK');
  if (String(p.paid) === 'true' && p.state === 'paid') {
    await fulfil(orderId, siteUrl(req), { paidAmountSen: Number(p.paid_amount || p.amount), source: 'callback' });
  } else {
    const order = await store.getOrder(orderId);
    if (order && order.payment.status === 'pending') { store.addLog(order, `Billplz reported unpaid (${p.state})`); await store.saveOrder(order); }
  }
  send(res, 200, 'OK');
});
