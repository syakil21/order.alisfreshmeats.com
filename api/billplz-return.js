// GET /api/billplz-return — customer's browser comes back from Billplz here, then goes to their order page.
const db = require('../lib/db');
const store = require('../lib/store');
const billplz = require('../lib/billplz');
const { query, redirect, siteUrl, handler } = require('../lib/http');
const { fulfil } = require('../lib/fulfil');

module.exports = handler(async (req, res) => {
  const q = query(req);
  const billId = q['billplz[id]'];
  const orderId = billId ? await db.get(`bill:${billId}`) : null;
  const order = orderId ? await store.getOrder(orderId) : null;
  if (!order) return redirect(res, '/');
  const valid = billplz.verify(q);
  if (valid && q['billplz[paid]'] === 'true' && order.payment.status !== 'paid') {
    await fulfil(order.id, siteUrl(req), { source: 'redirect' });
  }
  redirect(res, `/order.html?id=${order.id}&t=${order.token}${valid && q['billplz[paid]'] !== 'true' ? '&unpaid=1' : ''}`);
});
