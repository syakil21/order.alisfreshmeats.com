// End-of-day sales summary, sent as a phone alert to super admins about 20 minutes after closing time.
// Runs from a timer in server.js and whenever a dashboard loads, so a sleeping server catches up when it wakes
// (the summary for a day is sent once: the database remembers it).
const db = require('./db');
const store = require('./store');
const push = require('./push');
const { insights } = require('./insights');
const { mytParts, hhmmToMin, rm, MYT } = require('./util');

const AFTER_CLOSE_MIN = 20;
let nextCheck = 0; let busy = false;

function text(t, label) {
  const parts = [`${t.orders} order${t.orders === 1 ? '' : 's'}${t.orders ? ` (${t.delivery} delivery, ${t.pickup} pickup)` : ''}`];
  for (const b of t.branches || []) parts.push(`${b.name} RM${rm(b.salesSen)}`);
  if (t.prev?.salesSen) { const p = Math.round(((t.salesSen - t.prev.salesSen) / t.prev.salesSen) * 100); parts.push(`${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}% vs the day before`); }
  if (t.unpaid) parts.push(`${t.unpaid} checkout${t.unpaid === 1 ? '' : 's'} not paid`);
  return { title: `${label} sales: RM${rm(t.salesSen)}`, body: parts.join(' · ') };
}

async function tick(now = Date.now()) {
  if (busy || now < nextCheck) return null;
  busy = true;
  try {
    const settings = await store.getSettings();
    const dueMin = hhmmToMin(settings.hours?.close) + AFTER_CLOSE_MIN;
    const { date, minutes } = mytParts(now);
    const dayStart = Date.parse(`${date}T00:00:00+08:00`);
    // the day to report: today once we are past closing, otherwise yesterday (if the server slept through it)
    const today = minutes >= dueMin;
    const day = today ? date : mytParts(dayStart - 1).date;
    nextCheck = dayStart + dueMin * 60000 + (today ? 86400000 : 0);
    if (!settings.dailySummary?.enabled) return null;
    if (!(await db.set(`daily:${day}`, 1, { nx: true, ex: 4 * 86400 }))) return null;
    const t = await insights({ range: 'custom', from: day, to: day });
    const closedDay = (settings.hours?.closedDays || []).includes(new Date(Date.parse(`${day}T12:00:00+08:00`) + MYT).getUTCDay());
    if (!t.orders && (closedDay || !today)) return null; // nothing to say about a closed or long-gone empty day
    const msg = text(t, today ? "Today's" : "Yesterday's");
    await push.notifyStaff({ ...msg, url: '/admin.html', tag: `staff-daily-${day}` }, null, { superOnly: true });
    return msg;
  } catch (e) { console.warn('daily summary failed', e.message); nextCheck = now + 10 * 60000; return null; }
  finally { busy = false; }
}

module.exports = { tick, text, _reset: () => { nextCheck = 0; } };
