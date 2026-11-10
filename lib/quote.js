// Full price for a cart: items, discounts, loyalty points, and either delivery (area check + Lalamove
// fee for Standard / Priority / Saver) or self pickup (branch + time slot).
const db = require('./db');
const store = require('./store');
const lalamove = require('./lalamove');
const members = require('./members');
const { priceCart, pointsRedemption, pointsEarned, stockErrors, canServe } = require('./pricing');
const { toSen, normalizePhone, usableBranches, distanceKm, pickupSlots } = require('./util');

async function deliveryQuote(branch, loc, serviceType, specialRequests, tier = '1') {
  const key = `q:${branch.id}:${serviceType}:${tier}:${specialRequests || ''}:${loc.lat.toFixed(4)}:${loc.lng.toFixed(4)}`;
  const cached = await db.get(key);
  if (cached) return cached;
  const q = await lalamove.quote({
    pickup: { lat: branch.lat, lng: branch.lng, address: branch.address },
    dropoff: { lat: loc.lat, lng: loc.lng, address: loc.address || 'Customer address' },
    serviceType, specialRequests, tier,
  });
  const out = { totalRM: q.totalRM, distanceM: q.distanceM };
  await db.set(key, out, { ex: 240 });
  return out;
}

// Nearest active branch whose delivery radius covers the address. With `prefer` (e.g. "has the stock"),
// the nearest branch in range that passes it wins; otherwise the nearest one.
function pickBranch(settings, loc, prefer) {
  const list = usableBranches(settings).map((b) => ({ b, km: distanceKm({ lat: parseFloat(b.lat), lng: parseFloat(b.lng) }, loc) }));
  if (!list.length) return { none: true };
  const inRange = list.filter((x) => x.km <= store.branchRadiusKm(x.b)).sort((a, b) => a.km - b.km);
  const best = prefer ? inRange.find((x) => prefer(x.b)) : null;
  if (best) return { branch: best.b, km: best.km, skipped: inRange[0].b.id !== best.b.id ? inRange[0].b : null };
  if (inRange.length) return { branch: inRange[0].b, km: inRange[0].km };
  const nearest = list.sort((a, b) => a.km - b.km)[0];
  return { outside: true, branch: nearest.b, km: nearest.km };
}

const pickupBranches = (settings) => settings.branches.filter((b) => b.active && b.address);

