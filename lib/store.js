// Data access for settings, products, coupons, customer discounts and orders.
const db = require('./db');

// Straight-line delivery radius per branch. Selayang 48 km reaches Kuala Kubu Bharu (~35) and
// Kuala Selangor (~45); Brickfields 55 km reaches Seremban (~53). Editable in Settings → Branches.
const DEFAULT_RADIUS_KM = { selayang: 48, brickfields: 55 };

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
  deliveryAreaNote: 'We deliver up to Kuala Kubu Bharu, Kuala Selangor and Seremban.',
  minOrder: 0, // RM, items subtotal
  stackDiscounts: false, // false: customer gets the single best discount; true: all discounts apply
  // New member offer: RM off the first paid order of a newly registered member, for the first N members
  welcome: { enabled: true, amount: 15, limit: 100, minSpend: 0 },
  // Cutting preferences offered on products that have "Cutting options" ticked
  cutting: {
    sizes: ['1 inch', '2 inch', '3 inch', '4 inch'],
    weights: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100], // grams per piece
    cooking: ['Curry cut', 'Kurma', 'Chukka', 'Briyani'],
  },
  checkoutNote: 'Every order is cut and weighed fresh. Final weight may vary slightly.',
  // widthMm × heightMm = the sticker as you read it. rotate90: the printer feeds it sideways.
  label: { widthMm: 50, heightMm: 30, perItem: false, rotate90: true, flip: false },
  branches: [
    { id: 'selayang', name: 'Selayang', address: '', lat: '', lng: '', phone: '+60162053786', printerId: '', radiusKm: 48, active: true },
    { id: 'brickfields', name: 'Brickfields', address: '', lat: '', lng: '', phone: '+60162053786', printerId: '', radiusKm: 55, active: true },
  ],
};

// Products that get cutting options by default (staff can change per product)
const DEFAULT_CUT_IDS = [
  'bone-in-lamb-premium', 'leg-shoulder-only-bone-in', 'boneless-meat', 'bone-in-mutton', 'mutton-chops', 'mutton-rib-bone',
  'bone-in-mutton-leg-only', 'boneless-mutton-leg', 'lamb-shank', 'lamb-chop-shoulder-slices',
];

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
].map(([category, name, note, price, unit], i) => {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return {
    id, category, name, note, price, unit,
    step: unit === 'kg' ? 0.5 : 1,
    min: unit === 'kg' ? 0.5 : 1,
    cuts: DEFAULT_CUT_IDS.includes(id),
    image: '',
    available: true,
    sort: i,
  };
});

const productCuts = (p) => (typeof p.cuts === 'boolean' ? p.cuts : DEFAULT_CUT_IDS.includes(p.id));
const branchRadiusKm = (b) => Number(b.radiusKm) > 0 ? Number(b.radiusKm) : DEFAULT_RADIUS_KM[b.id] || 50;

function mergeSettings(saved) {
  const s = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  s.hours = { ...DEFAULT_SETTINGS.hours, ...(saved?.hours || {}) };
  s.label = { ...DEFAULT_SETTINGS.label, ...(saved?.label || {}) };
  s.welcome = { ...DEFAULT_SETTINGS.welcome, ...(saved?.welcome || {}) };
  s.cutting = { ...DEFAULT_SETTINGS.cutting, ...(saved?.cutting || {}) };
  if (!Array.isArray(s.branches) || !s.branches.length) s.branches = DEFAULT_SETTINGS.branches;
  s.branches = s.branches.map((b) => ({ ...b, radiusKm: branchRadiusKm(b) }));
  return s;
}

async function getSettings() { return mergeSettings(await db.get('settings')); }
async function saveSettings(s) { const m = mergeSettings(s); await db.set('settings', m); return m; }

async function getProducts() {
  const p = await db.get('products');
  if (Array.isArray(p)) return p.map((x) => ({ ...x, cuts: productCuts(x), image: x.image || '' }));
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
  DEFAULT_SETTINGS, SEED_PRODUCTS, DEFAULT_CUT_IDS, productCuts, branchRadiusKm, getSettings, saveSettings, getProducts, saveProducts,
  getCoupons, saveCoupons, getCustomers, saveCustomers, getOrder, saveOrder, listOrders, addLog,
};
