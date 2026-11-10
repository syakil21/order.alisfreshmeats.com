// POST /api/push — customers turn on notifications (order updates, promotions) for this phone.
const db = require('../lib/db');
const store = require('../lib/store');
const members = require('../lib/members');
const push = require('../lib/push');
const { body, send, ip, safeEqual, handler } = require('../lib/http');

const addId = (list, id) => [...new Set([...(list || []), id])].slice(-5);

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if ((await db.incr(`rl:push:${ip(req)}`, 600)) > 40) return send(res, 429, { error: 'Too many requests.' });
  const b = await body(req);
  if (b.action === 'key') return send(res, 200, { key: await push.publicKey() });

  if (b.action === 'unsubscribe') {
    if (b.endpoint) await push.remove(push.idOf(b.endpoint));
    return send(res, 200, { ok: true });
  }

  if (b.action === 'subscribe') {
    const member = await members.fromRequest(req);
    let id;
    try { id = await push.save(b.subscription, { promos: b.promos === undefined ? undefined : !!b.promos, memberId: member?.id }); }
    catch (e) { return send(res, 400, { error: e.message }); }
    if (member) { member.pushSubs = addId(member.pushSubs, id); await members.save(member); }
    if (b.orderId) {
      const o = await store.getOrder(b.orderId);
      if (o && safeEqual(o.token, b.token)) { o.pushSubs = addId(o.pushSubs, id); await store.saveOrder(o); }
    }
    return send(res, 200, { ok: true, id });
  }
  send(res, 400, { error: 'Unknown action' });
});
