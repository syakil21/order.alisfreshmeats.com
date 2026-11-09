// POST /api/member — customer accounts: sign up, log in, details, saved addresses, orders.
const db = require('../lib/db');
const store = require('../lib/store');
const members = require('../lib/members');
const { body, send, ip, handler, httpError } = require('../lib/http');
const { stage } = require('../lib/stage');

async function me(m) {
  const [settings, customers] = await Promise.all([store.getSettings(), store.getCustomers()]);
  const w = await members.welcomeStatus(settings, m);
  return {
    member: members.publicView(m),
    welcome: w.enabled ? { amount: w.amountSen / 100, minSpend: w.minSpendSen / 100, eligible: w.eligible, remaining: w.remaining, reason: w.eligible ? '' : w.reason } : null,
    discountPct: Number(customers[m.phone]?.discountPct) || 0,
  };
}

const open = {
  async signup(b, req) {
    if ((await db.incr(`rl:signup:${ip(req)}`, 3600)) > 10) throw httpError(429, 'Too many sign-ups from this connection. Please try again later.');
    const m = await members.create(b);
    return { token: await members.startSession(m), ...(await me(m)) };
  },
  async login(b, req) {
    const idKey = String(b.login || '').trim().toLowerCase().slice(0, 120);
    if ((await db.incr(`rl:mlogin:${ip(req)}`, 900)) > 30) throw httpError(429, 'Too many tries. Please wait 15 minutes.');
    if ((await db.incr(`rl:mlogin:${idKey}`, 900)) > 10) throw httpError(429, 'Too many tries for this account. Please wait 15 minutes.');
    const m = await members.findByLogin(b.login);
    if (!m || !members.checkPassword(b.password, m)) throw httpError(401, 'Wrong phone/email or password.');
    return { token: await members.startSession(m), ...(await me(m)) };
  },
};

const authed = {
  me: (b, m) => me(m),
  async logout(b, m, req) { await members.endSession(req); return { ok: true }; },
  async 'profile.save'(b, m) { await members.updateProfile(m, { name: b.name, phone: b.phone, email: b.email }); return me(m); },
  async 'password.change'(b, m) {
    if (!members.checkPassword(b.current, m)) throw httpError(400, 'Your current password is not correct.');
    await members.setPassword(m, b.next);
    return { ok: true };
  },
  async 'address.save'(b, m) { await members.saveAddress(m, b.address, { makeDefault: !!b.makeDefault }); return me(m); },
  async 'address.delete'(b, m) { await members.deleteAddress(m, String(b.id || '')); return me(m); },
  async 'address.default'(b, m) {
    if (!(m.addresses || []).some((a) => a.id === b.id)) throw httpError(404, 'Address not found');
    m.defaultAddressId = b.id; await members.save(m); return me(m);
  },
  async orders(b, m) {
    const ids = await db.zrevrange(`memberorders:${m.id}`, 0, 49);
    const orders = (await db.mget(ids.map((id) => `order:${id}`))).filter(Boolean);
    return {
      orders: orders.map((o) => ({
        no: o.no, createdAt: o.createdAt, totalSen: o.totalSen, paid: o.payment.status === 'paid', stageText: stage(o).text,
        items: o.items.map((i) => i.name).join(', '), link: `/order.html?id=${o.id}&t=${o.token}`,
      })),
    };
  },
};

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const b = await body(req);
  if (open[b.action]) return send(res, 200, await open[b.action](b, req));
  const fn = authed[b.action];
  if (!fn) return send(res, 400, { error: 'Unknown action' });
  const m = await members.fromRequest(req);
  if (!m) return send(res, 401, { error: 'Please log in again.' });
  send(res, 200, await fn(b, m, req));
});
