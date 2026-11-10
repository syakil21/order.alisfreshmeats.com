// Storage: Upstash Redis in production (Vercel Storage → Upstash adds KV_REST_API_URL / KV_REST_API_TOKEN).
// Falls back to an in-memory store only for the local demo (ALLOW_MEMORY_DB=1).
let client = null;

function redis() {
  if (client !== null) return client;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const { Redis } = require('@upstash/redis');
    client = new Redis({ url, token });
  } else {
    if (process.env.ALLOW_MEMORY_DB !== '1') throw new Error('Database not connected: add the Upstash Redis keys (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN).');
    client = false;
  }
  return client;
}

// ---- in-memory fallback (local dev) ----
const mem = global.__afmMem || (global.__afmMem = { kv: new Map(), exp: new Map(), z: new Map() });
const clone = (v) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
function alive(key) {
  const e = mem.exp.get(key);
  if (e && e < Date.now()) { mem.kv.delete(key); mem.exp.delete(key); return false; }
  return mem.kv.has(key);
}

async function get(key) {
  const r = redis();
  if (r) return (await r.get(key)) ?? null;
  return alive(key) ? clone(mem.kv.get(key)) : null;
}

async function set(key, value, opts = {}) {
  const r = redis();
  if (r) {
    const o = {};
    if (opts.ex) o.ex = opts.ex;
    if (opts.nx) o.nx = true;
    const res = await r.set(key, value, o);
    return opts.nx ? res === 'OK' : true;
  }
  if (opts.nx && alive(key)) return false;
  mem.kv.set(key, clone(value));
  if (opts.ex) mem.exp.set(key, Date.now() + opts.ex * 1000); else mem.exp.delete(key);
  return true;
}

async function del(key) {
  const r = redis();
  if (r) return r.del(key);
  mem.kv.delete(key); mem.exp.delete(key);
}

async function incr(key, exSeconds) {
  const r = redis();
  if (r) {
    const n = await r.incr(key);
    if (exSeconds && n === 1) await r.expire(key, exSeconds);
    return n;
  }
  const n = (alive(key) ? Number(mem.kv.get(key)) : 0) + 1;
  mem.kv.set(key, n);
  if (exSeconds && n === 1) mem.exp.set(key, Date.now() + exSeconds * 1000);
  return n;
}

// add (or subtract) a whole number; returns the new value
async function incrby(key, n) {
  const r = redis();
  if (r) return r.incrby(key, Math.round(n));
  const v = (alive(key) ? Number(mem.kv.get(key)) : 0) + Math.round(n);
  mem.kv.set(key, v);
  return v;
}

async function zadd(key, score, member) {
  const r = redis();
  if (r) return r.zadd(key, { score, member });
  const z = mem.z.get(key) || new Map();
  z.set(member, score); mem.z.set(key, z);
}

// newest first
async function zrevrange(key, start, stop) {
  const r = redis();
  if (r) return r.zrange(key, start, stop, { rev: true });
  const z = mem.z.get(key) || new Map();
  return [...z.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]).slice(start, stop + 1);
}

async function mget(keys) {
  if (!keys.length) return [];
  const r = redis();
  if (r) return r.mget(...keys);
  return keys.map((k) => (alive(k) ? clone(mem.kv.get(k)) : null));
}

async function zrem(key, member) {
  const r = redis();
  if (r) return r.zrem(key, member);
  mem.z.get(key)?.delete(member);
}

// members with min <= score <= max, oldest first
async function zrangeByScore(key, min, max) {
  const r = redis();
  if (r) return r.zrange(key, min, max, { byScore: true });
  const z = mem.z.get(key) || new Map();
  return [...z.entries()].filter(([, sc]) => sc >= min && sc <= max).sort((a, b) => a[1] - b[1]).map((e) => e[0]);
}

const parse = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };

// newest-first capped list (activity log)
async function lpush(key, value, max) {
  const r = redis();
  if (r) { await r.lpush(key, JSON.stringify(value)); if (max) await r.ltrim(key, 0, max - 1); return; }
  const l = mem.kv.get(key) || [];
  l.unshift(clone(value)); if (max && l.length > max) l.length = max;
  mem.kv.set(key, l);
}
async function lrange(key, start, stop) {
  const r = redis();
  if (r) return (await r.lrange(key, start, stop)).map(parse);
  return clone((mem.kv.get(key) || []).slice(start, stop + 1)) || [];
}

module.exports = { get, set, del, incr, incrby, zadd, zrem, zrevrange, zrangeByScore, mget, lpush, lrange };
