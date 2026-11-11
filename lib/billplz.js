// Billplz API v3 (https://www.billplz.com/api) — bills, X Signature verification.
const crypto = require('crypto');

const KEY = () => process.env.BILLPLZ_API_KEY || '';
const COLLECTION = () => process.env.BILLPLZ_COLLECTION_ID || '';
const XKEY = () => process.env.BILLPLZ_X_SIGNATURE_KEY || '';
const sandbox = () => process.env.BILLPLZ_SANDBOX === 'true';
const base = () => (sandbox() ? 'https://www.billplz-sandbox.com/api/v3' : 'https://www.billplz.com/api/v3');
const configured = () => !!(KEY() && COLLECTION() && XKEY());

async function call(method, path, form) {
  const r = await fetch(base() + path, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(KEY() + ':').toString('base64'),
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message;
    throw new Error('Billplz: ' + (Array.isArray(msg) ? msg.join(', ') : msg || `HTTP ${r.status}`));
  }
  return data;
}

async function createBill({ amountSen, name, email, mobile, description, callbackUrl, redirectUrl, reference }) {
  if (!configured()) throw new Error('Online payment is not set up yet.');
  const form = {
    collection_id: COLLECTION(),
    name: String(name).slice(0, 255),
    amount: String(amountSen),
    callback_url: callbackUrl,
    redirect_url: redirectUrl,
    description: String(description).slice(0, 200),
    reference_1_label: 'Order No',
    reference_1: reference,
  };
  if (email) form.email = email;
  if (mobile) form.mobile = mobile;
  return call('POST', '/bills', form);
}

const getBill = (id) => call('GET', `/bills/${encodeURIComponent(id)}`);

// Build the X Signature source string: key+value pairs (nested keys like billplz[id] → billplzid),
// sorted ascending case-insensitively, joined with "|".
// Close an unpaid bill so it can no longer be paid (Billplz refuses if it is already paid)
const deleteBill = (id) => call('DELETE', `/bills/${encodeURIComponent(id)}`);

function sourceString(params) {
  return Object.entries(params)
    .filter(([k]) => !/x_signature/.test(k))
    .map(([k, v]) => k.replace(/[[\]]/g, '') + (v ?? ''))
    .sort((a, b) => { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; })
    .join('|');
}
function sign(params, key = XKEY()) {
  return crypto.createHmac('sha256', key).update(sourceString(params)).digest('hex');
}
function verify(params, key = XKEY()) {
  const given = params.x_signature || params['billplz[x_signature]'];
  if (!key || !given) return false;
  const expected = Buffer.from(sign(params, key)); const got = Buffer.from(String(given));
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

module.exports = { configured, sandbox, createBill, getBill, deleteBill, sourceString, sign, verify };
