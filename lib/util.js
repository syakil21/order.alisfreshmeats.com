// Money, phone, time and distance helpers. Money is handled in sen (integer) to avoid rounding errors.
const toSen = (rm) => Math.round(Number(rm || 0) * 100);
const rm = (sen) => (Number(sen || 0) / 100).toFixed(2);

// Malaysian numbers → E.164 (+60…). Returns '' if invalid.
function normalizePhone(input) {
  let d = String(input || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('0')) d = '60' + d.slice(1);
  if (!d.startsWith('60')) d = '60' + d;
  const rest = d.slice(2);
  if (!/^1\d{8,9}$/.test(rest) && !/^[3-9]\d{7,8}$/.test(rest)) return '';
  return '+' + d;
}
function prettyPhone(e164) {
  const d = String(e164 || '').replace(/^\+60/, '0');
  return d.length > 3 ? d.slice(0, 3) + '-' + d.slice(3) : d;
}

// Malaysia is UTC+8 all year (no daylight saving)
const MYT = 8 * 3600 * 1000;
function mytParts(ts = Date.now()) {
  const d = new Date(ts + MYT);
  return { day: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), date: d.toISOString().slice(0, 10) };
}
function hhmmToMin(s) { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function fmtTime(ts) {
  const d = new Date(ts + MYT);
  let h = d.getUTCHours(); const m = String(d.getUTCMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return `${h}:${m}${ap}`;
}
function fmtHHMM(s) { return fmtTime(Date.UTC(2000, 0, 1) - MYT + hhmmToMin(s) * 60000); }
function fmtDateTime(ts) {
  const d = new Date(ts + MYT);
  return `${d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]}, ${fmtTime(ts)}`;
}

// "Today 9:30am", "Tomorrow 9:30am", "Mon 16 Nov 9:30am" (Malaysia time)
function fmtWhen(ts, now = Date.now()) {
  const d = mytParts(ts).date; const t = mytParts(now).date; const tm = mytParts(now + 86400000).date;
  const day = d === t ? 'Today' : d === tm ? 'Tomorrow' : new Date(ts + MYT).toUTCString().slice(0, 11).replace(',', '');
  return `${day} ${fmtTime(ts)}`;
}
// Opening hours for one weekday (0 = Sunday … 6 = Saturday): the usual hours, unless that day has its own
// (hours.days, e.g. Sunday 9am–1pm) or is a closed day. o / c are minutes after midnight.
function dayHours(settings, dow) {
  const h = settings.hours || {};
  const own = h.days?.[dow] || h.days?.[String(dow)];
  const open = own?.open || h.open || '09:00'; const close = own?.close || h.close || '18:00';
  return { open, close, o: hhmmToMin(open), c: hhmmToMin(close), closed: (h.closedDays || []).includes(dow), own: !!own };
}
// When the shop next opens for orders (timestamp), looking up to 8 days ahead. 0 if it never does.
function nextOpenAt(settings, ts = Date.now()) {
  const today = mytParts(ts);
  for (let d = 0; d < 9; d++) {
    const dayStart = Date.parse(`${today.date}T00:00:00+08:00`) + d * 86400000;
    const h = dayHours(settings, mytParts(dayStart).day);
    if (h.closed) continue;
    const at = dayStart + h.o * 60000;
    if (at > ts) return at;
  }
  return 0;
}

// Times a customer can choose for a later delivery: hourly, from about an hour after "as soon as possible",
// never before the shop has had its prep time after opening, up to advance.days days (today counts as one).
function deliverySlots(settings, now = Date.now()) {
  if (!settings.advance?.enabled) return [];
  const prep = Math.max(0, Number(settings.prepMinutes) || 0);
  return pickupSlots(settings, now, { step: 60, days: settings.advance.days, leadMin: prep + 60, afterOpenMin: prep });
}

function shopOpen(settings, ts = Date.now()) {
  if (!settings.acceptingOrders) return { open: false, message: 'Online ordering is paused right now. Please WhatsApp us to order.' };
  if (Number(settings.pausedUntil) > ts) return { open: false, message: `Online ordering is paused until ${fmtTime(Number(settings.pausedUntil))}. Please check back soon.` };
  const { day, minutes } = mytParts(ts);
  const h = dayHours(settings, day);
  const hoursText = `${fmtHHMM(h.open)}–${fmtHHMM(h.close)}`;
  if (h.closed || minutes < h.o || minutes >= h.c) {
    // closed by the clock: customers can still order ahead for the next opening time (if switched on)
    const next = settings.preorder?.enabled ? nextOpenAt(settings, ts) : 0;
    if (next) return { open: false, preorder: true, nextOpenAt: next, message: `We're closed now. Order ahead for ${fmtWhen(next, ts)}.` };
    return { open: false, message: h.closed ? "We're closed today." : `We're closed now. Online orders are taken ${hoursText}.` };
  }
  return { open: true, message: `Open for orders until ${fmtHHMM(h.close)}` };
}

// Self-collection time slots (Malaysia time) from now + prep time, within opening hours, for the next N days.
// opts (for delivery slots): step minutes, days, leadMin (earliest = now + this), afterOpenMin (first slot of a day)
function pickupSlots(settings, now = Date.now(), opts = {}) {
  const p = settings.pickup || {};
  const step = Math.max(10, Number(opts.step ?? p.slotMinutes) || 30);
  const days = Math.min(7, Math.max(1, Number(opts.days ?? p.days) || 2));
  const earliest = now + Math.max(0, Number(opts.leadMin ?? settings.prepMinutes) || 0) * 60000;
  const out = [];
  const today = mytParts(now);
  for (let d = 0; d < days + 7 && out.filter((x, i, a) => i === 0 || a[i - 1].day !== x.day).length <= days; d++) {
    const dayStart = Date.parse(`${today.date}T00:00:00+08:00`) + d * 86400000;
    const h = dayHours(settings, mytParts(dayStart).day); const open = h.o, close = h.c; // each day has its own hours
    if (h.closed) continue;
    const label = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : new Date(dayStart + MYT).toUTCString().slice(0, 11).replace(',', '');
    for (let m = Math.ceil((open + (opts.afterOpenMin || 0)) / step) * step; m <= close; m += step) {
      const at = dayStart + m * 60000;
      if (at < earliest) continue;
      out.push({ at: new Date(at).toISOString(), day: label, time: fmtTime(at), label: `${label} ${fmtTime(at)}` });
    }
    if (new Set(out.map((x) => x.day)).size >= days) break;
  }
  return out;
}

function distanceKm(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function usableBranches(settings) {
  return (settings.branches || []).filter((b) => b.active && b.address && isFinite(parseFloat(b.lat)) && isFinite(parseFloat(b.lng)));
}
function nearestBranch(settings, loc) {
  const list = usableBranches(settings);
  if (!list.length) return null;
  return list
    .map((b) => ({ b, d: distanceKm({ lat: parseFloat(b.lat), lng: parseFloat(b.lng) }, loc) }))
    .sort((x, y) => x.d - y.d)[0].b;
}

// How items are sold: [one, many]. kg can be bought in parts (0.25 / 0.5 / 1 kg steps); the rest are counted.
const UNITS = { kg: ['kg', 'kg'], set: ['set', 'sets'], pc: ['pc', 'pcs'], pack: ['pack', 'packs'], bottle: ['bottle', 'bottles'], bunch: ['bunch', 'bunches'], box: ['box', 'boxes'], tray: ['tray', 'trays'], bird: ['bird', 'birds'] };
function fmtQty(qty, unit) {
  if (unit === 'kg') return `${Number(qty)} kg`;
  return `${qty} ${(UNITS[unit] || UNITS.pc)[qty > 1 ? 1 : 0]}`;
}

module.exports = { dayHours, deliverySlots, UNITS, fmtWhen, nextOpenAt, toSen, rm, normalizePhone, prettyPhone, mytParts, fmtTime, fmtDateTime, fmtHHMM, shopOpen, pickupSlots, distanceKm, usableBranches, nearestBranch, fmtQty, hhmmToMin, MYT };
