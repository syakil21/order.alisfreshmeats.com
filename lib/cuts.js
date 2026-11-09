// Cutting preferences for an order line: by size, by weight per piece, cooking style and a comment.
// The browser sends { by, size, weight, cooking, note }; only clean, allowed values are kept.
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Returns { cut } (null when nothing chosen) or { error }
function normalizeCut(raw, product, settings) {
  if (!raw || typeof raw !== 'object' || !product.cuts) return { cut: null };
  const opts = settings.cutting || {};
  const cut = { by: '', size: '', weight: '', cooking: '', note: clip(raw.note, 120) };

  if (raw.by === 'size') {
    const v = clip(raw.size, 30);
    if (!v) return { error: `Choose a piece size for ${product.name}.` };
    cut.by = 'size';
    cut.size = (opts.sizes || []).find((s) => s.toLowerCase() === v.toLowerCase()) || v; // custom size is free text
  } else if (raw.by === 'weight') {
    const g = Math.round(parseFloat(String(raw.weight).replace(/[^\d.]/g, '')));
    if (!(g >= 5 && g <= 2000)) return { error: `Enter a piece weight between 5 g and 2000 g for ${product.name}.` };
    cut.by = 'weight';
    cut.weight = `${g} g`;
  }

  const ck = clip(raw.cooking, 30);
  if (ck) {
    const match = (opts.cooking || []).find((c) => c.toLowerCase() === ck.toLowerCase());
    if (!match) return { error: `Please choose a cooking style from the list for ${product.name}.` };
    cut.cooking = match;
  }
  if (!cut.by && !cut.cooking && !cut.note) return { cut: null };
  return { cut };
}

// "2 inch" → "2 inch pieces"; custom text like "small cubes" stays as typed
const sizeText = (s) => (/\d\s*(inch|inches|in|cm|mm|")$/i.test(s) ? `${s} pieces` : s);

function cutSummary(cut) {
  if (!cut) return '';
  return [
    cut.by === 'size' ? sizeText(cut.size) : cut.by === 'weight' ? `${cut.weight} per piece` : '',
    cut.cooking,
    cut.note ? `"${cut.note}"` : '',
  ].filter(Boolean).join(' · ');
}

module.exports = { normalizeCut, cutSummary };
