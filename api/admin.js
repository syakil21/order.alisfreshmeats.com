// POST /api/admin — staff dashboard actions. Every action except "login" needs the session token.
const crypto = require('crypto');
const db = require('../lib/db');
const store = require('../lib/store');
const billplz = require('../lib/billplz');
const lalamove = require('../lib/lalamove');
const printnode = require('../lib/printnode');
const { buildLabel } = require('../lib/label');
const { body, send, ip, siteUrl, rid, safeEqual, handler, httpError } = require('../lib/http');
const { fulfil, printLabel, bookDelivery, refreshDelivery, labelOptions, addTip } = require('../lib/fulfil');
const { stage } = require('../lib/stage');
const members = require('../lib/members');
const push = require('../lib/push');
const activity = require('../lib/activity');
const { insights, summarize } = require('../lib/insights');
const { normalizePhone, shopOpen, mytParts, fmtTime, rm } = require('../lib/util');

const num = (v, d = 0) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const slug = (s) => str(s, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || rid(4).toLowerCase();

async function requireSession(req) {
  const t = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!t || !(await db.get(`sess:${t}`))) throw httpError(401, 'Please log in again.');
}

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
    driver: d.driver?.name || '', priorityFeeRM: d.priorityFeeRM || 0, bookedAt: d.bookedAt || 0, matchedAt: d.driver?.matchedAt || 0,
    readyAt: o.prep?.readyAt || 0, cancelledAt: o.cancelledAt || 0, attempts: d.attempts || 0,
  };
}
const detail = (o) => { const { token, ...rest } = o; return { ...rest, ...{ summary: summary(o) } }; };

const SAMPLE_ORDER = {
  id: 'test', no: 'AFM-TEST', customer: { name: 'Test Customer', phone: '+60123456789' }, branchName: 'Test',
  address: { text: 'Test address', notes: 'Test print from dashboard' }, delivery: { scheduleAt: new Date().toISOString() },
  fulfilment: 'delivery', deliveryOption: 'priority',
  items: [
    { name: 'Boneless Meat', qty: 1.5, unit: 'kg', cutText: '2 inch pieces · Curry cut' },
    { name: 'Lamb Chop Shoulder Slices', qty: 1, unit: 'kg', cutText: '1 inch thick · "Remove fat please"' },
    { name: 'Mutton Leg Bones (Marrow)', qty: 1, unit: 'kg', cutText: 'Cut each into 3 pcs' },
    { name: 'Head', qty: 1, unit: 'set' },
  ],
};
const staffLog = (msg, extra) => activity.log('staff', msg, extra);
async function getOrderOr404(id) { const o = await store.getOrder(id); if (!o) throw httpError(404, 'Order not found'); return o; }
const MAX_IMAGE_BYTES = 700 * 1024;
const list = (v, n = 12) => String(Array.isArray(v) ? v.join(',') : v || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, n);

