// Server-side cart pricing: products, cutting preferences, member % discounts, the new member offer
// and coupon codes. Prices are never taken from the browser.
const { toSen, mytParts, fmtQty } = require('./util');
const { normalizeCut, cutSummary } = require('./cuts');

const MAX_QTY = 50;
const MAX_LINES = 40;

function priceItems(items, products, settings = {}) {
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const lines = []; const errors = [];
  let weightKg = 0;
  const totals = {}; // per product, for the max-per-order cap
  for (const it of (Array.isArray(items) ? items : []).slice(0, MAX_LINES)) {
    const p = byId[it.productId];
    const qty = Number(it.qty);
    if (!p) { errors.push('An item in your cart is no longer sold.'); continue; }
    if (!p.available) { errors.push(`${p.name} is sold out right now.`); continue; }
    const step = Number(p.step) || (p.unit === 'kg' ? 0.5 : 1);
    const min = Number(p.min) || step;
    const onStep = Math.abs(qty / step - Math.round(qty / step)) < 1e-9;
    if (!isFinite(qty) || qty < min || qty > MAX_QTY || !onStep) { errors.push(`Please choose a valid amount for ${p.name}.`); continue; }
    totals[p.id] = (totals[p.id] || 0) + qty;
    // stock: null = not counted (unlimited)
    if (p.stock !== null && p.stock !== undefined) {
      if (p.stock < min - 1e-9) { errors.push(`${p.name} is sold out.`); continue; }
      if (totals[p.id] > p.stock + 1e-9) { errors.push(`${p.name}: only ${fmtQty(Math.round(p.stock * 100) / 100, p.unit)} left.`); continue; }
    }
    const c = normalizeCut(it.cut, p, settings);
    if (c.error) { errors.push(c.error); continue; }
    const priceSen = toSen(p.price);
    const lineSen = Math.round(priceSen * qty);
    weightKg += p.unit === 'kg' ? qty : qty * 0.5; // rough weight for sets/pieces
    const line = { productId: p.id, category: p.category || '', name: p.name, unit: p.unit, qty, priceSen, lineSen };
    if (c.cut) { line.cut = c.cut; line.cutText = cutSummary(c.cut); }
    lines.push(line);
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
  return { kind: 'member', sen: Math.floor((subtotalSen * pct) / 100), label: `Member discount (${pct}% off)` };
}

// welcome = result of members.welcomeStatus()
function welcomeDiscount(welcome, subtotalSen) {
  if (!welcome?.eligible) return { off: true };
  if (welcome.minSpendSen && subtotalSen < welcome.minSpendSen) return { error: `Spend at least RM${(welcome.minSpendSen / 100).toFixed(2)} to use your RM${(welcome.amountSen / 100).toFixed(0)} new member offer.` };
  return { kind: 'welcome', sen: Math.min(subtotalSen, welcome.amountSen), label: `New member offer (RM${(welcome.amountSen / 100).toFixed(0)} off)` };
}

// Loyalty points: redeem in whole blocks (e.g. 100 points = RM5), up to maxPct of the meat total after discounts.
function pointsRedemption(loyalty, points, afterDiscountSen) {
  const L = loyalty || {};
  const block = Math.max(1, Math.round(Number(L.redeemPoints) || 100));
  const blockSen = Math.round((Number(L.redeemValue) || 0) * 100);
  if (!L.enabled || !blockSen || !(points >= block)) return { pointsUsed: 0, sen: 0 };
  const capSen = Math.floor((afterDiscountSen * Math.min(100, Math.max(0, Number(L.maxPct) || 0))) / 100);
  const blocks = Math.min(Math.floor(points / block), Math.floor(capSen / blockSen));
  return blocks > 0 ? { pointsUsed: blocks * block, sen: blocks * blockSen } : { pointsUsed: 0, sen: 0 };
}
const pointsEarned = (loyalty, paidItemsSen) => (loyalty?.enabled ? Math.floor(Math.max(0, paidItemsSen) / 100) * Math.max(0, Number(loyalty.earnPerRM) || 0) : 0);

function priceCart({ items, phone, couponCode, products, coupons, customers, settings, welcome, now }) {
  const base = priceItems(items, products, settings);
  const out = { ...base, discounts: [], discountSen: 0, couponCode: '', couponMessage: '', welcomeApplied: false, welcomeMessage: '' };
  const sub = base.subtotalSen;

  const member = memberDiscount(customers?.[phone], sub);
  const w = welcomeDiscount(welcome, sub);
  if (w.error) out.welcomeMessage = w.error;
  const welcomeD = w.kind ? w : null;

  let coupon = null;
  const code = String(couponCode || '').trim().toUpperCase();
  if (code) {
    const c = couponDiscount(coupons?.[code], { subtotalSen: sub, phone, now });
    if (c.error) out.couponError = c.error; else coupon = { kind: 'coupon', ...c, code };
  }

  const cands = [member, welcomeD, coupon].filter(Boolean);
  if (settings?.stackDiscounts && cands.length > 1) {
    // member % and welcome first, then the coupon on what's left
    let left = sub;
    for (const d of [member, welcomeD]) if (d) { const sen = Math.min(left, d.sen); out.discounts.push({ ...d, sen }); left -= sen; }
    if (coupon) {
      const c2 = couponDiscount(coupons[code], { subtotalSen: left, phone, now });
      if (!c2.error && c2.sen > 0) { out.discounts.push({ kind: 'coupon', sen: Math.min(left, c2.sen), label: c2.label }); out.couponCode = code; }
    }
  } else if (cands.length) {
    const best = cands.reduce((a, b) => (b.sen > a.sen ? b : a));
    out.discounts = [best];
    if (best.kind === 'coupon') out.couponCode = code;
    else if (coupon) out.couponMessage = `Your ${best.kind === 'welcome' ? 'new member offer' : 'member discount'} is better than this coupon, so we applied that instead.`;
  }

  out.discounts = out.discounts.map(({ kind, sen, label }) => ({ kind, sen, label }));
  out.welcomeApplied = out.discounts.some((d) => d.kind === 'welcome');
  out.discountSen = Math.min(sub, out.discounts.reduce((s, d) => s + d.sen, 0));
  out.minOrderSen = toSen(settings?.minOrder);
  if (out.minOrderSen && sub < out.minOrderSen) out.errors.push(`Minimum order is RM${(out.minOrderSen / 100).toFixed(2)}.`);
  return out;
}

// Stock errors for the branch that will prepare the order (products carry stockBy from store.withStock)
function stockErrors(lines, products, branch) {
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const qty = {};
  for (const l of lines) qty[l.productId] = (qty[l.productId] || 0) + l.qty;
  const errors = [];
  for (const [id, q] of Object.entries(qty)) {
    const p = byId[id]; const left = p?.stockBy?.[branch.id];
    if (left === null || left === undefined) continue;
    const min = Number(p.min) || Number(p.step) || 1;
    if (left < min - 1e-9) errors.push(`${p.name} is sold out at our ${branch.name} shop.`);
    else if (q > left + 1e-9) errors.push(`${p.name}: only ${fmtQty(Math.round(left * 100) / 100, p.unit)} left at our ${branch.name} shop.`);
  }
  return errors;
}
const canServe = (lines, products, branch) => stockErrors(lines, products, branch).length === 0;

module.exports = { priceCart, priceItems, couponDiscount, pointsRedemption, pointsEarned, stockErrors, canServe };
