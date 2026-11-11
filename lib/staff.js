// Staff logins for the dashboard. Two roles:
//   super — everything, including editing and deleting orders, prices, settings, insights and staff accounts
//   staff — orders: view, print, Lalamove (tip, change driver, cancel, rebook), contact customers, sold-out and stock
// A staff account can be limited to branches (e.g. only Brickfields): it then only sees and handles those orders.
// The ADMIN_PASSCODE environment variable always logs in as a super admin (the owner's master key).
const crypto = require('crypto');
const db = require('./db');
const { rid } = require('./http');

const KEY = 'staffusers';
const ROLES = ['super', 'staff'];
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

function hash(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(pw), salt, 32).toString('hex') };
}
function checkPassword(pw, u) {
  if (!u?.salt || !u?.hash) return false;
  const a = Buffer.from(hash(pw, u.salt).hash, 'hex'); const b = Buffer.from(u.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function ownerPasscode(pw) {
  const pass = process.env.ADMIN_PASSCODE || '';
  if (!pass) return false;
  const a = crypto.createHash('sha256').update(String(pw || '')).digest(); const b = crypto.createHash('sha256').update(pass).digest();
  return crypto.timingSafeEqual(a, b);
}

const all = async () => (await db.get(KEY)) || [];
const view = ({ hash: _h, salt: _s, ...u }) => u;
const list = async () => (await all()).map(view);
const findByName = async (name) => (await all()).find((u) => norm(u.name) === norm(name)) || null;
const get = async (id) => (await all()).find((u) => u.id === id) || null;

function err(message) { const e = new Error(message); e.status = 400; e.expose = true; return e; }

async function save({ id, name, password, role, active, branches }) {
  const users = await all();
  const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (n.length < 2) throw err('Enter the staff member’s name.');
  if (['owner'].includes(norm(n))) throw err('“Owner” is reserved. Use the person’s name.');
  if (users.some((u) => u.id !== id && norm(u.name) === norm(n))) throw err('Someone already has that name. Add a surname or initial.');
  const r = ROLES.includes(role) ? role : 'staff';
  let u = id ? users.find((x) => x.id === id) : null;
  if (id && !u) throw err('Staff account not found.');
  if (!u) {
    if (String(password || '').length < 4) throw err('Password must be at least 4 characters.');
    u = { id: rid(6), createdAt: Date.now() };
    users.push(u);
  }
  const br = (Array.isArray(branches) ? branches : []).map((x) => String(x).slice(0, 40)).filter(Boolean).slice(0, 20);
  Object.assign(u, { name: n, role: r, active: active !== false, branches: r === 'super' ? [] : br, updatedAt: Date.now() });
  if (password) {
    if (String(password).length < 4) throw err('Password must be at least 4 characters.');
    Object.assign(u, hash(password));
  }
  await db.set(KEY, users);
  return view(u);
}

async function remove(id) {
  const users = await all();
  await db.set(KEY, users.filter((u) => u.id !== id));
}

// Returns { id, name, role } or null
async function login(name, password) {
  const u = name ? await findByName(name) : null;
  if (u && u.active !== false && checkPassword(password, u)) return { id: u.id, name: u.name, role: u.role, branches: u.branches || [] };
  if (ownerPasscode(password)) return { id: 'owner', name: String(name || '').trim().slice(0, 40) || 'Owner', role: 'super', branches: [] };
  return null;
}

// Current role for a session (role changes and turned-off accounts apply straight away)
async function current(sess) {
  if (!sess?.role) return null;
  if (sess.id === 'owner') return sess;
  const u = await get(sess.id);
  if (!u || u.active === false) return null;
  return { id: u.id, name: u.name, role: u.role, branches: u.role === 'super' ? [] : u.branches || [] };
}
// Same as current(), from a session and the staff list that were already read (one database round trip)
function currentFrom(sess, users) {
  if (!sess?.role) return null;
  if (sess.id === 'owner') return sess;
  const u = (users || []).find((x) => x.id === sess.id);
  if (!u || u.active === false) return null;
  return { id: u.id, name: u.name, role: u.role, branches: u.role === 'super' ? [] : u.branches || [] };
}
// Can this person see / handle this order?
const sees = (me, order) => me?.role === 'super' || !(me?.branches || []).length || me.branches.includes(order?.branchId);

module.exports = { ROLES, KEY, list, save, remove, login, current, currentFrom, ownerPasscode, sees };
