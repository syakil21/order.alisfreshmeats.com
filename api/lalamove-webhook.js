// POST /api/lalamove-webhook?key=… — Lalamove delivery updates.
// The webhook only tells us *which* order changed; the status itself is re-read from Lalamove's API,
// so a forged webhook cannot fake a delivery status.
const db = require('../lib/db');
const store = require('../lib/store');
const { body, query, send, safeEqual, handler } = require('../lib/http');
const { refreshDelivery } = require('../lib/fulfil');

function candidateIds(obj, out = new Set(), depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (/orderid/i.test(k) && (typeof v === 'string' || typeof v === 'number')) out.add(String(v));
    else if (typeof v === 'object') candidateIds(v, out, depth + 1);
  }
  return out;
}

module.exports = handler(async (req, res) => {
  // Always answer 200: Lalamove checks the URL returns 200 when you register it.
  if (req.method !== 'POST') return send(res, 200, { ok: true });
  const secret = process.env.LALAMOVE_WEBHOOK_SECRET || '';
  if (!secret || !safeEqual(query(req).key, secret)) return send(res, 200, { ok: true });
  const b = await body(req);
  const ids = [...candidateIds(b.data || b)];
  for (const llmId of ids) {
    const orderId = await db.get(`llm:${llmId}`);
    if (!orderId) continue;
    const order = await store.getOrder(orderId);
    if (!order?.delivery?.lalamoveOrderId) continue;
    if (b.eventType === 'ORDER_REPLACED') {
      // Lalamove support swapped the delivery for a new one — follow the new id in the payload
      const d = order.delivery;
      const newest = ids.find((x) => x !== d.lalamoveOrderId && !(d.previous || []).includes(x));
      if (newest) {
        d.previous = [...(d.previous || []), d.lalamoveOrderId];
        d.lalamoveOrderId = newest;
        await db.set(`llm:${newest}`, order.id);
        store.addLog(order, `Lalamove replaced the delivery with #${newest}`);
      }
    } else if (order.delivery.lalamoveOrderId !== llmId) continue; // update for an old, already-replaced delivery
    try { await refreshDelivery(order); } catch (e) { console.warn('webhook refresh failed', e.message); }
    break;
  }
  send(res, 200, { ok: true });
});
