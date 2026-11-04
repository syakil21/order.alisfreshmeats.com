// Builds the order label PDF for the Clabel CT221B (default 50 × 30 mm, set in Settings → Labels).
// Page 1: order number, customer, pickup time, QR to the order in the staff dashboard, then items.
// Extra items continue on further labels. Optional: one extra label per item, to stick on each pack.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const QRCode = require('qrcode');
const { fmtQty, fmtTime, prettyPhone } = require('./util');

const MM = 72 / 25.4;
const black = rgb(0, 0, 0);
// Built-in PDF fonts only cover basic Latin; strip anything else so printing never fails.
const clean = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E]/g, '?');

function fit(font, text, size, maxW) {
  let t = clean(text);
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > maxW) t = t.slice(0, -1);
  return t + '...';
}

function drawQR(page, text, x, y, size) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'L' });
  const n = qr.modules.size; const cell = size / n;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.modules.get(r, c)) page.drawRectangle({ x: x + c * cell, y: y + size - (r + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: black });
  }
}

async function buildLabel(order, { widthMm = 50, heightMm = 30, perItem = false, qrUrl } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Label ${order.no}`);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = widthMm * MM, H = heightMm * MM, pad = 1.6 * MM, innerW = W - pad * 2;
  const pages = [];
  const newPage = () => { const p = pdf.addPage([W, H]); pages.push(p); return p; };

  // ---- first label: header ----
  let page = newPage();
  const qrSize = Math.min(H * 0.5, 13 * MM);
  if (qrUrl) drawQR(page, qrUrl, W - pad - qrSize, H - pad - qrSize, qrSize);
  const headW = innerW - (qrUrl ? qrSize + 1.2 * MM : 0);
  let y = H - pad;
  const noSize = Math.min(15, H / 6.2);
  y -= noSize * 0.82;
  page.drawText(fit(bold, order.no, noSize, headW), { x: pad, y, size: noSize, font: bold, color: black });
  const small = Math.max(5.5, Math.min(7.5, H / 13));
  const line = (p, text, f = reg, size = small, w = innerW) => { y -= size * 1.22; p.drawText(fit(f, text, size, w), { x: pad, y, size, font: f, color: black }); };
  line(page, order.customer.name, bold, small + 0.6, headW);
  line(page, prettyPhone(order.customer.phone), reg, small, headW);
  const pickup = order.delivery?.scheduleAt ? `Pickup ${fmtTime(Date.parse(order.delivery.scheduleAt))}` : 'Pickup ASAP';
  line(page, `${pickup} - ${order.branchName}`, reg, small, headW);
  if (qrUrl && y > H - pad - qrSize - small) y = H - pad - qrSize; // drop below the QR before full-width lines
  y -= 2;
  page.drawLine({ start: { x: pad, y }, end: { x: W - pad, y }, thickness: 0.5, color: black });

  // ---- items (flow onto continuation labels) ----
  const itemSize = small;
  const lineH = itemSize * 1.25;
  const qtyW = 13 * MM;
  const items = order.items.map((it) => ({ q: fmtQty(it.qty, it.unit), n: it.name }));
  if (order.address?.notes) items.push({ q: 'Note:', n: order.address.notes });
  for (const it of items) {
    if (y - lineH < pad) {
      page = newPage(); y = H - pad - 7;
      page.drawText(clean(`${order.no} (cont.)`), { x: pad, y, size: 7, font: bold, color: black });
      y -= 1.5;
      page.drawLine({ start: { x: pad, y }, end: { x: W - pad, y }, thickness: 0.5, color: black });
    }
    y -= lineH;
    page.drawText(fit(bold, it.q, itemSize, qtyW - 1), { x: pad, y, size: itemSize, font: bold, color: black });
    page.drawText(fit(reg, it.n, itemSize, innerW - qtyW), { x: pad + qtyW, y, size: itemSize, font: reg, color: black });
  }

  // page counter on order labels
  const total = pages.length;
  if (total > 1) pages.forEach((p, i) => p.drawText(`${i + 1}/${total}`, { x: W - pad - reg.widthOfTextAtSize(`${i + 1}/${total}`, 5.5), y: pad * 0.6, size: 5.5, font: reg, color: black }));

  // ---- optional: one label per item ----
  if (perItem) {
    order.items.forEach((it, i) => {
      const p = newPage(); let yy = H - pad;
      const big = Math.min(11, H / 7);
      yy -= big; p.drawText(fit(bold, it.name, big, innerW), { x: pad, y: yy, size: big, font: bold, color: black });
      yy -= big * 1.35; p.drawText(fit(bold, fmtQty(it.qty, it.unit), big, innerW), { x: pad, y: yy, size: big, font: bold, color: black });
      const s = Math.max(5.5, Math.min(7, H / 13));
      p.drawText(fit(reg, `${order.no}  ${order.customer.name}`, s, innerW), { x: pad, y: pad + s * 1.3, size: s, font: reg, color: black });
      p.drawText(clean(`Item ${i + 1} of ${order.items.length}`), { x: pad, y: pad * 0.8, size: s, font: reg, color: black });
    });
  }
  return Buffer.from(await pdf.save());
}

module.exports = { buildLabel };
