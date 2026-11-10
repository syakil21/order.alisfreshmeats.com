// GET /api/billplz-return — customer's browser comes back from Billplz here, then goes to their order page.
const db = require('../lib/db');
const store = require('../lib/store');
const billplz = require('../lib/billplz');
const { query, redirect, siteUrl, handler } = require('../lib/http');
const { fulfil, syncPayment } = require('../lib/fulfil');
const activity = require('../lib/activity');

module.exports = handler(async (req, res) => {
  const q = query(req);
  const billId = q['billplz[id]'];
  const orderId = billId ? await db.get(`bill:${billId}`) : null;
  const order = orderId ? await store.getOrder(orderId) : null;
  if (!order) return redirect(res, '/');
  const valid = billplz.verify(q);
  if (valid && q['billplz[paid]'] === 'true' && order.payment.status !== 'paid') {
    await fulfil(order.id, siteUrl(req), { source: 'redirect' });
  } else if (!valid && order.payment.status !== 'paid') {
    activity.log('error', `Billplz return for ${order.no} had a wrong X Signature. Check BILLPLZ_X_SIGNATURE_KEY in Hostinger. Payment re-checked with Billplz.`, { orderNo: order.no, orderId: order.id });
    try { await syncPayment(order, siteUrl(req), { force: true }); } catch (e) { console.warn('billplz re-check failed', e.message); }
  }
  redirect(res, `/order.html?id=${order.id}&t=${order.token}${valid && q['billplz[paid]'] !== 'true' ? '&unpaid=1' : ''}`);
});
