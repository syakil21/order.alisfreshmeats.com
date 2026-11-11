// Small order fee, ordering ahead while closed, alerts when a booking or sticker fails, the dashboard's quick
// check, spreadsheet export, end-of-day summary, Bahasa Melayu and the security headers.
// Run with: node scripts/e2e/run.js   (see README.md in this folder)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const B = process.env.BASE || 'http://localhost:3000'; const OUT = process.env.OUT || path.join(__dirname, '.out');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = []; const ok = (c, m) => { if (!c) errors.push(m); console.log(c ? '✓' : '✗', m); };
const J = async (p, body, tok) => { const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) }); return { status: r.status, d: await r.json() }; };
const G = async (p) => (await fetch(B + p)).json();
const billOf = (o) => o.paymentUrl.split('/').pop();
const HOME = { lat: 3.2080, lng: 101.6370, text: '12 Jalan Kepong Baru, 52100 Kuala Lumpur' };

(async () => {
  const tok = (await J('/api/admin', { action: 'login', name: 'Syakil', password: '1234' })).d.token;
  const A = (action, data = {}, t = tok) => J('/api/admin', { action, ...data }, t);
  const pickupOrder = async (items, who) => {
    const q = (await J('/api/quote', { items, fulfilment: 'pickup' })).d;
    return (await J('/api/checkout', { items, fulfilment: 'pickup', pickupBranchId: q.branch.id, pickupAt: q.pickupSlots[0].at, customer: who, address: {} })).d;
  };
  const deliveryOrder = async (items, who) => J('/api/checkout', { items, fulfilment: 'delivery', customer: who, address: HOME });
  const pay = async (o) => { await fetch(`${B}/__mock/billplz/${billOf(o)}/paysilent`); return G(`/api/order?id=${o.orderId}&t=${o.token}`); };

  // ---------- small order fee ----------
  const cat = await G('/api/catalog');
  ok(cat.smallOrder?.feeRM === 1.25 && cat.smallOrder?.belowRM === 50, 'shop knows the small order fee: RM1.25 under RM50');
  let q = (await J('/api/quote', { items: [{ productId: 'feet', qty: 1 }], fulfilment: 'pickup' })).d;
  ok(q.smallOrderSen === 125 && q.totalSen === 2400 + 125, `RM24 cart: fee RM1.25, total RM${(q.totalSen / 100).toFixed(2)}`);
  q = (await J('/api/quote', { items: [{ productId: 'boneless-meat', qty: 1 }], fulfilment: 'pickup' })).d;
  ok(q.smallOrderSen === 0 && q.totalSen === 8500, 'RM85 cart: no fee');
  const small = await pickupOrder([{ productId: 'feet', qty: 1 }], { name: 'Small Cart', phone: '0121110001' });
  const smallPage = await pay(small);
  ok(smallPage.paid && smallPage.smallOrderSen === 125 && smallPage.totalSen === 2525, 'paid order keeps the fee (order page total RM25.25)');
  const so = (await A('order.get', { id: small.orderId })).d.order;
  ok(so.smallOrderSen === 125 && so.payment.paidSen === 2525, 'Billplz was charged RM25.25');

  // ---------- quick check: nothing changed → tiny answer ----------
  let h = (await A('home')).d;
  ok(h.ver > 0 && Array.isArray(h.orders), `dashboard load carries a change counter (${h.ver})`);
  let h2 = (await A('home', { since: h.ver })).d;
  ok(h2.unchanged === true && !h2.orders, 'nothing changed: quick check answers "unchanged" without loading the board');
  ok((await J('/api/admin', { action: 'home', since: h.ver }, 'wrong-token')).status === 401, 'quick check still needs a valid login');
  const big = await pickupOrder([{ productId: 'boneless-meat', qty: 1 }], { name: 'Big Cart', phone: '0121110002' });
  await pay(big);
  h2 = (await A('home', { since: h.ver })).d;
  ok(!h2.unchanged && h2.orders.some((o) => o.id === big.orderId && o.paid) && h2.ver > h.ver, 'new paid order: quick check returns the full board straight away');

  // ---------- alerts when Lalamove or the sticker fails ----------
  await fetch(`${B}/__mock/down/lalamove/on`);
  // the delivery price was looked up while Lalamove still worked, as it is for a real customer
  await fetch(`${B}/__mock/down/lalamove/off`);
  await J('/api/quote', { items: [{ productId: 'boneless-meat', qty: 1 }], fulfilment: 'delivery', location: { lat: HOME.lat, lng: HOME.lng, address: HOME.text } });
  const d1 = (await deliveryOrder([{ productId: 'boneless-meat', qty: 1 }], { name: 'No Driver', phone: '0121110003' })).d;
  await fetch(`${B}/__mock/down/lalamove/on`);
  await pay(d1);
  await fetch(`${B}/__mock/down/lalamove/off`);
  const o1 = (await A('order.get', { id: d1.orderId })).d.order;
  let alerts = await G('/__mock/alerts');
  ok(o1.delivery.status === 'BOOKING_FAILED' && o1.summary.problem === 'Lalamove booking failed', 'Lalamove down at payment: order is flagged "Lalamove booking failed"');
  ok(alerts.some((a) => a.tag === `staff-${o1.no}-delivery` && /NOT booked/.test(a.title) && a.branchId === o1.branchId), `staff phones at ${o1.branchName} get "${alerts.find((a) => /NOT booked/.test(a.title))?.title}"`);
  await fetch(`${B}/__mock/down/print/on`);
  const p1 = await pickupOrder([{ productId: 'boneless-meat', qty: 2 }], { name: 'No Sticker', phone: '0121110004' });
  await pay(p1);
  await fetch(`${B}/__mock/down/print/off`);
  const o2 = (await A('order.get', { id: p1.orderId })).d.order;
  alerts = await G('/__mock/alerts');
  ok(o2.print.status === 'failed' && o2.summary.problem === 'Label not printed', 'printer down at payment: order is flagged "Label not printed"');
  ok(alerts.some((a) => a.tag === `staff-${o2.no}-print` && /sticker did not print/.test(a.title)), `staff phones get "${alerts.find((a) => /sticker/.test(a.title))?.title}"`);
  ok(alerts.filter((a) => /^New order/.test(a.title)).length >= 4, 'the normal new-order alert is still sent for every order');

  // ---------- spreadsheet export ----------
  const ex = (await A('orders.export', { range: 'today' })).d;
  const lines = ex.csv.split('\r\n');
  ok(/^Order no,Date,Time,Branch,/.test(lines[0]) && lines.length === ex.count + 1 && ex.count >= 4, `export: ${ex.count} paid orders, file ${ex.filename}`);
  ok(lines.some((l) => l.startsWith(so.no + ',') && /,1\.25,/.test(l) && /,25\.25,25\.25,/.test(l)), 'export row shows the small order fee and the amount paid');
  ok(!ex.csv.includes(small.token), 'export has no private order links');

  // ---------- checkouts that are never paid ----------
  const np = await pickupOrder([{ productId: 'boneless-meat', qty: 1 }], { name: 'Never Pays', phone: '0121110007' });
  let npPage = await G(`/api/order?id=${np.orderId}&t=${np.token}`);
  ok(!npPage.paid && !npPage.expired && npPage.payUrl && npPage.payBy > Date.now() + 25 * 60000, 'unpaid checkout: customer page says not confirmed, with 30 minutes to pay');
  let npCard = (await A('home')).d.orders.find((x) => x.id === np.orderId);
  ok(npCard.board === 'unpaid' && !npCard.paid && (await G('/__mock/alerts')).every((x) => !x.tag.includes(npCard.no)), 'staff see it only under "Not paid": no alert, no sticker, no booking');
  await fetch(`${B}/__mock/age/${np.orderId}/31`);
  npPage = await G(`/api/order?id=${np.orderId}&t=${np.token}`);
  ok(npPage.expired === true && npPage.payUrl === '' && npPage.stage === 'expired', '31 minutes later: cancelled automatically, payment link removed');
  ok((await fetch(`${B}/__mock/billplz/${billOf(np)}/paysilent`)).status === 404, 'its Billplz bill is closed and can no longer be paid');
  npCard = (await A('home')).d.orders.find((x) => x.id === np.orderId);
  ok(npCard.paymentStatus === 'expired' && npCard.stageText === 'Not paid: cancelled automatically', `dashboard card: "${npCard.stageText}"`);
  // paid at the bank but the notice never reached us: the last check finds the payment instead of cancelling
  const late = await pickupOrder([{ productId: 'boneless-meat', qty: 2 }], { name: 'Paid Late Notice', phone: '0121110008' });
  await fetch(`${B}/__mock/billplz/${billOf(late)}/paysilent`); await fetch(`${B}/__mock/age/${late.orderId}/45`);
  const sw = await G('/__mock/sweep');
  const lateO = (await A('order.get', { id: late.orderId })).d.order;
  ok(sw.due >= 1 && lateO.payment.status === 'paid' && lateO.fulfilledAt, 'a checkout that WAS paid is never cancelled: the sweep confirms it and prints the sticker');
  // a second unpaid one is cancelled by the timer sweep without anyone opening a page
  const np2 = await pickupOrder([{ productId: 'boneless-meat', qty: 3 }], { name: 'Never Pays Too', phone: '0121110009' });
  await fetch(`${B}/__mock/age/${np2.orderId}/40`); await G('/__mock/sweep');
  ok((await A('order.get', { id: np2.orderId })).d.order.payment.status === 'expired', 'the server timer cancels unpaid checkouts on its own');

  // ---------- advance order: delivery on a later day ----------
  const loc = { lat: HOME.lat, lng: HOME.lng, address: HOME.text };
  q = (await J('/api/quote', { items: [{ productId: 'boneless-meat', qty: 1 }], fulfilment: 'delivery', location: loc })).d;
  const dDays = [...new Set((q.deliverySlots || []).map((x) => x.day))];
  ok(dDays.length === 7 && !q.scheduledFor && q.deliveryOptions.length >= 2, `delivery quote offers later times on ${dDays.length} days (${dDays[1]} … ${dDays[6]})`);
  const slot = q.deliverySlots.filter((x) => x.day === dDays[2])[1];
  q = (await J('/api/quote', { items: [{ productId: 'boneless-meat', qty: 1 }], fulfilment: 'delivery', location: loc, deliverAt: slot.at })).d;
  ok(q.deliverAt === slot.at && q.scheduledFor === slot.at && q.deliveryOptions.length === 1 && q.deliveryOptions[0].desc === `Driver collects around ${slot.label}`, `chosen time ${slot.label}: one delivery option, "${q.deliveryOptions[0].desc}"`);
  const stockBefore = (await G('/api/catalog')).products.find((x) => x.id === 'head').stock;
  const adv = await J('/api/checkout', { items: [{ productId: 'boneless-meat', qty: 1 }, { productId: 'head', qty: 1 }], fulfilment: 'delivery', deliverAt: slot.at, customer: { name: 'Plan Ahead', phone: '0121110006' }, address: HOME });
  ok(adv.status === 200, 'advance order checks out');
  const advPage = await pay(adv.d);
  const o4 = (await A('order.get', { id: adv.d.orderId })).d.order;
  ok(o4.advance && o4.scheduledFor === slot.at && o4.delivery.status === 'ASSIGNING_DRIVER' && o4.delivery.scheduleAt === slot.at, `paid: Lalamove booked for ${slot.label}`);
  ok(advPage.preorder && advPage.advance && advPage.pickupAt === slot.at, 'order page shows the chosen time');
  ok(stockBefore == null || (await G('/api/catalog')).products.find((x) => x.id === 'head').stock === stockBefore - 1, 'stock is taken when the customer pays');
  ok((await G('/__mock/alerts')).some((x) => x.tag === `staff-${o4.no}` && x.body.includes(`Delivery for ${slot.label}`)), `staff alert: "Delivery for ${slot.label}"`);
  const badTime = await J('/api/checkout', { items: [{ productId: 'boneless-meat', qty: 2 }], fulfilment: 'delivery', deliverAt: new Date(Date.now() - 3600000).toISOString(), customer: { name: 'Plan Ahead', phone: '0121110006' }, address: HOME });
  ok(badTime.status === 400 && /no longer available/.test(badTime.d.error), `a time that has passed is refused: "${badTime.d.error}"`);
  const h4 = (await A('home')).d.orders.find((x) => x.id === o4.id);
  ok(h4.board === 'preparing' && h4.preorder && h4.pickupAt === slot.at && !h4.problem, 'dashboard has it as a later order with no problem flag');

  // ---------- browser: shop, fee, Bahasa Melayu ----------
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, locale: 'en-MY' });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  await ctx.route(/cdnjs\.cloudflare\.com|tile\.openstreetmap\.org|photon\.komoot\.io/, (r) => r.abort());
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push('shop pageerror: ' + e.message));
  await p.goto(B + '/'); await p.waitForSelector('.item');
  await p.click('.item[data-id="feet"] [data-quick]');
  await p.click('#openCart'); await p.click('#fulfilSeg [data-ful="pickup"]');
  await p.waitForSelector('[data-pslot]'); await p.click('[data-pslot]');
  await p.waitForFunction(() => /^Pay RM/.test(document.querySelector('#payBtn').textContent));
  let sum = await p.textContent('#sum');
  ok(/Small order fee/.test(sum) && /RM 1\.25/.test(sum) && /Add RM 26\.00 more to remove this fee/.test(sum), 'checkout shows the fee and how much more removes it');
  ok((await p.textContent('#payBtn')).trim() === 'Pay RM 25.25', 'Pay button: RM 25.25');
  await p.screenshot({ path: `${OUT}/20-small-order-fee.png` });
  await p.click('#sheet button.x');
  ok((await p.textContent('#langBtn')).trim() === 'BM', 'language button on the shop page');
  await p.click('#langBtn'); await p.waitForSelector('.item');
  await p.waitForFunction(() => document.querySelector('#cartbar').textContent.includes('Lihat troli'));
  ok(await p.evaluate(() => document.documentElement.lang) === 'ms' && /Tambah/.test(await p.textContent('.item[data-id="head"] .ctl')), 'Bahasa Melayu: menu buttons translated');
  await p.click('#openCart');
  await p.waitForFunction(() => /Caj pesanan kecil/.test(document.querySelector('#sum').textContent));
  sum = await p.textContent('#sum');
  ok(/Caj pesanan kecil/.test(sum) && /Tambah RM 26\.00 lagi untuk elak caj ini/.test(sum) && /Jumlah kecil/.test(sum), 'Bahasa Melayu: checkout summary translated');
  ok(/Ambil sendiri/.test(await p.textContent('#fulfilSeg')) && /Maklumat anda/.test(await p.textContent('#sheet')), 'Bahasa Melayu: checkout headings translated');
  const left = await p.evaluate(() => [...document.querySelectorAll('#sheet h4, #sheet button, #sheet label span')].map((e) => e.textContent.trim()).filter((t) => /^(Items|Delivery|Self pickup|Your details|Discounts|Apply|Remove|Name|Phone|Pickup time|Pick up from)$/.test(t)));
  ok(left.length === 0, `no English left on the main checkout labels${left.length ? ': ' + left.join(', ') : ''}`);
  await p.screenshot({ path: `${OUT}/21-bahasa-melayu.png` });
  await p.click('#sheet button.x');
  await p.click('#langBtn'); await p.waitForSelector('.item');
  ok(/View cart/.test(await p.textContent('#cartbar')), 'switching back to English works');
  // advance order on the checkout page (address remembered from an earlier visit)
  const LEAF = path.dirname(require.resolve('leaflet/dist/leaflet.js'));
  await ctx.unroute(/cdnjs\.cloudflare\.com|tile\.openstreetmap\.org|photon\.komoot\.io/);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet/, (r) => { const css = r.request().url().endsWith('.css'); r.fulfill({ path: `${LEAF}/${css ? 'leaflet.css' : 'leaflet.js'}`, contentType: css ? 'text/css' : 'text/javascript' }); });
  await ctx.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ path: path.join(__dirname, 'tile.png'), contentType: 'image/png' }));
  await ctx.route(/photon\.komoot\.io/, (r) => r.fulfill({ body: '{"features":[]}', contentType: 'application/json' }));
  await p.evaluate((a) => { localStorage.setItem('afm_details', JSON.stringify({ name: 'Plan Ahead', phone: '0121110006', address: a })); localStorage.setItem('afm_prefs', JSON.stringify({ fulfilment: 'delivery' })); }, { text: HOME.text, lat: HOME.lat, lng: HOME.lng });
  await p.reload(); await p.waitForSelector('.item');
  await p.click('.item[data-id="boneless-meat"] [data-open]'); await p.click('#itemAdd');
  await p.click('#openCart'); await p.waitForSelector('#whenBox:not([hidden]) [data-when="later"]', { timeout: 20000 });
  ok(/As soon as possible/.test(await p.textContent('#whenSeg')) && await p.isHidden('#laterBox'), 'checkout asks "When do you want it?" with "As soon as possible" chosen');
  await p.click('[data-when="later"]');
  await p.waitForFunction(() => document.querySelector('#payBtn').textContent.trim() === 'Choose a delivery time', null, { timeout: 15000 }).catch(() => {});
  ok((await p.textContent('#payBtn')).trim() === 'Choose a delivery time' && await p.isDisabled('#payBtn'), 'choosing later: Pay waits for a time');
  await p.click(`[data-dday="${dDays[2]}"]`); await p.click(`[data-dslot="${slot.at}"]`);
  await p.waitForFunction(() => /^Pay RM/.test(document.querySelector('#payBtn').textContent));
  ok((await p.textContent('#whenMsg')).includes(`Driver leaves our shop around ${slot.label}`) && (await p.textContent('#sum')).includes(`Driver collects around ${slot.label}`) && await p.isHidden('#speed'), `day and time picked: "${(await p.textContent('#whenMsg')).trim()}"`);
  await p.screenshot({ path: `${OUT}/24-advance-order.png` });
  await p.click('[data-when="now"]');
  await p.waitForFunction(() => !document.querySelector('#speed').hidden);
  ok(!(await p.textContent('#sum')).includes('Driver collects around'), 'back to "As soon as possible" restores the normal options');
  await p.click('#sheet button.x');
  // order page shows the fee
  const op = await ctx.newPage();
  await op.goto(`${B}/order.html?id=${small.orderId}&t=${small.token}`); await op.waitForSelector('.status-card');
  ok(/Small order fee/.test(await op.textContent('.status-card')), 'order page lists the small order fee');

  // ---------- browser: dashboard ----------
  const actx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await actx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  const a = await actx.newPage(); a.on('pageerror', (e) => errors.push('admin pageerror: ' + e.message));
  await a.goto(B + '/admin.html'); await a.fill('#lname', 'Syakil'); await a.fill('#pass', '1234'); await a.click('#loginForm button');
  await a.waitForSelector('#storeTitle'); await a.waitForSelector('.oc');
  const bar = await a.textContent('#attnBar');
  await a.click('#boardTabs [data-board="later"]');
  ok(/For later/.test(await a.textContent('#boardTabs')) && (await a.textContent('#board')).includes(o4.no) && /Lalamove booked for/.test(await a.textContent('#board')), 'dashboard "For later" tab lists the advance order: "Lalamove booked for …"');
  await a.screenshot({ path: `${OUT}/25-for-later.png` });
  ok(/2 orders need attention/.test(bar) && bar.includes(o1.no) && bar.includes(o2.no), 'red bar on Home: "2 orders need attention" with both order numbers');
  await a.screenshot({ path: `${OUT}/22-attention-bar.png` });
  await a.click('#attnBar');
  ok((await a.locator('#board .oc').count()) === 2 && await a.locator('#attnBar').isHidden(), 'clicking the bar opens "Needs attention"');
  await a.click('.nav [data-tab="insights"]'); await a.waitForSelector('#insights .tile');
  const [dl] = await Promise.all([a.waitForEvent('download'), a.click('#exportBtn')]);
  const file = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(file);
  const csv = fs.readFileSync(file, 'utf8');
  ok(/^alis-orders_\d{4}-\d\d-\d\d_to_\d{4}-\d\d-\d\d\.csv$/.test(dl.suggestedFilename()) && csv.charCodeAt(0) === 0xfeff && csv.includes(so.no), `Insights → Download spreadsheet saves ${dl.suggestedFilename()}`);
  ok(/Small order fees collected/.test(await a.textContent('#insights')), 'Insights shows small order fees collected');
  await a.click('.nav [data-tab="settings"]'); await a.waitForSelector('[name="smallOrder.feeRM"]');
  await a.waitForFunction(() => document.querySelector('[name="smallOrder.feeRM"]').value !== '');
  ok(await a.inputValue('[name="smallOrder.feeRM"]') === '1.25' && await a.inputValue('[name="smallOrder.belowRM"]') === '50' && await a.isChecked('[name="preorder.enabled"]') && await a.isChecked('[name="dailySummary.enabled"]'), 'Settings: fee RM1.25 below RM50, orders while closed and daily summary are on');
  // staff cannot export or see sales
  await A('staff.save', { user: { name: 'Kumar', password: 'pass1', role: 'staff', branches: ['brickfields'] } });
  const stok = (await J('/api/admin', { action: 'login', name: 'Kumar', password: 'pass1' })).d.token;
  ok((await A('orders.export', { range: 'today' }, stok)).status === 403, 'normal staff cannot download the spreadsheet');

  // ---------- members only + order confirmation ----------
  let cur = (await A('settings.get')).d.settings;
  await A('settings.save', { settings: { ...cur, requireMember: true } });
  ok((await G('/api/catalog')).requireMember === true, 'members-only ordering switched on');
  const guest = await J('/api/checkout', { items: [{ productId: 'boneless-meat', qty: 1 }], fulfilment: 'pickup', pickupBranchId: 'selayang', pickupAt: (await J('/api/quote', { items: [{ productId: 'boneless-meat', qty: 1 }], fulfilment: 'pickup' })).d.pickupSlots[0].at, customer: { name: 'Guest', phone: '0121110010' }, address: {} });
  ok(guest.status === 401 && guest.d.needLogin && /log in or sign up/i.test(guest.d.error), `a guest cannot check out: "${guest.d.error}"`);
  const gp = await ctx.newPage(); gp.on('pageerror', (e) => errors.push('guest pageerror: ' + e.message));
  await gp.goto(B + '/'); await gp.evaluate(() => { localStorage.removeItem('afm_member'); localStorage.setItem('afm_prefs', JSON.stringify({ fulfilment: 'pickup' })); });
  await gp.reload(); await gp.waitForSelector('.item');
  await gp.click('.item[data-id="head"] [data-quick]'); await gp.click('.item[data-id="boneless-meat"] [data-open]'); await gp.click('#itemAdd');
  await gp.click('#openCart'); await gp.click('#fulfilSeg [data-ful="pickup"]'); await gp.waitForSelector('[data-pslot]'); await gp.click('[data-pslot]');
  await gp.waitForFunction(() => /Log in or sign up to pay/.test(document.querySelector('#payBtn').textContent));
  ok(/Log in or sign up to order/.test(await gp.textContent('#loginBar')) && await gp.isHidden('#guestFields'), 'checkout shows "Log in or sign up to order" instead of the guest name and phone boxes');
  await gp.screenshot({ path: `${OUT}/26-members-only.png` });
  await gp.click('#payBtn'); await gp.waitForSelector('#signupForm:not([hidden])');
  ok(/account\.html\?signup=1/.test(gp.url()), 'the button opens the sign-up page');
  await gp.fill('#signupForm [name="name"]', 'Nurul Member'); await gp.fill('#signupForm [name="phone"]', '0121110011'); await gp.fill('#signupForm [name="password"]', 'secret123');
  await gp.click('#signupForm button');
  await gp.waitForSelector('#sheet.show', { timeout: 20000 }); await gp.waitForSelector('[data-pslot]'); await gp.click('[data-pslot]');
  await gp.waitForFunction(() => /^Pay RM/.test(document.querySelector('#payBtn').textContent));
  ok(/Ordering as/.test(await gp.textContent('#loginBar')) && /Nurul Member/.test(await gp.textContent('#loginBar')), 'after signing up the customer is back at the checkout with the cart kept');
  await gp.click('#payBtn'); await gp.waitForURL(/__mock\/billplz/);
  await gp.goBack(); // left the bank page without paying
  const mid = await gp.evaluate(() => JSON.parse(localStorage.getItem('afm_last') || 'null'));
  await gp.goto(`${B}/order.html?id=${mid.id}&t=${mid.t}`); await gp.waitForSelector('.status-card');
  ok(/Not confirmed yet/.test(await gp.textContent('.status-card')) && !(await gp.locator('.confirmed').count()), 'not paid: the page says "Not confirmed yet" and shows no confirmation');
  await gp.click('.status-card a.bigbtn'); await gp.waitForURL(/__mock\/billplz/); await gp.click('#pay'); await gp.waitForSelector('.confirmed');
  const conf = await gp.textContent('.confirmed');
  ok(/Order confirmed/.test(conf) && /Payment received: RM \d/.test(conf) && /Billplz receipt mb/.test(conf), `paid: "${conf.replace(/\s+/g, ' ').trim()}"`);
  await gp.screenshot({ path: `${OUT}/27-order-confirmed.png` });
  await gp.close();
  await A('settings.save', { settings: { ...cur, requireMember: false } });

  // ---------- map link of each shop ----------
  cur = (await A('settings.get')).d.settings;
  let pb = (await J('/api/quote', { items: [{ productId: 'boneless-meat', qty: 1 }], fulfilment: 'pickup' })).d.pickupBranches;
  ok(pb.every((b) => b.mapsUrl === ''), 'no Google Maps link saved yet: the shop page searches Maps for the shop by name and address');
  await p.reload(); await p.waitForSelector('.item'); // (the member's order above emptied the shared cart)
  await p.click('.item[data-id="boneless-meat"] [data-open]'); await p.click('#itemAdd');
  await p.click('#openCart'); await p.click('#fulfilSeg [data-ful="pickup"]'); await p.waitForSelector('#shopCard a');
  const href0 = await p.getAttribute('#shopCard a', 'href');
  ok(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Ali's%20Fresh%20Meats%20/.test(href0) && !/query=-?\d+\.\d+%2C/.test(href0), `"Open in Maps" searches for the shop, not a bare pin: ${decodeURIComponent(href0).slice(0, 110)}…`);
  cur.branches[0].mapsUrl = 'https://maps.app.goo.gl/AbCdEf123'; cur.branches[1].mapsUrl = 'https://evil.example.com/maps';
  await A('settings.save', { settings: cur });
  pb = (await J('/api/quote', { items: [{ productId: 'boneless-meat', qty: 1 }], fulfilment: 'pickup' })).d.pickupBranches;
  ok(pb[0].mapsUrl === 'https://maps.app.goo.gl/AbCdEf123' && pb[1].mapsUrl === '', 'a pasted Google Maps link is used for that branch; links to other websites are ignored');
  await p.click('#sheet button.x');

  // ---------- end-of-day summary (close the shop first: last order 00:01) ----------
  const settings = (await A('settings.get')).d.settings;
  const closed = { ...settings, hours: { open: '00:00', close: '00:01', closedDays: [] } };
  ok((await A('settings.save', { settings: closed })).status === 200, 'shop hours changed so it is closed now');
  const msg = await G('/__mock/daily');
  alerts = await G('/__mock/alerts');
  ok(msg && /^Today's sales: RM\d/.test(msg.title) && /orders \(\d+ delivery, \d+ pickup\)/.test(msg.body), `daily summary: "${msg?.title} · ${msg?.body}"`);
  ok(alerts.some((x) => /^staff-daily-/.test(x.tag) && x.superOnly), 'daily summary goes to super admins only');
  ok((await G('/__mock/daily')) === null, 'daily summary is sent once a day');

  // ---------- ordering ahead while closed ----------
  const c2 = await G('/api/catalog');
  ok(c2.open === false && c2.preorder === true && /Order ahead for Tomorrow 12:00am/.test(c2.openMessage), `closed: "${c2.openMessage}"`);
  q = (await J('/api/quote', { items: [{ productId: 'boneless-meat', qty: 1 }], fulfilment: 'delivery', location: { lat: HOME.lat, lng: HOME.lng, address: HOME.text } })).d;
  const at = Date.parse(q.scheduledFor);
  ok(q.preorder && q.scheduledText === 'Tomorrow 12:30am' && at > Date.now() && q.deliveryOptions.length === 1 && q.deliveryOptions[0].id === 'regular', `delivery quote while closed: one option, "${q.deliveryOptions[0]?.desc}"`);
  const pre = await deliveryOrder([{ productId: 'boneless-meat', qty: 1 }], { name: 'Night Owl', phone: '0121110005' });
  ok(pre.status === 200, 'customer can check out while the shop is closed');
  const prePage = await pay(pre.d);
  const o3 = (await A('order.get', { id: pre.d.orderId })).d.order;
  ok(o3.preorder && o3.delivery.status === 'ASSIGNING_DRIVER' && o3.delivery.scheduleAt === q.scheduledFor, `Lalamove booked for the next opening time + prep (${o3.delivery.scheduleAt})`);
  const llm = (await G('/__mock/calls')).llm.find((x) => String(x.orderId) === String(o3.delivery.lalamoveOrderId));
  ok(prePage.preorder === true && prePage.pickupAt === q.scheduledFor, 'order page tells the customer when the driver collects');
  ok(alerts.length && (await G('/__mock/alerts')).some((x) => x.tag === `staff-${o3.no}` && /Delivery for Tomorrow 12:30am/.test(x.body)), 'staff alert says it is for tomorrow');
  const slots = (await J('/api/quote', { items: [{ productId: 'boneless-meat', qty: 1 }], fulfilment: 'pickup' })).d.pickupSlots;
  ok(slots.length > 0 && slots[0].day === 'Tomorrow', 'self pickup while closed offers tomorrow\'s times');
  await p.goto(B + '/'); await p.waitForSelector('.item');
  ok(/Closed now · order ahead/.test(await p.textContent('#openChip')) && /Pay now and we prepare your order as soon as we open/.test(await p.textContent('#notice')), 'shop page: "Closed now · order ahead" with an explanation');
  await p.click('#openCart');
  await p.click('#fulfilSeg [data-ful="delivery"]');
  await p.waitForFunction(() => /Driver collects around/.test(document.querySelector('#sum').textContent), null, { timeout: 20000 });
  ok(/We're closed now\. Driver collects around Tomorrow 12:30am/.test(await p.textContent('#sum')), 'closed: checkout says the driver collects when the shop opens');
  await p.click('#fulfilSeg [data-ful="pickup"]'); await p.waitForSelector('[data-pslot]'); await p.click('[data-pslot]');
  await p.waitForFunction(() => /^Pay RM/.test(document.querySelector('#payBtn').textContent));
  ok(await p.isEnabled('#payBtn'), 'Pay button works while closed');
  await p.screenshot({ path: `${OUT}/23-closed-order-ahead.png` });
  await a.click('.nav [data-tab="home"]'); await a.waitForFunction(() => /taking orders ahead/.test(document.querySelector('#storeTitle').textContent), null, { timeout: 20000 });
  ok(true, 'dashboard says "Closed now · taking orders ahead"');
  // switched off → closed means closed
  await A('settings.save', { settings: { ...closed, preorder: { enabled: false } } });
  const no = await deliveryOrder([{ productId: 'boneless-meat', qty: 2 }], { name: 'Night Owl', phone: '0121110005' });
  ok(no.status === 400 && /closed/i.test(no.d.error) && (await G('/api/catalog')).preorder === false, `orders while closed switched off: "${no.d.error}"`);
  await A('settings.save', { settings });
  await browser.close();

  // ---------- security headers (the real server.js) ----------
  const port = 3077;
  const srv = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], { env: { ...process.env, PORT: String(port), ALLOW_MEMORY_DB: '1' }, stdio: 'ignore' });
  try {
    let r; for (let i = 0; i < 30 && !r; i++) { await sleep(200); r = await fetch(`http://localhost:${port}/admin.html`).catch(() => null); }
    const hd = (k) => r.headers.get(k) || '';
    ok(hd('x-frame-options') === 'SAMEORIGIN' && /frame-ancestors 'self'/.test(hd('content-security-policy')), 'other websites cannot show the dashboard inside their page');
    ok(/max-age=\d+/.test(hd('strict-transport-security')) && hd('x-content-type-options') === 'nosniff', 'browsers are told to always use https');
    const og = await (await fetch(`http://localhost:${port}/`)).text();
    const img = await fetch(`http://localhost:${port}/icons/share.jpg`);
    ok(/property="og:image" content="https:\/\/order\.alisfreshmeats\.com\/icons\/share\.jpg"/.test(og) && img.status === 200 && img.headers.get('content-type') === 'image/jpeg', 'link preview tags and picture are served');
  } finally { srv.kill(); }

  console.log(errors.length ? `\n${errors.length} problem(s):\n${errors.join('\n')}` : '\nALL GOOD');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
