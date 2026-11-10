// Activity log for troubleshooting: orders, payments, deliveries, printing, staff changes, sign-ups, errors.
// Newest first, last 5000 entries, shown in the staff dashboard → Activity.
const db = require('./db');

const MAX = 5000;
const TYPES = ['order', 'payment', 'delivery', 'print', 'stock', 'staff', 'member', 'push', 'system', 'error'];

async function log(type, msg, extra = {}) {
  try {
    await db.lpush('activity', { at: Date.now(), type: TYPES.includes(type) ? type : 'system', msg: String(msg).slice(0, 400), ...extra }, MAX);
  } catch (e) { console.warn('activity log failed:', e.message); }
}

// Pick a type from an order log message
function typeOf(msg) {
  if (/lalamove|driver|delivery|priority fee|tip/i.test(msg)) return 'delivery';
  if (/paid|payment|billplz/i.test(msg)) return 'payment';
  if (/label|print/i.test(msg)) return 'print';
  return 'order';
}

const list = (start = 0, count = 200) => db.lrange('activity', start, start + count - 1);

module.exports = { log, list, typeOf, TYPES };
