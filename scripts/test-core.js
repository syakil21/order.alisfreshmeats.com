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
console.log('All core tests passed');
