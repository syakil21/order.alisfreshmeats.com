// Full price for a cart: items, discounts, loyalty points, and either delivery (area check + Lalamove
// fee for Standard / Priority / Saver) or self pickup (branch + time slot).
const db = require('./db');
const store = require('./store');
const lalamove = require('./lalamove');
const members = require('./members');
const { priceCart, pointsRedemption, pointsEarned } = require('./pricing');
const { toSen, normalizePhone, usableBranches, distanceKm, pickupSlots } = require('./util');

async function deliveryQuote(branch, loc, serviceType, specialRequests) {
  const key = `q:${branch.id}:${serviceType}:${specialRequests || ''}:${loc.lat.toFixed(4)}:${loc.lng.toFixed(4)}`;
  const cached = await db.get(key);
  if (cached) return cached;
  const q = await lalamove.quote({
    pickup: { lat: branch.lat, lng: branch.lng, address: branch.address },
    dropoff: { lat: loc.lat, lng: loc.lng, address: loc.address || 'Customer address' },
    serviceType, specialRequests,
  });
  const out = { totalRM: q.totalRM, distanceM: q.distanceM };
  await db.set(key, out, { ex: 240 });
  return out;
}

// Nearest active branch whose delivery radius covers the address.
function pickBranch(settings, loc) {
  const list = usableBranches(settings).map((b) => ({ b, km: distanceKm({ lat: parseFloat(b.lat), lng: parseFloat(b.lng) }, loc) }));
  if (!list.length) return { none: true };
  const inRange = list.filter((x) => x.km <= store.branchRadiusKm(x.b)).sort((a, b) => a.km - b.km);
  if (inRange.length) return { branch: inRange[0].b, km: inRange[0].km };
  const nearest = list.sort((a, b) => a.km - b.km)[0];
  return { outside: true, branch: nearest.b, km: nearest.km };
}

const pickupBranches = (settings) => settings.branches.filter((b) => b.active && b.address);

async function buildQuote({ items, phone, couponCode, location, member, fulfilment, deliveryOption, pickupBranchId, pickupAt, usePoints }) {
  const [settings, products, coupons, customers] = await Promise.all([store.getSettings(), store.getProducts(), store.getCoupons(), store.getCustomers()]);
  const e164 = member ? member.phone : normalizePhone(phone);
  const welcome = await members.welcomeStatus(settings, member || null);
  const cart = priceCart({ items, phone: e164, couponCode, products, coupons, customers, settings, welcome });
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
      const pick = pickBranch(settings, loc);
      if (pick.none) result.deliveryError = 'Delivery is not available yet. Please WhatsApp us to order.';
      else if (pick.outside) {
        result.outOfArea = true;
        result.deliveryError = `Sorry, this address is outside our delivery area. ${settings.deliveryAreaNote || ''} (about ${Math.round(pick.km)} km from our ${pick.branch.name} shop)${pickupOn ? ' You can choose Self pickup instead.' : ''}`.replace(/\s+/g, ' ').trim();
      } else {
        const branch = pick.branch;
        result.branch = { id: branch.id, name: branch.name };
        const buffer = Number(settings.deliveryMarkup || 0);
        try {
          const q = await deliveryQuote(branch, loc, serviceType, settings.specialRequests);
          result.deliveryQuoteRM = q.totalRM;
          result.distanceKm = Math.round(q.distanceM / 100) / 10;
          const regular = toSen(q.totalRM + buffer);
          const prep = Number(settings.prepMinutes) || 0;
          result.deliveryOptions.push({ id: 'regular', label: 'Standard', desc: prep ? `Driver collects about ${prep} min after you pay` : 'Driver comes right after you pay', feeSen: regular });
          if (settings.priority?.enabled && Number(settings.priority.fee) > 0) {
            result.deliveryOptions.push({ id: 'priority', label: 'Priority', desc: 'Faster driver matching', feeSen: regular + toSen(settings.priority.fee) });
          }
          if (settings.saver?.enabled && settings.saver.serviceType) {
            try {
              const s = await deliveryQuote(branch, loc, settings.saver.serviceType, settings.saver.specialRequests || settings.specialRequests);
              result.deliveryOptions.push({ id: 'saver', label: 'Saver', desc: 'Pooled with other deliveries, arrives within 4 to 6 hours', feeSen: toSen(s.totalRM + buffer), quoteRM: s.totalRM });
            } catch (e) { console.warn('saver quote failed', e.message); }
          }
          const chosen = result.deliveryOptions.find((o) => o.id === deliveryOption) || result.deliveryOptions[0];
          result.deliveryOption = chosen.id;
          result.deliverySen = chosen.feeSen;
          if (chosen.quoteRM) result.deliveryQuoteRM = chosen.quoteRM;
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
