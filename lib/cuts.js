// Cutting preferences for an order line. Each product offers some of these kinds (store.CUT_MODES):
//   size      — piece size, e.g. "2 inch" (or the customer's own text)
//   weight    — grams per piece, e.g. 50
//   split     — cut each piece into, e.g. "3 pcs" (marrow bones)
//   count     — how many pieces in total (slices)
//   thickness — slice thickness, e.g. "1 inch"
// plus an optional cooking style and a comment. Only clean, allowed values are kept.
// An item can also have its own choices set by the owner (product.options, e.g. Skin: Skin on / Skin off):
// they are kept in cut.opts as { Skin: 'Skin off' }.
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v) => parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));

// Returns { cut } (null when nothing chosen) or { error }
function normalizeCut(raw, product, settings) {
  const groups = product.options || [];
  const must = groups.find((g) => g.required && !(raw && typeof raw === 'object' && raw.opts && raw.opts[g.name]));
  if (must) return { error: `Please choose ${must.name.toLowerCase()} (${must.choices.join(' or ')}) for ${product.name}.` };
  if (!raw || typeof raw !== 'object' || !product.cuts) return { cut: null };
  const opts = settings.cutting || {};
  const modes = product.cutModes || [];
  const cut = { by: '', size: '', weight: '', split: '', count: '', thickness: '', cooking: '', note: clip(raw.note, 120) };
  const pick = (list, v) => (list || []).find((x) => String(x).toLowerCase() === String(v).toLowerCase());

  if (raw.by) {
    if (!modes.includes(raw.by)) return { error: `That cutting choice isn't available for ${product.name}.` };
    cut.by = raw.by;
    if (raw.by === 'size') {
      const v = clip(raw.size, 30);
      if (!v) return { error: `Choose a piece size for ${product.name}.` };
      cut.size = pick(opts.sizes, v) || v; // custom size is free text
    } else if (raw.by === 'weight') {
      const g = Math.round(num(raw.weight));
      if (!(g >= 5 && g <= 2000)) return { error: `Enter a piece weight between 5 g and 2000 g for ${product.name}.` };
      cut.weight = `${g} g`;
    } else if (raw.by === 'split') {
      const n = Math.round(num(raw.split));
      if (!(n >= 2 && n <= 10)) return { error: `Choose how many pieces to cut each ${product.name} into.` };
      cut.split = `${n} pcs`;
    } else if (raw.by === 'count') {
      const n = Math.round(num(raw.count));
      if (!(n >= 1 && n <= 200)) return { error: `Enter how many pieces you want for ${product.name} (1 to 200).` };
      cut.count = String(n);
    } else if (raw.by === 'thickness') {
      const v = clip(raw.thickness, 30);
      if (!v) return { error: `Choose a slice thickness for ${product.name}.` };
      cut.thickness = pick(opts.thickness, v) || v;
    }
  }

  const ck = clip(raw.cooking, 30);
  if (ck) {
    if (!product.cooking) return { error: `Cooking styles aren't offered for ${product.name}.` };
    const match = pick(opts.cooking, ck);
    if (!match) return { error: `Please choose a cooking style from the list for ${product.name}.` };
    cut.cooking = match;
  }
  const chosen = {};
  for (const g of groups) {
    const v = clip(raw.opts?.[g.name], 30); if (!v) continue;
    const match = pick(g.choices, v);
    if (!match) return { error: `Please choose ${g.name.toLowerCase()} from the list for ${product.name}.` };
    chosen[g.name] = match;
  }
  if (Object.keys(chosen).length) cut.opts = chosen;
  if (!cut.by && !cut.cooking && !cut.note && !cut.opts) return { cut: null };
  for (const k of Object.keys(cut)) if (!cut[k]) delete cut[k];
  return { cut };
}

// "2 inch" → "2 inch pieces"; custom text like "small cubes" stays as typed
const sizeText = (s) => (/\d\s*(inch|inches|in|cm|mm|")$/i.test(s) ? `${s} pieces` : s);

function cutSummary(cut) {
  if (!cut) return '';
  const how = { size: () => sizeText(cut.size), weight: () => `${cut.weight} per piece`, split: () => `Cut each into ${cut.split}`, count: () => `${cut.count} pieces`, thickness: () => `${cut.thickness} thick` }[cut.by];
  return [...Object.values(cut.opts || {}), how ? how() : '', cut.cooking, cut.note ? `"${cut.note}"` : ''].filter(Boolean).join(' · ');
}

module.exports = { normalizeCut, cutSummary };
