// What happens after payment: book Lalamove (delivery orders), print the label at the branch,
// and notify the customer and staff.
const db = require('./db');
const store = require('./store');
const lalamove = require('./lalamove');
const printnode = require('./printnode');
const members = require('./members');
const push = require('./push');
const { buildLabel } = require('./label');
const { rm, fmtDateTime, fmtQty } = require('./util');

// QR = short upper-case link (smaller, easier-to-scan code): /S/AFM-1006 opens that order in the staff dashboard
function labelOptions(settings, order, site) {
  return { ...settings.label, qrUrl: site && settings.label.qr !== false ? `${site}/s/${order.no}`.toUpperCase() : undefined };
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
  try { await moveStock(order, -1); } catch (e) { console.error('stock update failed', e); }
  if (order.welcome) store.addLog(order, 'New member offer used');
  if (order.pointsUsed) store.addLog(order, `${order.pointsUsed} points used (−RM${rm(order.pointsSen)})`);
  if (order.pointsEarned) store.addLog(order, `${order.pointsEarned} points earned`);
  await store.saveOrder(order);
  return order;
}

// Take sold items off stock (sign -1) or put them back (sign +1). Only counted items change.
async function moveStock(order, sign) {
  if (sign < 0 && order.stockApplied) return;
  if (sign > 0 && !order.stockApplied) return;
  const qty = {};
  for (const it of order.items) if (it.productId) qty[it.productId] = (qty[it.productId] || 0) + it.qty;
  const parts = [];
  for (const [id, q] of Object.entries(qty)) {
    const r = await store.changeStock(id, sign * q);
    if (!r) continue;
    const it = order.items.find((x) => x.productId === id);
    parts.push(`${it.name} ${sign < 0 ? '−' : '+'}${fmtQty(q, it.unit)} → ${fmtQty(r.left, it.unit)} left${r.short ? ` (oversold by ${fmtQty(r.short, it.unit)})` : ''}`);
  }
  order.stockApplied = sign < 0;
  if (parts.length) store.addLog(order, `Stock ${sign < 0 ? 'sold' : 'returned'}: ${parts.join('; ')}`, 'stock');
}

// Undo the effects of a paid order (cancel / delete): stock, points, new member offer, coupon use. Runs once.
async function reverseOrder(order) {
  if (order.payment?.status !== 'paid' || order.reversedAt) return;
  await moveStock(order, +1);
  try { await members.reversePaidOrder(order); } catch (e) { console.error('member reverse failed', e); }
  if (order.couponCode) {
    const coupons = await store.getCoupons(); const c = coupons[order.couponCode];
    if (c) { c.used = Math.max(0, (c.used || 0) - 1); c.usedBy = (c.usedBy || []).filter((p) => p !== order.customer.phone); await store.saveCoupons(coupons); }
  }
  order.reversedAt = Date.now();
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
  const saver = order.deliveryOption === 'saver' && settings.saver?.serviceType;
  try {
    const q = await lalamove.quote({
      pickup: { lat: branch.lat, lng: branch.lng, address: branch.address },
      dropoff: { lat: order.address.lat, lng: order.address.lng, address: order.address.text },
      serviceType: saver ? settings.saver.serviceType : order.serviceType,
      specialRequests: saver ? settings.saver.specialRequests || settings.specialRequests : settings.specialRequests, scheduleAt,
      tier: order.deliveryOption === 'priority' ? '2' : '1',
    });
    const placed = await lalamove.placeOrder({
      quote: q,
      sender: { name: `Ali's Fresh Meats ${branch.name}`, phone: branch.phone },
      recipient: { name: order.customer.name, phone: order.customer.phone, remarks: deliveryRemarks(order) },
      metadata: { orderNo: order.no, orderId: order.id },
    });
    const history = [...(prev.history || [])];
    if (prev.lalamoveOrderId) history.push({ id: prev.lalamoveOrderId, status: prev.status, feeRM: prev.feeRM, priorityFeeRM: prev.priorityFeeRM || 0, at: prev.bookedAt });
    order.delivery = {
      status: placed.status || 'ASSIGNING_DRIVER',
      lalamoveOrderId: String(placed.orderId),
      shareLink: placed.shareLink || '',
      feeRM: Number(placed.priceBreakdown?.total ?? q.totalRM),
      priorityFeeRM: 0,
      scheduleAt: scheduleAt || new Date().toISOString(),
      bookedAt: Date.now(),
      attempts: (prev.attempts || 0) + 1,
      history,
      previous: history.map((h) => h.id),
    };
    await db.set(`llm:${order.delivery.lalamoveOrderId}`, order.id);
    const diff = order.delivery.feeRM - order.deliveryQuoteRM;
    store.addLog(order, `Lalamove booked #${order.delivery.lalamoveOrderId}${q.tier === '2' ? ' (Priority)' : ''}, fee RM${order.delivery.feeRM.toFixed(2)}${Math.abs(diff) >= 0.05 ? ` (quoted RM${Number(order.deliveryQuoteRM).toFixed(2)} at checkout)` : ''}`);
  } catch (e) {
    order.delivery = { ...prev, status: 'BOOKING_FAILED', error: e.message, attempts: (prev.attempts || 0) + 1, failedAt: Date.now() };
    store.addLog(order, `Lalamove booking failed: ${e.message}`);
  }
  return order;
}

