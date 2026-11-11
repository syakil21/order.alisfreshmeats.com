(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const saved = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const rm = (sen) => 'RM ' + (Number(sen || 0) / 100).toFixed(2);
  const UNITS = { kg: ['kg', 'kg'], set: ['set', 'sets'], pc: ['pc', 'pcs'], pack: ['pack', 'packs'], bottle: ['bottle', 'bottles'], bunch: ['bunch', 'bunches'], box: ['box', 'boxes'], tray: ['tray', 'trays'], bird: ['bird', 'birds'] };
  const qtyText = (q, u) => (u === 'kg' ? `${q} kg` : `${q} ${(UNITS[u] || UNITS.pc)[q > 1 ? 1 : 0]}`);
  const unitText = (u) => `/${UNITS[u] ? u : 'pc'}`;
  const PLACEHOLDER = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M9 27c-2-8 4-17 14-18 9-1 16 5 16 13 0 7-6 11-13 13-7 2-15 0-17-8Z"/><path d="M16 26c1-5 5-8 10-8" opacity=".6"/><circle cx="31" cy="25" r="3.4"/></svg>';

  let catalog = null;
  const products = {};
  let cart = loadCart();
  const details = saved.get('afm_details') || {};
  let token = saved.get('afm_member');
  let me = null; // { member, welcome, discountPct }
  let picker = null; let selectedSaved = null;
  let couponCode = '';
  const prefs = saved.get('afm_prefs') || {};
  let fulfilment = prefs.fulfilment === 'pickup' ? 'pickup' : 'delivery';
  let deliveryOption = 'regular';
  let pickupBranchId = prefs.pickupBranchId || ''; let pickupDay = ''; let pickupAt = '';
  let when = 'now'; let deliverDay = ''; let deliverAt = ''; // delivery now, or an advance order for a later day and time
  let usePoints = false;
  let quote = null; let quoteSeq = 0; let quoteTimer = null; let paying = false; let quoting = false;

  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 3500); }
  const auth = () => (token ? { Authorization: 'Bearer ' + token } : {});

  // ---------- cart: lines of { key, productId, qty, cut } ----------
  function loadCart() {
    const c = saved.get('afm_cart2');
    if (Array.isArray(c)) return c;
    const old = saved.get('afm_cart'); // older format { productId: qty }
    if (old && typeof old === 'object') { saved.set('afm_cart', null); return Object.entries(old).map(([productId, qty]) => ({ key: productId + '|null', productId, qty, cut: null })); }
    return [];
  }
  const saveCart = () => saved.set('afm_cart2', cart);
  const lineKey = (productId, cut) => productId + '|' + JSON.stringify(cut || null);
  const sizeText = (v) => (/\d\s*(inch|inches|in|cm|mm|")$/i.test(v) ? `${v} pieces` : v);
  function cutText(cut) {
    if (!cut) return '';
    const how = { size: () => sizeText(cut.size), weight: () => `${parseFloat(cut.weight)} g per piece`, split: () => `Cut each into ${cut.split}`, count: () => `${cut.count} pieces`, thickness: () => `${cut.thickness} thick` }[cut.by];
    return [how ? how() : '', cut.cooking, cut.note ? `“${cut.note}”` : ''].filter(Boolean).join(' · ');
  }
  // most of a product the customer can still add (max per order), not counting the line being edited
  function roomFor(p, exceptKey) {
    if (p.stock == null) return 50;
    const other = cart.filter((l) => l.productId === p.id && l.key !== exceptKey).reduce((s, l) => s + l.qty, 0);
    return Math.max(0, Math.round((p.stock - other) * 100) / 100);
  }
  const soldOut = (p) => p.stock != null && p.stock < (Number(p.min) || Number(p.step) || 1) - 1e-9;
  const maxText = (p) => (p.stock == null ? '' : soldOut(p) ? 'Sold out' : `Only ${qtyText(p.stock, p.unit)} left`);
  // returns the amount now in that cart line (may be less than asked when the max per order is reached)
  function addToCart(productId, qty, cut, replaceKey) {
    const p = products[productId];
    let at = cart.length;
    if (replaceKey) { const i = cart.findIndex((x) => x.key === replaceKey); if (i >= 0) { at = i; cart.splice(i, 1); } }
    const key = lineKey(productId, cut);
    const l = cart.find((x) => x.key === key);
    const want = Math.round(((l ? l.qty : 0) + qty) * 100) / 100;
    const q = Math.min(50, roomFor(p, key), want);
    if (q > 0) { if (l) l.qty = q; else cart.splice(at, 0, { key, productId, qty: q, cut: cut || null }); }
    saveCart(); refreshCartViews();
    return q;
  }
  function changeLine(key, dir) {
    const l = cart.find((x) => x.key === key); const p = l && products[l.productId]; if (!p) return;
    const step = Number(p.step) || 1; const min = Number(p.min) || step;
    let q = Math.round((l.qty + dir * step) * 100) / 100;
    if (dir > 0 && !l.qty) q = min;
    if (dir > 0 && q > roomFor(p, key)) return toast(`${p.name}: ${maxText(p).toLowerCase()}.`);
    if (q < min) cart = cart.filter((x) => x !== l); else l.qty = Math.min(50, q);
    saveCart(); refreshCartViews();
  }
  function removeLine(key) { cart = cart.filter((x) => x.key !== key); saveCart(); refreshCartViews(); }
  const productQty = (id) => cart.filter((l) => l.productId === id).reduce((s, l) => s + l.qty, 0);
  const estimate = () => cart.reduce((s, l) => s + Math.round(Number(products[l.productId]?.price || 0) * 100 * l.qty), 0);
  function refreshCartViews() {
    for (const el of $$('.item')) renderCtl(el.dataset.id);
    renderBar();
    if ($('#sheet').classList.contains('show')) { renderLines(); scheduleQuote(); }
  }

  // ---------- menu ----------
  async function load() {
    try {
      const r = await fetch('/api/catalog'); catalog = await r.json();
      if (!r.ok) throw new Error(catalog.error);
    } catch (e) {
      $('#menu').innerHTML = '<p class="notice">Menu could not load. Please refresh, or WhatsApp us to order.</p>';
      return;
    }
    $('#wa').href = `https://wa.me/${catalog.shop.whatsapp}`;
    const chip = $('#openChip');
    chip.textContent = catalog.open ? catalog.openMessage : catalog.preorder ? 'Closed now · order ahead' : 'Closed now';
    chip.className = 'chip ' + (catalog.open ? 'open' : catalog.preorder ? 'pre' : 'closed');
    $('#areaNote').textContent = catalog.shop.deliveryAreaNote || '';
    const notes = [];
    if (!catalog.open) notes.push(catalog.openMessage + (catalog.preorder ? ' Pay now and we prepare your order as soon as we open, or choose a self pickup time.' : ' You can still browse the menu.'));
    if (!catalog.deliveryReady) notes.push('Online delivery is being set up. Please WhatsApp us to order for now.');
    if (notes.length) { $('#notice').hidden = false; $('#notice').textContent = notes.join(' '); }
    $('#checkoutNote').textContent = catalog.shop.checkoutNote || '';
    const last = saved.get('afm_last');
    if (last?.id) { const a = $('#lastOrder'); a.style.display = 'inline-block'; a.href = `/order.html?id=${encodeURIComponent(last.id)}&t=${encodeURIComponent(last.t)}`; a.textContent = `Track your order ${last.no || ''} →`; }

    const cats = [];
    for (const p of catalog.products) { products[p.id] = p; if (!cats.includes(p.category)) cats.push(p.category); }
    cart = cart.filter((l) => products[l.productId] && (products[l.productId].cuts || !l.cut));
    saveCart();

    $('#tabs').innerHTML = cats.map((c, i) => `<a href="#cat-${i}" class="${i === 0 ? 'on' : ''}">${esc(c)}</a>`).join('');
    $('#menu').innerHTML = cats.map((c, i) => `
      <section class="cat" id="cat-${i}">
        <h3>${esc(c)}</h3>
        ${catalog.products.filter((p) => p.category === c).map((p) => `
          <div class="item" data-id="${esc(p.id)}">
            <button class="thumb ${p.image ? '' : 'empty'}" data-open="${esc(p.id)}" aria-label="${esc(p.name)} details">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : PLACEHOLDER}</button>
            <div class="info" data-open="${esc(p.id)}">
              <div class="name">${esc(p.name)}</div>
              ${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}
              <div class="price">RM ${Number(p.price).toFixed(2)}<small>${unitText(p.unit)}</small></div>
              ${p.cuts ? '<div class="cuttag">✂ Choose your cut</div>' : ''}
              ${p.stock != null && (soldOut(p) || p.stock <= 5) ? `<div class="left ${soldOut(p) ? 'out' : ''}">${esc(maxText(p))}</div>` : ''}
            </div>
            <div class="ctl"></div>
          </div>`).join('')}
      </section>`).join('');
    for (const el of $$('.item')) renderCtl(el.dataset.id);
    renderBar();

    const tabs = $$('.tabs a');
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { const i = e.target.id.split('-')[1]; tabs.forEach((t, j) => t.classList.toggle('on', String(j) === i)); }
    }, { rootMargin: '-40% 0px -55% 0px' });
    $$('.cat').forEach((s) => io.observe(s));

    await loadMe();
    setupBell();
    if (location.hash === '#cart' && cart.length) openSheet();
  }

  function stepperHTML(key, qty, unit) {
    return `<div class="stepper"><button data-dec="${esc(key)}" aria-label="Less">−</button><span>${qtyText(qty, unit)}</span><button data-inc="${esc(key)}" aria-label="More">+</button></div>`;
  }
  function renderCtl(id) {
    const el = document.querySelector(`.item[data-id="${CSS.escape(id)}"] .ctl`); const p = products[id];
    if (!el || !p) return;
    el.closest('.item').classList.toggle('soldout', soldOut(p));
    if (soldOut(p) && !productQty(id)) { el.innerHTML = '<span class="soldtag">Sold out</span>'; return; }
    if (p.cuts) {
      const q = productQty(id);
      el.innerHTML = `<button class="add" data-open="${esc(id)}">Add</button>${q ? `<div class="incart">${qtyText(Math.round(q * 100) / 100, p.unit)} in cart</div>` : ''}`;
      return;
    }
    const key = lineKey(id, null); const l = cart.find((x) => x.key === key);
    el.innerHTML = l ? stepperHTML(key, l.qty, p.unit) : `<button class="add" data-quick="${esc(id)}">Add</button>`;
  }
  function renderBar() {
    $('#cartbar').style.display = cart.length ? 'block' : 'none';
    $('#cartCount').textContent = cart.length;
    $('#cartTotal').textContent = rm(estimate());
  }

  document.addEventListener('click', (e) => {
    const t = e.target;
    const quick = t.closest('[data-quick]');
    if (quick) {
      const p = products[quick.dataset.quick];
      if (!addToCart(p.id, Number(p.min) || Number(p.step) || 1, null)) toast(`${p.name}: ${maxText(p).toLowerCase()}.`);
      return;
    }
    const ed = t.closest('[data-edit]'); if (ed) { const l = cart.find((x) => x.key === ed.dataset.edit); if (l) openItem(l.productId, l); return; }
    const rmv = t.closest('[data-remove]'); if (rmv) return removeLine(rmv.dataset.remove);
    const inc = t.closest('[data-inc]'); if (inc) return changeLine(inc.dataset.inc, 1);
    const dec = t.closest('[data-dec]'); if (dec) return changeLine(dec.dataset.dec, -1);
    const open = t.closest('[data-open]'); if (open) return openItem(open.dataset.open);
    if (t.closest('[data-close]')) closeSheet();
    if (t.closest('[data-close-item]')) closeItem();
  });

  // ---------- product sheet (photo, amount, cutting preferences); also edits a cart line ----------
  const MODE_LABEL = { size: 'By size', weight: 'By piece weight', split: 'Cut each into', count: 'Number of pieces', thickness: 'Slice thickness' };
  let item = null;
  function openItem(id, line) {
    const p = products[id]; if (!p) return;
    const c = catalog.cutting || {};
    const modes = p.cutModes || [];
    item = { p, qty: Number(p.min) || Number(p.step) || 1, by: modes.length === 1 && !p.cooking ? modes[0] : '', size: '', sizeCustom: '', weight: '', weightCustom: '', split: '', count: '', thickness: '', thicknessCustom: '', cooking: '', note: '', editKey: '' };
    if (line) {
      const cut = line.cut || {};
      Object.assign(item, { qty: line.qty, editKey: line.key, by: cut.by || item.by, cooking: cut.cooking || '', note: cut.note || '' });
      const inList = (list, v) => (list || []).map(String).some((x) => x.toLowerCase() === String(v).toLowerCase());
      if (cut.by === 'size') { if (inList(c.sizes, cut.size)) item.size = cut.size; else { item.size = 'custom'; item.sizeCustom = cut.size; } }
      if (cut.by === 'weight') { const g = String(parseFloat(cut.weight)); if (inList(c.weights, g)) item.weight = g; else { item.weight = 'custom'; item.weightCustom = g; } }
      if (cut.by === 'split') item.split = cut.split;
      if (cut.by === 'count') item.count = String(cut.count);
      if (cut.by === 'thickness') { if (inList(c.thickness, cut.thickness)) item.thickness = cut.thickness; else { item.thickness = 'custom'; item.thicknessCustom = cut.thickness; } }
    } else {
      const room = roomFor(p);
      if (p.stock != null && room < item.qty) { item.full = true; }
    }
    renderItem();
    $('#itemSheet').classList.add('show'); document.body.style.overflow = 'hidden';
  }
  function closeItem() { $('#itemSheet').classList.remove('show'); if (!$('#sheet').classList.contains('show')) document.body.style.overflow = ''; item = null; }
  const chip = (attr, val, on, label) => `<button type="button" class="opt ${on ? 'on' : ''}" ${attr}="${esc(val)}">${esc(label)}</button>`;
  const singleMode = (p) => (p.cutModes || []).length === 1 && !p.cooking;
  function modeOptions(by) {
    const c = catalog.cutting || {};
    if (by === 'size') return `<div class="opts sub">${(c.sizes || []).map((v) => chip('data-size', v, item.size === v, v)).join('')}${chip('data-size', 'custom', item.size === 'custom', 'Custom')}</div>
      ${item.size === 'custom' ? '<input class="inp" id="sizeCustom" maxlength="30" placeholder="e.g. 1.5 inch, small cubes">' : ''}`;
    if (by === 'weight') return `<div class="opts sub">${(c.weights || []).map((g) => chip('data-weight', g, String(item.weight) === String(g), `${g} g`)).join('')}${chip('data-weight', 'custom', item.weight === 'custom', 'Custom')}</div>
      ${item.weight === 'custom' ? '<div class="withunit"><input class="inp" id="weightCustom" type="number" inputmode="numeric" min="5" max="2000" placeholder="Weight per piece"><span>g</span></div>' : ''}`;
    if (by === 'split') return `<div class="opts sub">${(c.splits || ['2 pcs', '3 pcs']).map((v) => chip('data-split', v, item.split === v, v)).join('')}</div>`;
    if (by === 'count') return `<div class="withunit" style="margin-top:10px"><input class="inp" id="countIn" type="number" inputmode="numeric" min="1" max="200" placeholder="How many pieces"><span>pieces</span></div>`;
    if (by === 'thickness') return `<div class="opts sub">${(c.thickness || []).map((v) => chip('data-thick', v, item.thickness === v, v)).join('')}${chip('data-thick', 'custom', item.thickness === 'custom', 'Custom')}</div>
      ${item.thickness === 'custom' ? '<input class="inp" id="thickCustom" maxlength="30" placeholder="e.g. 0.75 inch">' : ''}`;
    return '';
  }
  function renderItem() {
    const { p } = item; const c = catalog.cutting || {};
    const modes = p.cutModes || [];
    let cutHTML = '';
    if (p.cuts) {
      let howHTML = '';
      if (singleMode(p)) howHTML = `<h5>${esc(MODE_LABEL[modes[0]])}</h5>${modeOptions(modes[0]).replace('opts sub', 'opts')}`;
      else if (modes.length) howHTML = `<h5>How should we cut it?</h5>
          <div class="opts">${chip('data-by', '', !item.by, 'No preference')}${modes.map((m) => chip('data-by', m, item.by === m, MODE_LABEL[m])).join('')}</div>
          ${modeOptions(item.by)}`;
      cutHTML = `
        <div class="cutbox">
          ${howHTML}
          ${p.cooking && (c.cooking || []).length ? `<h5>Cooking style <i>(optional)</i></h5><div class="opts">${(c.cooking || []).map((k) => chip('data-cook', k, item.cooking === k, k)).join('')}</div>` : ''}
          <h5>Comment <i>(optional)</i></h5>
          <textarea class="inp" id="cutNote" rows="2" maxlength="120" placeholder="e.g. remove fat, keep bones separate"></textarea>
        </div>`;
    }
    const room = roomFor(p, item.editKey);
    $('#itemBody').innerHTML = `
      <div class="ihero ${p.image ? '' : 'empty'}">${p.image ? `<img src="${esc(p.image)}" alt="">` : PLACEHOLDER}</div>
      <div class="ihead">
        <h3 id="itemTitle">${esc(p.name)}</h3>
        ${p.note ? `<p class="muted">${esc(p.note)}</p>` : ''}
        <div class="iprice">RM ${Number(p.price).toFixed(2)}<small>${unitText(p.unit)}</small></div>
        <div class="qtyrow"><span>Amount</span><div class="stepper"><button data-iq="-1" aria-label="Less">−</button><span>${qtyText(item.qty, p.unit)}</span><button data-iq="1" aria-label="More" ${item.qty + (Number(p.step) || 1) > room + 1e-9 ? 'disabled' : ''}>+</button></div></div>
        ${p.stock != null ? `<div class="capnote">${esc(maxText(p))}${room < p.stock && !item.editKey ? ` · ${qtyText(Math.max(0, room), p.unit)} more can be added` : ''}</div>` : ''}
      </div>
      ${cutHTML}`;
    const bind = (id, key) => { const el = $(id); if (el) { el.value = item[key]; el.addEventListener('input', () => { item[key] = el.value; }); } };
    bind('#sizeCustom', 'sizeCustom'); bind('#weightCustom', 'weightCustom'); bind('#countIn', 'count'); bind('#thickCustom', 'thicknessCustom'); bind('#cutNote', 'note');
    const full = room < (Number(p.min) || Number(p.step) || 1) - 1e-9;
    const btn = $('#itemAdd');
    btn.disabled = full;
    btn.textContent = full ? (soldOut(p) ? 'Sold out' : 'All remaining stock is in your cart') : `${item.editKey ? 'Update item' : 'Add to cart'} · ${rm(Math.round(p.price * 100 * item.qty))}`;
  }
  $('#itemBody').addEventListener('click', (e) => {
    if (!item) return;
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    if (d.iq) {
      const step = Number(item.p.step) || 1; const min = Number(item.p.min) || step;
      const room = roomFor(item.p, item.editKey);
      const next = Math.round((item.qty + Number(d.iq) * step) * 100) / 100;
      if (Number(d.iq) > 0 && next > room + 1e-9) return toast(`${maxText(item.p)}.`);
      item.qty = Math.min(50, Math.max(min, next));
    } else if ('by' in d) { item.by = d.by; }
    else if (d.size) item.size = d.size;
    else if (d.weight) item.weight = d.weight;
    else if (d.split) item.split = item.split === d.split && !singleMode(item.p) ? '' : d.split;
    else if (d.thick) item.thickness = d.thick;
    else if (d.cook) item.cooking = item.cooking === d.cook ? '' : d.cook;
    else return;
    renderItem();
    if (d.size === 'custom') $('#sizeCustom')?.focus();
    if (d.weight === 'custom') $('#weightCustom')?.focus();
    if (d.thick === 'custom') $('#thickCustom')?.focus();
    if (d.by === 'count') $('#countIn')?.focus();
  });
  $('#itemAdd').addEventListener('click', () => {
    if (!item) return;
    const { p } = item;
    let cut = null;
    if (p.cuts) {
      cut = { by: item.by, cooking: item.cooking, note: item.note.trim().slice(0, 120) };
      if (item.by === 'size') {
        cut.size = item.size === 'custom' ? item.sizeCustom.trim().slice(0, 30) : item.size;
        if (!cut.size) return toast(item.size === 'custom' ? 'Type the piece size you want.' : 'Choose a piece size.');
      }
      if (item.by === 'weight') {
        const g = Math.round(parseFloat(item.weight === 'custom' ? item.weightCustom : item.weight));
        if (!(g >= 5 && g <= 2000)) return toast(item.weight === 'custom' ? 'Enter a piece weight between 5 and 2000 g.' : 'Choose a piece weight.');
        cut.weight = String(g);
      }
      if (item.by === 'split') {
        if (!item.split) return toast(singleMode(p) ? `Choose how to cut: ${(catalog.cutting.splits || []).join(' or ')}.` : 'Choose how many pieces to cut each into.');
        cut.split = item.split;
      }
      if (item.by === 'count') {
        const n = Math.round(parseFloat(item.count));
        if (!(n >= 1 && n <= 200)) return toast('Enter how many pieces you want (1 to 200).');
        cut.count = String(n);
      }
      if (item.by === 'thickness') {
        cut.thickness = item.thickness === 'custom' ? item.thicknessCustom.trim().slice(0, 30) : item.thickness;
        if (!cut.thickness) return toast(item.thickness === 'custom' ? 'Type the slice thickness.' : 'Choose a slice thickness.');
      }
      for (const k of Object.keys(cut)) if (!cut[k]) delete cut[k];
      if (!cut.by && !cut.cooking && !cut.note) cut = null;
    }
    const got = addToCart(p.id, item.qty, cut, item.editKey);
    if (!got) toast(`${p.name}: ${maxText(p).toLowerCase()}.`);
    else toast(item.editKey ? `Updated ${p.name}` : `Added ${qtyText(got < item.qty ? got : item.qty, p.unit)} ${p.name}${got < item.qty ? ` (max per order)` : ''}`);
    closeItem();
  });

  // ---------- member ----------
  async function loadMe() {
    if (token) {
      try {
        const r = await fetch('/api/member', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ action: 'me' }) });
        if (r.status === 401) { token = null; saved.set('afm_member', null); }
        else if (r.ok) me = await r.json();
      } catch {}
    }
    $('#acctText').textContent = me ? `Hi, ${me.member.name.split(' ')[0]}` : 'Log in';
    const w = catalog.welcome; const box = $('#offer');
    if (w && !me) {
      box.hidden = false;
      box.innerHTML = `<b>New member? Get RM${w.amount} off your first order.</b> <span>${w.minSpend ? `Min. spend RM${w.minSpend}. ` : ''}Only ${w.remaining} left.</span> <a href="/account.html?signup=1&next=${encodeURIComponent('/')}">Sign up</a>`;
    } else if (me?.welcome?.eligible) {
      box.hidden = false;
      box.innerHTML = `<b>Your RM${me.welcome.amount} new member offer is ready.</b> <span>It comes off at checkout${me.welcome.minSpend ? ` (min. spend RM${me.welcome.minSpend})` : ''}.</span>`;
    } else box.hidden = true;
  }

  // ---------- deal alerts (push) ----------
  function setupBell() {
    const b = $('#bell'); if (!b || !window.AFM) return;
    const sup = AFM.push.support();
    if (sup === 'unsupported') return;
    b.hidden = false;
    const paint = () => { const on = AFM.push.promosOn(); b.classList.toggle('on', on); $('#bellText').textContent = on ? 'Deal alerts on' : 'Get deal alerts'; };
    paint();
    b.addEventListener('click', async () => {
      try {
        if (AFM.push.promosOn()) { await AFM.push.disable(); toast('Deal alerts turned off.'); }
        else { await AFM.push.enable({ promos: true, memberToken: token }); toast('Done! We’ll let you know about promotions.'); }
      } catch (e) { toast(e.message); }
      paint();
    });
  }

  // ---------- checkout ----------
  function openSheet() {
    $('#sheet').classList.add('show'); document.body.style.overflow = 'hidden';
    renderDetails();
    if (!catalog.pickup) fulfilment = 'delivery';
    if (!picker) {
      const br = catalog.pickup?.branches?.[0];
      picker = AddressPicker($('#picker'), { mapsKey: catalog.mapsKey, toast, onChange: onAddressChange, center: br && isFinite(parseFloat(br.lat)) ? { lat: parseFloat(br.lat), lng: parseFloat(br.lng) } : null });
      const def = me?.member.addresses?.find((a) => a.id === me.member.defaultAddressId) || me?.member.addresses?.[0];
      if (def) selectSaved(def.id);
      else if (details.address?.text) { picker.set(details.address, { silent: true }); $('#unit').value ||= details.unit || ''; }
    }
    renderFulfil();
    renderLines(); renderSavedAddrs(); scheduleQuote(0);
  }
  function closeSheet() { $('#sheet').classList.remove('show'); document.body.style.overflow = ''; }
  $('#openCart').addEventListener('click', openSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('#itemSheet').classList.contains('show')) closeItem(); else closeSheet(); } });

  function renderDetails() {
    const bar = $('#loginBar');
    if (me) {
      const m = me.member;
      bar.innerHTML = `Ordering as <b>${esc(m.name)}</b> · ${esc(m.phone.replace(/^\+60/, '0'))}${m.email ? ` · ${esc(m.email)}` : ''} <a href="/account.html">My account</a>`;
      $('#guestFields').hidden = true;
    } else {
      const w = catalog.welcome;
      bar.innerHTML = `Have an account? <a href="/account.html?next=${encodeURIComponent('/#cart')}">Log in</a>${w ? ` · New member? <a href="/account.html?signup=1&next=${encodeURIComponent('/#cart')}">Sign up</a> and get RM${w.amount} off` : ''}`;
      $('#guestFields').hidden = false;
      $('#name').value ||= details.name || ''; $('#phone').value ||= details.phone || ''; $('#email').value ||= details.email || '';
    }
  }

  function renderLines() {
    if (!cart.length) { $('#lines').innerHTML = '<div class="empty">Your cart is empty.</div>'; return; }
    $('#lines').innerHTML = cart.map((l) => {
      const p = products[l.productId];
      const ct = cutText(l.cut);
      return `<div class="line"><div><div class="n">${esc(p.name)}</div>${ct ? `<div class="cut">✂ ${esc(ct)}</div>` : ''}<div class="s">RM ${Number(p.price).toFixed(2)}${unitText(p.unit)}</div>
          <div class="tools">${p.cuts ? `<button type="button" data-edit="${esc(l.key)}">${l.cut ? 'Edit cut' : 'Add cutting preference'}</button>` : ''}<button type="button" class="rm" data-remove="${esc(l.key)}">Remove</button></div></div>
        ${stepperHTML(l.key, l.qty, p.unit)}<div></div><div class="amt">${rm(Math.round(p.price * 100 * l.qty))}</div></div>`;
    }).join('');
  }

  // ---------- delivery or self pickup ----------
  function renderFulfil() {
    const canPickup = !!catalog.pickup;
    $('#fulfilSec').hidden = !canPickup;
    $$('#fulfilSeg [data-ful]').forEach((b) => b.classList.toggle('on', b.dataset.ful === fulfilment));
    $('#deliverySec').hidden = fulfilment !== 'delivery';
    $('#pickupSec').hidden = fulfilment !== 'pickup';
    if (fulfilment === 'delivery') picker.start();
    if (fulfilment === 'pickup') {
      const list = catalog.pickup.branches;
      if (!list.some((b) => b.id === pickupBranchId)) pickupBranchId = list[0]?.id || '';
      $('#pickupBranches').innerHTML = list.map((b) => chip('data-pbranch', b.id, b.id === pickupBranchId, b.name)).join('');
      const b = list.find((x) => x.id === pickupBranchId);
      $('#shopCard').hidden = !b;
      if (b) $('#shopCard').innerHTML = `<b>Ali's Fresh Meats ${esc(b.name)}</b>${esc(b.address)}${b.lat ? `<br><a href="https://maps.google.com/?q=${encodeURIComponent(b.lat + ',' + b.lng)}" target="_blank" rel="noopener">Open in Maps</a>` : ''}`;
    }
    renderSlots();
  }
  function renderSlots() {
    const slots = (fulfilment === 'pickup' && quote?.fulfilment === 'pickup' && quote.pickupSlots) || [];
    const days = [...new Set(slots.map((x) => x.day))];
    if (!days.includes(pickupDay)) pickupDay = days[0] || '';
    if (pickupAt && !slots.some((x) => x.at === pickupAt)) pickupAt = '';
    $('#slotDays').innerHTML = days.length > 1 ? days.map((d) => chip('data-pday', d, d === pickupDay, d)).join('') : '';
    $('#slots').innerHTML = slots.filter((x) => x.day === pickupDay).map((x) => chip('data-pslot', x.at, x.at === pickupAt, x.time)).join('');
    const msg = $('#pickupMsg');
    if (fulfilment !== 'pickup' || !quote || quote.fulfilment !== 'pickup') msg.textContent = '';
    else if (!slots.length) { msg.className = 'msg err'; msg.textContent = 'No pickup times left. Please choose delivery or WhatsApp us.'; }
    else if (!pickupAt) { msg.className = 'msg'; msg.textContent = `Choose a time${days.length === 1 ? ` (${days[0].toLowerCase()})` : ''}. We have it cut and packed for you.`; }
    else { const sl = slots.find((x) => x.at === pickupAt); msg.className = 'msg ok'; msg.textContent = `Pickup ${sl.label.replace(/^(Today|Tomorrow)/, (m) => m.toLowerCase())}`; }
  }
  $('#fulfilSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ful]'); if (!b || b.dataset.ful === fulfilment) return;
    fulfilment = b.dataset.ful; prefs.fulfilment = fulfilment; saved.set('afm_prefs', prefs);
    quote = null; renderFulfil(); renderSummary(); scheduleQuote(0);
  });
  $('#pickupSec').addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.pbranch) { pickupBranchId = t.dataset.pbranch; prefs.pickupBranchId = pickupBranchId; saved.set('afm_prefs', prefs); renderFulfil(); scheduleQuote(0); }
    else if (t.dataset.pday) { pickupDay = t.dataset.pday; renderSlots(); }
    else if (t.dataset.pslot) { pickupAt = t.dataset.pslot; renderSlots(); scheduleQuote(0); }
  });
  $('#speed').addEventListener('change', (e) => { if (e.target.name === 'speed') { deliveryOption = e.target.value; scheduleQuote(0); } });
  // ---- delivery now or later (advance order) ----
  const lower = (s) => s.replace(/^(Today|Tomorrow)/, (m) => m.toLowerCase());
  function renderWhen() {
    const slots = (fulfilment === 'delivery' && quote?.fulfilment === 'delivery' && quote.deliverySlots) || [];
    const box = $('#whenBox');
    box.hidden = !slots.length;
    if (!slots.length) { when = 'now'; deliverAt = ''; return; }
    const days = [...new Set(slots.map((x) => x.day))];
    if (!days.includes(deliverDay)) deliverDay = days[0];
    if (deliverAt && !slots.some((x) => x.at === deliverAt)) deliverAt = '';
    $('#whenSeg').innerHTML = chip('data-when', 'now', when === 'now', quote.preorder ? 'When the shop opens' : 'As soon as possible') + chip('data-when', 'later', when === 'later', 'Choose a day and time');
    $('#laterBox').hidden = when !== 'later';
    $('#dDays').innerHTML = days.map((d) => chip('data-dday', d, d === deliverDay, d)).join('');
    $('#dSlots').innerHTML = slots.filter((x) => x.day === deliverDay).map((x) => chip('data-dslot', x.at, x.at === deliverAt, x.time)).join('');
    const msg = $('#whenMsg'); const sl = slots.find((x) => x.at === deliverAt);
    if (when !== 'later') { msg.className = 'msg'; msg.textContent = ''; }
    else if (!sl) { msg.className = 'msg'; msg.textContent = 'Choose the day and time. Our driver leaves the shop around then.'; }
    else { msg.className = 'msg ok'; msg.textContent = `Driver leaves our shop around ${lower(sl.label)}`; }
  }
  $('#whenBox').addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.when) { when = t.dataset.when; if (when === 'now') deliverAt = ''; renderWhen(); updatePay(); scheduleQuote(0); }
    else if (t.dataset.dday) { deliverDay = t.dataset.dday; renderWhen(); }
    else if (t.dataset.dslot) { deliverAt = t.dataset.dslot; renderWhen(); scheduleQuote(0); }
  });
  function renderSpeed() {
    renderWhen();
    const box = $('#speed');
    const opts = fulfilment === 'delivery' && quote?.deliveryOptions || [];
    box.hidden = opts.length < 2;
    if (opts.length < 2) { box.innerHTML = ''; return; }
    deliveryOption = quote.deliveryOption;
    box.innerHTML = opts.map((o) => `<label class="${o.id === deliveryOption ? 'on' : ''}"><input type="radio" name="speed" value="${esc(o.id)}" ${o.id === deliveryOption ? 'checked' : ''}><span class="t"><b>${esc(o.label)}</b><span>${esc(o.desc)}</span></span><span class="p">${rm(o.feeSen)}</span></label>`).join('');
  }

  // saved addresses (members)
  function renderSavedAddrs() {
    const list = me?.member.addresses || [];
    const box = $('#savedAddrs');
    box.hidden = !list.length;
    box.innerHTML = list.map((a) => `<button type="button" class="opt ${selectedSaved === a.id ? 'on' : ''}" data-saved="${esc(a.id)}">${esc(a.label)}</button>`).join('')
      + `<button type="button" class="opt ${!selectedSaved ? 'on' : ''}" data-saved="">+ New address</button>`;
    $('#saveAddrRow').hidden = !(me && !selectedSaved && picker?.get());
  }
  function selectSaved(id) {
    const a = (me?.member.addresses || []).find((x) => x.id === id);
    selectedSaved = a ? a.id : null;
    if (a) { picker.set(a, { silent: true }); $('#unit').value = a.unit || ''; $('#notes').value = a.notes || ''; }
    else { picker.set(null, { silent: true }); $('#unit').value = ''; $('#notes').value = ''; }
    renderSavedAddrs(); scheduleQuote(0);
  }
  $('#savedAddrs').addEventListener('click', (e) => { const b = e.target.closest('[data-saved]'); if (b) selectSaved(b.dataset.saved); });
  function onAddressChange(a) {
    if (selectedSaved) {
      const s = me.member.addresses.find((x) => x.id === selectedSaved);
      if (!a || !s || Math.abs(s.lat - a.lat) > 0.0003 || Math.abs(s.lng - a.lng) > 0.0003) selectedSaved = null;
    }
    if (!me) { details.address = a; saved.set('afm_details', details); }
    renderSavedAddrs(); scheduleQuote(0);
  }

  // ---------- pricing ----------
  function scheduleQuote(delay = 350) { clearTimeout(quoteTimer); quoteTimer = setTimeout(getQuote, delay); }
  async function getQuote() {
    if (!cart.length) { quoteSeq++; quoting = false; quote = null; renderSummary(); return; }
    const seq = ++quoteSeq;
    quoting = true; updatePay();
    $('#sum').style.opacity = 0.55;
    const addr = picker?.get();
    try {
      const r = await fetch('/api/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({
          items: cart.map(({ productId, qty, cut }) => ({ productId, qty, cut })), phone: $('#phone').value, couponCode,
          fulfilment, deliveryOption, pickupBranchId, pickupAt, usePoints, deliverAt: fulfilment === 'delivery' && when === 'later' ? deliverAt : '',
          location: fulfilment === 'delivery' && addr ? { lat: addr.lat, lng: addr.lng, address: addr.text } : null,
        }),
      });
      const q = await r.json();
      if (seq !== quoteSeq) return;
      if (!r.ok) throw new Error(q.error);
      quote = q;
      if (q.deliverAtError) { deliverAt = ''; toast(q.deliverAtError); }
    } catch (e) { if (seq === quoteSeq) { quote = null; toast(e.message || 'Could not update prices'); } }
    if (seq !== quoteSeq) return;
    quoting = false;
    $('#sum').style.opacity = 1;
    picker?.setMeta(fulfilment === 'delivery' && quote?.branch ? `From our ${quote.branch.name} shop${quote.distanceKm ? ` · ${quote.distanceKm} km` : ''}` : '');
    if (quote && usePoints && !quote.points?.used) usePoints = false;
    renderSpeed(); renderSlots(); renderPoints(); renderSummary();
  }
  function renderPoints() {
    const box = $('#pointsBox');
    const P = quote?.points; const L = catalog.loyalty;
    if (!L || !quote) { box.innerHTML = ''; return; }
    if (me && P?.enabled) {
      const earn = P.earned ? `<div class="earn">You’ll earn ${P.earned} points with this order.</div>` : '';
      if (P.canUse > 0) {
        box.innerHTML = `<label class="pts"><input type="checkbox" id="usePts" ${usePoints ? 'checked' : ''}><span>Use <b>${P.canUse} points</b> for <b>−${rm(P.canUseSen)}</b><small>You have ${P.available} points</small></span></label>${earn}`;
        $('#usePts').addEventListener('change', (e) => { usePoints = e.target.checked; scheduleQuote(0); });
      } else box.innerHTML = `<div class="muted">You have ${P.available} points. Every ${L.redeemPoints} points = RM${L.redeemValue} off.</div>${earn}`;
    } else if (!me) {
      const pts = Math.floor(Math.max(0, quote.subtotalSen - quote.discountSen) / 100) * L.earnPerRM;
      box.innerHTML = pts > 0 ? `<div class="muted">Members earn <b>${pts} points</b> on this order (${L.redeemPoints} points = RM${L.redeemValue} off). <a href="/account.html?signup=1&next=${encodeURIComponent('/#cart')}">Sign up</a></div>` : '';
    } else box.innerHTML = '';
  }
  function renderSummary() {
    const cm = $('#couponMsg');
    cm.className = 'msg'; cm.textContent = '';
    $('#welcomeMsg').textContent = [quote?.welcomeMessage, quote?.fulfilment === 'delivery' ? quote?.branchNote : ''].filter(Boolean).join(' ');
    if (!quote) { $('#sum').innerHTML = ''; return updatePay(); }
    if (couponCode) {
      if (quote.couponError) { cm.className = 'msg err'; cm.textContent = quote.couponError; }
      else if (quote.couponMessage) { cm.className = 'msg'; cm.textContent = quote.couponMessage; }
      else if (quote.couponCode) { cm.className = 'msg ok'; cm.textContent = `Coupon ${quote.couponCode} applied.`; }
    }
    let delivery;
    const ready = quote.fulfilment === 'pickup' ? !!quote.pickupAt : quote.deliverySen != null;
    if (quote.fulfilment === 'pickup') delivery = `<tr><td>Self pickup <span class="muted">(${esc(quote.branch?.name || '')})</span></td><td>Free</td></tr>`;
    else if (quote.deliverySen != null) {
      const opt = (quote.deliveryOptions || []).find((o) => o.id === quote.deliveryOption);
      delivery = `<tr><td>${opt && quote.deliveryOptions.length > 1 ? `${esc(opt.label)} delivery` : 'Delivery'} <span class="muted">(Lalamove${quote.distanceKm ? `, ${quote.distanceKm} km` : ''})</span>${quote.scheduledText ? `<div class="muted">${quote.deliverAt ? '' : "We're closed now. "}Driver collects around ${esc(quote.scheduledText)}</div>` : ''}</td><td>${rm(quote.deliverySen)}</td></tr>`;
    } else if (quote.deliveryError) delivery = `<tr><td colspan="2" class="msg err">${esc(quote.deliveryError)}</td></tr>`;
    else delivery = `<tr><td>Delivery</td><td class="muted">Set your address</td></tr>`;
    $('#sum').innerHTML = `
      <tr><td>Subtotal</td><td>${rm(quote.subtotalSen)}</td></tr>
      ${(quote.discounts || []).map((d) => `<tr class="disc"><td>${esc(d.label)}</td><td>− ${rm(d.sen)}</td></tr>`).join('')}
      ${quote.points?.sen ? `<tr class="disc"><td>Points (${quote.points.used})</td><td>− ${rm(quote.points.sen)}</td></tr>` : ''}
      ${quote.smallOrderSen ? `<tr><td>Small order fee <span class="muted">(orders under ${rm(quote.smallOrderBelowSen)})</span><div class="muted">Add ${rm(quote.smallOrderBelowSen - quote.subtotalSen)} more to remove this fee</div></td><td>${rm(quote.smallOrderSen)}</td></tr>` : ''}
      ${delivery}
      <tr class="tot"><td>Total</td><td>${ready ? rm(quote.totalSen) : '—'}</td></tr>
      ${(quote.errors || []).map((e) => `<tr><td colspan="2" class="msg err">${esc(e)}</td></tr>`).join('')}`;
    updatePay();
  }
  function updatePay() {
    const b = $('#payBtn'); let why = '';
    const addr = picker?.get();
    if (!cart.length) why = 'Your cart is empty';
    else if (!catalog.open && !catalog.preorder) why = 'Closed for orders now';
    else if (!quote || quoting) why = 'Updating prices…';
    else if (quote.errors?.length) why = quote.errors[0];
    else if (fulfilment === 'delivery' && when === 'later' && !deliverAt) why = 'Choose a delivery time';
    else if (fulfilment === 'delivery' && when === 'later' && quote.deliverAt !== deliverAt) why = 'Updating…';
    else if (fulfilment === 'pickup') { if (quote.fulfilment !== 'pickup') why = 'Updating…'; else if (!quote.pickupAt) why = quote.pickupSlots?.length ? 'Choose a pickup time' : 'No pickup times available'; }
    else if (!addr) why = 'Set your delivery address';
    else if (quote.deliverySen == null) why = quote.deliveryError ? (quote.outOfArea ? 'Outside delivery area' : 'Delivery not available') : 'Getting delivery price…';
    b.disabled = !!why || paying;
    b.textContent = paying ? 'Opening payment…' : why || `Pay ${rm(quote.totalSen)}`;
  }

  $('#applyCoupon').addEventListener('click', () => { couponCode = $('#coupon').value.trim().toUpperCase(); scheduleQuote(0); });
  $('#coupon').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#applyCoupon').click(); } });
  $('#phone').addEventListener('change', () => scheduleQuote(0));

  // ---------- pay ----------
  $('#payBtn').addEventListener('click', async () => {
    const addr = picker?.get();
    if (fulfilment === 'delivery' && !addr) return;
    let customer;
    if (me) customer = { name: me.member.name, phone: me.member.phone, email: me.member.email };
    else {
      const name = $('#name').value.trim(); const phone = $('#phone').value.trim(); const email = $('#email').value.trim();
      if (name.length < 2) { $('#name').focus(); return toast('Please enter your name.'); }
      if (phone.replace(/\D/g, '').length < 9) { $('#phone').focus(); return toast('Please enter your phone number.'); }
      customer = { name, phone, email };
      Object.assign(details, { name, phone, email, unit: $('#unit').value.trim() }); saved.set('afm_details', details);
    }
    paying = true; updatePay();
    const pushId = window.AFM?.push.id();
    try {
      const r = await fetch('/api/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({
          items: cart.map(({ productId, qty, cut }) => ({ productId, qty, cut })),
          customer, couponCode, fulfilment, deliveryOption, pickupBranchId, pickupAt, usePoints, deliverAt: fulfilment === 'delivery' && when === 'later' ? deliverAt : '',
          address: fulfilment === 'pickup'
            ? { notes: $('#pickupNotes').value.trim() }
            : { text: addr.text, lat: addr.lat, lng: addr.lng, unit: $('#unit').value.trim(), notes: $('#notes').value.trim() },
          saveAddress: !!(fulfilment === 'delivery' && me && !selectedSaved && $('#saveAddr').checked), addressLabel: $('#saveAddrLabel').value.trim() || 'Home',
          pushSubs: pushId && AFM.push.permission() === 'granted' ? [pushId] : [],
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not start payment');
      saved.set('afm_last', { id: d.orderId, t: d.token });
      location.href = d.paymentUrl;
    } catch (e) {
      paying = false; updatePay(); toast(e.message); scheduleQuote(0);
    }
  });

  load();
})();
