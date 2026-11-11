// Sales statistics for the staff dashboard (Insights): today, last 7 days, this month or a custom range.
// Counts paid, not-cancelled orders. All days are Malaysia days.
const db = require('./db');
const store = require('./store');
const { MYT, mytParts } = require('./util');

const DAY = 86400000;
const dayStart = (ts) => Date.parse(`${mytParts(ts).date}T00:00:00+08:00`);

function rangeOf(range, from, to, now = Date.now()) {
  const today = dayStart(now);
  if (range === '7d') return { from: today - 6 * DAY, to: now, label: 'Last 7 days', bucket: 'day' };
  if (range === '30d') return { from: today - 29 * DAY, to: now, label: 'Last 30 days', bucket: 'day' };
  if (range === 'month') { const d = mytParts(now).date; return { from: Date.parse(`${d.slice(0, 8)}01T00:00:00+08:00`), to: now, label: 'This month', bucket: 'day' }; }
  if (range === 'lastmonth') {
    const d = mytParts(now).date; const start = Date.parse(`${d.slice(0, 8)}01T00:00:00+08:00`);
    const prev = mytParts(start - DAY).date;
    return { from: Date.parse(`${prev.slice(0, 8)}01T00:00:00+08:00`), to: start - 1, label: 'Last month', bucket: 'day' };
  }
  if (range === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(from || '') && /^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
    const f = Date.parse(`${from}T00:00:00+08:00`); const t = Math.min(now, Date.parse(`${to}T00:00:00+08:00`) + DAY - 1);
    if (t >= f && t - f <= 400 * DAY) return { from: f, to: t, label: `${from} to ${to}`, bucket: t - f < DAY ? 'hour' : 'day' };
  }
  return { from: today, to: now, label: 'Today', bucket: 'hour' };
}

const counted = (o) => o.payment?.status === 'paid' && !o.cancelledAt;
const lalamoveCostSen = (o) => Math.round(((Number(o.delivery?.feeRM) || 0) + (Number(o.delivery?.priorityFeeRM) || 0)) * 100);

function summarize(orders) {
  const paid = orders.filter(counted);
  const s = {
    orders: paid.length, salesSen: 0, itemsSen: 0, discountSen: 0, pointsSen: 0, pointsEarned: 0, smallOrderSen: 0,
    delivery: 0, pickup: 0, priority: 0, saver: 0, deliveryChargedSen: 0, lalamoveSen: 0, rebooked: 0,
    unpaid: orders.filter((o) => o.payment?.status !== 'paid').length, cancelled: orders.filter((o) => o.cancelledAt).length,
    customers: new Set(paid.map((o) => o.customer?.phone)).size, kg: 0,
  };
  for (const o of paid) {
    s.salesSen += o.totalSen; s.discountSen += o.discountSen || 0; s.pointsSen += o.pointsSen || 0; s.pointsEarned += o.pointsEarned || 0;
    s.itemsSen += o.subtotalSen - (o.discountSen || 0) - (o.pointsSen || 0); s.smallOrderSen += o.smallOrderSen || 0;
    s.kg += o.items.reduce((k, i) => k + (i.unit === 'kg' ? i.qty : 0), 0);
    if (o.fulfilment === 'pickup') s.pickup++;
    else {
      s.delivery++; s.deliveryChargedSen += o.deliverySen || 0;
      if (o.delivery?.lalamoveOrderId) s.lalamoveSen += lalamoveCostSen(o);
      if (o.deliveryOption === 'priority') s.priority++;
      if (o.deliveryOption === 'saver') s.saver++;
      if ((o.delivery?.attempts || 0) > 1) s.rebooked++;
    }
  }
  s.aovSen = s.orders ? Math.round(s.salesSen / s.orders) : 0;
  s.deliveryDiffSen = s.deliveryChargedSen - s.lalamoveSen; // + means customers paid more than Lalamove cost
  s.kg = Math.round(s.kg * 10) / 10;
  return s;
}

async function insights({ range, from, to } = {}) {
  const r = rangeOf(range, from, to);
  const len = r.to - r.from + 1;
  const [orders, prevOrders, settings, newMembers] = await Promise.all([
    store.ordersBetween(r.from, r.to), store.ordersBetween(r.from - len, r.from - 1), store.getSettings(),
    db.zrangeByScore('members', r.from, r.to),
  ]);
  const cur = summarize(orders); const prev = summarize(prevOrders);
  const paid = orders.filter(counted);

  // chart: sales per hour (one day) or per day
  const series = [];
  if (r.bucket === 'hour') {
    const open = Number(String(settings.hours?.open || '09:00').split(':')[0]); const close = Number(String(settings.hours?.close || '18:00').split(':')[0]);
    const hrs = paid.map((o) => new Date(o.createdAt + MYT).getUTCHours());
    const lo = Math.min(open, ...hrs), hi = Math.max(close, ...hrs);
    for (let h = lo; h <= hi; h++) series.push({ label: `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`, salesSen: 0, orders: 0, h });
    for (const o of paid) { const b = series.find((x) => x.h === new Date(o.createdAt + MYT).getUTCHours()); if (b) { b.salesSen += o.totalSen; b.orders++; } }
    series.forEach((x) => delete x.h);
  } else {
    for (let t = dayStart(r.from); t <= r.to; t += DAY) {
      const d = mytParts(t).date;
      series.push({ date: d, label: new Date(t + MYT).toUTCString().slice(5, 11).trim(), salesSen: 0, orders: 0 });
    }
    const idx = Object.fromEntries(series.map((x, i) => [x.date, i]));
    for (const o of paid) { const b = series[idx[mytParts(o.createdAt).date]]; if (b) { b.salesSen += o.totalSen; b.orders++; } }
  }

  // best sellers
  const prods = {};
  for (const o of paid) for (const it of o.items) {
    const p = (prods[it.productId || it.name] ||= { name: it.name, unit: it.unit, qty: 0, salesSen: 0, orders: 0 });
    p.qty += it.qty; p.salesSen += it.lineSen; p.orders++;
  }
  const topProducts = Object.values(prods).sort((a, b) => b.salesSen - a.salesSen).slice(0, 10).map((p) => ({ ...p, qty: Math.round(p.qty * 100) / 100 }));

  const branches = {};
  for (const o of paid) { const b = (branches[o.branchName || '—'] ||= { name: o.branchName || '—', orders: 0, salesSen: 0 }); b.orders++; b.salesSen += o.totalSen; }

  const coupons = {};
  for (const o of paid) if (o.couponCode) { const c = (coupons[o.couponCode] ||= { code: o.couponCode, orders: 0, discountSen: 0 }); c.orders++; c.discountSen += o.discountSen || 0; }

  return {
    range: { ...r, key: range || 'today' }, ...cur, newMembers: newMembers.length,
    prev: { salesSen: prev.salesSen, orders: prev.orders, aovSen: prev.aovSen },
    series, topProducts, branches: Object.values(branches).sort((a, b) => b.salesSen - a.salesSen),
    coupons: Object.values(coupons).sort((a, b) => b.orders - a.orders),
  };
}

module.exports = { insights, rangeOf, summarize, lalamoveCostSen };
