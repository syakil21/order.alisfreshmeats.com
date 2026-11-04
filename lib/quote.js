// Full price for a cart + delivery address: items, discounts, Lalamove delivery fee.
const db = require('./db');
const store = require('./store');
const lalamove = require('./lalamove');
const { priceCart } = require('./pricing');
const { toSen, normalizePhone, nearestBranch } = require('./util');

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

async function buildQuote({ items, phone, couponCode, location }) {
  const [settings, products, coupons, customers] = await Promise.all([store.getSettings(), store.getProducts(), store.getCoupons(), store.getCustomers()]);
  const e164 = normalizePhone(phone);
  const cart = priceCart({ items, phone: e164, couponCode, products, coupons, customers, settings });
  const result = {
    lines: cart.lines, subtotalSen: cart.subtotalSen, discounts: cart.discounts, discountSen: cart.discountSen,
    couponCode: cart.couponCode, couponError: cart.couponError || '', couponMessage: cart.couponMessage || '',
    errors: cart.errors, weightKg: cart.weightKg, deliverySen: null, deliveryError: '', branch: null,
  };
  const serviceType = cart.weightKg > Number(settings.heavyOrderKg || Infinity) ? settings.heavyServiceType : settings.serviceType;
  result.serviceType = serviceType;

  const lat = parseFloat(location?.lat), lng = parseFloat(location?.lng);
  if (isFinite(lat) && isFinite(lng)) {
    const loc = { lat, lng, address: location.address };
    const branch = nearestBranch(settings, loc);
    if (!branch) result.deliveryError = 'Delivery is not available yet. Please WhatsApp us to order.';
    else {
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

module.exports = { buildQuote };
