// Data access for settings, products, coupons, customer discounts and orders.
const db = require('./db');

const DEFAULT_SETTINGS = {
  shopName: "Ali's Fresh Meats",
  whatsapp: '60162053786',
  acceptingOrders: true,
  // Ordering hours (Malaysia time). closedDays: 0 = Sunday … 6 = Saturday
  hours: { open: '09:00', close: '18:00', closedDays: [] },
  prepMinutes: 30, // Lalamove pickup is scheduled this many minutes after payment (0 = driver comes immediately)
  serviceType: 'MOTORCYCLE',
  heavyOrderKg: 15, // orders heavier than this use heavyServiceType
  heavyServiceType: 'CAR',
  specialRequests: '', // comma-separated Lalamove special request keys, e.g. an insulated bag key from Get City Info
  deliveryMarkup: 0, // RM added on top of the Lalamove fee (0 = pass through at cost)
  minOrder: 0, // RM, items subtotal
  stackDiscounts: false, // false: customer gets the better of member discount or coupon; true: both apply
  checkoutNote: 'Every order is cut and weighed fresh. Final weight may vary slightly.',
  label: { widthMm: 50, heightMm: 30, perItem: false },
  branches: [
    { id: 'selayang', name: 'Selayang', address: '', lat: '', lng: '', phone: '+60162053786', printerId: '', active: true },
    { id: 'brickfields', name: 'Brickfields', address: '', lat: '', lng: '', phone: '+60162053786', printerId: '', active: true },
  ],
};

// From the current price lists
const SEED_PRODUCTS = [
  ['Local Fresh Meat', 'Bone-in Lamb Premium', 'Leg + chops + ribs + liver', 70, 'kg'],
  ['Local Fresh Meat', 'Leg / Shoulder Only (Bone-in)', '', 75, 'kg'],
  ['Local Fresh Meat', 'Boneless Meat', '', 85, 'kg'],
  ['Local Fresh Meat', 'Head', '1 set', 30, 'set'],
  ['Local Fresh Meat', 'Feet', '1 set', 24, 'set'],
  ['Local Fresh Meat', 'Tripe', '', 30, 'kg'],
  ['Local Fresh Meat', 'Liver Set', '', 66, 'kg'],
  ['Local Fresh Meat', 'Brain', '1 piece', 10, 'pc'],
  ['Local Fresh Meat', 'Spleen', '1 piece', 8, 'pc'],
  ['Local Fresh Meat', 'Minced Meat (Local)', '', 88, 'kg'],
  ['Imported Mutton', 'Bone-in Mutton', 'Leg + chops + ribs mixed', 44, 'kg'],
  ['Imported Mutton', 'Mutton Chops', '', 40, 'kg'],
  ['Imported Mutton', 'Mutton Rib Bone', '', 38, 'kg'],
  ['Imported Mutton', 'Bone-in Mutton Leg Only', '', 46, 'kg'],
  ['Imported Mutton', 'Boneless Mutton Leg', '', 58, 'kg'],
  ['Imported Mutton', 'Minced Meat (Mutton)', '', 50, 'kg'],
  ['Imported Mutton', 'Mutton Tripe', '', 18, 'kg'],
  ['Imported Mutton', 'Mutton Leg Bones (Marrow)', '', 20, 'kg'],
  ['Lamb Selection', 'Lamb Shank', '', 42, 'kg'],
  ['Lamb Selection', 'Lamb Chop Shoulder Slices', '', 40, 'kg'],
].map(([category, name, note, price, unit], i) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
  category, name, note, price, unit,
  step: unit === 'kg' ? 0.5 : 1,
  min: unit === 'kg' ? 0.5 : 1,
  available: true,
  sort: i,
}));

function mergeSettings(saved) {
  const s = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  s.hours = { ...DEFAULT_SETTINGS.hours, ...(saved?.hours || {}) };
  s.label = { ...DEFAULT_SETTINGS.label, ...(saved?.label || {}) };
  if (!Array.isArray(s.branches) || !s.branches.length) s.branches = DEFAULT_SETTINGS.branches;
  return s;
}

async function getSettings() { return mergeSettings(await db.get('settings')); }
async function saveSettings(s) { const m = mergeSettings(s); await db.set('settings', m); return m; }

async function getProducts() {
  const p = await db.get('products');
  if (Array.isArray(p)) return p;
  await db.set('products', SEED_PRODUCTS);
  return SEED_PRODUCTS;
}
async function saveProducts(list) { await db.set('products', list); return list; }

async function getCoupons() { return (await db.get('coupons')) || {}; }
async function saveCoupons(c) { await db.set('coupons', c); return c; }

async function getCustomers() { return (await db.get('customers')) || {}; }
async function saveCustomers(c) { await db.set('customers', c); return c; }

async function getOrder(id) { return id ? db.get(`order:${id}`) : null; }
async function saveOrder(o) { o.updatedAt = Date.now(); await db.set(`order:${o.id}`, o); return o; }
async function listOrders(limit = 100) {
  const ids = await db.zrevrange('orders', 0, limit - 1);
  return (await db.mget(ids.map((id) => `order:${id}`))).filter(Boolean);
}
function addLog(o, msg) { (o.log ||= []).push({ at: Date.now(), msg }); if (o.log.length > 60) o.log.shift(); }

module.exports = {
  DEFAULT_SETTINGS, SEED_PRODUCTS, getSettings, saveSettings, getProducts, saveProducts,
  getCoupons, saveCoupons, getCustomers, saveCustomers, getOrder, saveOrder, listOrders, addLog,
};