// Priority fee / tip on the current Lalamove booking. `totalRM` replaces any earlier priority fee.
async function addTip(order, totalRM, why = 'staff') {
  const d = order.delivery || {};
  try {
    await lalamove.addPriorityFee(d.lalamoveOrderId, totalRM);
    d.priorityFeeRM = Number(totalRM);
    store.addLog(order, `Priority fee RM${Number(totalRM).toFixed(2)} added on Lalamove (${why})`);
    return true;
  } catch (e) {
    store.addLog(order, `Priority fee not added: ${e.message}`);
    if (why === 'staff') throw e;
    return false;
  }
}

function confirmText(order) {
  if (order.fulfilment === 'pickup') return `We're preparing ${order.no}. Collect it at our ${order.branchName} shop, ${fmtDateTime(Date.parse(order.pickup.at))}.`;
  return `We're preparing ${order.no}. A Lalamove driver will collect it from our ${order.branchName} shop.`;
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
    if (order.fulfilment !== 'pickup') order = await bookDelivery(order, settings);
    order = await printLabel(order, settings, site);
    order.fulfilledAt = Date.now();
    await store.saveOrder(order);
    await Promise.all([
      push.notifyOrder(order, { title: 'Order confirmed ✅', body: confirmText(order) }),
      push.notifyStaff({
        title: `New order ${order.no} · RM${rm(order.totalSen)}`,
        body: `${order.fulfilment === 'pickup' ? `Self pickup ${fmtDateTime(Date.parse(order.pickup.at))}` : `Delivery${order.deliveryOption === 'priority' ? ' (PRIORITY)' : ''}`} · ${order.customer.name} · ${order.branchName}`,
        url: `/admin.html#order=${order.id}`, tag: `staff-${order.no}`,
      }),
    ]);
    return order;
  } finally {
    await db.del(`lock:fulfil:${orderId}`);
  }
}

const STATUS_PUSH = {
  ON_GOING: (o) => ({ title: 'Driver on the way to our shop 🛵', body: `${o.delivery.driver?.name || 'Your Lalamove driver'} is collecting ${o.no}.` }),
  PICKED_UP: (o) => ({ title: 'Your order is on the way 🚚', body: `${o.no} has left our ${o.branchName} shop.` }),
  COMPLETED: (o) => ({ title: 'Delivered. Enjoy! 🍖', body: `${o.no} has been delivered. Thank you for ordering with Ali's Fresh Meats.` }),
};

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
      order.delivery.driver = { id: d.driverId, name: drv.name, phone: drv.phone, plate: drv.plateNumber, matchedAt: Date.now() };
    } catch { order.delivery.driver = { id: d.driverId, matchedAt: Date.now() }; }
  }
  order.delivery.checkedAt = Date.now();
  if (before !== order.delivery.status) {
    store.addLog(order, `Delivery status: ${order.delivery.status}`);
    if (STATUS_PUSH[order.delivery.status]) push.notifyOrder(order, STATUS_PUSH[order.delivery.status](order));
    if (lalamove.FINAL_FAIL.includes(order.delivery.status)) push.notifyStaff({ title: `⚠ ${order.no}: Lalamove ${order.delivery.status.toLowerCase()}`, body: 'Open the order to add a tip or rebook.', url: `/admin.html#order=${order.id}`, tag: `staff-${order.no}` });
  }
  await store.saveOrder(order);
  return order;
}

module.exports = { markPaid, fulfil, printLabel, bookDelivery, refreshDelivery, labelOptions, addTip, moveStock, reverseOrder };