const actions = {
  async login(b, req) {
    if ((await db.incr(`rl:login:${ip(req)}`, 900)) > 10) throw httpError(429, 'Too many tries. Wait 15 minutes.');
    const pass = process.env.ADMIN_PASSCODE || '';
    if (!pass) throw httpError(500, 'ADMIN_PASSCODE is not set on the server.');
    if (!safeEqual(crypto.createHash('sha256').update(String(b.passcode || '')).digest('hex'), crypto.createHash('sha256').update(pass).digest('hex'))) throw httpError(401, 'Wrong passcode.');
    const token = rid(24);
    await db.set(`sess:${token}`, { at: Date.now() }, { ex: 60 * 60 * 24 * 30 });
    staffLog(`Staff logged in (${ip(req)})`);
    return { token };
  },
  async logout(b, req) {
    const t = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (t) await db.del(`sess:${t}`);
    return { ok: true };
  },

  // ---- orders ----
  async 'orders.list'(b) {
    const orders = await store.listOrders(Math.min(500, b.limit || 200));
    return { orders: orders.map(summary), now: Date.now() };
  },
  async 'order.byNo'(b) {
    const no = String(b.no || '').toUpperCase().trim();
    let id = await db.get(`orderno:${no}`);
    if (!id) id = (await store.listOrders(500)).find((o) => o.no === no)?.id;
    if (!id) throw httpError(404, `Order ${no} not found`);
    return { id };
  },
  async 'order.get'(b) {
    const o = await store.getOrder(b.id); if (!o) throw httpError(404, 'Order not found');
    return { order: detail(o) };
  },
  async 'order.reprint'(b, req) {
    let o = await store.getOrder(b.id); if (!o) throw httpError(404, 'Order not found');
    o = await printLabel(o, await store.getSettings(), siteUrl(req), { reason: 'reprint by staff' });
    await store.saveOrder(o);
    if (o.print.status !== 'sent') throw httpError(400, o.print.error || 'Print failed');
    return { order: detail(o) };
  },
  async 'order.rebook'(b) {
    let o = await store.getOrder(b.id); if (!o) throw httpError(404, 'Order not found');
    if (o.payment.status !== 'paid') throw httpError(400, 'Order is not paid.');
    const st = o.delivery?.status;
    if (o.delivery?.lalamoveOrderId && !['BOOKING_FAILED', ...lalamove.FINAL_FAIL].includes(st)) throw httpError(400, `A Lalamove delivery is already active (${st}). Cancel it first.`);
    if (o.fulfilment === 'pickup') throw httpError(400, 'This is a self pickup order.');
    staffLog(`Rebook requested for ${o.no}`, { orderNo: o.no, orderId: o.id });
    o = await bookDelivery(o, await store.getSettings());
    o.fulfilledAt ||= Date.now();
    await store.saveOrder(o);
    if (o.delivery.status === 'BOOKING_FAILED') throw httpError(400, o.delivery.error);
    return { order: detail(o) };
  },
  async 'order.cancelDelivery'(b) {
    const o = await store.getOrder(b.id); if (!o?.delivery?.lalamoveOrderId) throw httpError(400, 'No Lalamove delivery to cancel.');
    try { await lalamove.cancelOrder(o.delivery.lalamoveOrderId); } catch (e) { throw httpError(400, e.message); }
    o.delivery.status = 'CANCELED';
    store.addLog(o, `Lalamove #${o.delivery.lalamoveOrderId} cancelled by staff`, 'staff');
    await store.saveOrder(o);
    return { order: detail(o) };
  },
  async 'order.refresh'(b) {
    let o = await store.getOrder(b.id); if (!o) throw httpError(404, 'Order not found');
    try { o = await refreshDelivery(o); } catch (e) { throw httpError(400, e.message); }
    return { order: detail(o) };
  },
  // If a payment went through but the callback never arrived, ask Billplz directly.
  async 'order.checkPayment'(b, req) {
    let o = await store.getOrder(b.id); if (!o) throw httpError(404, 'Order not found');
    if (!o.payment.billId) throw httpError(400, 'This order has no Billplz bill.');
    const bill = await billplz.getBill(o.payment.billId);
    if (bill.paid === true || bill.state === 'paid') o = await fulfil(o.id, siteUrl(req), { paidAmountSen: Number(bill.paid_amount), source: 'manual check' });
    else { store.addLog(o, `Payment checked: still ${bill.state}`); await store.saveOrder(o); }
    return { order: detail(o), billState: bill.state };
  },


  // ---- home: store switch, today's numbers and the order board ----
  async home() {
    const [settings, orders, today] = await Promise.all([store.getSettings(), store.listOrders(300), insights({ range: 'today' })]);
    const now = Date.now(); const st = shopOpen(settings, now); const todayDate = mytParts(now).date;
    const board = orders.filter((o) => {
      const b = stage(o).board;
      if (b === 'done') return mytParts(o.updatedAt || o.createdAt).date === todayDate;
      if (b === 'unpaid') return now - o.createdAt < 3 * 3600000;
      return now - o.createdAt < 4 * 86400000;
    }).map(summary);
    return {
      store: { open: st.open, message: st.message, acceptingOrders: settings.acceptingOrders, pausedUntil: settings.pausedUntil > now ? settings.pausedUntil : 0, hours: settings.hours },
      today: { salesSen: today.salesSen, orders: today.orders, aovSen: today.aovSen, delivery: today.delivery, pickup: today.pickup, prev: today.prev, unpaid: today.unpaid },
      orders: board, now,
    };
  },
  async 'store.pause'(b) {
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
    staffLog(`Online ordering paused ${what} (until ${fmtTime(until)})`);
    return actions.home();
  },
  async 'store.setOpen'(b) {
    const s = await store.getSettings();
    s.acceptingOrders = !!b.open; s.pausedUntil = 0;
    await store.saveSettings(s);
    staffLog(b.open ? 'Online ordering turned ON' : 'Online ordering turned OFF');
    return actions.home();
  },

  // ---- order actions from the board ----
  async 'order.ready'(b) {
    const o = await getOrderOr404(b.id);
    if (o.payment.status !== 'paid') throw httpError(400, 'Order is not paid.');
    (o.prep ||= {}).readyAt = Date.now();
    store.addLog(o, o.fulfilment === 'pickup' ? 'Marked ready for collection' : 'Marked packed, waiting for the driver', 'staff');
    await store.saveOrder(o);
    if (o.fulfilment === 'pickup') await push.notifyOrder(o, { title: 'Ready for collection 🛍️', body: `${o.no} is ready at our ${o.branchName} shop.` });
    return { order: detail(o) };
  },
  async 'order.collected'(b) {
    const o = await getOrderOr404(b.id);
    (o.prep ||= {}).collectedAt = Date.now(); o.prep.readyAt ||= Date.now();
    store.addLog(o, 'Collected by customer', 'staff');
    await store.saveOrder(o);
    return { order: detail(o) };
  },
  async 'order.undoReady'(b) {
    const o = await getOrderOr404(b.id);
    o.prep = {}; store.addLog(o, 'Ready / collected undone', 'staff'); await store.saveOrder(o);
    return { order: detail(o) };
  },
  // Cancel a paid order (e.g. out of stock). Refunds are done in Billplz / by bank transfer.
  async 'order.cancel'(b) {
    const o = await getOrderOr404(b.id);
    if (o.cancelledAt) throw httpError(400, 'Already cancelled.');
    const d = o.delivery || {};
    if (d.lalamoveOrderId && !lalamove.FINAL_FAIL.includes(d.status) && d.status !== 'COMPLETED') {
      try { await lalamove.cancelOrder(d.lalamoveOrderId); d.status = 'CANCELED'; } catch (e) { throw httpError(400, `Cancel the Lalamove delivery first: ${e.message}`); }
    }
    o.cancelledAt = Date.now(); o.cancelReason = str(b.reason, 200);
    if (o.memberId && o.payment.status === 'paid') {
      const m = await members.get(o.memberId);
      if (m) {
        if (o.pointsEarned) members.addPoints(m, -o.pointsEarned, 'Order cancelled', o.no);
        if (o.pointsUsed) members.addPoints(m, o.pointsUsed, 'Points returned (order cancelled)', o.no);
        await members.save(m);
      }
    }
    store.addLog(o, `Order cancelled by staff${o.cancelReason ? `: ${o.cancelReason}` : ''}${o.payment.status === 'paid' ? `. Refund RM${rm(o.totalSen)} to the customer.` : ''}`, 'staff');
    await store.saveOrder(o);
    return { order: detail(o) };
  },
  // Priority fee ("tip") on a Lalamove order that is still looking for a driver. Keeps the original price,
  // unlike cancel + rebook which gets a new (often higher) quote.
  async 'order.tip'(b) {
    const o = await getOrderOr404(b.id);
    const d = o.delivery || {};
    if (!d.lalamoveOrderId) throw httpError(400, 'No Lalamove delivery on this order.');
    if (d.status !== 'ASSIGNING_DRIVER') throw httpError(400, d.status === 'ON_GOING' || d.status === 'PICKED_UP' ? 'A driver has already accepted. Tips can only be added while Lalamove is finding a driver.' : `Lalamove status is ${d.status}. Tips only work while finding a driver; rebook instead.`);
    const add = num(b.amountRM);
    if (!(add >= 1 && add <= 100)) throw httpError(400, 'Enter a tip between RM1 and RM100.');
    const total = Math.round(((Number(d.priorityFeeRM) || 0) + add) * 100) / 100;
    try { await addTip(o, total, 'staff'); } catch (e) { await store.saveOrder(o); throw httpError(400, e.message); }
    staffLog(`Tip added on ${o.no}: +RM${add.toFixed(2)} (total priority fee RM${total.toFixed(2)})`, { orderNo: o.no, orderId: o.id });
    await store.saveOrder(o);
    return { order: detail(o) };
  },
  // Ask Lalamove for another driver (free, 15+ minutes after the driver accepted and before pickup).
  async 'order.changeDriver'(b) {
    const o = await getOrderOr404(b.id);
    const d = o.delivery || {};
    if (!d.lalamoveOrderId || !d.driver?.id) throw httpError(400, 'No driver assigned yet.');
    if (d.status !== 'ON_GOING') throw httpError(400, 'You can only change the driver before the order is picked up.');
    const reason = ['DRIVER_LATE', 'DRIVER_ASKED_CHANGE', 'DRIVER_UNRESPONSIVE', 'DRIVER_RUDE'].includes(b.reason) ? b.reason : 'DRIVER_LATE';
    try { await lalamove.changeDriver(d.lalamoveOrderId, d.driver.id, reason); }
    catch (e) { throw httpError(400, /15|minute/i.test(e.message) ? `Lalamove allows a driver change 15 minutes after the driver accepted. ${e.message}` : e.message); }
    store.addLog(o, `Driver change requested (${reason.toLowerCase().replace(/_/g, ' ')}); previous driver ${d.driver.name || d.driver.id}`, 'staff');
    (d.oldDrivers ||= []).push(d.driver); delete d.driver; d.status = 'ASSIGNING_DRIVER';
    await store.saveOrder(o);
    return { order: detail(o) };
  },
  // What a rebook would cost right now, before staff commit to it.
  async 'order.rebookQuote'(b) {
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

  // ---- catalogue ----
  async 'products.get'() { return { products: await store.getProducts() }; },
  async 'products.save'(b) {
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
        cooking: !!p.cooking, maxQty: Math.max(0, Math.min(50, num(p.maxQty))),
        image: current[id]?.image || '', available: p.available !== false, sort: i,
      };
    });
    staffLog(`Menu saved (${list.length} products)`);
    // delete photos of removed products
    for (const old of Object.values(current)) if (old.image && !list.some((p) => p.image === old.image)) await db.del(`img:${old.image}`);
    return { products: await store.saveProducts(list) };
  },
  async 'products.toggle'(b) {
    const products = await store.getProducts();
    const p = products.find((x) => x.id === b.id); if (!p) throw httpError(404, 'Product not found');
    p.available = !!b.available;
    staffLog(`${p.name} ${p.available ? 'back in stock' : 'marked sold out'}`);
    return { products: await store.saveProducts(products) };
  },
  async 'products.image'(b) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || ''));
    if (!m) throw httpError(400, 'Please upload a JPG, PNG or WebP photo.');
    if (Buffer.byteLength(m[2], 'base64') > MAX_IMAGE_BYTES) throw httpError(400, 'Photo is too large. Please use a smaller photo.');
    const products = await store.getProducts();
    const p = products.find((x) => x.id === b.id); if (!p) throw httpError(404, 'Save the new product first, then add its photo.');
    const imgId = rid(9);
    await db.set(`img:${imgId}`, { type: m[1], b64: m[2] });
    if (p.image) await db.del(`img:${p.image}`);
    p.image = imgId;
    staffLog(`Photo changed: ${p.name}`);
    return { products: await store.saveProducts(products) };
  },
  async 'products.imageRemove'(b) {
    const products = await store.getProducts();
    const p = products.find((x) => x.id === b.id); if (!p) throw httpError(404, 'Product not found');
    if (p.image) await db.del(`img:${p.image}`);
    p.image = '';
    return { products: await store.saveProducts(products) };
  },

  // ---- registered members ----
  async 'members.list'() {
    const [list2, customers, used] = await Promise.all([members.list(), store.getCustomers(), members.welcomeUsedCount()]);
    return { members: list2.map((m) => ({ id: m.id, name: m.name, phone: m.phone, email: m.email, createdAt: m.createdAt, orderCount: m.orderCount || 0, lastOrderAt: m.lastOrderAt || 0, welcomeUsed: !!m.welcomeUsed, addresses: (m.addresses || []).length, discountPct: Number(customers[m.phone]?.discountPct) || 0, points: m.points || 0, pointsLog: (m.pointsLog || []).slice(0, 10) })), welcomeUsed: used };
  },
  async 'members.points'(b) {
    const m = await members.get(b.id); if (!m) throw httpError(404, 'Member not found');
    const delta = Math.round(num(b.delta));
    if (!delta || Math.abs(delta) > 100000) throw httpError(400, 'Enter the points to add (or minus to remove).');
    members.addPoints(m, delta, str(b.reason, 80) || 'Adjusted by staff');
    await members.save(m);
    staffLog(`Points ${delta > 0 ? '+' : ''}${delta} for ${m.name} (${m.phone})${b.reason ? `: ${str(b.reason, 80)}` : ''}`);
    return { points: m.points };
  },
  async 'members.resetPassword'(b) {
    const m = await members.get(b.id); if (!m) throw httpError(404, 'Member not found');
    const temp = Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[crypto.randomInt(31)]).join('');
    await members.setPassword(m, temp);
    staffLog(`Password reset for member ${m.name} (${m.phone})`);
    return { password: temp, phone: m.phone, name: m.name };
  },

  // ---- coupons ----
  async 'coupons.get'() { return { coupons: Object.values(await store.getCoupons()) }; },
  async 'coupons.save'(b) {
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
    staffLog(`Coupon ${code} saved (${type === 'percent' ? `${value}%` : `RM${value}`} off${coupons[code].active ? '' : ', inactive'})`);
    return { coupons: Object.values(coupons) };
  },
  async 'coupons.delete'(b) {
    const coupons = await store.getCoupons(); delete coupons[b.code]; await store.saveCoupons(coupons);
    staffLog(`Coupon ${str(b.code, 30)} deleted`);
    return { coupons: Object.values(coupons) };
  },

  // ---- member discounts ----
  async 'customers.get'() { return { customers: Object.values(await store.getCustomers()) }; },
  async 'customers.save'(b) {
    const c = b.customer || {};
    const phone = normalizePhone(c.phone); if (!phone) throw httpError(400, 'Enter a valid Malaysian phone number.');
    const pct = num(c.discountPct); if (!(pct > 0 && pct <= 100)) throw httpError(400, 'Discount must be between 1 and 100%.');
    const customers = await store.getCustomers();
    if (b.originalPhone && b.originalPhone !== phone) delete customers[b.originalPhone];
    customers[phone] = { phone, name: str(c.name, 80), discountPct: pct, note: str(c.note, 120) };
    await store.saveCustomers(customers);
    staffLog(`Customer discount ${pct}% for ${phone}`);
    return { customers: Object.values(customers) };
  },
  async 'customers.delete'(b) {
    const customers = await store.getCustomers(); delete customers[b.phone]; await store.saveCustomers(customers);
    staffLog(`Customer discount removed for ${str(b.phone, 20)}`);
    return { customers: Object.values(customers) };
  },

  // ---- settings ----
  async 'settings.get'(b, req) { return { settings: await store.getSettings(), status: integrationStatus(req), welcomeUsed: await members.welcomeUsedCount() }; },
  async 'settings.save'(b, req) {
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
      priority: { enabled: !!(s.priority?.enabled ?? cur.priority.enabled), fee: Math.max(0, Math.min(100, num(s.priority?.fee, cur.priority.fee))) },
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
    staffLog('Settings saved');
    return { settings: saved, status: integrationStatus(req), welcomeUsed: await members.welcomeUsedCount() };
  },


  // ---- insights, activity log, promotions ----
  async insights(b) { return insights({ range: b.range, from: b.from, to: b.to }); },
  async 'activity.list'(b) {
    const start = Math.max(0, Math.round(num(b.start))); const count = Math.min(300, Math.max(10, Math.round(num(b.count, 100))));
    const type = activity.TYPES.includes(b.type) ? b.type : ''; const q = str(b.q, 60).toLowerCase();
    if (!type && !q) { const items = await activity.list(start, count); return { items, next: items.length === count ? start + count : null }; }
    const all = await activity.list(0, 5000);
    const hits = all.filter((a) => (!type || a.type === type) && (!q || `${a.msg} ${a.orderNo || ''}`.toLowerCase().includes(q)));
    const items = hits.slice(start, start + count);
    return { items, next: start + count < hits.length ? start + count : null };
  },
  async 'promo.info'() {
    return { subscribers: await push.promoCount(), history: await db.lrange('promos', 0, 19) };
  },
  async 'promo.send'(b) {
    const title = str(b.title, 60); const text = str(b.body, 180);
    if (title.length < 3) throw httpError(400, 'Add a title for the notification.');
    if ((await db.incr('rl:promo', 3600)) > 6) throw httpError(429, 'You can send up to 6 promotions an hour.');
    const url = /^\/[\w\-./?=&#%]*$/.test(String(b.url || '')) ? b.url : '/';
    const r = await push.broadcastPromo({ title, body: text, url, tag: `promo-${Date.now()}` });
    await db.lpush('promos', { at: Date.now(), title, body: text, url, sent: r.sent }, 50);
    return { ...r, subscribers: await push.promoCount() };
  },
  async 'staffPush.save'(b) {
    if (b.on === false) { if (b.subscription?.endpoint) await push.save(b.subscription, { staff: false }); return { on: false }; }
    await push.save(b.subscription, { staff: true });
    staffLog('New-order alerts turned on for a staff device');
    await push.notifyStaff({ title: 'New-order alerts are on ✅', body: "This device will be notified when a paid order comes in.", url: '/admin.html', tag: 'staff-test' });
    return { on: true };
  },

  // ---- integrations ----
  async 'printers.list'() { return { printers: await printnode.printers() }; },
  async 'print.test'(b, req) {
    const settings = await store.getSettings();
    const br = settings.branches.find((x) => x.id === b.branchId);
    if (!br?.printerId) throw httpError(400, 'Choose a printer for this branch and save first.');
    const pdf = await buildLabel({ ...SAMPLE_ORDER, branchName: br.name }, labelOptions(settings, SAMPLE_ORDER, siteUrl(req)));
    const jobId = await printnode.printPdf({ printerId: br.printerId, title: 'Test label', pdf });
    return { jobId };
  },
  async 'lalamove.setup'(b, req) {
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
  return {
    site: siteUrl(req),
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
  if (b.action !== 'login') await requireSession(req);
  try { send(res, 200, await fn(b, req)); }
  catch (e) {
    if (e.status) throw e;
    console.error(e);
    activity.log('error', `Dashboard ${b.action}: ${e.message}`);
    throw httpError(400, e.message);
  }
});
module.exports.SAMPLE_ORDER = SAMPLE_ORDER;
