// Data access for settings, products, coupons, customer discounts and orders.
const db = require('./db');
const activity = require('./activity');

// Straight-line delivery radius per branch. Selayang 48 km reaches Kuala Kubu Bharu (~35) and
// Kuala Selangor (~45); Brickfields 55 km reaches Seremban (~53). Editable in Settings → Branches.
const DEFAULT_RADIUS_KM = { selayang: 48, brickfields: 55 };

const DEFAULT_SETTINGS = {
  shopName: "Ali's Fresh Meats",
  whatsapp: '60162053786',
  acceptingOrders: true,
  pausedUntil: 0, // staff "pause orders" (timestamp)
  // Ordering hours (Malaysia time). closedDays: 0 = Sunday … 6 = Saturday
  hours: { open: '09:00', close: '18:00', closedDays: [] },
  prepMinutes: 30, // Lalamove pickup / earliest self-collection is this many minutes after payment
  serviceType: 'MOTORCYCLE',
  heavyOrderKg: 15, // orders heavier than this use heavyServiceType
  heavyServiceType: 'CAR',
  specialRequests: '', // comma-separated Lalamove special request keys, e.g. an insulated bag key from Get City Info
  deliveryMarkup: 0, // RM buffer added to every Lalamove fee (covers price changes if a delivery has to be rebooked)
  deliveryAreaNote: 'We deliver up to Kuala Kubu Bharu, Kuala Selangor and Seremban.',
  // Delivery speed options shown to customers
  priority: { enabled: true, fee: 5 }, // RM charged and added to Lalamove as a priority fee (faster driver matching)
  saver: { enabled: false, serviceType: '', specialRequests: '' }, // only if Lalamove enables pooling for your API account
  // Self collection at a branch, in time slots
  pickup: { enabled: true, slotMinutes: 30, days: 2 },
  minOrder: 0, // RM, items subtotal
  stackDiscounts: false, // false: customer gets the single best discount; true: all discounts apply
  // New member offer: RM off the first paid order of a newly registered member, for the first N members
  welcome: { enabled: true, amount: 15, limit: 100, minSpend: 0 },
  // Loyalty points for members: earn per RM1 spent on meat, redeem in blocks
  loyalty: { enabled: true, earnPerRM: 1, redeemPoints: 100, redeemValue: 5, maxPct: 50 },
  // Cutting choices. Each product picks which kinds it offers (Prices → Cutting).
  cutting: {
    sizes: ['1 inch', '2 inch', '3 inch', '4 inch'],
    weights: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100], // grams per piece
    splits: ['2 pcs', '3 pcs'], // "cut each piece into"
    thickness: ['0.5 inch', '1 inch', '1.5 inch'],
    cooking: ['Curry cut', 'Kurma', 'Chukka', 'Briyani'],
  },
  checkoutNote: 'Every order is cut and weighed fresh. Final weight may vary slightly.',
  // widthMm × heightMm = the sticker as you read it. rotate90: the printer feeds it sideways.
  label: { widthMm: 80, heightMm: 50, perItem: false, rotate90: true, flip: false, qr: true },
  branches: [
    { id: 'selayang', name: 'Selayang', address: '', lat: '', lng: '', phone: '+60162053786', printerId: '', radiusKm: 48, active: true },
    { id: 'brickfields', name: 'Brickfields', address: '', lat: '', lng: '', phone: '+60162053786', printerId: '', radiusKm: 55, active: true },
  ],
};

// Kinds of cutting a product can offer
const CUT_MODES = ['size', 'weight', 'split', 'count', 'thickness'];
const CUT_MODE_LABELS = { size: 'Piece size', weight: 'Piece weight', split: 'Cut each into', count: 'Number of pieces', thickness: 'Slice thickness' };

