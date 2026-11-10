// GET /api/label?id=…&auth=… — the order label as a PDF (staff only). Backup for printing by hand.
// GET /api/label?sample=1&auth=…[&preview=1] — a sample label (preview=1: as you'll read it, not turned for the printer).
const db = require('../lib/db');
const store = require('../lib/store');
const { query, send, siteUrl, handler } = require('../lib/http');
const { buildLabel } = require('../lib/label');
const { labelOptions, withCategories } = require('../lib/fulfil');
const { SAMPLE_ORDER } = require('./admin');

module.exports = handler(async (req, res) => {
  const q = query(req);
  if (!q.auth || !(await require('../lib/staff').current(await db.get(`sess:${q.auth}`)))) return send(res, 401, 'Please log in to the dashboard first.');
  const order = q.sample ? SAMPLE_ORDER : await store.getOrder(q.id);
  if (!order) return send(res, 404, 'Order not found');
  const [settings, products] = await Promise.all([store.getSettings(), store.getProducts()]);
  const pdf = await buildLabel(withCategories(order, products), { ...labelOptions(settings, order, siteUrl(req), products), preview: q.preview === '1' });
  send(res, 200, pdf, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${order.no}-label.pdf"` });
});
