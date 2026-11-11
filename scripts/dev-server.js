// Local demo server: `npm run dev` → http://localhost:3000 (dashboard: /admin.html, passcode 1234)
// Runs the real API code with an in-memory database and FAKE Billplz, Lalamove and PrintNode,
// so you can try the full order flow without any accounts. Never used on Vercel.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const LOCAL = `http://localhost:${PORT}`;
const PRINT_DIR = process.env.PRINT_DIR || path.join(__dirname, '..', '.mock-prints');
Object.assign(process.env, {
  SITE_URL: LOCAL, ADMIN_PASSCODE: process.env.ADMIN_PASSCODE || '1234',
  BILLPLZ_API_KEY: 'mock-key', BILLPLZ_COLLECTION_ID: 'mockcol', BILLPLZ_X_SIGNATURE_KEY: 'S-mock-x-signature', BILLPLZ_SANDBOX: 'true',
  LALAMOVE_API_KEY: 'pk_test_mock', LALAMOVE_API_SECRET: 'sk_test_mock', LALAMOVE_WEBHOOK_SECRET: 'devsecret',
  PRINTNODE_API_KEY: 'mock-printnode', ALLOW_MEMORY_DB: '1',
});
const billplz = require('../lib/billplz');
const store = require('../lib/store');
// keep a copy of every staff phone alert so tests can check who would be told what
const pushLib = require('../lib/push');
const staffAlerts = [];
const realNotifyStaff = pushLib.notifyStaff;
pushLib.notifyStaff = (p, branchId, o) => { staffAlerts.push({ title: p.title, body: p.body, tag: p.tag, branchId: branchId || '', superOnly: !!o?.superOnly }); return realNotifyStaff(p, branchId, o); };
const { distanceKm } = require('../lib/util');

// demo branch locations (made up for local testing only)
store.saveSettings({
  ...store.DEFAULT_SETTINGS,
  requireMember: false, // the demo starts with guest checkout on; tests switch members-only on
  hours: { open: '00:00', close: '23:59', closedDays: [] },
  branches: [
    { id: 'selayang', name: 'Selayang', address: 'Demo address, Selayang, Selangor', lat: '3.2526', lng: '101.6499', phone: '+60162053786', printerId: '7350001', active: true },
    { id: 'brickfields', name: 'Brickfields', address: 'Demo address, Brickfields, Kuala Lumpur', lat: '3.1290', lng: '101.6857', phone: '+60162053786', printerId: '7350002', active: true },
  ],
});

