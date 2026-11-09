// Core checks: Billplz X Signature against Billplz's published samples, Lalamove signing, pricing and coupons.
const assert = require('assert');
const crypto = require('crypto');
const billplz = require('../lib/billplz');
const { priceCart } = require('../lib/pricing');
const { SEED_PRODUCTS } = require('../lib/store');
const { normalizePhone, shopOpen } = require('../lib/util');

const KEY = 'S-s7b4yWpp9h7rrkNM1i3Z_g';
// Billplz docs sample callback → expected signature
const cb = { amount: '100', collection_id: 'yhx5t1pp', due_at: '2018-9-27', email: 'tester@test.com', id: 'zq0tm2wc', mobile: '', name: 'TESTER',
  paid_amount: '100', paid_at: '2018-09-27 15:15:09 +0800', paid: 'true', state: 'paid', url: 'http://www.billplz-sandbox.com/bills/zq0tm2wc' };
assert.strictEqual(billplz.sourceString(cb), 'amount100|collection_idyhx5t1pp|due_at2018-9-27|emailtester@test.com|idzq0tm2wc|mobile|nameTESTER|paid_amount100|paid_at2018-09-27 15:15:09 +0800|paidtrue|statepaid|urlhttp://www.billplz-sandbox.com/bills/zq0tm2wc');
assert.strictEqual(billplz.sign(cb, KEY), '0fe0a20b8d557eeae570377783d062a3816a9ea80f368860bacfa7ec3ca4d00e');
assert.ok(billplz.verify({ ...cb, x_signature: '0fe0a20b8d557eeae570377783d062a3816a9ea80f368860bacfa7ec3ca4d00e' }, KEY));
assert.ok(!billplz.verify({ ...cb, amount: '1', x_signature: '0fe0a20b8d557eeae570377783d062a3816a9ea80f368860bacfa7ec3ca4d00e' }, KEY));
// Billplz docs sample redirect
const rd = { 'billplz[id]': 'zq0tm2wc', 'billplz[paid]': 'true', 'billplz[paid_at]': '2018-09-27 15:15:09 +0800' };
assert.strictEqual(billplz.sourceString(rd), 'billplzidzq0tm2wc|billplzpaid_at2018-09-27 15:15:09 +0800|billplzpaidtrue');
assert.strictEqual(billplz.sign(rd, KEY), '4aab095fe5a39b1d534500988f9a0cb085cd1b6d5bbb55dd4e02ea6fa102b47b');
console.log('✓ Billplz X Signature matches Billplz sample callback + redirect');

// Lalamove signature format (doc example string)
const raw = `1546222219293\r\nPOST\r\n/v3/quotations\r\n\r\n{}`;
assert.strictEqual(crypto.createHmac('sha256', 'sk_test_x').update(raw).digest('hex').length, 64);

// phones
assert.strictEqual(normalizePhone('016-2053786'), '+60162053786');
assert.strictEqual(normalizePhone('+60 12-345 6789'), '+60123456789');
assert.strictEqual(normalizePhone('0312345678'), '+60312345678');
assert.strictEqual(normalizePhone('12345'), '');
console.log('✓ Phone numbers');

// pricing
const settings = { minOrder: 0, stackDiscounts: false };
const items = [{ productId: 'boneless-meat', qty: 1.5 }, { productId: 'head', qty: 1 }];
let r = priceCart({ items, phone: '+60123456789', products: SEED_PRODUCTS, coupons: {}, customers: {}, settings });
assert.strictEqual(r.subtotalSen, 12750 + 3000);
assert.deepStrictEqual(r.errors, []);
r = priceCart({ items: [{ productId: 'boneless-meat', qty: 0.3 }], products: SEED_PRODUCTS, coupons: {}, customers: {}, settings });
assert.ok(r.errors.length, 'rejects 0.3kg');
const coupons = { RAYA10: { code: 'RAYA10', type: 'percent', value: 10, active: true, minSpend: 100 }, FIVE: { code: 'FIVE', type: 'fixed', value: 5, active: true } };
r = priceCart({ items, phone: '+60123456789', couponCode: 'raya10', products: SEED_PRODUCTS, coupons, customers: {}, settings });
assert.strictEqual(r.discountSen, 1575); assert.strictEqual(r.couponCode, 'RAYA10');
r = priceCart({ items: [{ productId: 'brain', qty: 1 }], couponCode: 'RAYA10', products: SEED_PRODUCTS, coupons, customers: {}, settings });
assert.ok(/at least/.test(r.couponError));
const customers = { '+60123456789': { discountPct: 5 } };
r = priceCart({ items, phone: '+60123456789', couponCode: 'RAYA10', products: SEED_PRODUCTS, coupons, customers, settings });
assert.strictEqual(r.discountSen, 1575, 'better of member 5% vs coupon 10%');
r = priceCart({ items, phone: '+60123456789', couponCode: 'FIVE', products: SEED_PRODUCTS, coupons, customers, settings });
assert.strictEqual(r.discountSen, 787); assert.ok(r.couponMessage);
r = priceCart({ items, phone: '+60123456789', couponCode: 'FIVE', products: SEED_PRODUCTS, coupons, customers, settings: { stackDiscounts: true } });
assert.strictEqual(r.discountSen, 787 + 500);
console.log('✓ Pricing, coupons, member discounts');

