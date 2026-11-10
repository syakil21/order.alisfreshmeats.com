// POST /api/admin — staff dashboard actions. Every action except "login" needs the session token.
const crypto = require('crypto');
const db = require('../lib/db');
const store = require('../lib/store');
const billplz = require('../lib/billplz');
const lalamove = require('../lib/lalamove');
const printnode = require('../lib/printnode');
const { buildLabel } = require('../lib/label');
const { body, send, ip, siteUrl, rid, safeEqual, handler, httpError } = require('../lib/http');
const { syncPayment, fulfil, printLabel, bookDelivery, refreshDelivery, labelOptions, withCategories, addTip, reverseOrder } = require('../lib/fulfil');
const staff = require('../lib/staff');
const { stage } = require('../lib/stage');
const members = require('../lib/members');
const push = require('../lib/push');
const activity = require('../lib/activity');
const { insights, summarize } = require('../lib/insights');
const { normalizePhone, shopOpen, mytParts, fmtTime, rm, fmtQty } = require('../lib/util');

const num = (v, d = 0) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const slug = (s) => str(s, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || rid(4).toLowerCase();

async function requireSession(req) {
  const t = String(req.headers.authorization || '').replace(/^Bearer /, '');
  const me = t ? await staff.current(await db.get(`sess:${t}`)) : null;
  if (!me) throw httpError(401, 'Please log in again.');
  return me;
}
// What normal staff may do. Everything else (edit/delete orders, prices, settings, insights, customers,
// promotions, activity log, staff accounts) is for super admins only.
const STAFF_OK = new Set([
  'logout', 'me', 'home', 'orders.list', 'order.byNo', 'order.get', 'order.reprint', 'order.rebook', 'order.rebookQuote',
  'order.cancelDelivery', 'order.refresh', 'order.checkPayment', 'order.ready', 'order.collected', 'order.undoReady',
  'order.tip', 'order.changeDriver', 'products.get', 'products.toggle', 'stock.set', 'staffPush.save',
]);

function summary(o) {
  const s = stage(o);
  const d = o.delivery || {};
  const printProblem = o.print?.status && o.print.status !== 'sent' && o.payment.status === 'paid' && !o.cancelledAt ? 'Label not printed' : false;
  return {
    id: o.id, no: o.no, createdAt: o.createdAt, name: o.customer.name, phone: o.customer.phone, branchName: o.branchName,
    totalSen: o.totalSen, itemCount: o.items.length, paid: o.payment.status === 'paid', paymentStatus: o.payment.status,
    items: o.items.map((i) => `${i.unit === 'kg' ? `${i.qty} kg` : `${i.qty}×`} ${i.name}`).join(', ').slice(0, 160),
    fulfilment: o.fulfilment || 'delivery', deliveryOption: o.deliveryOption || (o.fulfilment === 'pickup' ? '' : 'regular'),
    stage: s.key, stageText: s.text, board: s.board, problem: s.problem || printProblem,
    printStatus: o.print?.status || '', deliveryStatus: d.status || '',
    pickupAt: o.fulfilment === 'pickup' ? o.pickup?.at || null : d.scheduleAt || null,
    driver: d.driver?.name || '', driverPlate: d.driver?.plate || '', driverPhone: d.driver?.phone || '', priorityFeeRM: d.priorityFeeRM || 0, bookedAt: d.bookedAt || 0, matchedAt: d.driver?.matchedAt || 0,
    readyAt: o.prep?.readyAt || 0, cancelledAt: o.cancelledAt || 0, attempts: d.attempts || 0,
  };
}
const detail = (o) => { const { token, ...rest } = o; return { ...rest, ...{ summary: summary(o) } }; };

const SAMPLE_ORDER = {
  id: 'test', no: 'AFM-TEST', customer: { name: 'Test Customer', phone: '+60123456789' }, branchName: 'Test',
  address: { text: 'Test address', notes: 'Test print from dashboard' }, delivery: { scheduleAt: new Date().toISOString() },
  fulfilment: 'delivery', deliveryOption: 'priority',
  items: [
    { productId: 'boneless-meat', name: 'Boneless Meat', qty: 1.5, unit: 'kg', cutText: '2 inch pieces · Curry cut' },
    { productId: 'lamb-chop-shoulder-slices', name: 'Lamb Chop Shoulder Slices', qty: 1, unit: 'kg', cutText: '1 inch thick · "Remove fat please"' },
    { productId: 'mutton-leg-bones-marrow', name: 'Mutton Leg Bones (Marrow)', qty: 1, unit: 'kg', cutText: 'Cut each into 3 pcs' },
    { productId: 'head', name: 'Head', qty: 1, unit: 'set' },
  ],
};
// Cancel the order's Lalamove booking if it's still live. A booking Lalamove doesn't have (test keys, removed)
// counts as cancelled. Any other failure stops the action, unless a super admin chose to go ahead anyway (force).
async function stopLalamove(o, me, why, force) {
  const d = o.delivery || {};
  if (!d.lalamoveOrderId || !['ASSIGNING_DRIVER', 'ON_GOING'].includes(d.status)) return 'none';
  try {
    await lalamove.cancelOrder(d.lalamoveOrderId); d.status = 'CANCELED';
    store.addLog(o, `Lalamove #${d.lalamoveOrderId} cancelled${why ? ` (${why})` : ''}`, 'staff', me?.name);
    return 'cancelled';
  } catch (e) {
    if (lalamove.isGone(e)) {
      d.status = 'NOT_FOUND';
      store.addLog(o, `Lalamove #${d.lalamoveOrderId} not found on this Lalamove account (made with test keys, or removed), so nothing to cancel`, 'staff', me?.name);
      return 'gone';
    }
    if (!force) throw httpError(409, `Lalamove could not cancel this delivery: ${e.message}`);
    store.addLog(o, `Lalamove #${d.lalamoveOrderId} NOT cancelled (${e.message}). Check it in the Lalamove app.`, 'staff', me?.name);
    return 'failed';
  }
}
const staffLog = (me, msg, extra = {}) => activity.log('staff', `${msg} · ${me?.name || 'staff'}`, { by: me?.name || '', ...extra });
// Menu for the dashboard: products with stock per branch, and the branches this person handles
async function productsView(me) {
  const settings = await store.getSettings();
  const branches = settings.branches.filter((b) => b.active !== false && staff.sees(me, { branchId: b.id })).map((b) => ({ id: b.id, name: b.name }));
  return { products: await store.withStock(await store.getProducts(), settings.branches), branches };
}
async function getOrderOr404(id) { const o = await store.getOrder(id); if (!o) throw httpError(404, 'Order not found'); return o; }
const MAX_IMAGE_BYTES = 700 * 1024;
const list = (v, n = 12) => String(Array.isArray(v) ? v.join(',') : v || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, n);

const actions = {
  async login(b, req, me) {
    if ((await db.incr(`rl:login:${ip(req)}`, 900)) > 10) throw httpError(429, 'Too many tries. Wait 15 minutes.');
    if (!process.env.ADMIN_PASSCODE && !(await staff.list()).length) throw httpError(500, 'ADMIN_PASSCODE is not set on the server.');
    const who = await staff.login(str(b.name, 40), String(b.password ?? b.passcode ?? ''));
    if (!who) throw httpError(401, 'Wrong name or password.');
    const token = rid(24);
    await db.set(`sess:${token}`, { at: Date.now(), ...who }, { ex: 60 * 60 * 24 * 30 });
    activity.log('staff', `${who.name} logged in (${who.role === 'super' ? 'super admin' : 'staff'}, ${ip(req)})`, { by: who.name });
    return { token, me: who };
  },
  async me(b, req, me) {
    const settings = await store.getSettings();
    const names = (me.branches || []).map((id) => settings.branches.find((x) => x.id === id)?.name || id);
    return { me: { ...me, branchNames: names } };
  },
  async logout(b, req, me) {
    const t = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (t) await db.del(`sess:${t}`);
    return { ok: true };
  },

  // ---- orders ----
  async 'orders.list'(b, req, me) {
    const orders = (await store.listOrders(Math.min(500, b.limit || 200))).filter((o) => staff.sees(me, o));
    return { orders: orders.map(summary), now: Date.now() };
  },
  async 'order.byNo'(b, req, me) {
    const no = String(b.no || '').toUpperCase().trim();
    let id = await db.get(`orderno:${no}`);
    if (!id) id = (await store.listOrders(500)).find((o) => o.no === no)?.id;
    if (!id) throw httpError(404, `Order ${no} not found`);
    const o = await store.getOrder(id);
    if (o && !staff.sees(me, o)) throw httpError(403, `${no} is a ${o.branchName} order.`);
    return { id };
  },
  async 'order.get'(b, req, me) {
    const o = await store.getOrder(b.id); if (!o) throw httpError(404, 'Order not found');
    return { order: detail(withCategories(o, await store.getProducts())) };
  },
  async 'order.reprint'(b, req, me) {
    let o = await store.getOrder(b.id); if (!o) throw httpError(404, 'Order not found');
    o = await printLabel(o, await store.getSettings(), siteUrl(req), { reason: `reprint by ${me.name}` });
    await store.saveOrder(o);
    if (o.print.status !== 'sent') throw httpError(400, o.print.error || 'Print failed');
    return { order: detail(o) };
  },
  async 'order.rebook'(b, req, me) {
    let o = await store.getOrder(b.id); if (!o) throw httpError(404, 'Order not found');
    if (o.payment.status !== 'paid') throw httpError(400, 'Order is not paid.');
    const st = o.delivery?.status;
    if (o.delivery?.lalamoveOrderId && !['BOOKING_FAILED', ...lalamove.FINAL_FAIL].includes(st)) throw httpError(400, `A Lalamove delivery is already active (${st}). Cancel it first.`);
    if (o.fulfilment === 'pickup') throw httpError(400, 'This is a self pickup order.');
    staffLog(me, `Rebook requested for ${o.no}`, { orderNo: o.no, orderId: o.id });
    o = await bookDelivery(o, await store.getSettings());
    o.fulfilledAt ||= Date.now();
    await store.saveOrder(o);
    if (o.delivery.status === 'BOOKING_FAILED') throw httpError(400, o.delivery.error);
    return { order: detail(o) };
  },
  async 'order.cancelDelivery'(b, req, me) {
    const o = await store.getOrder(b.id); if (!o?.delivery?.lalamoveOrderId) throw httpError(400, 'No Lalamove delivery to cancel.');
    if (!['ASSIGNING_DRIVER', 'ON_GOING'].includes(o.delivery.status)) throw httpError(400, `This delivery can't be cancelled now (${o.delivery.status}).`);
    const r = await stopLalamove(o, me, '', false);
    await store.saveOrder(o);
    return { order: detail(o), result: r };
  },
  async 'order.refresh'(b, req, me) {
    let o = await store.getOrder(b.id); if (!o) throw httpError(404, 'Order not found');
    try { o = await refreshDelivery(o); } catch (e) { throw httpError(400, e.message); }
    return { order: detail(o) };
  },
  // If a payment went through but the callback never arrived, ask Billplz directly.
  async 'order.checkPayment'(b, req, me) {
    let o = await store.getOrder(b.id); if (!o) throw httpError(404, 'Order not found');
    if (!o.payment.billId) throw httpError(400, 'This order has no Billplz bill.');
    const bill = await billplz.getBill(o.payment.billId);
    if (bill.paid === true || bill.state === 'paid') o = await fulfil(o.id, siteUrl(req), { paidAmountSen: Number(bill.paid_amount), source: 'manual check' });
    else { store.addLog(o, `Payment checked with Billplz: bill ${o.payment.billId} is ${bill.state}`, 'payment', me?.name); await store.saveOrder(o); }
    // Often the customer went back and paid a second checkout: point staff to it
    let paidInstead = null;
    if (bill.state !== 'paid') {
      const near = (await store.listOrders(300)).filter((x) => x.id !== o.id && x.customer.phone === o.customer.phone && x.payment.status === 'paid' && Math.abs(x.createdAt - o.createdAt) < 6 * 3600000);
      if (near.length) paidInstead = { no: near[0].no, id: near[0].id, at: near[0].payment.paidAt || near[0].createdAt };
    }
    return { order: detail(o), billState: bill.state, billId: o.payment.billId, paidInstead };
  },


  // ---- home: store switch, today's numbers and the order board ----
  async home(b, req, me) {
    const [settings, orders, today] = await Promise.all([store.getSettings(), store.listOrders(300), insights({ range: 'today' })]);
    const stale = orders.filter((o) => ['ASSIGNING_DRIVER', 'ON_GOING', 'PICKED_UP'].includes(o.delivery?.status) && Date.now() - (o.delivery.checkedAt || o.delivery.bookedAt || 0) > 5 * 60000).slice(0, 3);
    for (const o of stale) { try { orders[orders.indexOf(o)] = await refreshDelivery(o); } catch (e) { console.warn('board refresh failed', o.no, e.message); } }
    // unpaid checkouts from the last 6 hours: ask Billplz in case its payment notice never arrived
    const unpaid = orders.filter((o) => o.payment.status === 'pending' && o.payment.billId && Date.now() - o.createdAt < 6 * 3600000).slice(0, 5);
    for (const o of unpaid) { try { orders[orders.indexOf(o)] = await syncPayment(o, siteUrl(req)); } catch (e) { console.warn('payment check failed', o.no, e.message); } }
    const now = Date.now(); const st = shopOpen(settings, now); const todayDate = mytParts(now).date;
    const mine = orders.filter((o) => staff.sees(me, o));
    const todays = mine.filter((o) => mytParts(o.createdAt).date === todayDate);
    const paidToday = todays.filter((o) => o.payment.status === 'paid' && !o.cancelledAt);
    const board = mine.filter((o) => {
      const b = stage(o).board;
      if (b === 'done') return mytParts(o.updatedAt || o.createdAt).date === todayDate;
      if (b === 'unpaid') return now - o.createdAt < 3 * 3600000;
      return now - o.createdAt < 4 * 86400000;
    }).map(summary);
    return {
      store: { open: st.open, message: st.message, acceptingOrders: settings.acceptingOrders, pausedUntil: settings.pausedUntil > now ? settings.pausedUntil : 0, hours: settings.hours },
      today: me?.role === 'super'
        ? { salesSen: today.salesSen, orders: today.orders, aovSen: today.aovSen, delivery: today.delivery, pickup: today.pickup, prev: today.prev, unpaid: today.unpaid }
        : { orders: paidToday.length, delivery: paidToday.filter((o) => o.fulfilment !== 'pickup').length, pickup: paidToday.filter((o) => o.fulfilment === 'pickup').length, unpaid: todays.filter((o) => o.payment.status !== 'paid').length },
      orders: board, now,
    };
  },
  async 'store.pause'(b, req, me) {
    const s = await store.getSettings(); const now = Date.now();
    let until = 0; let what;
    if (b.minutes === 'today') {
      const [h, m] = String(s.hours.close).split(':').map(Number);
      until = Date.parse(`${mytParts(now).date}T${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}:00+08:00`);
      if (until <= now) until = now + 3600000;
      what = 'for the rest of today';
    } else {
      const min = Math.max(5, Math.min(24 * 60, Math.round(num(b.minutes, 30))));
      until = now + min * 60000; what = `for ${min >= 60 ? `${min / 60} hour${min > 60 ? 's' : ''}` : `${min} min`}`;
    }
    s.pausedUntil = until; s.acceptingOrders = true;
    await store.saveSettings(s);
    staffLog(me, `Online ordering paused ${what} (until ${fmtTime(until)})`);
    return actions.home(b, req, me);
  },
  async 'store.setOpen'(b, req, me) {
    const s = await store.getSettings();
    s.acceptingOrders = !!b.open; s.pausedUntil = 0;
    await store.saveSettings(s);
    staffLog(me, b.open ? 'Online ordering turned ON' : 'Online ordering turned OFF');
    return actions.home(b, req, me);
  },

  // ---- order actions from the board ----
  async 'order.ready'(b, req, me) {
    const o = await getOrderOr404(b.id);
    if (o.payment.status !== 'paid') throw httpError(400, 'Order is not paid.');
    (o.prep ||= {}).readyAt = Date.now();
    store.addLog(o, o.fulfilment === 'pickup' ? 'Marked ready for collection' : 'Marked packed, waiting for the driver', 'staff', me?.name);
    await store.saveOrder(o);
    if (o.fulfilment === 'pickup') await push.notifyOrder(o, { title: 'Ready for collection 🛍️', body: `${o.no} is ready at our ${o.branchName} shop.` });
    return { order: detail(o) };
  },
  async 'order.collected'(b, req, me) {
    const o = await getOrderOr404(b.id);
    (o.prep ||= {}).collectedAt = Date.now(); o.prep.readyAt ||= Date.now();
    store.addLog(o, 'Collected by customer', 'staff', me?.name);
    await store.saveOrder(o);
    return { order: detail(o) };
  },
  async 'order.undoReady'(b, req, me) {
    const o = await getOrderOr404(b.id);
    o.prep = {}; store.addLog(o, 'Ready / collected undone', 'staff', me?.name); await store.saveOrder(o);
    return { order: detail(o) };
  },
  // Cancel a paid order (e.g. out of stock). Refunds are done in Billplz / by bank transfer.
  async 'order.cancel'(b, req, me) {
    const o = await getOrderOr404(b.id);
    if (o.cancelledAt) throw httpError(400, 'Already cancelled.');
    await stopLalamove(o, me, 'order cancelled', !!b.force);
    o.cancelledAt = Date.now(); o.cancelReason = str(b.reason, 200);
    await reverseOrder(o);
    store.addLog(o, `Order cancelled${o.cancelReason ? `: ${o.cancelReason}` : ''}${o.payment.status === 'paid' ? `. Refund RM${rm(o.totalSen)} to the customer.` : ''}`, 'staff', me?.name);
    await store.saveOrder(o);
    return { order: detail(o) };
  },
  // Priority fee ("tip") on a Lalamove order that is still looking for a driver. Keeps the original price,
  // unlike cancel + rebook which gets a new (often higher) quote.
  async 'order.tip'(b, req, me) {
    const o = await getOrderOr404(b.id);
    const d = o.delivery || {};
    if (!d.lalamoveOrderId) throw httpError(400, 'No Lalamove delivery on this order.');
    if (d.status !== 'ASSIGNING_DRIVER') throw httpError(400, d.status === 'ON_GOING' || d.status === 'PICKED_UP' ? 'A driver has already accepted. Tips can only be added while Lalamove is finding a driver.' : `Lalamove status is ${d.status}. Tips only work while finding a driver; rebook instead.`);
    const add = num(b.amountRM);
    if (!(add >= 1 && add <= 100)) throw httpError(400, 'Enter a tip between RM1 and RM100.');
    const total = Math.round(((Number(d.priorityFeeRM) || 0) + add) * 100) / 100;
    try { await addTip(o, total, 'staff'); } catch (e) { await store.saveOrder(o); throw httpError(400, e.message); }
    staffLog(me, `Tip added on ${o.no}: +RM${add.toFixed(2)} (total priority fee RM${total.toFixed(2)})`, { orderNo: o.no, orderId: o.id });
    await store.saveOrder(o);
    return { order: detail(o) };
  },
  // Ask Lalamove for another driver (free, 15+ minutes after the driver accepted and before pickup).
  async 'order.changeDriver'(b, req, me) {
    const o = await getOrderOr404(b.id);
    const d = o.delivery || {};
    if (!d.lalamoveOrderId || !d.driver?.id) throw httpError(400, 'No driver assigned yet.');
    if (d.status !== 'ON_GOING') throw httpError(400, 'You can only change the driver before the order is picked up.');
    const reason = ['DRIVER_LATE', 'DRIVER_ASKED_CHANGE', 'DRIVER_UNRESPONSIVE', 'DRIVER_RUDE'].includes(b.reason) ? b.reason : 'DRIVER_LATE';
    try { await lalamove.changeDriver(d.lalamoveOrderId, d.driver.id, reason); }
    catch (e) { throw httpError(400, /15|minute/i.test(e.message) ? `Lalamove allows a driver change 15 minutes after the driver accepted. ${e.message}` : e.message); }
    store.addLog(o, `Driver change requested (${reason.toLowerCase().replace(/_/g, ' ')}); previous driver ${d.driver.name || d.driver.id}`, 'staff', me?.name);
    (d.oldDrivers ||= []).push(d.driver); delete d.driver; d.status = 'ASSIGNING_DRIVER';
    await store.saveOrder(o);
    return { order: detail(o) };
  },
  // What a rebook would cost right now, before staff commit to it.
  async 'order.rebookQuote'(b, req, me) {
    const o = await getOrderOr404(b.id);
    if (o.fulfilment === 'pickup') throw httpError(400, 'This is a self pickup order.');
    const settings = await store.getSettings();
    const br = settings.branches.find((x) => x.id === o.branchId);
    if (!br) throw httpError(400, 'Branch not found.');
    const saver = o.deliveryOption === 'saver' && settings.saver?.serviceType;
    const q = await lalamove.quote({
      pickup: { lat: br.lat, lng: br.lng, address: br.address }, dropoff: { lat: o.address.lat, lng: o.address.lng, address: o.address.text },
      serviceType: saver ? settings.saver.serviceType : o.serviceType, specialRequests: saver ? settings.saver.specialRequests || settings.specialRequests : settings.specialRequests,
    });
    return { nowRM: q.totalRM, firstRM: Number(o.delivery?.history?.[0]?.feeRM || o.delivery?.feeRM || o.deliveryQuoteRM) || 0, chargedRM: (o.deliverySen || 0) / 100 };
  },

  // ---- super admin: edit / delete an order (kept in the history and the activity log) ----
  async 'order.edit'(b, req, me) {
    const o = await getOrderOr404(b.id);
    if (o.deletedAt) throw httpError(400, 'This order was deleted.');
    const ch = [];
    const setText = (obj, k, v, n, label) => {
      if (v === undefined || v === null) return;
      const val = str(v, n);
      if (val !== (obj[k] || '')) { ch.push(`${label} “${obj[k] || ''}” → “${val}”`); obj[k] = val; }
    };
    const c = b.customer || {};
    if (c.name !== undefined && str(c.name, 80).length < 2) throw httpError(400, 'Enter the customer name.');
    setText(o.customer, 'name', c.name, 80, 'name');
    if (c.phone !== undefined) {
      const ph = normalizePhone(c.phone); if (!ph) throw httpError(400, 'Enter a valid Malaysian phone number.');
      if (ph !== o.customer.phone) { ch.push(`phone ${o.customer.phone} → ${ph}`); o.customer.phone = ph; }
    }
    setText(o.customer, 'email', c.email, 120, 'email');
    const a = b.address || {};
    if (o.fulfilment !== 'pickup') { setText(o.address, 'text', a.text, 300, 'address'); setText(o.address, 'unit', a.unit, 80, 'unit'); }
    setText(o.address, 'notes', a.notes, 300, 'note');
    if (o.fulfilment === 'pickup' && b.pickupAt) {
      const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(b.pickupAt) ? b.pickupAt : `${b.pickupAt}:00+08:00`);
      if (!isFinite(t)) throw httpError(400, 'Check the pickup time.');
      const iso = new Date(t).toISOString();
      if (iso !== o.pickup?.at) { ch.push(`pickup time → ${new Date(t + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')}`); o.pickup = { ...(o.pickup || {}), at: iso }; }
    }
    const stockDelta = {};
    if (Array.isArray(b.items)) {
      const keep = [];
      o.items.forEach((it, i) => {
        const e = b.items.find((x) => Number(x.i) === i) || {};
        if (e.remove) { ch.push(`removed ${it.name} (${fmtQty(it.qty, it.unit)})`); stockDelta[it.productId] = (stockDelta[it.productId] || 0) - it.qty; return; }
        if (e.qty !== undefined) {
          const q = Math.round(num(e.qty) * 100) / 100;
          if (!(q > 0 && q <= 50)) throw httpError(400, `Check the amount for ${it.name}.`);
          if (q !== it.qty) { ch.push(`${it.name} ${fmtQty(it.qty, it.unit)} → ${fmtQty(q, it.unit)}`); stockDelta[it.productId] = (stockDelta[it.productId] || 0) + q - it.qty; it.qty = q; it.lineSen = Math.round(it.priceSen * q); }
        }
        if (e.cutText !== undefined && str(e.cutText, 160) !== (it.cutText || '')) { ch.push(`${it.name} cut “${it.cutText || ''}” → “${str(e.cutText, 160)}”`); it.cutText = str(e.cutText, 160); }
        keep.push(it);
      });
      if (!keep.length) throw httpError(400, 'An order needs at least one item. Delete the order instead.');
      o.items = keep;
    }
    if (!ch.length) throw httpError(400, 'Nothing changed.');
    const before = o.totalSen;
    o.originalTotalSen ??= o.totalSen;
    o.subtotalSen = o.items.reduce((sum, it) => sum + it.lineSen, 0);
    o.discountSen = Math.min(o.discountSen || 0, o.subtotalSen);
    o.totalSen = o.subtotalSen - o.discountSen - (o.pointsSen || 0) + (o.deliverySen || 0);
    if (o.totalSen !== before) ch.push(`total RM${rm(before)} → RM${rm(o.totalSen)}`);
    // counted stock follows the new amounts on paid orders
    if (o.stockApplied && !o.reversedAt) for (const [pid, d] of Object.entries(stockDelta)) if (d) await store.changeStock(o.branchId, pid, -d);
    const reason = str(b.reason, 200);
    (o.edits ||= []).push({ at: Date.now(), by: me.name, changes: ch, reason });
    store.addLog(o, `Edited: ${ch.join('; ')}${reason ? ` (${reason})` : ''}`, 'staff', me.name);
    await store.saveOrder(o);
    return { order: detail(o) };
  },
  async 'order.delete'(b, req, me) {
    const o = await getOrderOr404(b.id);
    if (o.deletedAt) throw httpError(400, 'Already deleted.');
    await stopLalamove(o, me, 'order deleted', !!b.force);
    await reverseOrder(o);
    const reason = str(b.reason, 200);
    Object.assign(o, { deletedAt: Date.now(), deletedBy: me.name, deleteReason: reason });
    store.addLog(o, `Order deleted${reason ? `: ${reason}` : ''} (${o.customer.name}, ${rm(o.totalSen)}, ${o.payment.status === 'paid' ? 'paid' : 'not paid'})`, 'staff', me.name);
    await store.saveOrder(o);
    await db.zrem('orders', o.id);
    await db.zadd('orders:deleted', o.deletedAt, o.id);
    if (o.memberId) await db.zrem(`memberorders:${o.memberId}`, o.id);
    return { ok: true };
  },
  async 'orders.deleted'() {
    const ids = await db.zrevrange('orders:deleted', 0, 199);
    return { orders: (await db.mget(ids.map((id) => `order:${id}`))).filter(Boolean).map((o) => ({ ...summary(o), deletedAt: o.deletedAt, deletedBy: o.deletedBy, deleteReason: o.deleteReason || '' })) };
  },

  // ---- staff accounts (super admin) ----
  async 'staff.list'(b, req, me) {
    const settings = await store.getSettings();
    return { staff: await staff.list(), owner: !!process.env.ADMIN_PASSCODE, branches: settings.branches.map((x) => ({ id: x.id, name: x.name })) };
  },
  async 'staff.save'(b, req, me) {
    const u = b.user || {};
    const settings = await store.getSettings();
    const valid = settings.branches.map((x) => x.id);
    const saved = await staff.save({ id: u.id, name: u.name, password: u.password, role: u.role, active: u.active, branches: (u.branches || []).filter((x) => valid.includes(x)) });
    const where = saved.branches.length ? saved.branches.map((id) => settings.branches.find((x) => x.id === id)?.name).join(', ') : 'all branches';
    staffLog(me, `Staff account ${u.id ? 'updated' : 'added'}: ${saved.name} (${saved.role === 'super' ? 'super admin' : `staff, ${where}`}${saved.active ? '' : ', turned off'}${u.password && u.id ? ', new password' : ''})`);
    return { staff: await staff.list() };
  },
  async 'staff.delete'(b, req, me) {
    const u = (await staff.list()).find((x) => x.id === b.id); if (!u) throw httpError(404, 'Not found');
    if (u.id === me.id) throw httpError(400, 'You cannot delete your own account.');
    await staff.remove(u.id);
    staffLog(me, `Staff account deleted: ${u.name}`);
    return { staff: await staff.list() };
  },

  // ---- stock (staff can update) ----
  async 'stock.set'(b, req, me) {
    const settings = await store.getSettings();
    const br = settings.branches.find((x) => x.id === b.branchId); if (!br) throw httpError(400, 'Choose the branch.');
    if (!staff.sees(me, { branchId: br.id })) throw httpError(403, `You can only change ${me.branches.map((id) => settings.branches.find((x) => x.id === id)?.name).join(', ')} stock.`);
    const p = (await store.getProducts()).find((x) => x.id === b.id); if (!p) throw httpError(404, 'Product not found');
    const raw = b.qty;
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      await store.setStock(br.id, p.id, null);
      activity.log('stock', `${p.name} at ${br.name}: stopped counting stock · ${me.name}`, { by: me.name });
    } else {
      const q = Math.round(num(raw, -1) * 100) / 100;
      if (!(q >= 0 && q <= 100000)) throw httpError(400, 'Enter how many you have (0 or more).');
      await store.setStock(br.id, p.id, q);
      activity.log('stock', `${p.name} at ${br.name}: stock set to ${fmtQty(q, p.unit)} · ${me.name}`, { by: me.name });
    }
    return productsView(me);
  },

  // ---- catalogue ----
  async 'products.get'(b, req, me) { return productsView(me); },
  async 'products.save'(b, req, me) {
    if (!Array.isArray(b.products)) throw httpError(400, 'products must be a list');
    const current = Object.fromEntries((await store.getProducts()).map((p) => [p.id, p]));
    const seen = new Set();
    const list = b.products.map((p, i) => {
      const unit = ['kg', 'set', 'pc'].includes(p.unit) ? p.unit : 'kg';
      let id = p.id ? slug(p.id) : slug(p.name); while (seen.has(id)) id += '-2'; seen.add(id);
      const step = num(p.step, unit === 'kg' ? 0.5 : 1) || (unit === 'kg' ? 0.5 : 1);
      if (!str(p.name)) throw httpError(400, `Product ${i + 1} needs a name.`);
      return {
        id, category: str(p.category, 60) || 'Other', name: str(p.name, 80), note: str(p.note, 120),
        price: Math.max(0, Math.round(num(p.price) * 100) / 100), unit, step, min: Math.max(step, num(p.min, step)),
        cutModes: (Array.isArray(p.cutModes) ? p.cutModes : []).filter((m) => store.CUT_MODES.includes(m)),
        cooking: !!p.cooking,
        image: current[id]?.image || '', available: p.available !== false, sort: i,
      };
    });
    staffLog(me, `Menu saved (${list.length} products)`);
    // delete photos of removed products
    for (const old of Object.values(current)) if (old.image && !list.some((p) => p.image === old.image)) await db.del(`img:${old.image}`);
    await store.saveProducts(list);
    return productsView(me);
  },
  async 'products.toggle'(b, req, me) {
    const products = await store.getProducts();
    const p = products.find((x) => x.id === b.id); if (!p) throw httpError(404, 'Product not found');
    p.available = !!b.available;
    staffLog(me, `${p.name} ${p.available ? 'back on sale' : 'marked sold out'}`);
    await store.saveProducts(products);
    return productsView(me);
  },
  async 'products.image'(b, req, me) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || ''));
    if (!m) throw httpError(400, 'Please upload a JPG, PNG or WebP photo.');
    if (Buffer.byteLength(m[2], 'base64') > MAX_IMAGE_BYTES) throw httpError(400, 'Photo is too large. Please use a smaller photo.');
    const products = await store.getProducts();
    const p = products.find((x) => x.id === b.id); if (!p) throw httpError(404, 'Save the new product first, then add its photo.');
    const imgId = rid(9);
    await db.set(`img:${imgId}`, { type: m[1], b64: m[2] });
    if (p.image) await db.del(`img:${p.image}`);
    p.image = imgId;
    staffLog(me, `Photo changed: ${p.name}`);
    await store.saveProducts(products);
    return productsView(me);
  },
  async 'products.imageRemove'(b, req, me) {
    const products = await store.getProducts();
    const p = products.find((x) => x.id === b.id); if (!p) throw httpError(404, 'Product not found');
    if (p.image) await db.del(`img:${p.image}`);
    p.image = '';
    await store.saveProducts(products);
    return productsView(me);
  },

  // ---- registered members ----
  async 'members.list'(b, req, me) {
    const [list2, customers, used] = await Promise.all([members.list(), store.getCustomers(), members.welcomeUsedCount()]);
    return { members: list2.map((m) => ({ id: m.id, name: m.name, phone: m.phone, email: m.email, createdAt: m.createdAt, orderCount: m.orderCount || 0, lastOrderAt: m.lastOrderAt || 0, welcomeUsed: !!m.welcomeUsed, addresses: (m.addresses || []).length, discountPct: Number(customers[m.phone]?.discountPct) || 0, points: m.points || 0, pointsLog: (m.pointsLog || []).slice(0, 10) })), welcomeUsed: used };
  },
  async 'members.points'(b, req, me) {
    const m = await members.get(b.id); if (!m) throw httpError(404, 'Member not found');
    const delta = Math.round(num(b.delta));
    if (!delta || Math.abs(delta) > 100000) throw httpError(400, 'Enter the points to add (or minus to remove).');
    members.addPoints(m, delta, str(b.reason, 80) || 'Adjusted by staff');
    await members.save(m);
    staffLog(me, `Points ${delta > 0 ? '+' : ''}${delta} for ${m.name} (${m.phone})${b.reason ? `: ${str(b.reason, 80)}` : ''}`);
    return { points: m.points };
  },
  async 'members.resetPassword'(b, req, me) {
    const m = await members.get(b.id); if (!m) throw httpError(404, 'Member not found');
    const temp = Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[crypto.randomInt(31)]).join('');
    await members.setPassword(m, temp);
    staffLog(me, `Password reset for member ${m.name} (${m.phone})`);
    return { password: temp, phone: m.phone, name: m.name };
  },

  // ---- coupons ----
  async 'coupons.get'(b, req, me) { return { coupons: Object.values(await store.getCoupons()) }; },
  async 'coupons.save'(b, req, me) {
    const c = b.coupon || {};
    const code = str(c.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!code) throw httpError(400, 'Coupon needs a code (letters and numbers).');
    const coupons = await store.getCoupons();
    if (b.originalCode && b.originalCode !== code) { if (coupons[code]) throw httpError(400, 'That code already exists.'); delete coupons[b.originalCode]; }
    const prev = coupons[b.originalCode || code] || coupons[code] || {};
    const type = c.type === 'fixed' ? 'fixed' : 'percent';
    const value = num(c.value);
    if (!(value > 0) || (type === 'percent' && value > 100)) throw httpError(400, 'Enter a discount between 1 and 100% or a RM amount.');
    const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : '');
    const phones = String(Array.isArray(c.phones) ? c.phones.join(',') : c.phones || '').split(/[,\n]/).map(normalizePhone).filter(Boolean);
    coupons[code] = {
      code, type, value, minSpend: num(c.minSpend), maxDiscount: num(c.maxDiscount), startsOn: date(c.startsOn), endsOn: date(c.endsOn),
      maxUses: Math.max(0, Math.floor(num(c.maxUses))), oncePerCustomer: !!c.oncePerCustomer, phones, active: c.active !== false,
      note: str(c.note, 120), used: prev.used || 0, usedBy: prev.usedBy || [], createdAt: prev.createdAt || Date.now(),
    };
    await store.saveCoupons(coupons);
    staffLog(me, `Coupon ${code} saved (${type === 'percent' ? `${value}%` : `RM${value}`} off${coupons[code].active ? '' : ', inactive'})`);
    return { coupons: Object.values(coupons) };
  },
  async 'coupons.delete'(b, req, me) {
    const coupons = await store.getCoupons(); delete coupons[b.code]; await store.saveCoupons(coupons);
    staffLog(me, `Coupon ${str(b.code, 30)} deleted`);
    return { coupons: Object.values(coupons) };
  },

  // ---- member discounts ----
  async 'customers.get'(b, req, me) { return { customers: Object.values(await store.getCustomers()) }; },
  async 'customers.save'(b, req, me) {
    const c = b.customer || {};
    const phone = normalizePhone(c.phone); if (!phone) throw httpError(400, 'Enter a valid Malaysian phone number.');
    const pct = num(c.discountPct); if (!(pct > 0 && pct <= 100)) throw httpError(400, 'Discount must be between 1 and 100%.');
    const customers = await store.getCustomers();
    if (b.originalPhone && b.originalPhone !== phone) delete customers[b.originalPhone];
    customers[phone] = { phone, name: str(c.name, 80), discountPct: pct, note: str(c.note, 120) };
    await store.saveCustomers(customers);
    staffLog(me, `Customer discount ${pct}% for ${phone}`);
    return { customers: Object.values(customers) };
  },
  async 'customers.delete'(b, req, me) {
    const customers = await store.getCustomers(); delete customers[b.phone]; await store.saveCustomers(customers);
    staffLog(me, `Customer discount removed for ${str(b.phone, 20)}`);
    return { customers: Object.values(customers) };
  },

  // ---- settings ----
  async 'settings.get'(b, req, me) { return { settings: await store.getSettings(), status: integrationStatus(req), welcomeUsed: await members.welcomeUsedCount() }; },
  async 'settings.save'(b, req, me) {
    const s = b.settings || {}; const cur = await store.getSettings();
    const hhmm = (v, d) => (/^\d{2}:\d{2}$/.test(String(v || '')) ? v : d);
    const next = {
      ...cur,
      shopName: str(s.shopName, 60) || cur.shopName,
      whatsapp: String(normalizePhone(s.whatsapp) || cur.whatsapp).replace('+', ''),
      acceptingOrders: s.acceptingOrders !== false,
      hours: { open: hhmm(s.hours?.open, cur.hours.open), close: hhmm(s.hours?.close, cur.hours.close), closedDays: (s.hours?.closedDays || []).map(Number).filter((d) => d >= 0 && d <= 6) },
      prepMinutes: Math.max(0, Math.min(600, Math.round(num(s.prepMinutes, cur.prepMinutes)))),
      serviceType: str(s.serviceType, 30).toUpperCase() || 'MOTORCYCLE',
      heavyOrderKg: Math.max(0, num(s.heavyOrderKg, cur.heavyOrderKg)),
      heavyServiceType: str(s.heavyServiceType, 30).toUpperCase() || 'CAR',
      specialRequests: str(s.specialRequests, 200).toUpperCase().replace(/\s+/g, ''),
      deliveryMarkup: Math.max(0, num(s.deliveryMarkup)),
      minOrder: Math.max(0, num(s.minOrder)),
      stackDiscounts: !!s.stackDiscounts,
      checkoutNote: str(s.checkoutNote, 300),
      deliveryAreaNote: str(s.deliveryAreaNote, 200),
      welcome: { enabled: !!s.welcome?.enabled, amount: Math.max(0, num(s.welcome?.amount, cur.welcome.amount)), limit: Math.max(0, Math.round(num(s.welcome?.limit, cur.welcome.limit))), minSpend: Math.max(0, num(s.welcome?.minSpend)) },
      cutting: {
        sizes: list(s.cutting?.sizes).map((x) => x.slice(0, 20)),
        weights: list(s.cutting?.weights, 20).map((x) => Math.round(parseFloat(x))).filter((g) => g >= 5 && g <= 2000),
        splits: list(s.cutting?.splits ?? cur.cutting.splits).map((x) => x.slice(0, 20)),
        thickness: list(s.cutting?.thickness ?? cur.cutting.thickness).map((x) => x.slice(0, 20)),
        cooking: list(s.cutting?.cooking).map((x) => x.slice(0, 30)),
      },
      priority: { enabled: !!(s.priority?.enabled ?? cur.priority.enabled) },
      saver: { enabled: !!(s.saver?.enabled ?? cur.saver.enabled), serviceType: str(s.saver?.serviceType ?? cur.saver.serviceType, 30).toUpperCase(), specialRequests: str(s.saver?.specialRequests ?? cur.saver.specialRequests, 200).toUpperCase().replace(/\s+/g, '') },
      pickup: { enabled: !!(s.pickup?.enabled ?? cur.pickup.enabled), slotMinutes: Math.max(10, Math.min(240, Math.round(num(s.pickup?.slotMinutes, cur.pickup.slotMinutes)))), days: Math.max(1, Math.min(7, Math.round(num(s.pickup?.days, cur.pickup.days)))) },
      loyalty: {
        enabled: !!(s.loyalty?.enabled ?? cur.loyalty.enabled), earnPerRM: Math.max(0, Math.min(100, num(s.loyalty?.earnPerRM, cur.loyalty.earnPerRM))),
        redeemPoints: Math.max(1, Math.round(num(s.loyalty?.redeemPoints, cur.loyalty.redeemPoints))), redeemValue: Math.max(0, num(s.loyalty?.redeemValue, cur.loyalty.redeemValue)),
        maxPct: Math.max(0, Math.min(100, num(s.loyalty?.maxPct, cur.loyalty.maxPct))),
      },
      label: { widthMm: Math.min(150, Math.max(15, num(s.label?.widthMm, 50))), heightMm: Math.min(150, Math.max(15, num(s.label?.heightMm, 30))), perItem: !!s.label?.perItem, rotate90: !!s.label?.rotate90, flip: !!s.label?.flip, qr: !!s.label?.qr, sizeSet: true },
      branches: (Array.isArray(s.branches) ? s.branches : cur.branches).map((br) => ({
        id: br.id ? slug(br.id) : slug(br.name), name: str(br.name, 60), address: str(br.address, 300),
        lat: isFinite(parseFloat(br.lat)) ? String(parseFloat(br.lat)) : '', lng: isFinite(parseFloat(br.lng)) ? String(parseFloat(br.lng)) : '',
        phone: normalizePhone(br.phone) || '', printerId: str(br.printerId, 20).replace(/\D/g, ''), active: br.active !== false,
        radiusKm: Math.min(300, Math.max(1, num(br.radiusKm, 50))),
      })).filter((br) => br.name),
    };
    for (const br of next.branches) if (br.active && br.address && (!br.lat || !br.lng)) throw httpError(400, `${br.name}: add the map coordinates (lat, lng).`);
    for (const br of next.branches) if (br.active && br.address && !br.phone) throw httpError(400, `${br.name}: add a contact phone for the Lalamove driver.`);
    const saved = await store.saveSettings(next);
    staffLog(me, 'Settings saved');
    return { settings: saved, status: integrationStatus(req), welcomeUsed: await members.welcomeUsedCount() };
  },


  // ---- insights, activity log, promotions ----
  async insights(b, req, me) { return insights({ range: b.range, from: b.from, to: b.to }); },
  async 'activity.list'(b, req, me) {
    const start = Math.max(0, Math.round(num(b.start))); const count = Math.min(300, Math.max(10, Math.round(num(b.count, 100))));
    const type = activity.TYPES.includes(b.type) ? b.type : ''; const q = str(b.q, 60).toLowerCase();
    if (!type && !q) { const items = await activity.list(start, count); return { items, next: items.length === count ? start + count : null }; }
    const all = await activity.list(0, 5000);
    const hits = all.filter((a) => (!type || a.type === type) && (!q || `${a.msg} ${a.orderNo || ''}`.toLowerCase().includes(q)));
    const items = hits.slice(start, start + count);
    return { items, next: start + count < hits.length ? start + count : null };
  },
  async 'promo.info'(b, req, me) {
    return { subscribers: await push.promoCount(), history: await db.lrange('promos', 0, 19) };
  },
  async 'promo.send'(b, req, me) {
    const title = str(b.title, 60); const text = str(b.body, 180);
    if (title.length < 3) throw httpError(400, 'Add a title for the notification.');
    if ((await db.incr('rl:promo', 3600)) > 6) throw httpError(429, 'You can send up to 6 promotions an hour.');
    const url = /^\/[\w\-./?=&#%]*$/.test(String(b.url || '')) ? b.url : '/';
    const r = await push.broadcastPromo({ title, body: text, url, tag: `promo-${Date.now()}` });
    await db.lpush('promos', { at: Date.now(), title, body: text, url, sent: r.sent }, 50);
    return { ...r, subscribers: await push.promoCount() };
  },
  async 'staffPush.save'(b, req, me) {
    if (b.on === false) { if (b.subscription?.endpoint) await push.save(b.subscription, { staff: false }); return { on: false }; }
    await push.save(b.subscription, { staff: true, branches: me.branches || [] });
    staffLog(me, 'New-order alerts turned on for a staff device');
    await push.notifyStaff({ title: 'New-order alerts are on ✅', body: "This device will be notified when a paid order comes in.", url: '/admin.html', tag: 'staff-test' });
    return { on: true };
  },

  // ---- integrations ----
  async 'printers.list'(b, req, me) { return { printers: await printnode.printers() }; },
  async 'print.test'(b, req, me) {
    const settings = await store.getSettings();
    const br = settings.branches.find((x) => x.id === b.branchId);
    if (!br?.printerId) throw httpError(400, 'Choose a printer for this branch and save first.');
    const products = await store.getProducts();
    const pdf = await buildLabel(withCategories({ ...SAMPLE_ORDER, branchName: br.name }, products), labelOptions(settings, SAMPLE_ORDER, siteUrl(req), products));
    const jobId = await printnode.printPdf({ printerId: br.printerId, title: 'Test label', pdf });
    return { jobId };
  },
  async 'lalamove.setup'(b, req, me) {
    const secret = process.env.LALAMOVE_WEBHOOK_SECRET;
    if (!secret) throw httpError(400, 'Add LALAMOVE_WEBHOOK_SECRET to the environment variables first.');
    const url = `${siteUrl(req)}/api/lalamove-webhook?key=${encodeURIComponent(secret)}`;
    let webhook = 'ok';
    try { await lalamove.setWebhook(url); } catch (e) { webhook = e.message; }
    let services = [];
    try {
      const cities = await lalamove.cities();
      const kl = (cities || []).find((c) => /kuala|KUL/i.test(`${c.name} ${c.locode}`)) || cities?.[0];
      services = (kl?.services || []).map((s) => ({ key: s.key, description: s.description, specialRequests: (s.specialRequests || []).map((r) => ({ name: r.name, description: r.description })) }));
    } catch (e) { services = [{ key: 'error', description: e.message }]; }
    return { webhook, services };
  },
};

