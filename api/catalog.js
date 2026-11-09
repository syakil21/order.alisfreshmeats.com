// GET /api/catalog — menu, shop status and public settings for the shop page.
const store = require('../lib/store');
const members = require('../lib/members');
const { send, handler } = require('../lib/http');
const { shopOpen, usableBranches } = require('../lib/util');

module.exports = handler(async (req, res) => {
  const [settings, products] = await Promise.all([store.getSettings(), store.getProducts()]);
  const status = shopOpen(settings);
  const welcome = await members.welcomeStatus(settings, null);
  send(res, 200, {
    shop: { name: settings.shopName, whatsapp: settings.whatsapp, checkoutNote: settings.checkoutNote, minOrder: Number(settings.minOrder) || 0, deliveryAreaNote: settings.deliveryAreaNote || '' },
    open: status.open,
    openMessage: status.message,
    deliveryReady: usableBranches(settings).length > 0,
    branches: usableBranches(settings).map((b) => b.name),
    mapsKey: process.env.GOOGLE_MAPS_API_KEY || '',
    welcome: welcome.enabled && welcome.remaining > 0 ? { amount: welcome.amountSen / 100, minSpend: welcome.minSpendSen / 100, remaining: welcome.remaining } : null,
    cutting: settings.cutting,
    products: products
      .filter((p) => p.available)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      .map(({ id, category, name, note, price, unit, step, min, cuts, image }) => ({ id, category, name, note, price, unit, step, min, cuts: !!cuts, image: image ? `/api/image?id=${image}` : '' })),
  });
});
