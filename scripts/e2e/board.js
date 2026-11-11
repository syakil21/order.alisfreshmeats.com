// Full walk-through in a real browser against the local mock server (fake Billplz/Lalamove/PrintNode):
// staff dashboard, menu, stock per branch, shop, map, checkout, delivery and pickup, roles, edit/delete, labels.
// Run with: node scripts/e2e/run.js   (see README.md in this folder)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const B = process.env.BASE || 'http://localhost:3000'; const OUT = process.env.OUT || path.join(__dirname, '.out');
fs.mkdirSync(OUT, { recursive: true });
const LEAFLET = path.dirname(require.resolve('leaflet/dist/leaflet.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];
  const ok = (c, m) => { if (!c) { errors.push('FAIL ' + m); console.log('✗', m); } else console.log('✓', m); };
  const watch = (p, tag) => {
    p.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
    p.on('response', (r) => { if (r.status() >= 500) errors.push(`${tag} ${r.status()} ${r.url()}`); });
    p.on('dialog', (d) => d.accept(answers.length ? answers.shift() : d.defaultValue()));
  };
  const answers = []; // next prompt() answers
  let adminTok0 = '';
  const stockOf = async (id) => { const r = await fetch(B + '/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminTok0 }, body: JSON.stringify({ action: 'products.get' }) }); return (await r.json()).products.find((x) => x.id === id).stockBy; };
  // external map resources served locally (the sandbox has no internet)
  async function offline(ctx) {
    await ctx.route('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/**', (r) => {
      const f = r.request().url().endsWith('.css') ? 'leaflet.css' : 'leaflet.js';
      r.fulfill({ path: `${LEAFLET}/${f}`, contentType: f.endsWith('css') ? 'text/css' : 'text/javascript' });
    });
    await ctx.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ path: path.join(__dirname, 'tile.png'), contentType: 'image/png' }));
    await ctx.route('https://photon.komoot.io/**', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/reverse') {
        const lat = Number(u.searchParams.get('lat'));
        return r.fulfill({ json: { features: [{ geometry: { coordinates: [Number(u.searchParams.get('lon')), lat] }, properties: { housenumber: String(Math.round(lat * 1000) % 90 + 1), street: 'Jalan Kepong Baru', district: 'Kepong', postcode: '52100', city: 'Kuala Lumpur', state: 'Kuala Lumpur', countrycode: 'MY' } }] } });
      }
      return r.fulfill({ json: { features: [
        { geometry: { coordinates: [101.6370, 3.2080] }, properties: { name: 'Kepong Baru', street: 'Jalan Kepong', postcode: '52100', city: 'Kuala Lumpur', state: 'Kuala Lumpur', countrycode: 'MY' } },
        { geometry: { coordinates: [101.6400, 3.2200] }, properties: { name: 'Menjalara', city: 'Kuala Lumpur', countrycode: 'MY' } },
      ] } });
    });
    await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  }

  // ================= staff: Grab-style home + menu =================
  const actx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await offline(actx);
  const admin = await actx.newPage(); watch(admin, 'admin');
  await admin.goto(B + '/admin.html'); await admin.fill('#lname', 'Syakil'); await admin.fill('#pass', '1234'); await admin.click('#loginForm button');
  await admin.waitForSelector('#storeTitle:has-text("Open for online orders today")');
  ok(await admin.isChecked('#storeSwitch'), 'home: store switch shows OPEN');
  ok(/Sales today/.test(await admin.textContent('#todayTiles')), 'home: today tiles');
  ok(/Preparing/.test(await admin.textContent('#boardTabs')), 'home: order board tabs');
  await admin.screenshot({ path: `${OUT}/01-admin-home-empty.png` });

  await admin.click('.nav [data-tab="menu"]'); await admin.waitForSelector('.mi');
  ok(/cut each into/.test(await admin.textContent('.mi:has-text("Marrow")')), 'menu: marrow offers "cut each into"');
  ok(/number of pieces, slice thickness/.test(await admin.textContent('.mi:has-text("Shoulder Slices")')), 'menu: slices offer count + thickness');
  adminTok0 = await admin.evaluate(() => localStorage.getItem('afm_admin'));
  ok(/\+ Selayang/.test(await admin.textContent('.mi:has-text("Head")')) && /\+ Brickfields/.test(await admin.textContent('.mi:has-text("Lamb Shank")')) && !(await admin.$('.mi:has-text("Boneless Meat") [data-stock]')), 'menu: head, lamb shank etc. offer stock per branch (not counted yet)');
  answers.push('2'); await admin.click('.mi:has-text("Head") [data-br="selayang"]'); await admin.waitForSelector('.mi:has-text("Head") [data-br="selayang"]:has-text("Selayang 2 sets")');
  answers.push('1'); await admin.click('.mi:has-text("Head") [data-br="brickfields"]'); await admin.waitForSelector('.mi:has-text("Head") [data-br="brickfields"]:has-text("Brickfields 1 set")');
  ok(true, 'stock set: head Selayang 2, Brickfields 1');
  // sold out toggle saves instantly
  await admin.click('.mi:has-text("Spleen") .sw-sm'); await admin.waitForSelector('#toast:has-text("Spleen: sold out")');
  let cat = await (await fetch(B + '/api/catalog')).json();
  ok(!cat.products.some((p) => p.id === 'spleen'), 'sold-out item hidden from shop instantly');
  await admin.click('.mi:has-text("Spleen") .sw-sm'); await admin.waitForSelector('#toast:has-text("Spleen: on sale")');
  // edit an item: price + stock from the drawer
  await admin.click('.mi:has-text("Feet") .nm'); await admin.waitForSelector('#drawer.show [data-pstock="selayang"]');
  await admin.fill('[data-pstock="selayang"]', '6'); await admin.click('[data-pstocksave="selayang"]'); await admin.waitForSelector('#toast:has-text("Selayang: 6 sets Feet in stock")');
  await admin.fill('#drawer [data-k="price"]', '25');
  await admin.screenshot({ path: `${OUT}/02-admin-menu-edit.png` });
  await admin.click('#pSave'); await admin.waitForSelector('#toast:has-text("Menu saved")');
  cat = await (await fetch(B + '/api/catalog')).json();
  ok((await stockOf('feet')).selayang === 6 && cat.products.find((p) => p.id === 'feet').price === 25 && (await stockOf('head')).selayang === 2, 'menu save keeps stock (feet 6, head 2 at Selayang) and price RM25');
  ok(cat.products.find((p) => p.id === 'head').stock === 2 && cat.products.find((p) => p.id === 'feet').stock === null, 'shop: head shows best branch (2); feet not counted at Brickfields = no limit');
  await admin.screenshot({ path: `${OUT}/02b-admin-menu.png` });
  await admin.click('.nav [data-tab="home"]');

  // ================= customer: install bar (iPhone) =================
  const ios = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await offline(ios);
  const ip = await ios.newPage(); watch(ip, 'ios');
  await ip.goto(B + '/'); await ip.waitForSelector('#installBar.show', { timeout: 8000 });
  ok(/Add to Home Screen/.test(await ip.textContent('#installBar')), 'iPhone: install bar explains Share → Add to Home Screen');
  await ip.screenshot({ path: `${OUT}/03-ios-install-bar.png` });
  const mf = await (await fetch(B + '/manifest.webmanifest')).json();
  ok(mf.display === 'standalone' && mf.icons.length === 3, 'web app manifest');
  await ios.close();

  // ================= customer: cuts, caps, edit line =================
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, geolocation: { latitude: 3.205, longitude: 101.625 }, permissions: ['geolocation'] });
  await offline(ctx);
  const p = await ctx.newPage(); watch(p, 'shop');
  await p.goto(B + '/'); await p.waitForSelector('.item');
  await p.click('.item[data-id="mutton-leg-bones-marrow"] .ctl .add'); await p.waitForSelector('#itemSheet.show');
  ok(/Cut each into/.test(await p.textContent('#itemBody')) && await p.$('#itemBody [data-split="2 pcs"]') && await p.$('#itemBody [data-split="3 pcs"]') && !(await p.$('#itemBody [data-by]')), 'marrow: 2 pcs / 3 pcs choice, no other cuts');
  await p.click('#itemAdd'); await p.waitForSelector('#toast:has-text("Choose how to cut")');
  ok(true, 'marrow: must choose 2 or 3 pcs');
  await p.click('#itemBody [data-split="3 pcs"]');
  await p.screenshot({ path: `${OUT}/04-marrow-sheet.png` });
  await p.click('#itemAdd'); await p.waitForSelector('#itemSheet', { state: 'hidden' });
  await p.click('.item[data-id="lamb-chop-shoulder-slices"] .ctl .add'); await p.waitForSelector('#itemSheet.show');
  await p.click('#itemBody [data-by="count"]'); await p.fill('#countIn', '12');
  await p.screenshot({ path: `${OUT}/05-slices-count.png` });
  await p.click('#itemAdd'); await p.waitForSelector('#itemSheet', { state: 'hidden' });
  await p.click('.item[data-id="lamb-chop-shoulder-slices"] .ctl .add'); await p.click('#itemBody [data-by="thickness"]'); await p.click('#itemBody [data-thick="1 inch"]');
  await p.click('#itemAdd'); await p.waitForSelector('#itemSheet', { state: 'hidden' });
  await p.click('.item[data-id="head"] [data-quick]'); await p.click('.item[data-id="head"] [data-inc]');
  ok(/Only 2 sets left/.test(await p.textContent('.item[data-id="head"]')), 'shop shows "Only 2 sets left"');
  await p.click('.item[data-id="head"] [data-inc]'); await p.waitForSelector('#toast:has-text("only 2 sets left")');
  ok(/2 sets/.test(await p.textContent('.item[data-id="head"] .ctl')), 'cannot add more head than in stock');
  await p.click('#openCart'); await p.waitForSelector('#sheet.show #lines .line');
  const linesText = await p.textContent('#lines');
  ok(/Cut each into 3 pcs/.test(linesText) && /12 pieces/.test(linesText) && /1 inch thick/.test(linesText), 'cart shows marrow 3 pcs, slices 12 pieces and 1 inch thick');
  // edit the marrow line at checkout
  await p.click('#lines .line:first-child [data-edit]'); await p.waitForSelector('#itemSheet.show');
  ok(/Update item/.test(await p.textContent('#itemAdd')) && await p.$('#itemBody [data-split="3 pcs"].on'), 'edit opens the sheet prefilled');
  await p.click('#itemBody [data-split="2 pcs"]'); await p.click('#itemBody [data-iq="1"]'); await p.click('#itemAdd');
  await p.waitForSelector('#lines:has-text("Cut each into 2 pcs")');
  ok(!/3 pcs/.test(await p.textContent('#lines')) && /^Mutton Leg Bones \(Marrow\)✂ Cut each into 2 pcs/.test((await p.textContent('#lines .line:first-child')).trim()) && /1 kg/.test(await p.textContent('#lines .line:first-child')), 'line updated in place (2 pcs, 1 kg)');

  // ================= Lalamove-style map =================
  await p.waitForSelector('#picker .lm-map .leaflet-tile-loaded', { timeout: 10000 });
  ok(await p.isVisible('#picker .lm-map') && await p.isVisible('#picker .lm-locate'), 'map with centre pin and locate button visible straight away');
  await p.$eval('#deliverySec', (e) => e.scrollIntoView({ block: 'start' }));
  await p.screenshot({ path: `${OUT}/06a-map-empty.png` });
  await p.fill('#picker .lm-q', 'Kepong'); await p.waitForSelector('#picker .lm-sugg button');
  await p.screenshot({ path: `${OUT}/06-map-search.png` });
  await p.click('#picker .lm-sugg button >> nth=0');
  await p.waitForSelector('#picker .lm-title:has-text("Kepong Baru")');
  await p.waitForSelector('#speed:not([hidden]) input[value="priority"]');
  ok(/Regular/.test(await p.textContent('#speed')) && /Priority/.test(await p.textContent('#speed')) && /Match faster/.test(await p.textContent('#speed')), 'delivery options like Lalamove: Priority and Regular');
  // drag the map: pin moves, address updates (reverse geocode)
  const box = await (await p.$('#picker .lm-mapel')).boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 - 40, { steps: 8 }); await p.mouse.up();
  await p.waitForSelector('#picker .lm-title:has-text("Jalan Kepong Baru")');
  ok(/Deliver here/.test(await p.textContent('#picker .lm-bubble')), 'dragging the map re-pins and updates the address');
  await p.$eval('#deliverySec', (e) => e.scrollIntoView({ block: 'start' }));
  await p.screenshot({ path: `${OUT}/06b-map-pinned.png` });
  // locate me
  await p.click('#picker .lm-locate'); await p.waitForFunction(() => /Jalan Kepong Baru/.test(document.querySelector('#picker .lm-title').textContent));
  ok(true, 'locate-me button pins the current location');
  await p.check('#speed input[value="priority"]');
  await p.waitForSelector('#sum:has-text("Priority delivery")');
  const prio = await p.$eval('#speed label:first-child .p', (e) => e.textContent); const regular = await p.$eval('#speed label:nth-child(2) .p', (e) => e.textContent);
  const ratio = parseFloat(prio.replace(/[^\d.]/g, '')) / parseFloat(regular.replace(/[^\d.]/g, ''));
  ok(ratio > 1.3 && ratio < 1.42, `priority uses Lalamove's priority price (${prio} vs ${regular})`);
  await p.screenshot({ path: `${OUT}/07-checkout-delivery.png`, fullPage: false });
  await p.$eval('#speed', (e) => e.scrollIntoView({ block: 'center' }));
  await p.screenshot({ path: `${OUT}/08-checkout-speed.png` });

  // ================= self pickup, pay, staff marks ready/collected =================
  await p.click('[data-ful="pickup"]'); await p.waitForSelector('#slots [data-pslot]');
  ok(await p.isVisible('#pickupBranches [data-pbranch="selayang"]') && /Demo address, Selayang/.test(await p.textContent('#shopCard')), 'pickup: branch + shop address');
  ok((await p.textContent('#payBtn')) === 'Choose a pickup time', 'pickup: must choose a time');
  await p.click('#slots [data-pslot] >> nth=0');
  await p.waitForSelector('#sum:has-text("Self pickup")');
  console.log('   cart:', JSON.stringify(await p.evaluate(() => JSON.parse(localStorage.getItem('afm_cart2')).map((l) => [l.productId, l.qty]))), '|', (await p.textContent('#sum')).replace(/\s+/g, ' '));
  await p.fill('#name', 'Pickup Tester'); await p.fill('#phone', '012-555 1212');
  await p.$eval('#pickupSec', (e) => e.scrollIntoView({ block: 'start' }));
  await p.screenshot({ path: `${OUT}/09-checkout-pickup.png` });
  await p.waitForSelector('#payBtn:not([disabled])');
  const payTxt = await p.textContent('#payBtn');
  await p.click('#payBtn'); await p.waitForURL(/__mock\/billplz/);
  await p.click('#pay'); await p.waitForURL(/order\.html/);
  await p.waitForSelector('.status-card:has-text("self pickup")');
  ok(/Ready for collection/.test(await p.textContent('.steps')) && /Collect at Ali's Fresh Meats Selayang/.test(await p.textContent('#root')), 'order page: pickup steps + shop');
  ok(/Free/.test(await p.textContent('.sum')), 'order page: pickup free');
  await p.screenshot({ path: `${OUT}/10-order-pickup.png` });
  const pickupNo = (await p.textContent('.status-card .sub')).match(/AFM-\d+/)[0];
  ok(payTxt.includes('Pay'), `paid ${payTxt}`);

  await admin.click('.nav [data-tab="home"]'); await sleep(300);
  await admin.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await admin.waitForSelector(`#board .oc:has-text("${pickupNo}")`, { timeout: 20000 });
  ok(/Pickup/.test(await admin.textContent(`#board .oc:has-text("${pickupNo}")`)), 'board: pickup card under Preparing');
  await admin.screenshot({ path: `${OUT}/11-admin-board.png` });
  await admin.click(`#board .oc:has-text("${pickupNo}") [data-cact="order.ready"]`); await admin.waitForSelector('#toast:has-text("Marked ready")');
  await admin.click('[data-board="ready"]'); await admin.waitForSelector(`#board .oc:has-text("${pickupNo}") [data-cact="order.collected"]`);
  await admin.click(`#board .oc:has-text("${pickupNo}") [data-cact="order.collected"]`); await admin.waitForSelector('#toast:has-text("collected")');
  await admin.click('[data-board="done"]'); await admin.waitForSelector(`#board .oc:has-text("${pickupNo}")`);
  ok(true, 'pickup: ready → collected → done');
  await p.reload(); await p.waitForSelector('.status-card h2:has-text("Collected")');
  ok(true, 'customer sees Collected');

  // ================= member: points; priority delivery; tip; change driver; rebook =================
  const sign = await (await fetch(B + '/api/member', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'signup', name: 'Points Tester', phone: '0123334444', password: 'secret123' }) })).json();
  ok(!!sign.token, 'member signed up');
  await p.evaluate((t) => { localStorage.setItem('afm_member', JSON.stringify(t)); localStorage.setItem('afm_cart2', JSON.stringify([{ key: 'boneless-meat|null', productId: 'boneless-meat', qty: 2, cut: null }])); localStorage.setItem('afm_prefs', JSON.stringify({ fulfilment: 'delivery' })); }, sign.token);
  await p.goto(B + '/#cart'); await p.waitForSelector('#sheet.show');
  await p.fill('#picker .lm-q', 'Kepong'); await p.click('#picker .lm-sugg button >> nth=0');
  await p.waitForSelector('#speed input[value="priority"]'); await p.check('#speed input[value="priority"]');
  await p.waitForSelector('#pointsBox:has-text("You’ll earn")');
  ok(/RM15 off|New member offer/.test(await p.textContent('#sum')), 'member: new member offer applied');
  const earnTxt = await p.textContent('#pointsBox');
  ok(/You have 0 points/.test(earnTxt) && /earn 155 points/.test(earnTxt), 'member: earns 155 points on RM170 − RM15');
  await p.waitForSelector('#payBtn:not([disabled])'); await p.click('#payBtn'); await p.waitForURL(/__mock\/billplz/); await p.click('#pay'); await p.waitForURL(/order\.html/);
  await p.waitForSelector('.status-card:has-text("priority delivery")');
  ok(/\+155 points/.test(await p.textContent('#root')), 'order page: +155 points');
  const prioNo = (await p.textContent('.status-card .sub')).match(/AFM-\d+/)[0];
  let calls = await (await fetch(B + '/__mock/calls')).json();
  let llm = calls.llm.at(-1);
  ok(llm.tier === '2' && !llm.priorityFee, 'priority: booked on Lalamove priority tier (no tip needed)');
  const me1 = await (await fetch(B + '/api/member', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sign.token }, body: JSON.stringify({ action: 'me' }) })).json();
  ok(me1.loyalty.points === 155, 'member has 155 points');

  // staff adds a tip from the order drawer
  await admin.click('[data-board="preparing"]'); await admin.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await admin.waitForSelector(`#board .oc:has-text("${prioNo}")`, { timeout: 20000 });
  ok(/Priority/.test(await admin.textContent(`#board .oc:has-text("${prioNo}")`)), 'board: priority tag');
  await admin.click(`#board .oc:has-text("${prioNo}") .no`); await admin.waitForSelector('#drawer.show #tipAmt');
  await admin.screenshot({ path: `${OUT}/12-admin-drawer-tip.png` });
  await admin.fill('#tipAmt', '3'); await admin.click('#drawer [data-act="order.tip"]'); await admin.waitForSelector('#toast:has-text("Tip added")');
  calls = await (await fetch(B + '/__mock/calls')).json(); llm = calls.llm.at(-1);
  ok(llm.priorityFee === '3.00', 'tip: RM3 added on the same booking (no rebook)');
  // driver accepts → change driver
  await fetch(`${B}/__mock/lalamove/advance/${llm.orderId}`);
  await admin.click('#drawer [data-act="order.refresh"]'); await admin.waitForSelector('#drawer #drvReason');
  await admin.selectOption('#drvReason', 'DRIVER_UNRESPONSIVE'); await admin.click('#drawer [data-act="order.changeDriver"]'); await admin.waitForSelector('#toast:has-text("finding another driver")');
  calls = await (await fetch(B + '/__mock/calls')).json(); llm = calls.llm.at(-1);
  ok(llm.status === 'ASSIGNING_DRIVER' && llm.changedDriver === 'DRIVER_UNRESPONSIVE', 'change driver: same booking back to finding driver');
  // expires → check new price → rebook
  await fetch(`${B}/__mock/lalamove/expire/${llm.orderId}`);
  await admin.click('#drawer [data-act="order.refresh"]'); await admin.waitForSelector('#drawer [data-act="rebookQuote"]');
  await admin.click('#drawer [data-act="rebookQuote"]'); await admin.waitForSelector('#doRebook');
  ok(/customer paid RM/.test(await admin.textContent('#rbq')), 'rebook: shows new price vs what the customer paid');
  await admin.screenshot({ path: `${OUT}/13-admin-rebook-quote.png` });
  await admin.click('#doRebook'); await admin.waitForSelector('#toast:has-text("Lalamove booked")');
  calls = await (await fetch(B + '/__mock/calls')).json();
  ok(calls.llm.at(-1).orderId !== llm.orderId && calls.llm.at(-1).status === 'ASSIGNING_DRIVER', 'rebooked a new Lalamove order');
  await admin.click('#drawer [data-close] >> nth=0');

  // second member order uses points
  await p.evaluate(() => localStorage.setItem('afm_cart2', JSON.stringify([{ key: 'boneless-meat|null', productId: 'boneless-meat', qty: 1, cut: null }])));
  await p.goto(B + '/#cart'); await p.waitForSelector('#sheet.show');
  await p.waitForSelector('#usePts'); ok(/Use 100 points/.test(await p.textContent('#pointsBox')), 'points: can use 100 of 155');
  await p.check('#usePts'); await p.waitForSelector('#sum:has-text("Points (100)")');
  await p.$eval('#pointsBox', (e) => e.scrollIntoView({ block: 'center' }));
  await p.screenshot({ path: `${OUT}/14-checkout-points.png` });
  await p.click('[data-ful="pickup"]'); await p.waitForSelector('#slots [data-pslot]'); await p.click('#slots [data-pslot] >> nth=0');
  await p.waitForSelector('#payBtn:not([disabled])'); await p.click('#payBtn'); await p.waitForURL(/__mock\/billplz/); await p.click('#pay'); await p.waitForURL(/order\.html/);
  await p.waitForSelector('.status-card .sub');
  const me2 = await (await fetch(B + '/api/member', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sign.token }, body: JSON.stringify({ action: 'me' }) })).json();
  ok(me2.loyalty.points === 155 - 100 + 80, `points after redeeming: ${me2.loyalty.points} (155 − 100 + 80)`);
  await p.goto(B + '/account.html'); await p.waitForSelector('.pointscard');
  ok(/135/.test(await p.textContent('.pointscard')) && await p.isVisible('#notifyBox'), 'account: points card + notification settings');
  ok(await p.$('[data-reorder]'), 'account: order again button');
  await p.screenshot({ path: `${OUT}/15-account-points.png` });

  // ================= push subscription API =================
  const fakeSub = { endpoint: 'https://fcm.googleapis.com/fcm/send/fake-' + Date.now(), keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
  const key = await (await fetch(B + '/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'key' }) })).json();
  ok(/^[A-Za-z0-9_-]{80,}$/.test(key.key), 'push: VAPID public key generated');
  const sub = await (await fetch(B + '/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'subscribe', subscription: fakeSub, promos: true }) })).json();
  ok(/^[a-f0-9]{24}$/.test(sub.id), 'push: subscription saved');

  // ================= promotions, insights, activity, pause =================
  await admin.click('.nav [data-tab="promos"]'); await admin.waitForSelector('#subCount:has-text("1")');
  await admin.fill('#pTitle', 'Lamb shank is back 🍖'); await admin.fill('#pBody', 'Order today, 10% off with SHANK10');
  await admin.click('#pSend'); await admin.waitForSelector('#toast:has-text("Sent to")');
  ok(/Lamb shank is back/.test(await admin.textContent('#promoHistory')), 'promotion sent and listed');
  await admin.screenshot({ path: `${OUT}/16-admin-promos.png` });

  await admin.click('.nav [data-tab="insights"]'); await admin.waitForSelector('#chart svg path');
  const insTxt = await admin.textContent('#insights');
  ok(/Paid orders/.test(insTxt) && /Paid to Lalamove/.test(insTxt) && /Best sellers/.test(insTxt), 'insights: tiles, delivery money, best sellers');
  await admin.hover('#chart .hit >> nth=' + (new Date().getUTCHours() + 8) % 24); await sleep(150);
  await admin.screenshot({ path: `${OUT}/17-admin-insights-today.png`, fullPage: true });
  await admin.click('[data-range="7d"]'); await admin.waitForSelector('#insights:has-text("Last 7 days")');
  ok((await admin.$$('#chart .hit')).length === 7, 'insights: 7 daily columns');
  await admin.screenshot({ path: `${OUT}/18-admin-insights-7d.png` });

  await admin.click('.nav [data-tab="activity"]'); await admin.waitForSelector('#actList .act');
  const actTxt = await admin.textContent('#actList');
  ok(/Tip added/.test(actTxt) && /Promotion sent/.test(actTxt) && /New member/.test(actTxt) && /Paid RM/.test(actTxt), 'activity log: tips, promos, sign-ups, payments');
  await admin.click('[data-atype="staff"]'); await admin.waitForFunction(() => [...document.querySelectorAll('#actList .act .tag')].every((t) => /Staff/.test(t.textContent)));
  ok(true, 'activity: filter by type');
  await admin.screenshot({ path: `${OUT}/19-admin-activity.png` });

  await admin.click('.nav [data-tab="home"]'); await admin.click('[data-pause="30"]'); await admin.waitForSelector('#storeTitle:has-text("Paused until")');
  cat = await (await fetch(B + '/api/catalog')).json();
  ok(!cat.open && /paused until/.test(cat.openMessage), 'pause 30 min closes the shop');
  await admin.screenshot({ path: `${OUT}/20-admin-paused.png` });
  await admin.click('[data-resume]'); await admin.waitForSelector('#storeTitle:has-text("Open for online orders")');
  cat = await (await fetch(B + '/api/catalog')).json(); ok(cat.open, 'resume reopens');

  // mobile staff view
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mctx.newPage(); watch(m, 'staff-mobile');
  await m.goto(B + '/admin.html'); await m.fill('#lname', 'Syakil'); await m.fill('#pass', '1234'); await m.click('#loginForm button'); await m.waitForSelector('#storeTitle:has-text("Open")');
  await m.click('[data-board="done"]');
  await m.screenshot({ path: `${OUT}/21-staff-mobile-home.png` });
  await m.click('.bnav [data-tab="more"]'); await m.waitForSelector('#drawer.show [data-tab="settings"]');
  await m.click('#drawer [data-tab="settings"]'); await m.waitForSelector('[name="pickup.slotMinutes"]');
  ok(await m.isVisible('[name="priority.enabled"]') && !(await m.$('[name="priority.fee"]')) && await m.isVisible('[name="loyalty.redeemPoints"]') && await m.isVisible('[name="cutting.thickness"]'), 'settings: priority on/off, pickup, loyalty, thickness');
  await m.fill('[name="loyalty.redeemPoints"]', '200'); await m.click('#settingsForm button.pri'); await m.waitForSelector('#toast:has-text("Settings saved")');
  cat = await (await fetch(B + '/api/catalog')).json(); ok(cat.loyalty.redeemPoints === 200, 'settings saved (200 points)');

  // ================= stock after paying; super admin edits and deletes; staff role =================
  let hs = await stockOf('head');
  ok(hs.selayang === 0 && hs.brickfields === 1, 'head: Selayang 2 → 0 after the Selayang order, Brickfields still 1');
  await p.goto(B + '/'); await p.waitForSelector('.item[data-id="head"]:has-text("Only 1 set left")');
  ok(true, 'shop shows "Only 1 set left" (Brickfields)');
  // pickup at Selayang is refused, Brickfields is fine
  const q1 = await (await fetch(B + '/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ productId: 'head', qty: 1 }], fulfilment: 'pickup', pickupBranchId: 'selayang' }) })).json();
  const q2 = await (await fetch(B + '/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ productId: 'head', qty: 1 }], fulfilment: 'pickup', pickupBranchId: 'brickfields' }) })).json();
  ok(q1.errors[0] === 'Head is sold out at our Selayang shop.' && !q2.errors.length, 'pickup: Selayang sold out, Brickfields OK');
  // delivery to an address both shops reach goes to the shop that has it
  const q3 = await (await fetch(B + '/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ productId: 'head', qty: 1 }], location: { lat: 3.208, lng: 101.637, address: 'Kepong' } }) })).json();
  ok(q3.branch.id === 'brickfields' && !q3.errors.length && /Brickfields/.test(q3.branchNote), 'delivery: sent from Brickfields because Selayang ran out');
  const q4 = await (await fetch(B + '/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ productId: 'head', qty: 2 }], location: { lat: 3.208, lng: 101.637, address: 'Kepong' } }) })).json();
  ok(q4.branch.id === 'selayang' && /only|sold out/.test(q4.errors[0]), `delivery: neither shop has 2 → error (${q4.errors[0]})`);

  // edit the pickup order (super)
  await admin.click('.nav [data-tab="home"]'); await admin.click('[data-board="done"]');
  await admin.click(`#board .oc:has-text("${pickupNo}") .no`); await admin.waitForSelector('#drawer [data-act="edit"]');
  await admin.click('#drawer [data-act="edit"]'); await admin.waitForSelector('#edSave');
  await admin.fill('#drawerBody [data-ei="3"] [data-eqty]', '1'); await admin.fill('#edPhone', '012-555 9999'); await admin.fill('#edReason', 'customer only wants 1 head');
  await admin.screenshot({ path: `${OUT}/22-admin-edit-order.png` });
  await admin.click('#edSave'); await admin.waitForSelector('#toast:has-text("Order updated")', { timeout: 8000 }).catch(async () => { console.log('   toast:', await admin.textContent('#toast'), '| button:', await admin.textContent('#edSave').catch(() => 'gone')); });
  const drawerTxt = await admin.textContent('#drawerBody');
  ok(/To refund to customer/.test(drawerTxt) && /RM 30.00/.test(drawerTxt) && /Edited: .*phone \+60125551212 → \+60125559999.*Head 2 sets → 1 set.*Syakil/.test(drawerTxt), 'edit: phone + qty changed, refund RM30 shown, logged with name');
  cat = await (await fetch(B + '/api/catalog')).json();
  ok((await stockOf('head')).selayang === 1, 'edit put 1 head back in Selayang stock');
  await admin.screenshot({ path: `${OUT}/23-admin-edited.png` });
  // delete it
  answers.push('Test order');
  await admin.click('#drawer [data-act="delete"]'); await admin.waitForSelector('#toast:has-text("deleted")');
  ok(!(await admin.$(`#board .oc:has-text("${pickupNo}")`)), 'deleted order gone from the board');
  cat = await (await fetch(B + '/api/catalog')).json();
  ok((await stockOf('head')).selayang === 2, 'delete returned the Selayang stock');
  await admin.click('[data-board="deleted"]'); await admin.waitForSelector(`#board .oc:has-text("${pickupNo}")`);
  ok(/Deleted by Syakil.*Test order/.test(await admin.textContent(`#board .oc:has-text("${pickupNo}")`)), 'deleted tab keeps the record');
  await admin.click('.nav [data-tab="activity"]'); await admin.waitForFunction(() => /Order deleted/.test(document.querySelector('#actList').textContent), null, { timeout: 8000 }).catch(() => {});
  await admin.screenshot({ path: `${OUT}/24a-activity-deleted.png` });
  ok(new RegExp(`${pickupNo}.*Order deleted: Test order`).test(await admin.textContent('#actList')), 'activity log: order deleted with reason and name');

  // staff account
  await admin.click('.nav [data-tab="staff"]'); await admin.waitForSelector('#staffForm');
  await admin.fill('#staffForm [name="name"]', 'Aminah'); await admin.fill('#staffForm [name="password"]', '4321'); await admin.click('#saveStaff');
  await admin.waitForSelector('#staffRows:has-text("Aminah")');
  await admin.screenshot({ path: `${OUT}/24-admin-staff.png` });
  const sctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const st = await sctx.newPage(); watch(st, 'staff');
  await st.goto(B + '/admin.html'); await st.fill('#lname', 'aminah'); await st.fill('#pass', '4321'); await st.click('#loginForm button');
  await st.waitForSelector('#storeTitle');
  const navTxt = await st.textContent('#nav');
  ok(/Home/.test(navTxt) && /Menu/.test(navTxt) && !/Insights|Settings|Customers|Staff|Activity/.test(navTxt), 'staff: only Home and Menu');
  ok(!/Sales today/.test(await st.textContent('#todayTiles')), 'staff: no sales figures');
  await st.click('[data-board="all"]'); await st.waitForSelector(`#board .oc:has-text("${prioNo}")`);
  await st.click(`#board .oc:has-text("${prioNo}") .no`); await st.waitForSelector('#drawer [data-act="order.reprint"]');
  ok(!(await st.$('#drawer [data-act="edit"]')) && !(await st.$('#drawer [data-act="delete"]')) && /WhatsApp/.test(await st.textContent('#drawerBody')), 'staff: can see order + contact, no edit/delete');
  await st.screenshot({ path: `${OUT}/25-staff-view.png` });
  const stTok = await st.evaluate(() => localStorage.getItem('afm_admin'));
  const prioId0 = (await (await fetch(B + '/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + stTok }, body: JSON.stringify({ action: 'order.byNo', no: prioNo }) })).json()).id;
  const forb = await fetch(B + '/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + stTok }, body: JSON.stringify({ action: 'order.delete', id: 'x' }) });
  ok(forb.status === 403, 'staff cannot delete orders (server refuses)');
  const forb2 = await fetch(B + '/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + stTok }, body: JSON.stringify({ action: 'insights' }) });
  ok(forb2.status === 403, 'staff cannot see insights (server refuses)');
  await st.click('#drawer [data-act="order.reprint"]'); await st.waitForSelector('#toast:has-text("Label sent")');
  ok(true, 'staff can reprint');
  await st.click('#drawer [data-close] >> nth=0'); await st.click('.nav [data-tab="menu"]'); await st.waitForSelector('.mi');
  answers.push('5'); await st.click('.mi:has-text("Brain") [data-br="selayang"]'); await st.waitForSelector('.mi:has-text("Brain") [data-br="selayang"]:has-text("Selayang 5 pcs")');
  ok(true, 'staff can update stock');
  // branch-only staff: Siti works at Brickfields, all test orders are Selayang
  await admin.click('#resetStaff'); await admin.fill('#staffForm [name="name"]', 'Siti'); await admin.fill('#staffForm [name="password"]', '5555');
  await admin.selectOption('#staffForm [name="branch"]', 'brickfields'); await admin.click('#saveStaff'); await admin.waitForSelector('#staffRows:has-text("Siti")');
  ok(/Siti.*Staff.*Brickfields/.test((await admin.textContent('#staffRows')).replace(/\s+/g, ' ')), 'staff Siti limited to Brickfields');
  const bctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const bp = await bctx.newPage(); watch(bp, 'siti');
  await bp.goto(B + '/admin.html'); await bp.fill('#lname', 'Siti'); await bp.fill('#pass', '5555'); await bp.click('#loginForm button'); await bp.waitForSelector('#storeTitle');
  await bp.click('[data-board="all"]'); await bp.waitForSelector('#board .empty');
  ok(/Brickfields/.test(await bp.textContent('#whoami')) && (await bp.$$('#board .oc')).length === 0, 'Brickfields staff sees no Selayang orders');
  const sTok = await bp.evaluate(() => localStorage.getItem('afm_admin'));
  const sg = await fetch(B + '/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sTok }, body: JSON.stringify({ action: 'order.get', id: prioId0 }) });
  ok(sg.status === 403, 'Brickfields staff cannot open a Selayang order');
  ok(await bp.isDisabled('#storeSwitch'), 'staff cannot switch the shop off');
  await bp.click('.nav [data-tab="menu"]'); await bp.waitForSelector('.mi');
  ok(!(await bp.$('[data-br="selayang"]')) && await bp.$('.mi:has-text("Head") [data-br="brickfields"]'), 'Brickfields staff only sees Brickfields stock');
  const ss = await fetch(B + '/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sTok }, body: JSON.stringify({ action: 'stock.set', id: 'head', branchId: 'selayang', qty: 9 }) });
  ok(ss.status === 403, 'Brickfields staff cannot change Selayang stock');
  await bp.screenshot({ path: `${OUT}/27-branch-staff-menu.png` });
  await bp.screenshot({ path: `${OUT}/26-branch-staff.png` });
  calls = await (await fetch(B + '/__mock/calls')).json();
  ok(calls.llm.every((x) => /^ORDER NO: AFM-\d+/.test(x.remarks)), 'Lalamove driver sees the order number first');

  // turned-off account is logged out straight away
  await admin.click('#staffRows [data-sedit]'); await admin.uncheck('#staffForm [name="active"]'); await admin.click('#saveStaff'); await admin.waitForSelector('#staffRows:has-text("Off")');
  const after = await fetch(B + '/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + stTok }, body: JSON.stringify({ action: 'home' }) });
  ok(after.status === 401, 'turned-off staff account is logged out');

  // ================= Lalamove booking not on the account (test keys) / can't be cancelled =================
  const adminTok = await admin.evaluate(() => localStorage.getItem('afm_admin'));
  const aapi = async (action, data = {}) => { const r = await fetch(B + '/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminTok }, body: JSON.stringify({ action, ...data }) }); return { status: r.status, d: await r.json() }; };
  const prioId = (await aapi('order.byNo', { no: prioNo })).d.id;
  let po = (await aapi('order.get', { id: prioId })).d.order;
  await fetch(`${B}/__mock/lalamove/forget/${po.delivery.lalamoveOrderId}`);
  const cd = await aapi('order.cancelDelivery', { id: prioId });
  ok(cd.status === 200 && cd.d.result === 'gone' && cd.d.order.delivery.status === 'NOT_FOUND', 'cancel Lalamove: booking not on the account → marked not found (no error)');
  ok(/booking not found: rebook/.test(cd.d.order.summary.problem), 'shows "Lalamove booking not found: rebook"');
  // rebook, then Lalamove refuses to cancel (driver already has it) → delete asks, then deletes anyway
  ok((await aapi('order.rebook', { id: prioId })).status === 200, 'rebooked');
  po = (await aapi('order.get', { id: prioId })).d.order;
  await fetch(`${B}/__mock/lalamove/status/${po.delivery.lalamoveOrderId}/PICKED_UP`);
  await admin.click('.nav [data-tab="home"]'); await admin.click('[data-board="all"]');
  await admin.waitForSelector(`#board .oc:has-text("${prioNo}")`);
  await admin.click(`#board .oc:has-text("${prioNo}") .no`); await admin.waitForSelector('#drawer [data-act="delete"]');
  const dialogs = []; admin.on('dialog', (d) => dialogs.push(d.message()));
  answers.push('Test order');
  await admin.click('#drawer [data-act="delete"]'); await admin.waitForSelector('#toast:has-text("deleted")');
  ok(dialogs.some((m) => /could not cancel/i.test(m) && /Delete the order anyway/.test(m)), 'delete: asks before deleting when Lalamove refuses to cancel');
  po = (await aapi('order.get', { id: prioId })).d.order;
  ok(!!po.deletedAt && po.log.some((l) => /NOT cancelled/.test(l.msg)), 'deleted anyway, with a note to check the Lalamove app');

  // labels printed for both orders
  const prints = fs.readdirSync(process.env.PRINT_DIR).filter((f) => f.endsWith('.pdf'));
  ok(prints.length >= 3, `${prints.length} labels printed`);

  await browser.close();
  console.log(errors.length ? `\n${errors.length} problem(s):\n${errors.join('\n')}` : '\nALL GOOD');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