function integrationStatus(req) {
  const here = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  return {
    site: siteUrl(req),
    billplzCallback: `${siteUrl(req)}/api/billplz-callback`,
    siteMismatch: process.env.SITE_URL && new URL(process.env.SITE_URL).host !== new URL(here).host ? process.env.SITE_URL : '',
    database: !!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL),
    billplz: billplz.configured() ? (billplz.sandbox() ? 'sandbox' : 'live') : false,
    lalamove: lalamove.configured() ? (lalamove.sandbox() ? 'sandbox' : 'live') : false,
    lalamoveWebhookSecret: !!process.env.LALAMOVE_WEBHOOK_SECRET,
    printnode: printnode.configured(),
    maps: !!process.env.GOOGLE_MAPS_API_KEY,
  };
}

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const b = await body(req);
  const fn = actions[b.action];
  if (!fn) return send(res, 400, { error: 'Unknown action' });
  const me = b.action === 'login' ? null : await requireSession(req);
  if (me && me.role !== 'super' && !STAFF_OK.has(b.action)) throw httpError(403, 'Only a super admin can do this.');
  if (me && b.id && /^order\./.test(b.action) && b.action !== 'order.byNo') {
    const o = await store.getOrder(b.id);
    if (o && !staff.sees(me, o)) throw httpError(403, `This is a ${o.branchName} order.`);
  }
  try { send(res, 200, await fn(b, req, me)); }
  catch (e) {
    if (e.status) throw e;
    console.error(e);
    activity.log('error', `Dashboard ${b.action}: ${e.message}`);
    throw httpError(400, e.message);
  }
});
module.exports.SAMPLE_ORDER = SAMPLE_ORDER;