// Products that get cutting options by default (staff can change per product)
const DEFAULT_CUT_IDS = [
  'bone-in-lamb-premium', 'leg-shoulder-only-bone-in', 'boneless-meat', 'bone-in-mutton', 'mutton-chops', 'mutton-rib-bone',
  'bone-in-mutton-leg-only', 'boneless-mutton-leg', 'lamb-shank', 'lamb-chop-shoulder-slices',
];
const DEFAULT_CUT_MODES = { 'mutton-leg-bones-marrow': ['split'], 'lamb-chop-shoulder-slices': ['count', 'thickness'] };
// Default most a customer can order of these per order (sets / pieces / kg)
const DEFAULT_MAX = { head: 2, feet: 2, brain: 4, spleen: 4, 'liver-set': 2, tripe: 2, 'mutton-tripe': 2, 'lamb-shank': 4 };

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
].map(([category, name, note, price, unit], i) => normalizeProduct({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
  category, name, note, price, unit, step: unit === 'kg' ? 0.5 : 1, min: unit === 'kg' ? 0.5 : 1, image: '', available: true, sort: i,
}));

// Fill in cutting and cap settings for products saved before these options existed
function normalizeProduct(p) {
  let modes;
  if (Array.isArray(p.cutModes)) modes = p.cutModes.filter((m) => CUT_MODES.includes(m));
  else if (DEFAULT_CUT_MODES[p.id]) modes = DEFAULT_CUT_MODES[p.id];
  else modes = (p.cuts === true || (p.cuts === undefined && DEFAULT_CUT_IDS.includes(p.id))) ? ['size', 'weight'] : [];
  const cooking = typeof p.cooking === 'boolean' ? p.cooking : modes.length > 0 && p.id !== 'mutton-leg-bones-marrow';
  const maxQty = p.maxQty === undefined ? DEFAULT_MAX[p.id] || 0 : Math.max(0, Number(p.maxQty) || 0);
  return { ...p, cutModes: modes, cooking, cuts: modes.length > 0 || cooking, maxQty, image: p.image || '' };
}
const productCuts = (p) => normalizeProduct(p).cuts;
const branchRadiusKm = (b) => Number(b.radiusKm) > 0 ? Number(b.radiusKm) : DEFAULT_RADIUS_KM[b.id] || 50;

function mergeSettings(saved) {
  const s = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  for (const k of ['hours', 'label', 'welcome', 'cutting', 'priority', 'saver', 'pickup', 'loyalty']) s[k] = { ...DEFAULT_SETTINGS[k], ...(saved?.[k] || {}) };
  // the first version assumed 50 × 30 stickers; the shop's stickers are 80 × 50
  if (!s.label.sizeSet && Number(s.label.widthMm) === 50 && Number(s.label.heightMm) === 30) Object.assign(s.label, { widthMm: 80, heightMm: 50, rotate90: true });
  if (!Array.isArray(s.branches) || !s.branches.length) s.branches = DEFAULT_SETTINGS.branches;
  s.branches = s.branches.map((b) => ({ ...b, radiusKm: branchRadiusKm(b) }));
  return s;
}

async function getSettings() { return mergeSettings(await db.get('settings')); }
async function saveSettings(s) { const m = mergeSettings(s); await db.set('settings', m); return m; }

async function getProducts() {
  const p = await db.get('products');
  if (Array.isArray(p)) return p.map(normalizeProduct);
  await db.set('products', SEED_PRODUCTS);
  return SEED_PRODUCTS;
}
async function saveProducts(list) { const l = list.map(normalizeProduct); await db.set('products', l); return l; }

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
// orders created between two timestamps (for Insights)
async function ordersBetween(from, to) {
  const ids = await db.zrangeByScore('orders', from, to);
  const out = [];
  for (let i = 0; i < ids.length; i += 200) out.push(...(await db.mget(ids.slice(i, i + 200).map((id) => `order:${id}`))));
  return out.filter(Boolean);
}
// Order history (shown on the order) + the shop-wide activity log
function addLog(o, msg, type) {
  (o.log ||= []).push({ at: Date.now(), msg }); if (o.log.length > 80) o.log.shift();
  activity.log(type || activity.typeOf(msg), msg, { orderNo: o.no, orderId: o.id });
}

module.exports = {
  DEFAULT_SETTINGS, SEED_PRODUCTS, DEFAULT_CUT_IDS, CUT_MODES, CUT_MODE_LABELS, normalizeProduct, productCuts, branchRadiusKm,
  getSettings, saveSettings, getProducts, saveProducts, getCoupons, saveCoupons, getCustomers, saveCustomers,
  getOrder, saveOrder, listOrders, ordersBetween, addLog,
};