async function buildQuote({ items, phone, couponCode, location, member, fulfilment, deliveryOption, pickupBranchId, pickupAt, usePoints }) {
  const [settings, rawProducts, coupons, customers] = await Promise.all([store.getSettings(), store.getProducts(), store.getCoupons(), store.getCustomers()]);
  const products = await store.withStock(rawProducts, settings.branches);
  // stock is checked per branch below, once we know which shop prepares the order
  const noStock = products.map((p) => ({ ...p, stock: null }));
  const e164 = member ? member.phone : normalizePhone(phone);
  const welcome = await members.welcomeStatus(settings, member || null);
  const cart = priceCart({ items, phone: e164, couponCode, products: noStock, coupons, customers, settings, welcome });
  const pickupOn = !!settings.pickup?.enabled && pickupBranches(settings).length > 0;
  const mode = fulfilment === 'pickup' && pickupOn ? 'pickup' : 'delivery';
  const result = {
    fulfilment: mode, pickupAvailable: pickupOn,
    lines: cart.lines, subtotalSen: cart.subtotalSen, discounts: cart.discounts, discountSen: cart.discountSen,
    couponCode: cart.couponCode, couponError: cart.couponError || '', couponMessage: cart.couponMessage || '',
    welcomeApplied: cart.welcomeApplied, welcomeMessage: cart.welcomeMessage || '',
    errors: cart.errors, weightKg: cart.weightKg, deliverySen: null, deliveryError: '', branch: null,
    deliveryOptions: [], deliveryOption: 'regular',
  };

  // ---- loyalty points (members) ----
  const afterDiscount = cart.subtotalSen - cart.discountSen;
  const L = settings.loyalty || {};
  result.points = { enabled: !!L.enabled, available: member?.points || 0, used: 0, sen: 0, earned: 0, redeemPoints: Number(L.redeemPoints) || 100, redeemValue: Number(L.redeemValue) || 0 };
  if (member && L.enabled) {
    const r = pointsRedemption(L, member.points || 0, afterDiscount);
    result.points.canUse = r.pointsUsed;
    result.points.canUseSen = r.sen;
    if (usePoints && r.pointsUsed) { result.points.used = r.pointsUsed; result.points.sen = r.sen; }
    result.points.earned = pointsEarned(L, afterDiscount - result.points.sen);
  }

  const serviceType = cart.weightKg > Number(settings.heavyOrderKg || Infinity) ? settings.heavyServiceType : settings.serviceType;
  result.serviceType = serviceType;

  if (mode === 'pickup') {
    // ---- self pickup ----
    const branches = pickupBranches(settings);
    result.pickupBranches = branches.map((b) => ({ id: b.id, name: b.name, address: b.address, lat: b.lat, lng: b.lng }));
    const branch = branches.find((b) => b.id === pickupBranchId) || branches[0];
    result.branch = { id: branch.id, name: branch.name };
    result.errors.push(...stockErrors(cart.lines, products, branch));
    result.pickupSlots = pickupSlots(settings);
    const slot = result.pickupSlots.find((s) => s.at === pickupAt);
    if (slot) result.pickupAt = slot.at;
    else result.pickupError = result.pickupSlots.length ? 'Choose a pickup time.' : 'No pickup times available right now.';
    result.deliverySen = 0;
  } else {
    // ---- delivery ----
    const lat = parseFloat(location?.lat), lng = parseFloat(location?.lng);
    if (isFinite(lat) && isFinite(lng)) {
      const loc = { lat, lng, address: location.address };
      const pick = pickBranch(settings, loc, (br) => canServe(cart.lines, products, br));
      if (pick.none) result.deliveryError = 'Delivery is not available yet. Please WhatsApp us to order.';
      else if (pick.outside) {
        result.outOfArea = true;
        result.deliveryError = `Sorry, this address is outside our delivery area. ${settings.deliveryAreaNote || ''} (about ${Math.round(pick.km)} km from our ${pick.branch.name} shop)${pickupOn ? ' You can choose Self pickup instead.' : ''}`.replace(/\s+/g, ' ').trim();
      } else {
        const branch = pick.branch;
        result.branch = { id: branch.id, name: branch.name };
        result.errors.push(...stockErrors(cart.lines, products, branch));
        if (pick.skipped) result.branchNote = `Sent from our ${branch.name} shop (${pick.skipped.name} has run out of something in your order).`;
        const buffer = Number(settings.deliveryMarkup || 0);
        try {
          const q = await deliveryQuote(branch, loc, serviceType, settings.specialRequests);
          result.deliveryQuoteRM = q.totalRM;
          result.distanceKm = Math.round(q.distanceM / 100) / 10;
          const prep = Number(settings.prepMinutes) || 0;
          // Same three choices as the Lalamove app. Prices come straight from Lalamove (+ the delivery buffer).
          const [prio, pool] = await Promise.all([
            settings.priority?.enabled ? deliveryQuote(branch, loc, serviceType, settings.specialRequests, '2').catch((e) => { console.warn('priority quote failed', e.code || e.message); return null; }) : null,
            settings.saver?.enabled && settings.saver.serviceType ? deliveryQuote(branch, loc, settings.saver.serviceType, settings.saver.specialRequests || settings.specialRequests).catch((e) => { console.warn('pooling quote failed', e.message); return null; }) : null,
          ]);
          if (prio && prio.totalRM > q.totalRM) result.deliveryOptions.push({ id: 'priority', label: 'Priority', desc: 'Match faster for quick deliveries', feeSen: toSen(prio.totalRM + buffer), quoteRM: prio.totalRM });
          result.deliveryOptions.push({ id: 'regular', label: 'Regular', desc: prep ? `Driver collects about ${prep} min after you pay` : 'Driver comes right after you pay', feeSen: toSen(q.totalRM + buffer), quoteRM: q.totalRM });
          if (pool) result.deliveryOptions.push({ id: 'saver', label: 'Pooling', desc: 'Save more. Delivered in 4–6 hours', feeSen: toSen(pool.totalRM + buffer), quoteRM: pool.totalRM });
          const chosen = result.deliveryOptions.find((o) => o.id === deliveryOption) || result.deliveryOptions.find((o) => o.id === 'regular');
          result.deliveryOption = chosen.id;
          result.deliverySen = chosen.feeSen;
          result.deliveryQuoteRM = chosen.quoteRM;
        } catch (e) {
          console.error('quote failed', e.code, e.message);
          result.deliveryError = e.code === 'ERR_OUT_OF_SERVICE_AREA' ? e.message : 'Could not get a delivery price for this address. Please check the address or WhatsApp us.';
        }
      }
    }
  }
  result.totalSen = result.subtotalSen - result.discountSen - result.points.sen + (result.deliverySen || 0);
  return { result, settings, phone: e164 };
}

module.exports = { buildQuote, pickBranch };