// opening hours (Malaysia time)
const s = { acceptingOrders: true, hours: { open: '09:00', close: '18:00', closedDays: [] } };
assert.ok(shopOpen(s, Date.parse('2026-11-04T02:00:00Z')).open); // 10am MYT
assert.ok(!shopOpen(s, Date.parse('2026-11-04T12:00:00Z')).open); // 8pm MYT
console.log('✓ Opening hours');

// ---- cutting preferences ----
const { DEFAULT_SETTINGS, branchRadiusKm } = require('../lib/store');
const S = { ...DEFAULT_SETTINGS };
const cutItems = (cut) => [{ productId: 'boneless-meat', qty: 1, cut }];
r = priceCart({ items: cutItems({ by: 'size', size: '2 inch', cooking: 'curry cut', note: '  remove   fat ' }), products: SEED_PRODUCTS, coupons: {}, customers: {}, settings: S });
assert.deepStrictEqual(r.errors, []);
assert.strictEqual(r.lines[0].cutText, '2 inch pieces · Curry cut · "remove fat"');
r = priceCart({ items: cutItems({ by: 'size', size: 'small cubes' }), products: SEED_PRODUCTS, coupons: {}, customers: {}, settings: S });
assert.strictEqual(r.lines[0].cutText, 'small cubes', 'custom size kept as typed');
r = priceCart({ items: cutItems({ by: 'size', size: '1.5 inch' }), products: SEED_PRODUCTS, coupons: {}, customers: {}, settings: S });
assert.strictEqual(r.lines[0].cutText, '1.5 inch pieces');
r = priceCart({ items: cutItems({ by: 'weight', weight: '75' }), products: SEED_PRODUCTS, coupons: {}, customers: {}, settings: S });
assert.strictEqual(r.lines[0].cutText, '75 g per piece');
r = priceCart({ items: cutItems({ by: 'weight', weight: '3' }), products: SEED_PRODUCTS, coupons: {}, customers: {}, settings: S });
assert.ok(/between 5 g and 2000 g/.test(r.errors[0]));
r = priceCart({ items: cutItems({ by: 'size', size: '' }), products: SEED_PRODUCTS, coupons: {}, customers: {}, settings: S });
assert.ok(/piece size/.test(r.errors[0]));
r = priceCart({ items: cutItems({ cooking: 'Rendang' }), products: SEED_PRODUCTS, coupons: {}, customers: {}, settings: S });
assert.ok(/cooking style/.test(r.errors[0]), 'cooking must be from the list');
r = priceCart({ items: [{ productId: 'brain', qty: 1, cut: { by: 'size', size: '2 inch' } }], products: SEED_PRODUCTS, coupons: {}, customers: {}, settings: S });
assert.ok(!r.lines[0].cut, 'cuts ignored on products without cutting options');
r = priceCart({ items: cutItems({ by: '', cooking: '', note: '' }), products: SEED_PRODUCTS, coupons: {}, customers: {}, settings: S });
assert.ok(!r.lines[0].cut, 'empty preference = no cut');
console.log('✓ Cutting preferences');