// ---------------- fake external services ----------------
const mock = { bills: new Map(), llm: new Map(), quotes: new Map(), jobs: 0, calls: [], down: {} }; // down.lalamove / down.print: pretend that service is failing
const realFetch = global.fetch;
const J = (status, data) => new Response(data == null ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

global.fetch = async (url, opts = {}) => {
  const u = new URL(url); const method = (opts.method || 'GET').toUpperCase();
  mock.calls.push(`${method} ${u.host}${u.pathname}`);
  if (u.host === 'rest.sandbox.lalamove.com') {
    // verify the HMAC exactly as Lalamove does
    const [key, time, sig] = String(opts.headers.Authorization).replace('hmac ', '').split(':');
    const raw = `${time}\r\n${method}\r\n${u.pathname}\r\n\r\n${opts.body || ''}`;
    const expect = crypto.createHmac('sha256', process.env.LALAMOVE_API_SECRET).update(raw).digest('hex');
    if (key !== process.env.LALAMOVE_API_KEY || sig !== expect || opts.headers.Market !== 'MY') return J(401, { errors: [{ id: 'ERR_UNAUTHORIZED', message: 'bad signature' }] });
    const body = opts.body ? JSON.parse(opts.body).data : null;
    if (mock.down.lalamove && method === 'POST') return J(503, { errors: [{ id: 'ERR_SERVICE_UNAVAILABLE', message: 'Lalamove is not available (mock)' }] });
    if (method === 'POST' && u.pathname === '/v3/quotations') {
      const [a, b] = body.stops.map((s) => ({ lat: +s.coordinates.lat, lng: +s.coordinates.lng }));
      const km = distanceKm(a, b) * 1.3;
      if (km > 80) return J(422, { errors: [{ id: 'ERR_OUT_OF_SERVICE_AREA' }] });
      const tier = body.pricingTierCode === '2' ? '2' : '1';
      const total = (((body.serviceType === 'CAR' ? 16 : 6) + km * (body.serviceType === 'CAR' ? 1.4 : 0.9)) * (tier === '2' ? 1.365 : 1)).toFixed(1);
      const q = { quotationId: String(Date.now()) + String(Math.random()).slice(2, 6), pricingTierCode: tier, scheduleAt: body.scheduleAt, expiresAt: new Date(Date.now() + 300000).toISOString(), serviceType: body.serviceType,
        priceBreakdown: { total, currency: 'MYR' }, distance: { value: String(Math.round(km * 1000)), unit: 'm' },
        stops: body.stops.map((s, i) => ({ ...s, stopId: `stop${Date.now()}${i}` })) };
      mock.quotes.set(q.quotationId, q);
      return J(201, { data: q });
    }
    if (method === 'POST' && u.pathname === '/v3/orders') {
      const q = mock.quotes.get(body.quotationId);
      if (!q) return J(422, { errors: [{ id: 'ERR_INVALID_QUOTATION_ID' }] });
      if (!/^\+60\d{8,10}$/.test(body.sender.phone) || !/^\+60\d{8,10}$/.test(body.recipients[0].phone)) return J(422, { errors: [{ id: 'ERR_INVALID_PHONE_NUMBER' }] });
      const id = String(3000000000000000000n + BigInt(mock.llm.size + 1));
      const o = { orderId: id, quotationId: q.quotationId, tier: q.pricingTierCode, status: 'ASSIGNING_DRIVER', driverId: '', shareLink: `https://share.sandbox.lalamove.com/?MY${id}`, priceBreakdown: q.priceBreakdown, stops: q.stops, remarks: body.recipients[0].remarks, metadata: body.metadata };
      mock.llm.set(id, o);
      return J(201, { data: o });
    }
    let m;
    if ((m = u.pathname.match(/^\/v3\/orders\/(\d+)\/drivers\/(\w+)$/))) {
      if (method === 'DELETE') {
        const o = mock.llm.get(m[1]);
        if (!o || o.status !== 'ON_GOING' || o.driverId !== m[2]) return J(422, { errors: [{ id: 'ERR_CHANGE_DRIVER_FORBIDDEN', message: 'Driver cannot be changed now' }] });
        o.status = 'ASSIGNING_DRIVER'; o.driverId = ''; o.changedDriver = body?.reason; return J(204);
      }
      return J(200, { data: { driverId: m[2], name: 'Ahmad Driver (demo)', phone: '+60111234567', plateNumber: '**C123*' } });
    }
    if ((m = u.pathname.match(/^\/v3\/orders\/(\d+)\/priority-fee$/)) && method === 'POST') {
      const o = mock.llm.get(m[1]);
      if (!o || o.status !== 'ASSIGNING_DRIVER') return J(422, { errors: [{ id: 'ERR_PRIORITY_FEE_FORBIDDEN', message: 'Order is not looking for a driver' }] });
      if (Number(body.priorityFee) <= Number(o.priorityFee || 0)) return J(422, { errors: [{ id: 'ERR_INVALID_PRIORITY_FEE', message: 'Priority fee must be higher than before' }] });
      o.priorityFee = body.priorityFee; o.priceBreakdown = { ...o.priceBreakdown, priorityFee: body.priorityFee };
      return J(200, { data: o });
    }
    if ((m = u.pathname.match(/^\/v3\/orders\/(\d+)$/))) {
      const o = mock.llm.get(m[1]); if (!o) return J(404, { errors: [{ id: 'ERR_ORDER_NOT_FOUND' }] });
      if (method === 'DELETE') { if (!['ASSIGNING_DRIVER', 'ON_GOING'].includes(o.status)) return J(409, { message: 'ERR_CANCELLATION_FORBIDDEN' }); o.status = 'CANCELED'; return J(204); }
      return J(200, { data: o });
    }
    if (u.pathname === '/v3/cities') return J(200, { data: [{ locode: 'MY KUL', name: 'Kuala Lumpur', services: [{ key: 'MOTORCYCLE', description: 'Motorcycle', specialRequests: [{ name: 'THERMAL_BAG_1', description: 'Thermal bag (demo)' }] }, { key: 'CAR', description: 'Car', specialRequests: [] }] }] });
    if (u.pathname === '/v3/webhook') return J(200, { data: { url: body.url } });
    return J(404, { message: 'not mocked' });
  }
  if (u.host === 'www.billplz-sandbox.com') {
    if (!String(opts.headers.Authorization).startsWith('Basic ')) return J(401, { error: { message: 'Unauthorized' } });
    if (method === 'POST' && u.pathname === '/api/v3/bills') {
      const f = Object.fromEntries(new URLSearchParams(opts.body));
      if (!f.collection_id || !f.amount || !f.callback_url || !(f.email || f.mobile)) return J(422, { error: { type: 'Bad Request', message: ['missing fields'] } });
      const id = 'mb' + crypto.randomBytes(4).toString('hex');
      const bill = { id, collection_id: f.collection_id, paid: false, state: 'due', amount: Number(f.amount), paid_amount: 0, due_at: new Date().toISOString().slice(0, 10), email: f.email || '', mobile: f.mobile || '', name: f.name, url: `${LOCAL}/__mock/billplz/${id}`, callback_url: f.callback_url, redirect_url: f.redirect_url, description: f.description };
      mock.bills.set(id, bill);
      return J(200, bill);
    }
    const m = u.pathname.match(/^\/api\/v3\/bills\/(\w+)$/);
    if (m && mock.bills.has(m[1]) && method === 'DELETE') { if (mock.bills.get(m[1]).paid) return J(422, { error: { message: 'Bill already paid' } }); mock.bills.delete(m[1]); return J(200, {}); }
    if (m && mock.bills.has(m[1])) return J(200, mock.bills.get(m[1]));
    return J(404, { error: { message: 'not found' } });
  }
  if (u.host === 'api.printnode.com') {
    if (u.pathname === '/printers') return J(200, [{ id: 7350001, name: 'Clabel CT221B', computer: { name: 'SELAYANG-PC' }, state: 'online' }, { id: 7350002, name: 'Clabel CT221B', computer: { name: 'BRICKFIELDS-PC' }, state: 'online' }]);
    if (u.pathname === '/printjobs' && mock.down.print) return J(500, { message: 'Printer offline (mock)' });
    if (u.pathname === '/printjobs') {
      const b = JSON.parse(opts.body); const n = ++mock.jobs;
      fs.mkdirSync(PRINT_DIR, { recursive: true });
      fs.writeFileSync(path.join(PRINT_DIR, `job-${n}-printer-${b.printerId}.pdf`), Buffer.from(b.content, 'base64'));
      return J(201, 900000 + n);
    }
  }
  return realFetch(url, opts);
};

// ---------------- mock pages ----------------
async function mockBillplzPage(req, res, id, action) {
  const bill = mock.bills.get(id);
  if (!bill) { res.statusCode = 404; return res.end('no bill'); }
  if (action === 'paysilent') { // demo: paid at Billplz, but its notice never reaches us
    Object.assign(bill, { paid: true, state: 'paid', paid_amount: bill.amount });
    res.setHeader('Content-Type', 'application/json'); return res.end('{"ok":true}');
  }
  if (action === 'pay' || action === 'fail') {
    const paid = action === 'pay';
    if (paid) Object.assign(bill, { paid: true, state: 'paid', paid_amount: bill.amount });
    const paidAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' +0800';
    const cb = { id: bill.id, collection_id: bill.collection_id, paid: String(paid), state: bill.state, amount: String(bill.amount), paid_amount: String(bill.paid_amount), due_at: bill.due_at, email: bill.email, mobile: bill.mobile, name: bill.name, url: bill.url, paid_at: paid ? paidAt : '' };
    cb.x_signature = billplz.sign(cb, process.env.BILLPLZ_X_SIGNATURE_KEY);
    if (paid && process.env.MOCK_SKIP_CALLBACK !== '1') {
      await realFetch(bill.callback_url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(cb).toString() });
    }
    const rd = { 'billplz[id]': bill.id, 'billplz[paid]': String(paid), 'billplz[paid_at]': paid ? paidAt : '' };
    rd['billplz[x_signature]'] = billplz.sign(rd, process.env.BILLPLZ_X_SIGNATURE_KEY);
    res.statusCode = 302; res.setHeader('Location', `${bill.redirect_url}?${new URLSearchParams(rd)}`); return res.end();
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#eef3f8;margin:0;padding:40px 16px">
    <div style="max-width:420px;margin:auto;background:#fff;border-radius:14px;padding:24px;box-shadow:0 4px 20px #0001">
    <p style="color:#888;margin:0">DEMO PAYMENT PAGE (stands in for Billplz)</p><h2>${bill.description}</h2><p>${bill.name}</p>
    <h1 style="margin:10px 0 20px">RM ${(bill.amount / 100).toFixed(2)}</h1>
    <a id="pay" href="/__mock/billplz/${id}/pay" style="display:block;text-align:center;background:#1a73e8;color:#fff;padding:14px;border-radius:10px;text-decoration:none;font-weight:700">Pay with FPX (demo)</a>
    <a href="/__mock/billplz/${id}/fail" style="display:block;text-align:center;margin-top:12px;color:#666">Cancel payment</a></div>`);
}

// demo: move a Lalamove delivery forward and fire the webhook like Lalamove would
async function mockAdvance(req, res, id) {
  const o = mock.llm.get(id); if (!o) { res.statusCode = 404; return res.end('no such delivery'); }
  const next = { ASSIGNING_DRIVER: 'ON_GOING', ON_GOING: 'PICKED_UP', PICKED_UP: 'COMPLETED' }[o.status];
  if (next) { o.status = next; if (next === 'ON_GOING') o.driverId = '80901'; if (next === 'COMPLETED') o.stops[1].POD = { status: 'DELIVERED', image: 'https://example.com/pod.jpg', deliveredAt: new Date().toISOString() }; }
  const payload = { apiKey: process.env.LALAMOVE_API_KEY, timestamp: Date.now(), eventType: next === 'ON_GOING' ? 'DRIVER_ASSIGNED' : 'ORDER_STATUS_CHANGED', eventVersion: 'v3', data: { order: { orderId: id, status: o.status } } };
  const r = await realFetch(`${LOCAL}/api/lalamove-webhook?key=${process.env.LALAMOVE_WEBHOOK_SECRET}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: o.status, webhook: r.status }));
}

