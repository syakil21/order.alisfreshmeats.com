// Lalamove API v3 (https://developers.lalamove.com). Market: Malaysia.
const crypto = require('crypto');

const KEY = () => process.env.LALAMOVE_API_KEY || '';
const SECRET = () => process.env.LALAMOVE_API_SECRET || '';
const configured = () => !!(KEY() && SECRET());
const sandbox = () => process.env.LALAMOVE_SANDBOX === 'true' || KEY().startsWith('pk_test');
const base = () => (sandbox() ? 'https://rest.sandbox.lalamove.com' : 'https://rest.lalamove.com');

const ERRORS = {
  ERR_OUT_OF_SERVICE_AREA: 'Sorry, Lalamove does not deliver to this address.',
  ERR_INSUFFICIENT_CREDIT: 'Lalamove wallet balance is too low. Please top up the Lalamove wallet.',
  ERR_INVALID_PHONE_NUMBER: 'Invalid phone number for Lalamove.',
  ERR_INVALID_SERVICE_TYPE: 'Lalamove vehicle type in Settings is not valid for this city.',
  ERR_INVALID_SPECIAL_REQUEST: 'A Lalamove special request in Settings is not valid.',
  ERR_INVALID_QUOTATION_ID: 'Delivery quote expired.',
  ERR_CANCELLATION_FORBIDDEN: 'Lalamove no longer allows cancelling this delivery.',
  ERR_ORDER_NOT_FOUND: 'This booking is not on your Lalamove account (it may have been made with test keys, or removed).',
  ERR_RATE_LIMIT_EXCEEDED: 'Lalamove is busy, please try again in a minute.',
};

async function call(method, path, payload) {
  if (!configured()) { const e = new Error('Lalamove is not set up yet (missing API key).'); e.code = 'NOT_CONFIGURED'; throw e; }
  const time = Date.now().toString();
  const bodyStr = payload ? JSON.stringify(payload) : '';
  const raw = `${time}\r\n${method}\r\n${path}\r\n\r\n${bodyStr}`;
  const sig = crypto.createHmac('sha256', SECRET()).update(raw).digest('hex');
  const r = await fetch(base() + path, {
    method,
    headers: {
      Authorization: `hmac ${KEY()}:${time}:${sig}`,
      Market: 'MY',
      'Request-ID': crypto.randomUUID(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: bodyStr || undefined,
  });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!r.ok) {
    const err0 = data?.errors?.[0] || (Array.isArray(data?.errors) ? null : data?.errors) || {};
    const code = err0.id || data?.message || `HTTP_${r.status}`;
    const e = new Error(ERRORS[code] || [code, err0.detail || err0.message].filter(Boolean).join(': '));
    e.code = code; e.status = r.status;
    throw e;
  }
  return data?.data ?? data;
}

function stop(p) {
  return { coordinates: { lat: String(p.lat), lng: String(p.lng) }, address: String(p.address).slice(0, 500) };
}

// tier: '1' Regular (default) or '2' Priority (faster matching), same as the Lalamove app
async function quote({ pickup, dropoff, serviceType, specialRequests, scheduleAt, tier }) {
  const data = {
    serviceType: serviceType || 'MOTORCYCLE',
    language: 'en_MY',
    stops: [stop(pickup), stop(dropoff)],
  };
  const sr = String(specialRequests || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (sr.length) data.specialRequests = sr;
  if (scheduleAt) data.scheduleAt = scheduleAt;
  if (String(tier || '') === '2') data.pricingTierCode = '2';
  const q = await call('POST', '/v3/quotations', { data });
  return {
    quotationId: q.quotationId,
    expiresAt: q.expiresAt,
    totalRM: Number(q.priceBreakdown?.total || 0),
    currency: q.priceBreakdown?.currency || 'MYR',
    stops: q.stops || [],
    distanceM: Number(q.distance?.value || 0),
    serviceType: q.serviceType,
    tier: String(q.pricingTierCode || data.pricingTierCode || '1'),
  };
}

async function placeOrder({ quote: q, sender, recipient, metadata }) {
  return call('POST', '/v3/orders', {
    data: {
      quotationId: q.quotationId,
      sender: { stopId: q.stops[0].stopId, name: sender.name, phone: sender.phone },
      recipients: [{ stopId: q.stops[1].stopId, name: recipient.name, phone: recipient.phone, remarks: String(recipient.remarks || '').slice(0, 1500) }],
      isPODEnabled: true,
      metadata: metadata || {},
    },
  });
}

const getOrder = (id) => call('GET', `/v3/orders/${id}`);
const getDriver = (orderId, driverId) => call('GET', `/v3/orders/${orderId}/drivers/${driverId}`);
const cancelOrder = (id) => call('DELETE', `/v3/orders/${id}`);
const cities = () => call('GET', '/v3/cities');
// Priority fee (tip): only before a driver accepts; each new amount must be higher than the last.
const addPriorityFee = (id, rm) => call('POST', `/v3/orders/${id}/priority-fee`, { data: { priorityFee: String(Number(rm).toFixed(2)) } });
// Change driver: allowed 15 min after matching, before pickup. No extra fee.
const changeDriver = (id, driverId, reason = 'DRIVER_UNRESPONSIVE') => call('DELETE', `/v3/orders/${id}/drivers/${driverId}`, { data: { reason } });
const setWebhook = (url) => call('PATCH', '/v3/webhook', { data: { url } });

// NOT_FOUND: our record points to a booking Lalamove doesn't have (e.g. made with sandbox keys before going live)
const FINAL_FAIL = ['CANCELED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'NOT_FOUND'];
const isGone = (e) => e?.code === 'ERR_ORDER_NOT_FOUND' || e?.status === 404;

module.exports = { configured, sandbox, quote, placeOrder, getOrder, getDriver, cancelOrder, cities, setWebhook, addPriorityFee, changeDriver, FINAL_FAIL, isGone };
