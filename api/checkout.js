// POST /api/checkout — re-prices the cart on the server, creates the order and a Billplz bill.
const db = require('../lib/db');
const store = require('../lib/store');
const billplz = require('../lib/billplz');
const members = require('../lib/members');
const { body, send, ip, siteUrl, rid, handler } = require('../lib/http');
const { buildQuote } = require('../lib/quote');
const { shopOpen, distanceKm } = require('../lib/util');

const bad = (res, error) => send(res, 400, { error });

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if ((await db.incr(`rl:checkout:${ip(req)}`, 600)) > 20) return send(res, 429, { error: 'Too many attempts, please wait a few minutes.' });
  const b = await body(req);
  const c = b.customer || {}; const a = b.address || {};
  const member = await members.fromRequest(req);

  const name = String(c.name || member?.name || '').trim().slice(0, 80);
  const email = String(c.email || '').trim().slice(0, 120);
  if (name.length < 2) return bad(res, 'Please enter your name.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 'Please check your email address.');
  if (!String(a.text || '').trim() || !isFinite(parseFloat(a.lat)) || !isFinite(parseFloat(a.lng))) return bad(res, 'Please choose your delivery address on the map.');

  const { result: q, settings, phone } = await buildQuote({
    items: b.items, phone: c.phone, couponCode: b.couponCode, member,
    location: { lat: a.lat, lng: a.lng, address: a.text },
  });
  const status = shopOpen(settings);
  if (!status.open) return bad(res, status.message);
  if (!phone) return bad(res, 'Please enter a valid Malaysian phone number.');
  if (!q.lines.length) return bad(res, 'Your cart is empty.');
  if (q.errors.length) return bad(res, q.errors[0]);
  if (b.couponCode && q.couponError) return bad(res, q.couponError);
  if (q.deliveryError || q.deliverySen == null) return bad(res, q.deliveryError || 'Could not get a delivery price.');

  const seq = await db.incr('orderseq');
  const order = {
    id: rid(9), token: rid(12), no: `AFM-${1000 + seq}`, createdAt: Date.now(),
    memberId: member?.id || '',
    customer: { name, phone, email },
    address: {
      text: String(a.text).trim().slice(0, 300), unit: String(a.unit || '').trim().slice(0, 80),
      notes: String(a.notes || '').trim().slice(0, 300), lat: parseFloat(a.lat), lng: parseFloat(a.lng),
    },
    branchId: q.branch.id, branchName: q.branch.name, serviceType: q.serviceType,
    items: q.lines, subtotalSen: q.subtotalSen, discounts: q.discounts, discountSen: q.discountSen,
    couponCode: q.couponCode, welcome: !!q.welcomeApplied,
    deliverySen: q.deliverySen, deliveryQuoteRM: q.deliveryQuoteRM, totalSen: q.totalSen,
    weightKg: q.weightKg, distanceKm: q.distanceKm,
    payment: { status: 'pending' }, print: {}, delivery: {}, log: [],
  };
  store.addLog(order, `Order placed${member ? ` by member ${member.name}` : ''}, waiting for payment`);

  // Members: keep their email up to date and save a new address if they ticked "save"
  if (member) {
    try {
      if (email && email.toLowerCase() !== member.email) await members.updateProfile(member, { email });
      if (b.saveAddress) {
        const same = (member.addresses || []).find((x) => distanceKm(x, order.address) < 0.03);
        await members.saveAddress(member, { ...order.address, id: same?.id, label: String(b.addressLabel || same?.label || 'Home') });
      }
    } catch (e) { console.warn('member update skipped', e.message); }
  }

  const site = siteUrl(req);
  try {
    const bill = await billplz.createBill({
      amountSen: order.totalSen, name, email, mobile: phone,
      description: `Ali's Fresh Meats order ${order.no}`,
      callbackUrl: `${site}/api/billplz-callback`,
      redirectUrl: `${site}/api/billplz-return`,
      reference: order.no,
    });
    order.payment = { status: 'pending', billId: bill.id, billUrl: bill.url };
    await db.set(`bill:${bill.id}`, order.id);
  } catch (e) {
    console.error(e);
    order.payment = { status: 'failed', error: e.message };
    store.addLog(order, `Could not create payment: ${e.message}`);
    await store.saveOrder(order);
    await db.zadd('orders', order.createdAt, order.id);
    return send(res, 502, { error: 'Online payment is unavailable right now. Please try again shortly or WhatsApp us.' });
  }
  await store.saveOrder(order);
  await db.zadd('orders', order.createdAt, order.id);
  if (member) await db.zadd(`memberorders:${member.id}`, order.createdAt, order.id);
  send(res, 200, { paymentUrl: order.payment.billUrl, orderId: order.id, token: order.token });
});
