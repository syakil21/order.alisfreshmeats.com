// GET /api/order?id=…&t=… — the customer's order status page (needs the private token from their link).
const store = require('../lib/store');
const { query, send, safeEqual, siteUrl, handler } = require('../lib/http');
const { refreshDelivery, syncPayment, expireIfUnpaid } = require('../lib/fulfil');
const { stage } = require('../lib/stage');
const lalamove = require('../lib/lalamove');

const LIVE = ['ASSIGNING_DRIVER', 'ON_GOING', 'PICKED_UP'];

module.exports = handler(async (req, res) => {
  const q = query(req);
  let order = await store.getOrder(q.id);
  if (!order || !safeEqual(order.token, q.t)) return send(res, 404, { error: 'Order not found' });

  // Backup for a missed Billplz callback: while unpaid (first 6 hours), ask Billplz directly.
  if (order.payment.status === 'pending' && Date.now() - order.createdAt < 6 * 3600000) {
    try { order = await syncPayment(order, siteUrl(req)); } catch (e) { console.warn('payment check failed', e.message); }
  }

  // Backup for missed webhooks: refresh from Lalamove at most once a minute while the delivery is live.
  const d = order.delivery || {};
  if (d.lalamoveOrderId && LIVE.includes(d.status) && Date.now() - (d.checkedAt || 0) > 60000) {
    try { order = await refreshDelivery(order); } catch (e) { console.warn('refresh failed', e.message); }
  }
  const settings = await store.getSettings();
  // never paid within the time allowed: cancel it now (also done by the server's timer and the dashboard)
  if (order.payment.status === 'pending') { try { order = await expireIfUnpaid(order, siteUrl(req), settings); } catch (e) { console.warn('expiry failed', e.message); } }
  const s = stage(order);
  const del = order.delivery || {};
  const pickup = order.fulfilment === 'pickup';
  const branch = settings.branches.find((b) => b.id === order.branchId) || {};
  send(res, 200, {
    no: order.no, createdAt: order.createdAt, name: order.customer.name, branchName: order.branchName,
    fulfilment: pickup ? 'pickup' : 'delivery', deliveryOption: order.deliveryOption || '',
    address: order.address.text, unit: order.address.unit,
    shop: pickup ? { name: branch.name, address: branch.address || '', lat: branch.lat, lng: branch.lng, phone: branch.phone || '', mapsUrl: branch.mapsUrl || '' } : null,
    items: order.items.map(({ name, qty, unit, lineSen, cutText }) => ({ name, qty, unit, lineSen, cutText: cutText || '' })),
    subtotalSen: order.subtotalSen, discounts: order.discounts || [], smallOrderSen: order.smallOrderSen || 0, deliverySen: order.deliverySen, totalSen: order.totalSen,
    advance: !!order.advance,
    preorder: !!order.preorder && Date.parse(order.scheduledFor || order.pickup?.at || '') > Date.now(),
    pointsUsed: order.pointsUsed || 0, pointsSen: order.pointsSen || 0, pointsEarned: order.pointsEarned || 0,
    paid: order.payment.status === 'paid',
    payUrl: order.payment.status === 'pending' ? order.payment.billUrl : '',
    expired: order.payment.status === 'expired',
    payBy: order.payment.status === 'pending' ? order.createdAt + Math.max(10, Number(settings.payMinutes) || 30) * 60000 : 0,
    replacedBy: order.payment.status === 'replaced' && order.replacedBy?.id ? await (async () => { const r = await store.getOrder(order.replacedBy.id); return r ? { no: r.no, link: `/order.html?id=${r.id}&t=${r.token}` } : null; })() : null,
    stage: s.key, stageText: s.text,
    pickupAt: pickup ? order.pickup?.at || null : del.scheduleAt || order.scheduledFor || null,
    trackUrl: del.lalamoveOrderId && !lalamove.FINAL_FAIL.includes(del.status) ? del.shareLink || '' : '',
    driver: del.driver?.name ? { name: del.driver.name, plate: del.driver.plate || '' } : null,
    notify: (order.pushSubs || []).length > 0,
    whatsapp: settings.whatsapp,
  });
});