// ---- new member offer ----
const W = { eligible: true, amountSen: 1500, minSpendSen: 0 };
const two = [{ productId: 'boneless-meat', qty: 1 }]; // RM85
r = priceCart({ items: two, phone: '+60123456789', products: SEED_PRODUCTS, coupons, customers: {}, settings: S, welcome: W });
assert.strictEqual(r.discountSen, 1500); assert.ok(r.welcomeApplied);
r = priceCart({ items: two, phone: '+60123456789', couponCode: 'FIVE', products: SEED_PRODUCTS, coupons, customers: {}, settings: S, welcome: W });
assert.strictEqual(r.discountSen, 1500); assert.ok(/new member offer is better/.test(r.couponMessage));
r = priceCart({ items: two, phone: '+60123456789', couponCode: 'FIVE', products: SEED_PRODUCTS, coupons, customers: {}, settings: { ...S, stackDiscounts: true }, welcome: W });
assert.strictEqual(r.discountSen, 2000, 'stacked offer + coupon');
r = priceCart({ items: [{ productId: 'spleen', qty: 1 }], products: SEED_PRODUCTS, coupons: {}, customers: {}, settings: S, welcome: W });
assert.strictEqual(r.discountSen, 800, 'offer never more than the items');
r = priceCart({ items: two, products: SEED_PRODUCTS, coupons: {}, customers: {}, settings: S, welcome: { ...W, minSpendSen: 10000 } });
assert.strictEqual(r.discountSen, 0); assert.ok(/Spend at least RM100.00/.test(r.welcomeMessage));
r = priceCart({ items: two, products: SEED_PRODUCTS, coupons: {}, customers: {}, settings: S, welcome: { eligible: false } });
assert.strictEqual(r.discountSen, 0); assert.ok(!r.welcomeApplied);
console.log('✓ New member offer');

// ---- delivery radius ----
const { pickBranch } = require('../lib/quote');
const RS = { branches: [
  { id: 'selayang', name: 'Selayang', address: 'x', lat: '3.2490', lng: '101.6480', active: true, radiusKm: 48 },
  { id: 'brickfields', name: 'Brickfields', address: 'x', lat: '3.1290', lng: '101.6857', active: true, radiusKm: 55 },
] };
const at = (lat, lng) => pickBranch(RS, { lat, lng });
assert.strictEqual(at(3.5660, 101.6560).branch.id, 'selayang', 'Kuala Kubu Bharu');
assert.strictEqual(at(3.3417, 101.2500).branch.id, 'selayang', 'Kuala Selangor');
assert.strictEqual(at(2.7259, 101.9378).branch.id, 'brickfields', 'Seremban');
assert.ok(!at(3.5660, 101.6560).outside && !at(3.3417, 101.2500).outside && !at(2.7259, 101.9378).outside);
assert.ok(at(2.5220, 101.7960).outside, 'Port Dickson outside');
assert.ok(at(3.6850, 101.5180).outside, 'Tanjung Malim outside');
assert.ok(at(3.6800, 100.9870).outside, 'Sabak Bernam outside');
assert.strictEqual(branchRadiusKm({ id: 'selayang' }), 48); assert.strictEqual(branchRadiusKm({ id: 'brickfields' }), 55);
console.log('✓ Delivery radius (KKB, Kuala Selangor, Seremban in; Port Dickson, Tanjung Malim out)');

// ---- landscape label turned for the printer ----
const { buildLabel } = require('../lib/label');
const { PDFDocument } = require('pdf-lib');
(async () => {
  const order = { no: 'AFM-1', customer: { name: 'A', phone: '+60123456789' }, branchName: 'Selayang', address: {}, delivery: {}, items: [{ name: 'Boneless Meat', qty: 1, unit: 'kg', cutText: '2 inch pieces · Curry cut' }] };
  const size = async (o) => { const d = await PDFDocument.load(await buildLabel(order, o)); const [w, h] = [d.getPage(0).getWidth(), d.getPage(0).getHeight()]; return [Math.round(w / 2.835), Math.round(h / 2.835)]; };
  assert.deepStrictEqual(await size({ widthMm: 50, heightMm: 30 }), [50, 30]);
  assert.deepStrictEqual(await size({ widthMm: 50, heightMm: 30, rotate90: true }), [30, 50], 'rotated page is portrait');
  assert.deepStrictEqual(await size({ widthMm: 50, heightMm: 30, rotate90: true, preview: true }), [50, 30], 'preview stays landscape');
  console.log('✓ Label page turned 90° for the printer');
  console.log('All core tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
