// POST /api/admin — staff dashboard actions. Every action except "login" needs the session token.
const crypto = require('crypto');
const db = require('../lib/db');
const store = require('../lib/store');
const billplz = require('../lib/billplz');
const lalamove = require('../lib/lalamove');
const printnode = require('../lib/printnode');
const { buildLabel } = require('../lib/label');
const { body, send, ip, siteUrl, rid, safeEqual, handler, httpError } = require('../lib/http');
const { fulfil, printLabel, bookDelivery, refreshDelivery, labelOptions } = require('../lib/fulfil');
const { stage } = require('../lib/stage');
const members = require('../lib/members');
const { normalizePhone } = require('../lib/util');

const num = (v, d = 0) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const slug = (s) => str(s, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || rid(4).toLowerCase();

async function requireSession(req) {
  const t = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!t || !(await db.get(`sess:${t}`))) throw httpError(401, 'Please log in again.');
}

function summary(o) {
  const s = stage(o);
  return {
    id: o.id, no: o.no, createdAt: o.createdAt, name: o.customer.name, phone: o.customer.phone, branchName: o.branchName,
    totalSen: o.totalSen, itemCount: o.items.length, paid: o.payment.status === 'paid', paymentStatus: o.payment.status,
    stage: s.key, stageText: s.text, problem: s.problem || (o.print?.status && !['sent'].includes(o.print.status) && o.payment.status === 'paid' ? 'Label not printed' : false),
    printStatus: o.print?.status || '', deliveryStatus: o.delivery?.status || '', pickupAt: o.delivery?.scheduleAt || null,
  };
}
const detail = (o) => { const { token, ...rest } = o; return { ...rest, ...{ summary: summary(o) } }; };

const SAMPLE_ORDER = {
  id: 'test', no: 'AFM-TEST', customer: { name: 'Test Customer', phone: '+60123456789' }, branchName: 'Test',
  address: { text: 'Test address', notes: 'Test print from dashboard' }, delivery: { scheduleAt: new Date().toISOString() },
  items: [
    { name: 'Boneless Meat', qty: 1.5, unit: 'kg', cutText: '2 inch pieces · Curry cut' },
    { name: 'Mutton Chops', qty: 1, unit: 'kg', cutText: '50 g per piece · Chukka · "Remove fat please"' },
    { name: 'Head', qty: 1, unit: 'set' },
  ],
};
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
    o = await printLabel(o, await store.getSettings(), siteUrl(req), { reason: 'reprint' });
    await store.saveOrder(o);
    if (o.print.status !== 'sent') throw httpError(400, o.print.error || 'Print failed');
    return { order: detail(o) };
  },
  async 'order.rebook'(b) {
    let o = await store.getOrder(b.id); if (!o) throw httpError(404, 'Order not found');
    if (o.payment.status !== 'paid') throw httpError(400, 'Order is not paid.');
    const st = o.delivery?.status;
    if (o.delivery?.lalamoveOrderId && !['BOOKING_FAILED', ...lalamove.FINAL_FAIL].includes(st)) throw httpError(400, `A Lalamove delivery is already active (${st}). Cancel it first.`);
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
    store.addLog(o, `Lalamove #${o.delivery.lalamoveOrderId} cancelled by staff`);
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
        cuts: !!p.cuts, image: current[id]?.image || '', available: p.available !== false, sort: i,
      };
    });
    // delete photos of removed products
    for (const old of Object.values(current)) if (old.image && !list.some((p) => p.image === old.image)) await db.del(`img:${old.image}`);
    return { products: await store.saveProducts(list) };
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
    return { members: list2.map((m) => ({ id: m.id, name: m.name, phone: m.phone, email: m.email, createdAt: m.createdAt, orderCount: m.orderCount || 0, welcomeUsed: !!m.welcomeUsed, addresses: (m.addresses || []).length, discountPct: Number(customers[m.phone]?.discountPct) || 0 })), welcomeUsed: used };
  },
  async 'members.resetPassword'(b) {
    const m = await members.get(b.id); if (!m) throw httpError(404, 'Member not found');
    const temp = Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[crypto.randomInt(31)]).join('');
    await members.setPassword(m, temp);
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
    return { coupons: Object.values(coupons) };
  },
  async 'coupons.delete'(b) {
    const coupons = await store.getCoupons(); delete coupons[b.code]; await store.saveCoupons(coupons);
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
    return { customers: Object.values(customers) };
  },
  async 'customers.delete'(b) {
    const customers = await store.getCustomers(); delete customers[b.phone]; await store.saveCustomers(customers);
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
        cooking: list(s.cutting?.cooking).map((x) => x.slice(0, 30)),
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
    return { settings: await store.saveSettings(next), status: integrationStatus(req), welcomeUsed: await members.welcomeUsedCount() };
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
  catch (e) { if (e.status) throw e; console.error(e); throw httpError(400, e.message); }
});
module.exports.SAMPLE_ORDER = SAMPLE_ORDER;
