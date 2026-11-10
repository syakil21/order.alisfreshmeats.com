// Web push notifications (installed app or browser): promotions, order updates, staff new-order alerts.
// The VAPID key pair is created once and kept in the database, so there's nothing to set up.
const crypto = require('crypto');
const webpush = require('web-push');
const db = require('./db');
const activity = require('./activity');

let ready = null;
async function init() {
  if (ready) return ready;
  ready = (async () => {
    let k = await db.get('vapid');
    if (!k?.publicKey) {
      const gen = webpush.generateVAPIDKeys();
      await db.set('vapid', gen, { nx: true });
      k = await db.get('vapid');
    }
    const site = String(process.env.SITE_URL || '');
    webpush.setVapidDetails(/^https:\/\//.test(site) ? site : 'https://order.alisfreshmeats.com', k.publicKey, k.privateKey);
    return k;
  })();
  try { return await ready; } catch (e) { ready = null; throw e; }
}
const publicKey = async () => (await init()).publicKey;
const idOf = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 24);

// Save or update a subscription. Returns its id.
async function save(subscription, { promos, staff, memberId, branches } = {}) {
  if (!subscription?.endpoint || !/^https:\/\//.test(subscription.endpoint) || !subscription.keys?.p256dh || !subscription.keys?.auth) throw new Error('Invalid subscription');
  const id = idOf(subscription.endpoint);
  const prev = (await db.get(`psub:${id}`)) || {};
  const rec = {
    ...prev, id, sub: { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } },
    promos: promos === undefined ? !!prev.promos : !!promos, staff: staff === undefined ? !!prev.staff : !!staff,
    memberId: memberId || prev.memberId || '', createdAt: prev.createdAt || Date.now(), updatedAt: Date.now(),
    branches: Array.isArray(branches) ? branches : prev.branches || [],
  };
  await db.set(`psub:${id}`, rec);
  if (rec.promos) await db.zadd('psubs:promo', rec.createdAt, id); else await db.zrem('psubs:promo', id);
  if (rec.staff) await db.zadd('psubs:staff', rec.createdAt, id); else await db.zrem('psubs:staff', id);
  return id;
}
async function remove(id) {
  await db.del(`psub:${id}`); await db.zrem('psubs:promo', id); await db.zrem('psubs:staff', id);
}

// payload: { title, body, url, tag }
async function sendTo(ids, payload) {
  if (!ids?.length) return { sent: 0, failed: 0 };
  await init();
  let sent = 0, failed = 0;
  const recs = await db.mget([...new Set(ids)].map((id) => `psub:${id}`));
  await Promise.all(recs.filter(Boolean).map(async (r) => {
    try { await webpush.sendNotification(r.sub, JSON.stringify(payload), { TTL: 6 * 3600 }); sent++; }
    catch (e) { failed++; if (e.statusCode === 404 || e.statusCode === 410) await remove(r.id); else console.warn('push failed', e.statusCode, e.body || e.message); }
  }));
  return { sent, failed };
}

async function promoCount() { return (await db.zrevrange('psubs:promo', 0, 99999)).length; }
async function broadcastPromo(payload) {
  const ids = await db.zrevrange('psubs:promo', 0, 99999);
  const r = await sendTo(ids, payload);
  activity.log('push', `Promotion sent: "${payload.title}" to ${r.sent} phone(s)`);
  return r;
}
// branchId: only staff phones for that branch (or all-branch phones) get it
async function notifyStaff(payload, branchId) {
  try {
    let ids = await db.zrevrange('psubs:staff', 0, 999);
    if (branchId && ids.length) {
      const recs = await db.mget(ids.map((id) => `psub:${id}`));
      ids = ids.filter((id, i) => !(recs[i]?.branches || []).length || recs[i].branches.includes(branchId));
    }
    return await sendTo(ids, payload);
  } catch (e) { console.warn('staff push failed', e.message); }
}
// The customer's phones for this order: subscribed on the order page, or via their member account
async function notifyOrder(order, payload) {
  try {
    let ids = [...(order.pushSubs || [])];
    if (order.memberId) { const m = await db.get(`member:${order.memberId}`); ids = ids.concat(m?.pushSubs || []); }
    return await sendTo(ids, { tag: `order-${order.no}`, url: `/order.html?id=${order.id}&t=${order.token}`, ...payload });
  } catch (e) { console.warn('order push failed', e.message); }
}

module.exports = { publicKey, save, remove, sendTo, broadcastPromo, notifyStaff, notifyOrder, promoCount, idOf };