// ---------------- server ----------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, LOCAL);
  let m;
  try {
    if ((m = u.pathname.match(/^\/__mock\/billplz\/(\w+)(?:\/(pay|fail|paysilent))?$/))) return await mockBillplzPage(req, res, m[1], m[2]);
    if ((m = u.pathname.match(/^\/__mock\/lalamove\/advance\/(\d+)$/))) return await mockAdvance(req, res, m[1]);
    if (u.pathname === '/__mock/calls') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ calls: mock.calls, llm: [...mock.llm.values()].map((o) => ({ orderId: o.orderId, status: o.status, remarks: o.remarks, metadata: o.metadata, tier: o.tier, priorityFee: o.priorityFee || '', changedDriver: o.changedDriver || '', driverId: o.driverId })) })); }
    // demo: a booking Lalamove doesn't know (like one made with sandbox keys before going live)
    if ((m = u.pathname.match(/^\/__mock\/age\/([\w-]+)\/(\d+)$/))) { const o = await store.getOrder(m[1]); o.createdAt -= Number(m[2]) * 60000; await store.saveOrder(o); res.setHeader('Content-Type', 'application/json'); return res.end('{"ok":true}'); }
    if (u.pathname === '/__mock/sweep') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ due: await require('../lib/fulfil').expireUnpaid(`http://localhost:${PORT}`) })); }
    if (u.pathname === '/__mock/alerts') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(staffAlerts)); }
    if (u.pathname === '/__mock/daily') { const d = require('../lib/daily'); d._reset(); res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(await d.tick())); }
    if ((m = u.pathname.match(/^\/__mock\/down\/(lalamove|print)\/(on|off)$/))) { mock.down[m[1]] = m[2] === 'on'; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(mock.down)); }
    if ((m = u.pathname.match(/^\/__mock\/lalamove\/forget\/(\d+)$/))) { mock.llm.delete(m[1]); res.setHeader('Content-Type', 'application/json'); return res.end('{"ok":true}'); }
    if ((m = u.pathname.match(/^\/__mock\/lalamove\/status\/(\d+)\/(\w+)$/))) { const o = mock.llm.get(m[1]); if (o) o.status = m[2]; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ status: o?.status })); }
    if ((m = u.pathname.match(/^\/__mock\/lalamove\/expire\/(\d+)$/))) { const o = mock.llm.get(m[1]); if (o) o.status = 'EXPIRED'; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ status: o?.status })); }
    if ((m = u.pathname.match(/^\/s\/([\w-]+)$/i))) { req.url = `/api/s?no=${m[1]}`; return await require(path.join(__dirname, '..', 'api', 's.js'))(req, res); }
    if ((m = u.pathname.match(/^\/api\/([\w-]+)$/))) {
      const file = path.join(__dirname, '..', 'api', `${m[1]}.js`);
      if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
      return await require(file)(req, res);
    }
    let p = path.join(__dirname, '..', 'public', decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    if (!p.startsWith(path.join(__dirname, '..', 'public')) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
    fs.createReadStream(p).pipe(res);
  } catch (e) { console.error(e); res.statusCode = 500; res.end('error'); }
});
server.listen(PORT, () => console.log(`Demo shop: ${LOCAL}\nDashboard: ${LOCAL}/admin.html (passcode ${process.env.ADMIN_PASSCODE})\nFake printed labels are saved in ${PRINT_DIR}`));
