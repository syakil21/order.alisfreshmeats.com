// GET /s/AFM-1006 (the QR code on each label) → opens that order in the staff dashboard.
const { query, redirect, handler } = require('../lib/http');

module.exports = handler(async (req, res) => {
  const no = String(query(req).no || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
  redirect(res, no ? `/admin.html#no=${no}` : '/admin.html');
});
