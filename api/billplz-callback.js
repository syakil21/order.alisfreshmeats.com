// POST /api/billplz-callback — Billplz server-to-server payment notice (X Signature verified).
const db = require('../lib/db');
const store = require('../lib/store');
const billplz = require('../lib/billplz');
const { body, send, siteUrl, handler } = require('../lib/http');
const { fulfil, syncPayment } = require('../lib/fulfil');
const activity = require('../lib/activity');

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, 'POST only');
  const p = await body(req);
  const orderId = p.id ? await db.get(`bill:${p.id}`) : null;
  if (!billplz.verify(p)) {
    // Don't trust the message, but don't lose the payment either: ask Billplz directly (with our API key).
    activity.log('error', `Billplz payment notice for bill ${p.id || '?'} had a wrong X Signature. Check BILLPLZ_X_SIGNATURE_KEY in Hostinger. The payment was re-checked with Billplz.`);
    if (orderId) { try { await syncPayment(await store.getOrder(orderId), siteUrl(req), { force: true }); } catch (e) { console.warn('billplz re-check failed', e.message); } }
    return send(res, 200, 'OK');
  }
  if (!orderId) return send(res, 200, 'OK');
  if (String(p.paid) === 'true' && p.state === 'paid') {
    await fulfil(orderId, siteUrl(req), { paidAmountSen: Number(p.paid_amount || p.amount), source: 'callback' });
  } else {
    const order = await store.getOrder(orderId);
    if (order && order.payment.status === 'pending') { store.addLog(order, `Billplz reported unpaid (${p.state})`); await store.saveOrder(order); }
  }
  send(res, 200, 'OK');
});
