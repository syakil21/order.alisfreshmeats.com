// Builds the order label PDF for the Clabel CT221B.
// widthMm × heightMm is the sticker as you read it (landscape by default, 50 × 30 mm).
// rotate90: the printer feeds the sticker sideways, so the PDF page is portrait and the landscape
// design is turned 90° onto it (stops the driver from rotating it and printing it "portrait").
// Page 1: order number, customer, pickup time, QR to the order in the staff dashboard, then items
// with their cutting preferences. Extra items continue on further labels. Optional: one label per item.
const { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = require('pdf-lib');
const QRCode = require('qrcode');
const { fmtQty, fmtTime, prettyPhone } = require('./util');

const MM = 72 / 25.4;
const black = rgb(0, 0, 0);
// Built-in PDF fonts only cover basic Latin; strip anything else so printing never fails.
const clean = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/·/g, '-').replace(/[^\x20-\x7E]/g, '?');

function fit(font, text, size, maxW) {
  let t = clean(text);
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > maxW) t = t.slice(0, -1);
  return t + '...';
}

// Word-wrap into at most maxLines lines; the last line is shortened with "..." if needed
function wrap(font, text, size, maxW, maxLines = 2) {
  const words = clean(text).split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i];
    if (font.widthOfTextAtSize(next, size) <= maxW) { cur = next; continue; }
    if (cur) lines.push(cur); else { lines.push(fit(font, words[i], size, maxW)); cur = ''; continue; }
    cur = words[i];
    if (lines.length === maxLines - 1) { cur = words.slice(i).join(' '); break; }
  }
  if (cur) lines.push(lines.length >= maxLines ? '' : fit(font, cur, size, maxW));
  return lines.filter(Boolean).slice(0, maxLines);
}

function drawQR(page, text, x, y, size) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'L' });
  const n = qr.modules.size; const cell = size / n;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.modules.get(r, c)) page.drawRectangle({ x: x + c * cell, y: y + size - (r + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: black });
  }
}

async function buildLabel(order, { widthMm = 50, heightMm = 30, perItem = false, rotate90 = false, flip = false, preview = false, qrUrl } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Label ${order.no}`);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = widthMm * MM, H = heightMm * MM, pad = 1.6 * MM, innerW = W - pad * 2;
  const turn = rotate90 && !preview; const upside = flip && !preview;
  const pages = [];
  const newPage = () => {
    const p = pdf.addPage(turn ? [H, W] : [W, H]);
    // Draw everything in "sticker" coordinates (W × H); this matrix places it on the physical page.
    let m = null;
    if (turn && upside) m = [0, -1, 1, 0, 0, W];
    else if (turn) m = [0, 1, -1, 0, H, 0];
    else if (upside) m = [-1, 0, 0, -1, W, H];
    p.pushOperators(pushGraphicsState(), ...(m ? [concatTransformationMatrix(...m)] : []));
    pages.push(p);
    return p;
  };

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
  if (qrUrl) y = Math.min(y, H - pad - qrSize); // full-width lines start below the QR
  y -= 2.5;
  page.drawLine({ start: { x: pad, y }, end: { x: W - pad, y }, thickness: 0.5, color: black });

  // ---- items with cutting preferences (flow onto continuation labels) ----
  // On bigger stickers use the largest text (up to 10 pt) that still fits every item on this label.
  const qtyW = 13 * MM;
  const layout = (size) => {
    const sub = Math.max(5, size - 0.8);
    const list = order.items.map((it) => ({ q: fmtQty(it.qty, it.unit), n: it.name, sub: it.cutText ? wrap(bold, it.cutText, sub, innerW - qtyW, 2) : [] }));
    if (order.address?.notes) list.push({ q: 'Note:', n: order.address.notes, sub: [] });
    const need = list.reduce((h, it) => h + size * 1.25 + it.sub.length * sub * 1.2, 0);
    return { size, sub, list, need };
  };
  let L = layout(small);
  for (let sz = 10; sz > small; sz -= 0.5) { const t = layout(sz); if (t.need <= y - pad) { L = t; break; } }
  const itemSize = L.size; const subSize = L.sub; const items = L.list;
  const lineH = itemSize * 1.25;
  const subH = subSize * 1.2;
  for (const it of items) {
    const need = lineH + it.sub.length * subH;
    if (y - need < pad) {
      page = newPage(); y = H - pad - 7;
      page.drawText(clean(`${order.no} (cont.)`), { x: pad, y, size: 7, font: bold, color: black });
      y -= 1.5;
      page.drawLine({ start: { x: pad, y }, end: { x: W - pad, y }, thickness: 0.5, color: black });
    }
    y -= lineH;
    page.drawText(fit(bold, it.q, itemSize, qtyW - 1), { x: pad, y, size: itemSize, font: bold, color: black });
    page.drawText(fit(reg, it.n, itemSize, innerW - qtyW), { x: pad + qtyW, y, size: itemSize, font: reg, color: black });
    for (const s of it.sub) { y -= subH; page.drawText(s, { x: pad + qtyW, y, size: subSize, font: bold, color: black }); }
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
      if (it.cutText) for (const l of wrap(bold, it.cutText, s + 0.5, innerW, 2)) { yy -= (s + 0.5) * 1.3; p.drawText(l, { x: pad, y: yy, size: s + 0.5, font: bold, color: black }); }
      p.drawText(fit(reg, `${order.no}  ${order.customer.name}`, s, innerW), { x: pad, y: pad + s * 1.3, size: s, font: reg, color: black });
      p.drawText(clean(`Item ${i + 1} of ${order.items.length}`), { x: pad, y: pad * 0.8, size: s, font: reg, color: black });
    });
  }
  for (const p of pages) p.pushOperators(popGraphicsState());
  return Buffer.from(await pdf.save());
}

module.exports = { buildLabel };
