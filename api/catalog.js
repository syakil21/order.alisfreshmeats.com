// GET /api/catalog — menu, shop status and public settings for the shop page.
const store = require('../lib/store');
const { send, handler } = require('../lib/http');
const { shopOpen, usableBranches } = require('../lib/util');

module.exports = handler(async (req, res) => {
  const [settings, products] = await Promise.all([store.getSettings(), store.getProducts()]);
  const status = shopOpen(settings);
  send(res, 200, {
    shop: { name: settings.shopName, whatsapp: settings.whatsapp, checkoutNote: settings.checkoutNote, minOrder: Number(settings.minOrder) || 0 },
    open: status.open,
    openMessage: status.message,
    deliveryReady: usableBranches(settings).length > 0,
    branches: usableBranches(settings).map((b) => b.name),
    mapsKey: process.env.GOOGLE_MAPS_API_KEY || '',
    products: products
      .filter((p) => p.available)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      .map(({ id, category, name, note, price, unit, step, min }) => ({ id, category, name, note, price, unit, step, min })),
  });
});
