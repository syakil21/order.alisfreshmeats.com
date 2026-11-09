// Full price for a cart + delivery address: items, discounts, delivery area check, Lalamove delivery fee.
const db = require('./db');
const store = require('./store');
const lalamove = require('./lalamove');
const members = require('./members');
const { priceCart } = require('./pricing');
const { toSen, normalizePhone, usableBranches, distanceKm } = require('./util');

async function deliveryQuote(settings, branch, loc, serviceType) {
  const key = `q:${branch.id}:${serviceType}:${loc.lat.toFixed(4)}:${loc.lng.toFixed(4)}`;
  const cached = await db.get(key);
  if (cached) return cached;
  const q = await lalamove.quote({
    pickup: { lat: branch.lat, lng: branch.lng, address: branch.address },
    dropoff: { lat: loc.lat, lng: loc.lng, address: loc.address || 'Customer address' },
    serviceType, specialRequests: settings.specialRequests,
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

async function buildQuote({ items, phone, couponCode, location, member }) {
  const [settings, products, coupons, customers] = await Promise.all([store.getSettings(), store.getProducts(), store.getCoupons(), store.getCustomers()]);
  const e164 = member ? member.phone : normalizePhone(phone);
  const welcome = await members.welcomeStatus(settings, member || null);
  const cart = priceCart({ items, phone: e164, couponCode, products, coupons, customers, settings, welcome });
  const result = {
    lines: cart.lines, subtotalSen: cart.subtotalSen, discounts: cart.discounts, discountSen: cart.discountSen,
    couponCode: cart.couponCode, couponError: cart.couponError || '', couponMessage: cart.couponMessage || '',
    welcomeApplied: cart.welcomeApplied, welcomeMessage: cart.welcomeMessage || '',
    errors: cart.errors, weightKg: cart.weightKg, deliverySen: null, deliveryError: '', branch: null,
  };
  const serviceType = cart.weightKg > Number(settings.heavyOrderKg || Infinity) ? settings.heavyServiceType : settings.serviceType;
  result.serviceType = serviceType;

  const lat = parseFloat(location?.lat), lng = parseFloat(location?.lng);
  if (isFinite(lat) && isFinite(lng)) {
    const loc = { lat, lng, address: location.address };
    const pick = pickBranch(settings, loc);
    if (pick.none) result.deliveryError = 'Delivery is not available yet. Please WhatsApp us to order.';
    else if (pick.outside) {
      result.outOfArea = true;
      result.deliveryError = `Sorry, this address is outside our delivery area. ${settings.deliveryAreaNote || ''} (about ${Math.round(pick.km)} km from our ${pick.branch.name} shop)`.replace(/\s+/g, ' ').trim();
    } else {
      const branch = pick.branch;
      result.branch = { id: branch.id, name: branch.name };
      try {
        const q = await deliveryQuote(settings, branch, loc, serviceType);
        result.deliveryQuoteRM = q.totalRM;
        result.distanceKm = Math.round(q.distanceM / 100) / 10;
        result.deliverySen = toSen(q.totalRM + Number(settings.deliveryMarkup || 0));
      } catch (e) {
        console.error('quote failed', e.code, e.message);
        result.deliveryError = e.code === 'ERR_OUT_OF_SERVICE_AREA' ? e.message : 'Could not get a delivery price for this address. Please check the address or WhatsApp us.';
      }
    }
  }
  result.totalSen = result.subtotalSen - result.discountSen + (result.deliverySen || 0);
  return { result, settings, phone: e164 };
}

module.exports = { buildQuote, pickBranch };
