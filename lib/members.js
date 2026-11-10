// Customer accounts: sign up / log in with phone or email + password, saved details and addresses,
// and the new member offer (RM off the first paid order, for the first N members).
const crypto = require('crypto');
const db = require('./db');
const { normalizePhone, toSen } = require('./util');
const { rid } = require('./http');

const SESSION_DAYS = 60;
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const normEmail = (e) => String(e || '').trim().toLowerCase().slice(0, 120);

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(pw), salt, 32).toString('hex') };
}
function checkPassword(pw, m) {
  if (!m?.salt || !m?.hash) return false;
  const a = Buffer.from(hashPassword(pw, m.salt).hash, 'hex'); const b = Buffer.from(m.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const get = (id) => (id ? db.get(`member:${id}`) : null);
async function save(m) { m.updatedAt = Date.now(); await db.set(`member:${m.id}`, m); return m; }

async function findByLogin(identifier) {
  const s = String(identifier || '').trim();
  if (s.includes('@')) return get(await db.get(`memberemail:${normEmail(s)}`));
  const phone = normalizePhone(s);
  return phone ? get(await db.get(`memberphone:${phone}`)) : null;
}

function publicView(m) {
  if (!m) return null;
  const { hash, salt, ...rest } = m;
  return rest;
}

function err(message, status = 400) { const e = new Error(message); e.status = status; e.expose = true; return e; }

async function create({ name, phone, email, password }) {
  name = String(name || '').trim().slice(0, 80);
  const p = normalizePhone(phone);
  const e = normEmail(email);
  if (name.length < 2) throw err('Please enter your name.');
  if (!p) throw err('Please enter a valid Malaysian phone number.');
  if (e && !emailOk(e)) throw err('Please check your email address.');
  if (String(password || '').length < 6) throw err('Password must be at least 6 characters.');
  if (await db.get(`memberphone:${p}`)) throw err('This phone number already has an account. Please log in.');
  if (e && (await db.get(`memberemail:${e}`))) throw err('This email already has an account. Please log in.');
  const id = rid(9);
  // claim the phone atomically so two sign-ups can't share it
  if (!(await db.set(`memberphone:${p}`, id, { nx: true }))) throw err('This phone number already has an account. Please log in.');
  if (e && !(await db.set(`memberemail:${e}`, id, { nx: true }))) { await db.del(`memberphone:${p}`); throw err('This email already has an account. Please log in.'); }
  const m = { id, name, phone: p, email: e, ...hashPassword(password), addresses: [], defaultAddressId: '', welcomeUsed: false, createdAt: Date.now() };
  await save(m);
  await db.zadd('members', m.createdAt, id);
  return m;
}

async function updateProfile(m, { name, phone, email }) {
  const n = String(name ?? m.name).trim().slice(0, 80);
  if (n.length < 2) throw err('Please enter your name.');
  const p = phone === undefined ? m.phone : normalizePhone(phone);
  if (!p) throw err('Please enter a valid Malaysian phone number.');
  const e = email === undefined ? m.email : normEmail(email);
  if (e && !emailOk(e)) throw err('Please check your email address.');
  if (p !== m.phone) {
    if (!(await db.set(`memberphone:${p}`, m.id, { nx: true }))) throw err('Another account already uses this phone number.');
    await db.del(`memberphone:${m.phone}`);
  }
  if (e !== m.email) {
    if (e && !(await db.set(`memberemail:${e}`, m.id, { nx: true }))) throw err('Another account already uses this email.');
    if (m.email) await db.del(`memberemail:${m.email}`);
  }
  Object.assign(m, { name: n, phone: p, email: e });
  return save(m);
}

async function setPassword(m, pw) {
  if (String(pw || '').length < 6) throw err('Password must be at least 6 characters.');
  Object.assign(m, hashPassword(pw));
  return save(m);
}

function cleanAddress(a) {
  const lat = parseFloat(a?.lat), lng = parseFloat(a?.lng);
  const text = String(a?.text || '').trim().slice(0, 300);
  if (!text || !isFinite(lat) || !isFinite(lng)) throw err('Please choose the address on the map.');
  return {
    id: a.id && /^[\w-]{4,20}$/.test(a.id) ? a.id : rid(6), label: String(a.label || '').trim().slice(0, 30) || 'Home',
    text, unit: String(a.unit || '').trim().slice(0, 80), notes: String(a.notes || '').trim().slice(0, 300), lat, lng,
  };
}
async function saveAddress(m, raw, { makeDefault } = {}) {
  const a = cleanAddress(raw);
  const i = (m.addresses ||= []).findIndex((x) => x.id === a.id);
  if (i >= 0) m.addresses[i] = a; else { if (m.addresses.length >= 10) throw err('You can save up to 10 addresses.'); m.addresses.push(a); }
  if (makeDefault || !m.defaultAddressId || !m.addresses.some((x) => x.id === m.defaultAddressId)) m.defaultAddressId = a.id;
  await save(m);
  return a;
}
async function deleteAddress(m, id) {
  m.addresses = (m.addresses || []).filter((x) => x.id !== id);
  if (m.defaultAddressId === id) m.defaultAddressId = m.addresses[0]?.id || '';
  return save(m);
}

// ---- sessions ----
async function startSession(m) {
  const token = rid(24);
  await db.set(`msess:${token}`, m.id, { ex: SESSION_DAYS * 86400 });
  return token;
}
const tokenOf = (req) => String(req.headers.authorization || '').replace(/^Bearer /, '').trim();
async function fromRequest(req) {
  const t = tokenOf(req);
  if (!t || t.length < 20) return null;
  return get(await db.get(`msess:${t}`));
}
async function endSession(req) { const t = tokenOf(req); if (t) await db.del(`msess:${t}`); }

// ---- new member offer ----
const welcomeUsedCount = async () => Number(await db.get('welcome:used')) || 0;
const paidOrdersForPhone = async (phone) => Number(await db.get(`phonepaid:${phone}`)) || 0;

// What the offer looks like for this member right now (also used for guests: member = null)
async function welcomeStatus(settings, member) {
  const w = settings.welcome || {};
  const used = await welcomeUsedCount();
  const limit = Math.max(0, Number(w.limit) || 0);
  const out = { enabled: !!w.enabled && Number(w.amount) > 0, amountSen: toSen(w.amount), minSpendSen: toSen(w.minSpend), remaining: Math.max(0, limit - used), eligible: false, reason: '' };
  if (!out.enabled) { out.reason = 'off'; return out; }
  if (!out.remaining) { out.reason = 'Our new member offer has been fully claimed.'; return out; }
  if (!member) { out.reason = 'login'; return out; }
  if (member.welcomeUsed) { out.reason = 'You have already used your new member offer.'; return out; }
  if ((await paidOrdersForPhone(member.phone)) > 0) { out.reason = 'The new member offer is for first orders only.'; return out; }
  out.eligible = true;
  return out;
}

// Called once when an order is paid
function addPoints(m, delta, reason, orderNo) {
  m.points = Math.max(0, Math.round((m.points || 0) + delta));
  (m.pointsLog ||= []).unshift({ at: Date.now(), delta: Math.round(delta), reason, orderNo: orderNo || '' });
  if (m.pointsLog.length > 60) m.pointsLog.length = 60;
}

async function recordPaidOrder(order) {
  if (order.customer?.phone) await db.incr(`phonepaid:${order.customer.phone}`);
  if (!order.memberId) return;
  const m = await get(order.memberId);
  if (!m) return;
  if (order.welcome) {
    await db.incr('welcome:used');
    m.welcomeUsed = true; m.welcomeOrderId = order.id;
  }
  if (order.pointsUsed) {
    const used = Math.min(order.pointsUsed, m.points || 0);
    addPoints(m, -used, 'Used on order', order.no);
  }
  if (order.pointsEarned) addPoints(m, order.pointsEarned, 'Earned on order', order.no);
  m.lastOrderAt = Date.now();
  m.orderCount = (m.orderCount || 0) + 1;
  await save(m);
}

// Undo what recordPaidOrder did (order cancelled or deleted)
async function reversePaidOrder(order) {
  if (order.customer?.phone && Number(await db.get(`phonepaid:${order.customer.phone}`)) > 0) await db.incrby(`phonepaid:${order.customer.phone}`, -1);
  if (!order.memberId) return;
  const m = await get(order.memberId);
  if (!m) return;
  if (order.welcome && m.welcomeOrderId === order.id) {
    if (Number(await db.get('welcome:used')) > 0) await db.incrby('welcome:used', -1);
    m.welcomeUsed = false; m.welcomeOrderId = '';
  }
  if (order.pointsEarned) addPoints(m, -order.pointsEarned, 'Order cancelled', order.no);
  if (order.pointsUsed) addPoints(m, order.pointsUsed, 'Points returned (order cancelled)', order.no);
  m.orderCount = Math.max(0, (m.orderCount || 1) - 1);
  await save(m);
}

async function list(limit = 500) {
  const ids = await db.zrevrange('members', 0, limit - 1);
  return (await db.mget(ids.map((id) => `member:${id}`))).filter(Boolean).map(publicView);
}

module.exports = {
  addPoints, get, save, create, findByLogin, checkPassword, setPassword, updateProfile, saveAddress, deleteAddress, cleanAddress,
  startSession, fromRequest, endSession, publicView, welcomeStatus, recordPaidOrder, reversePaidOrder, welcomeUsedCount, list, normEmail,
};
