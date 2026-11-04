// Server-side cart pricing: products, member (customer) discounts and coupon codes.
// Prices are never taken from the browser.
const { toSen, mytParts } = require('./util');

const MAX_QTY = 50;

function priceItems(items, products) {
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const lines = []; const errors = [];
  let weightKg = 0;
  for (const it of Array.isArray(items) ? items : []) {
    const p = byId[it.productId];
    const qty = Number(it.qty);
    if (!p) { errors.push('An item in your cart is no longer sold.'); continue; }
    if (!p.available) { errors.push(`${p.name} is sold out right now.`); continue; }
    const step = Number(p.step) || (p.unit === 'kg' ? 0.5 : 1);
    const min = Number(p.min) || step;
    const onStep = Math.abs(qty / step - Math.round(qty / step)) < 1e-9;
    if (!isFinite(qty) || qty < min || qty > MAX_QTY || !onStep) { errors.push(`Please choose a valid amount for ${p.name}.`); continue; }
    const priceSen = toSen(p.price);
    const lineSen = Math.round(priceSen * qty);
    weightKg += p.unit === 'kg' ? qty : qty * 0.5; // rough weight for sets/pieces
    lines.push({ productId: p.id, name: p.name, unit: p.unit, qty, priceSen, lineSen });
  }
  const subtotalSen = lines.reduce((s, l) => s + l.lineSen, 0);
  return { lines, subtotalSen, errors, weightKg };
}

// Returns { sen, label } or { error }
function couponDiscount(coupon, { subtotalSen, phone, now = Date.now() }) {
  if (!coupon || !coupon.active) return { error: 'This coupon code is not valid.' };
  const today = mytParts(now).date;
  if (coupon.startsOn && today < coupon.startsOn) return { error: 'This coupon is not active yet.' };
  if (coupon.endsOn && today > coupon.endsOn) return { error: 'This coupon has expired.' };
  if (coupon.maxUses && (coupon.used || 0) >= coupon.maxUses) return { error: 'This coupon has been fully used.' };
  const phones = (coupon.phones || []).filter(Boolean);
  if (phones.length && !phones.includes(phone)) return { error: 'This coupon is not valid for this phone number.' };
  if (coupon.oncePerCustomer && phone && (coupon.usedBy || []).includes(phone)) return { error: 'You have already used this coupon.' };
  const minSen = toSen(coupon.minSpend);
  if (minSen && subtotalSen < minSen) return { error: `Spend at least RM${(minSen / 100).toFixed(2)} to use this coupon.` };
  let sen;
  if (coupon.type === 'percent') {
    sen = Math.floor((subtotalSen * Math.min(100, Number(coupon.value) || 0)) / 100);
    const cap = toSen(coupon.maxDiscount);
    if (cap) sen = Math.min(sen, cap);
  } else {
    sen = Math.min(subtotalSen, toSen(coupon.value));
  }
  const label = coupon.type === 'percent' ? `Coupon ${coupon.code} (${Number(coupon.value)}% off)` : `Coupon ${coupon.code}`;
  return { sen, label };
}

function memberDiscount(customer, subtotalSen) {
  if (!customer || !(Number(customer.discountPct) > 0)) return null;
  const pct = Math.min(100, Number(customer.discountPct));
  return { sen: Math.floor((subtotalSen * pct) / 100), label: `Member discount (${pct}% off)` };
}

function priceCart({ items, phone, couponCode, products, coupons, customers, settings, now }) {
  const base = priceItems(items, products);
  const out = { ...base, discounts: [], discountSen: 0, couponCode: '', couponMessage: '' };
  const member = memberDiscount(customers?.[phone], base.subtotalSen);

  let coupon = null;
  const code = String(couponCode || '').trim().toUpperCase();
  if (code) {
    const c = couponDiscount(coupons?.[code], { subtotalSen: base.subtotalSen, phone, now });
    if (c.error) out.couponError = c.error; else coupon = { ...c, code };
  }

  if (settings?.stackDiscounts && member && coupon) {
    const afterMember = base.subtotalSen - member.sen;
    const c2 = couponDiscount(coupons[code], { subtotalSen: afterMember, phone, now });
    out.discounts = [member, c2.error ? null : { sen: c2.sen, label: c2.label }].filter(Boolean);
    out.couponCode = c2.error ? '' : code;
  } else if (member && coupon) {
    if (coupon.sen > member.sen) { out.discounts = [coupon]; out.couponCode = code; }
    else { out.discounts = [member]; out.couponMessage = 'Your member discount is better than this coupon, so we applied that instead.'; }
  } else if (coupon) { out.discounts = [coupon]; out.couponCode = code; }
  else if (member) out.discounts = [member];

  out.discountSen = Math.min(base.subtotalSen, out.discounts.reduce((s, d) => s + d.sen, 0));
  out.minOrderSen = toSen(settings?.minOrder);
  if (out.minOrderSen && base.subtotalSen < out.minOrderSen) out.errors.push(`Minimum order is RM${(out.minOrderSen / 100).toFixed(2)}.`);
  return out;
}

module.exports = { priceCart, priceItems, couponDiscount };
