// What happens after payment: print the label at the branch, then book Lalamove.
const db = require('./db');
const store = require('./store');
const lalamove = require('./lalamove');
const printnode = require('./printnode');
const members = require('./members');
const { buildLabel } = require('./label');
const { rm } = require('./util');

function labelOptions(settings, order, site) {
  return { ...settings.label, qrUrl: site ? `${site}/admin.html#order=${order.id}` : undefined };
}

async function markPaid(order, info = {}) {
  if (order.payment.status === 'paid') return order;
  order.payment.status = 'paid';
  order.payment.paidAt = Date.now();
  if (info.paidAmountSen) order.payment.paidSen = info.paidAmountSen;
  store.addLog(order, `Paid RM${rm(info.paidAmountSen || order.totalSen)} via Billplz (${info.source || 'callback'})`);
  if (order.couponCode) {
    const coupons = await store.getCoupons();
    const c = coupons[order.couponCode];
    if (c) {
      c.used = (c.used || 0) + 1;
      if (order.customer.phone && !(c.usedBy || []).includes(order.customer.phone)) (c.usedBy ||= []).push(order.customer.phone);
      await store.saveCoupons(coupons);
    }
  }
  try { await members.recordPaidOrder(order); } catch (e) { console.error('member update failed', e); }
  if (order.welcome) store.addLog(order, 'New member offer used');
  await store.saveOrder(order);
  return order;
}

async function printLabel(order, settings, site, { reason = 'auto' } = {}) {
  const branch = settings.branches.find((b) => b.id === order.branchId);
  order.print ||= {};
  if (!printnode.configured() || !branch?.printerId) {
    order.print = { ...order.print, status: 'not_configured', error: !printnode.configured() ? 'PrintNode API key missing' : `No printer chosen for ${order.branchName}`, at: Date.now() };
    store.addLog(order, 'Label not printed: printer not set up');
    return order;
  }
  try {
    const pdf = await buildLabel(order, labelOptions(settings, order, site));
    const jobId = await printnode.printPdf({ printerId: branch.printerId, title: `${order.no} label`, pdf });
    order.print = { status: 'sent', jobId, at: Date.now(), count: (order.print.count || 0) + 1 };
    store.addLog(order, `Label sent to printer (${reason}, job ${jobId})`);
  } catch (e) {
    order.print = { ...order.print, status: 'failed', error: e.message, at: Date.now() };
    store.addLog(order, `Label print failed: ${e.message}`);
  }
  return order;
}

function deliveryRemarks(order) {
  const lines = [`Ali's Fresh Meats order ${order.no}`];
  if (order.address.unit) lines.push(`Unit/Floor: ${order.address.unit}`);
  if (order.address.notes) lines.push(`Note: ${order.address.notes}`);
  lines.push('Fresh meat - please deliver promptly.');
  if (order.address.lat && order.address.lng) lines.push(`Pin: https://maps.google.com/?q=${order.address.lat},${order.address.lng}`);
  return lines.join('\r\n');
}

async function bookDelivery(order, settings) {
  const branch = settings.branches.find((b) => b.id === order.branchId);
  const prep = Math.max(0, Number(settings.prepMinutes) || 0);
  const scheduleAt = prep > 0 ? new Date(Date.now() + prep * 60000).toISOString() : undefined;
  const prev = order.delivery || {};
  try {
    const q = await lalamove.quote({
      pickup: { lat: branch.lat, lng: branch.lng, address: branch.address },
      dropoff: { lat: order.address.lat, lng: order.address.lng, address: order.address.text },
      serviceType: order.serviceType, specialRequests: settings.specialRequests, scheduleAt,
    });
    const placed = await lalamove.placeOrder({
      quote: q,
      sender: { name: `Ali's Fresh Meats ${branch.name}`, phone: branch.phone },
      recipient: { name: order.customer.name, phone: order.customer.phone, remarks: deliveryRemarks(order) },
      metadata: { orderNo: order.no, orderId: order.id },
    });
    order.delivery = {
      status: placed.status || 'ASSIGNING_DRIVER',
      lalamoveOrderId: String(placed.orderId),
      shareLink: placed.shareLink || '',
      feeRM: Number(placed.priceBreakdown?.total ?? q.totalRM),
      scheduleAt: scheduleAt || new Date().toISOString(),
      bookedAt: Date.now(),
      attempts: (prev.attempts || 0) + 1,
      previous: prev.lalamoveOrderId ? [...(prev.previous || []), prev.lalamoveOrderId] : prev.previous,
    };
    await db.set(`llm:${order.delivery.lalamoveOrderId}`, order.id);
    const diff = order.delivery.feeRM - order.deliveryQuoteRM;
    store.addLog(order, `Lalamove booked #${order.delivery.lalamoveOrderId}, fee RM${order.delivery.feeRM.toFixed(2)}${Math.abs(diff) >= 0.05 ? ` (quoted RM${order.deliveryQuoteRM.toFixed(2)} at checkout)` : ''}`);
  } catch (e) {
    order.delivery = { ...prev, status: 'BOOKING_FAILED', error: e.message, attempts: (prev.attempts || 0) + 1, failedAt: Date.now() };
    store.addLog(order, `Lalamove booking failed: ${e.message}`);
  }
  return order;
}

// Marks the order paid and fulfils it. Runs once per order even though Billplz sends both a
// server callback and a browser redirect (and may retry the callback).
async function fulfil(orderId, site, paidInfo) {
  const gotLock = await db.set(`lock:fulfil:${orderId}`, '1', { nx: true, ex: 90 });
  if (!gotLock) return store.getOrder(orderId);
  try {
    let order = await store.getOrder(orderId);
    if (!order) return null;
    if (paidInfo && order.payment.status !== 'paid') order = await markPaid(order, paidInfo);
    if (order.payment.status !== 'paid' || order.fulfilledAt) return order;
    const settings = await store.getSettings();
    // Booking first gives the scheduled pickup time to print on the label.
    order = await bookDelivery(order, settings);
    order = await printLabel(order, settings, site);
    order.fulfilledAt = Date.now();
    await store.saveOrder(order);
    return order;
  } finally {
    await db.del(`lock:fulfil:${orderId}`);
  }
}

// Pull the latest delivery status + driver from Lalamove.
async function refreshDelivery(order) {
  const id = order.delivery?.lalamoveOrderId;
  if (!id || !lalamove.configured()) return order;
  const d = await lalamove.getOrder(id);
  const before = order.delivery.status;
  order.delivery.status = d.status || before;
  order.delivery.shareLink = d.shareLink || order.delivery.shareLink;
  if (d.priceBreakdown?.total) order.delivery.feeRM = Number(d.priceBreakdown.total);
  const pod = d.stops?.[1]?.POD;
  if (pod) order.delivery.pod = { status: pod.status, image: pod.image, at: pod.deliveredAt };
  if (d.driverId && d.driverId !== order.delivery.driver?.id) {
    try {
      const drv = await lalamove.getDriver(id, d.driverId);
      order.delivery.driver = { id: d.driverId, name: drv.name, phone: drv.phone, plate: drv.plateNumber };
    } catch { order.delivery.driver = { id: d.driverId }; }
  }
  order.delivery.checkedAt = Date.now();
  if (before !== order.delivery.status) store.addLog(order, `Delivery status: ${order.delivery.status}`);
  await store.saveOrder(order);
  return order;
}

module.exports = { markPaid, fulfil, printLabel, bookDelivery, refreshDelivery, labelOptions };
