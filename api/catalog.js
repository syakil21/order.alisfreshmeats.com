// GET /api/catalog — menu, shop status and public settings for the shop page.
const store = require('../lib/store');
const members = require('../lib/members');
const push = require('../lib/push');
const { send, handler } = require('../lib/http');
const { shopOpen, usableBranches } = require('../lib/util');

module.exports = handler(async (req, res) => {
  const [settings, products] = await Promise.all([store.getSettings(), store.getProducts().then(store.withStock)]);
  const status = shopOpen(settings);
  const welcome = await members.welcomeStatus(settings, null);
  let vapidKey = '';
  try { vapidKey = await push.publicKey(); } catch (e) { console.warn('push key unavailable', e.message); }
  const L = settings.loyalty || {};
  const pickupBranches = settings.pickup?.enabled ? settings.branches.filter((b) => b.active && b.address) : [];
  send(res, 200, {
    shop: { name: settings.shopName, whatsapp: settings.whatsapp, checkoutNote: settings.checkoutNote, minOrder: Number(settings.minOrder) || 0, deliveryAreaNote: settings.deliveryAreaNote || '' },
    open: status.open,
    openMessage: status.message,
    deliveryReady: usableBranches(settings).length > 0,
    branches: usableBranches(settings).map((b) => b.name),
    pickup: pickupBranches.length ? { branches: pickupBranches.map((b) => ({ id: b.id, name: b.name, address: b.address, lat: b.lat, lng: b.lng, phone: b.phone || '' })) } : null,
    priority: !!settings.priority?.enabled,
    loyalty: L.enabled ? { earnPerRM: Number(L.earnPerRM) || 0, redeemPoints: Number(L.redeemPoints) || 100, redeemValue: Number(L.redeemValue) || 0 } : null,
    mapsKey: process.env.GOOGLE_MAPS_API_KEY || '',
    vapidKey,
    welcome: welcome.enabled && welcome.remaining > 0 ? { amount: welcome.amountSen / 100, minSpend: welcome.minSpendSen / 100, remaining: welcome.remaining } : null,
    cutting: settings.cutting,
    products: products
      .filter((p) => p.available)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      .map(({ id, category, name, note, price, unit, step, min, cuts, cutModes, cooking, stock, image }) => ({
        id, category, name, note, price, unit, step, min, cuts: !!cuts, cutModes: cutModes || [], cooking: !!cooking, stock: stock === null ? null : Math.max(0, stock),
        image: image ? `/api/image?id=${image}` : '',
      })),
  });
});
