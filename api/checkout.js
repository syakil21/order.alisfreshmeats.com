// POST /api/checkout — re-prices the cart on the server, creates the order and a Billplz bill.
const db = require('../lib/db');
const store = require('../lib/store');
const billplz = require('../lib/billplz');
const members = require('../lib/members');
const { body, send, ip, siteUrl, rid, handler } = require('../lib/http');
const { buildQuote } = require('../lib/quote');
const { syncPayment } = require('../lib/fulfil');
const { distanceKm, fmtWhen } = require('../lib/util');

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
  const pickup = b.fulfilment === 'pickup';
  if (!pickup && (!String(a.text || '').trim() || !isFinite(parseFloat(a.lat)) || !isFinite(parseFloat(a.lng)))) return bad(res, 'Please choose your delivery address on the map.');

  const { result: q, settings, phone, status } = await buildQuote({
    items: b.items, phone: c.phone, couponCode: b.couponCode, member,
    location: pickup ? null : { lat: a.lat, lng: a.lng, address: a.text },
    fulfilment: b.fulfilment, deliveryOption: b.deliveryOption, pickupBranchId: b.pickupBranchId, pickupAt: b.pickupAt, deliverAt: pickup ? '' : b.deliverAt, usePoints: !!b.usePoints,
  });
  if (!status.open && !status.preorder) return bad(res, status.message);
  if (!phone) return bad(res, 'Please enter a valid Malaysian phone number.');
  if (!q.lines.length) return bad(res, 'Your cart is empty.');
  if (q.errors.length) return bad(res, q.errors[0]);
  if (b.couponCode && q.couponError) return bad(res, q.couponError);
  if (pickup && q.fulfilment !== 'pickup') return bad(res, 'Self pickup is not available right now.');
  if (q.fulfilment === 'pickup' && q.pickupError) return bad(res, q.pickupError);
  if (q.fulfilment === 'delivery' && (q.deliveryError || q.deliverySen == null)) return bad(res, q.deliveryError || 'Could not get a delivery price.');
  if (q.fulfilment === 'delivery' && q.deliverAtError) return bad(res, q.deliverAtError);
  if (b.deliveryOption && q.fulfilment === 'delivery' && b.deliveryOption !== q.deliveryOption) return bad(res, 'That delivery option is not available for this address. Please choose again.');
  if (b.usePoints && !q.points.used) return bad(res, 'Your points cannot be used on this order. Please refresh and try again.');
  if (q.totalSen < 100) return bad(res, 'The amount to pay must be at least RM1.00.');

  // Pressing Pay again (e.g. back from the bank page): reuse the same unpaid bill if nothing changed,
  // otherwise mark the earlier unpaid checkout(s) as replaced so they don't look like missing payments.
  const sig = JSON.stringify([q.lines.map((l) => [l.productId, l.qty, l.cut || null]), q.fulfilment, q.deliveryOption, q.branch?.id, q.pickupAt || q.deliverAt || '', q.totalSen,
    pickup ? '' : [Number(parseFloat(a.lat).toFixed(5)), Number(parseFloat(a.lng).toFixed(5))]]);
  const earlier = (await store.listOrders(80)).filter((o) => o.customer?.phone === phone && o.payment?.status === 'pending' && !o.deletedAt && Date.now() - o.createdAt < 2 * 3600000);
  const same = earlier.find((o) => o.checkoutSig === sig && o.payment.billUrl);
  if (same) {
    try {
      const bill = await billplz.getBill(same.payment.billId);
      if (bill.state === 'due') {
        store.addLog(same, 'Customer pressed Pay again with the same order; same Billplz bill reused');
        await store.saveOrder(same);
        return send(res, 200, { paymentUrl: same.payment.billUrl, orderId: same.id, token: same.token });
      }
      if (bill.state === 'paid') { // paid a moment ago: record it, and don't make a second bill
        const done = await syncPayment(same, siteUrl(req), { force: true });
        return send(res, 200, { paymentUrl: `/order.html?id=${done.id}&t=${done.token}`, orderId: done.id, token: done.token });
      }
    } catch (e) { console.warn('bill reuse check failed', e.message); }
  }

  const seq = await db.incr('orderseq');
  const order = {
    id: rid(9), token: rid(12), no: `AFM-${1000 + seq}`, createdAt: Date.now(),
    memberId: member?.id || '',
    customer: { name, phone, email },
    fulfilment: q.fulfilment,
    address: q.fulfilment === 'pickup' ? { text: '', unit: '', notes: String(a.notes || '').trim().slice(0, 300) } : {
      text: String(a.text).trim().slice(0, 300), unit: String(a.unit || '').trim().slice(0, 80),
      notes: String(a.notes || '').trim().slice(0, 300), lat: parseFloat(a.lat), lng: parseFloat(a.lng),
    },
    branchId: q.branch.id, branchName: q.branch.name, serviceType: q.serviceType,
    items: q.lines, subtotalSen: q.subtotalSen, discounts: q.discounts, discountSen: q.discountSen,
    couponCode: q.couponCode, welcome: !!q.welcomeApplied,
    pointsUsed: q.points.used || 0, pointsSen: q.points.sen || 0, pointsEarned: member ? q.points.earned || 0 : 0,
    smallOrderSen: q.smallOrderSen || 0, deliverySen: q.deliverySen, deliveryQuoteRM: q.deliveryQuoteRM || 0, totalSen: q.totalSen,
    weightKg: q.weightKg, distanceKm: q.distanceKm,
    payment: { status: 'pending' }, print: {}, delivery: {}, prep: {}, log: [], checkoutSig: sig,
  };
  if (q.fulfilment === 'pickup') order.pickup = { branchId: q.branch.id, at: q.pickupAt };
  else order.deliveryOption = q.deliveryOption;
  if (status.preorder || q.deliverAt) { order.preorder = true; if (q.scheduledFor) order.scheduledFor = q.scheduledFor; } // ordered for later
  if (q.deliverAt) order.advance = true;
  if (Array.isArray(b.pushSubs)) order.pushSubs = b.pushSubs.filter((x) => /^[a-f0-9]{24}$/.test(x)).slice(0, 3);
  const how = q.fulfilment === 'pickup' ? `self pickup at ${q.branch.name}` : `${({ regular: 'standard', priority: 'priority', saver: 'saver' })[q.deliveryOption] || 'standard'} delivery`;
  store.addLog(order, `Order placed${member ? ` by member ${member.name}` : ''} (${how}${order.preorder ? `, ${order.advance ? 'advance order' : 'ordered ahead while closed'}${order.scheduledFor ? ` for ${fmtWhen(Date.parse(order.scheduledFor))}` : ''}` : ''}), waiting for payment`);

  // Members: keep their email up to date and save a new address if they ticked "save"
  if (member) {
    try {
      if (email && email.toLowerCase() !== member.email) await members.updateProfile(member, { email });
      if (b.saveAddress && q.fulfilment === 'delivery') {
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
  await db.set(`orderno:${order.no}`, order.id);
  for (const o of earlier) {
    if (o.id === order.id || o.payment.status !== 'pending') continue;
    o.payment.status = 'replaced'; o.replacedBy = { no: order.no, id: order.id };
    store.addLog(o, `Not paid: the customer checked out again as ${order.no}`);
    await store.saveOrder(o);
  }
  if (member) await db.zadd(`memberorders:${member.id}`, order.createdAt, order.id);
  send(res, 200, { paymentUrl: order.payment.billUrl, orderId: order.id, token: order.token });
});
