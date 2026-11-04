(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const saved = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const rm = (sen) => 'RM ' + (Number(sen || 0) / 100).toFixed(2);
  const qtyText = (q, u) => (u === 'kg' ? `${q} kg` : u === 'set' ? `${q} ${q > 1 ? 'sets' : 'set'}` : `${q} ${q > 1 ? 'pcs' : 'pc'}`);
  const unitText = (u) => (u === 'kg' ? '/kg' : u === 'set' ? '/set' : '/pc');

  let catalog = null;
  const products = {};
  let cart = saved.get('afm_cart') || {};
  const details = saved.get('afm_details') || {};
  let address = details.address && isFinite(details.address.lat) ? details.address : null;
  let couponCode = '';
  let quote = null; let quoteSeq = 0; let quoteTimer = null; let paying = false; let quoting = false;

  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 3500); }

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
    chip.textContent = catalog.open ? catalog.openMessage : 'Closed now';
    chip.className = 'chip ' + (catalog.open ? 'open' : 'closed');
    const notes = [];
    if (!catalog.open) notes.push(catalog.openMessage + ' You can still browse the menu.');
    if (!catalog.deliveryReady) notes.push('Online delivery is being set up. Please WhatsApp us to order for now.');
    if (notes.length) { $('#notice').hidden = false; $('#notice').textContent = notes.join(' '); }
    $('#checkoutNote').textContent = catalog.shop.checkoutNote || '';
    const last = saved.get('afm_last');
    if (last?.id) { const a = $('#lastOrder'); a.style.display = 'inline-block'; a.href = `/order.html?id=${encodeURIComponent(last.id)}&t=${encodeURIComponent(last.t)}`; a.textContent = `Track your order ${last.no || ''} →`; }

    const cats = [];
    for (const p of catalog.products) { products[p.id] = p; if (!cats.includes(p.category)) cats.push(p.category); }
    for (const id of Object.keys(cart)) if (!products[id]) delete cart[id];

    $('#tabs').innerHTML = cats.map((c, i) => `<a href="#cat-${i}" class="${i === 0 ? 'on' : ''}">${esc(c)}</a>`).join('');
    $('#menu').innerHTML = cats.map((c, i) => `
      <section class="cat" id="cat-${i}">
        <h3>${esc(c)}</h3>
        ${catalog.products.filter((p) => p.category === c).map((p) => `
          <div class="item" data-id="${esc(p.id)}">
            <div>
              <div class="name">${esc(p.name)}</div>
              ${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}
              <div class="price">RM ${Number(p.price).toFixed(2)}<small>${unitText(p.unit)}</small></div>
            </div>
            <div class="ctl"></div>
          </div>`).join('')}
      </section>`).join('');
    for (const el of document.querySelectorAll('.item')) renderCtl(el.dataset.id);
    renderBar();

    // highlight active tab while scrolling
    const tabs = [...document.querySelectorAll('.tabs a')];
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { const i = e.target.id.split('-')[1]; tabs.forEach((t, j) => t.classList.toggle('on', String(j) === i)); }
    }, { rootMargin: '-40% 0px -55% 0px' });
    document.querySelectorAll('.cat').forEach((s) => io.observe(s));
    if (location.hash === '#cart' && Object.keys(cart).length) openSheet();
  }

  function stepperHTML(id) {
    const p = products[id];
    return `<div class="stepper"><button data-dec="${esc(id)}" aria-label="Less">−</button><span>${qtyText(cart[id], p.unit)}</span><button data-inc="${esc(id)}" aria-label="More">+</button></div>`;
  }
  function renderCtl(id) {
    const el = document.querySelector(`.item[data-id="${CSS.escape(id)}"] .ctl`);
    if (el) el.innerHTML = cart[id] ? stepperHTML(id) : `<button class="add" data-inc="${esc(id)}">Add</button>`;
  }
  function change(id, dir) {
    const p = products[id]; if (!p) return;
    const step = Number(p.step) || 1; const min = Number(p.min) || step;
    let q = cart[id] || 0;
    q = dir > 0 ? (q ? q + step : min) : q - step;
    q = Math.round(q * 100) / 100;
    if (q < min) delete cart[id]; else cart[id] = Math.min(50, q);
    saved.set('afm_cart', cart);
    renderCtl(id); renderBar();
    if ($('#sheet').classList.contains('show')) { renderLines(); scheduleQuote(); }
  }
  function estimate() { return Object.entries(cart).reduce((s, [id, q]) => s + Math.round(Number(products[id]?.price || 0) * 100 * q), 0); }
  function renderBar() {
    const n = Object.keys(cart).length;
    $('#cartbar').style.display = n ? 'block' : 'none';
    $('#cartCount').textContent = n;
    $('#cartTotal').textContent = rm(estimate());
  }

  document.addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]'); if (inc) return change(inc.dataset.inc, 1);
    const dec = e.target.closest('[data-dec]'); if (dec) return change(dec.dataset.dec, -1);
    if (e.target.closest('[data-close]')) closeSheet();
  });

  // ---------- checkout sheet ----------
  function openSheet() {
    $('#sheet').classList.add('show'); document.body.style.overflow = 'hidden';
    $('#name').value ||= details.name || ''; $('#phone').value ||= details.phone || ''; $('#email').value ||= details.email || '';
    $('#unit').value ||= details.unit || '';
    renderLines(); renderAddress(); initAddressSearch(); scheduleQuote(0);
  }
  function closeSheet() { $('#sheet').classList.remove('show'); document.body.style.overflow = ''; }
  $('#openCart').addEventListener('click', openSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  function renderLines() {
    const ids = Object.keys(cart);
    if (!ids.length) { $('#lines').innerHTML = '<div class="empty">Your cart is empty.</div>'; return; }
    $('#lines').innerHTML = ids.map((id) => {
      const p = products[id];
      return `<div class="line"><div><div class="n">${esc(p.name)}</div><div class="s">RM ${Number(p.price).toFixed(2)}${unitText(p.unit)}</div></div>
        ${stepperHTML(id)}<div></div><div class="amt">${rm(Math.round(p.price * 100 * cart[id]))}</div></div>`;
    }).join('');
  }

  // ---------- address ----------
  function setAddress(a) {
    address = a; details.address = a; saved.set('afm_details', details);
    renderAddress(); scheduleQuote(0);
  }
  function renderAddress() {
    const picked = !!(address && address.text);
    $('#addrPicked').style.display = picked ? 'block' : 'none';
    $('#addrSearch').style.display = picked ? 'none' : 'block';
    if (picked) { $('#addrText').textContent = address.text; $('#addrMeta').textContent = quote?.branch ? `From our ${quote.branch.name} shop${quote.distanceKm ? ` · ${quote.distanceKm} km` : ''}` : ''; }
  }
  $('#addrChange').addEventListener('click', () => { address = null; renderAddress(); scheduleQuote(0); setTimeout(() => $('#acHost').querySelector('input,gmp-place-autocomplete')?.focus(), 50); });

  let searchReady = false;
  function loadMaps(key) {
    return new Promise((resolve, reject) => {
      if (window.google?.maps?.importLibrary) return resolve();
      window.__afmMaps = resolve;
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&libraries=places&callback=__afmMaps`;
      s.async = true; s.onerror = reject; document.head.appendChild(s);
    });
  }
  async function placeToAddress(place) {
    await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
    const name = place.displayName || ''; const fa = place.formattedAddress || '';
    const text = name && !fa.startsWith(name) ? `${name}, ${fa}` : fa;
    setAddress({ text, lat: place.location.lat(), lng: place.location.lng() });
  }
  async function initAddressSearch() {
    if (searchReady) return; searchReady = true;
    const host = $('#acHost');
    if (catalog.mapsKey) {
      try {
        await loadMaps(catalog.mapsKey);
        const { PlaceAutocompleteElement } = await google.maps.importLibrary('places');
        const el = new PlaceAutocompleteElement({ includedRegionCodes: ['my'] });
        host.appendChild(el);
        el.addEventListener('gmp-select', async (ev) => { try { await placeToAddress(ev.placePrediction.toPlace()); } catch (e) { $('#addrErr').textContent = 'Could not use that address, please try another.'; } });
        el.addEventListener('gmp-placeselect', async (ev) => { try { await placeToAddress(ev.place); } catch {} });
        return;
      } catch (e) { console.warn('Maps failed', e); }
    }
    // No map search available: location button + typed address
    host.innerHTML = '<p class="muted" style="margin:0">Tap “Use my current location” while at the delivery address, then type the street address below.</p>';
    $('#addrManualWrap').hidden = false;
  }
  $('#useLoc').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Location is not available on this device.');
    $('#useLoc').textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(async (pos) => {
      $('#useLoc').textContent = 'Use my current location';
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      let text = $('#addrManual').value.trim();
      if (!text && window.google?.maps?.importLibrary) {
        try {
          const { Geocoder } = await google.maps.importLibrary('geocoding');
          const r = await new Geocoder().geocode({ location: { lat, lng } });
          text = r.results?.[0]?.formatted_address || '';
        } catch {}
      }
      if (!text) { address = { text: '', lat, lng }; $('#addrManualWrap').hidden = false; $('#addrManual').focus(); $('#addrErr').textContent = 'Got your location. Now type your street address.'; scheduleQuote(0); return; }
      $('#addrErr').textContent = '';
      setAddress({ text, lat, lng });
    }, () => { $('#useLoc').textContent = 'Use my current location'; toast('Could not get your location. Please allow location access.'); }, { enableHighAccuracy: true, timeout: 12000 });
  });
  $('#addrManual').addEventListener('change', () => {
    const t = $('#addrManual').value.trim();
    if (t && address && isFinite(address.lat)) { $('#addrErr').textContent = ''; setAddress({ ...address, text: t }); }
  });

  // ---------- pricing ----------
  function scheduleQuote(delay = 350) { clearTimeout(quoteTimer); quoteTimer = setTimeout(getQuote, delay); }
  async function getQuote() {
    const items = Object.entries(cart).map(([productId, qty]) => ({ productId, qty }));
    if (!items.length) { quoteSeq++; quoting = false; quote = null; renderSummary(); return; }
    const seq = ++quoteSeq;
    quoting = true; updatePay();
    $('#sum').style.opacity = 0.55;
    try {
      const r = await fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, phone: $('#phone').value, couponCode, location: address && isFinite(address.lat) ? { lat: address.lat, lng: address.lng, address: address.text } : null }) });
      const q = await r.json();
      if (seq !== quoteSeq) return;
      if (!r.ok) throw new Error(q.error);
      quote = q;
    } catch (e) { if (seq === quoteSeq) { quote = null; toast(e.message || 'Could not update prices'); } }
    if (seq !== quoteSeq) return;
    quoting = false;
    $('#sum').style.opacity = 1;
    renderSummary(); renderAddress();
  }
  function renderSummary() {
    const cm = $('#couponMsg');
    cm.className = 'msg'; cm.textContent = '';
    if (!quote) { $('#sum').innerHTML = ''; return updatePay(); }
    if (couponCode) {
      if (quote.couponError) { cm.className = 'msg err'; cm.textContent = quote.couponError; }
      else if (quote.couponMessage) { cm.className = 'msg'; cm.textContent = quote.couponMessage; }
      else if (quote.couponCode) { cm.className = 'msg ok'; cm.textContent = `Coupon ${quote.couponCode} applied.`; }
    }
    let delivery;
    if (quote.deliverySen != null) delivery = `<tr><td>Delivery <span class="muted">(Lalamove${quote.distanceKm ? `, ${quote.distanceKm} km` : ''})</span></td><td>${rm(quote.deliverySen)}</td></tr>`;
    else if (quote.deliveryError) delivery = `<tr><td colspan="2" class="msg err">${esc(quote.deliveryError)}</td></tr>`;
    else delivery = `<tr><td>Delivery</td><td class="muted">Add your address</td></tr>`;
    $('#sum').innerHTML = `
      <tr><td>Subtotal</td><td>${rm(quote.subtotalSen)}</td></tr>
      ${(quote.discounts || []).map((d) => `<tr class="disc"><td>${esc(d.label)}</td><td>− ${rm(d.sen)}</td></tr>`).join('')}
      ${delivery}
      <tr class="tot"><td>Total</td><td>${quote.deliverySen != null ? rm(quote.totalSen) : '—'}</td></tr>
      ${(quote.errors || []).map((e) => `<tr><td colspan="2" class="msg err">${esc(e)}</td></tr>`).join('')}`;
    updatePay();
  }
  function updatePay() {
    const b = $('#payBtn'); let why = '';
    if (!Object.keys(cart).length) why = 'Your cart is empty';
    else if (!catalog.open) why = 'Closed for orders now';
    else if (!quote || quoting) why = 'Updating prices…';
    else if (quote.errors?.length) why = quote.errors[0];
    else if (!address || !address.text || !isFinite(address.lat)) why = 'Add your delivery address';
    else if (quote.deliverySen == null) why = quote.deliveryError ? 'Delivery not available' : 'Getting delivery price…';
    b.disabled = !!why || paying;
    b.textContent = paying ? 'Opening payment…' : why || `Pay ${rm(quote.totalSen)}`;
  }

  $('#applyCoupon').addEventListener('click', () => { couponCode = $('#coupon').value.trim().toUpperCase(); scheduleQuote(0); });
  $('#coupon').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#applyCoupon').click(); } });
  $('#phone').addEventListener('change', () => scheduleQuote(0));

  // ---------- pay ----------
  $('#payBtn').addEventListener('click', async () => {
    const name = $('#name').value.trim(); const phone = $('#phone').value.trim(); const email = $('#email').value.trim();
    if (name.length < 2) { $('#name').focus(); return toast('Please enter your name.'); }
    if (phone.replace(/\D/g, '').length < 9) { $('#phone').focus(); return toast('Please enter your phone number.'); }
    Object.assign(details, { name, phone, email, unit: $('#unit').value.trim() }); saved.set('afm_details', details);
    paying = true; updatePay();
    try {
      const r = await fetch('/api/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: Object.entries(cart).map(([productId, qty]) => ({ productId, qty })),
          customer: { name, phone, email }, couponCode,
          address: { text: address.text, lat: address.lat, lng: address.lng, unit: $('#unit').value.trim(), notes: $('#notes').value.trim() },
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
