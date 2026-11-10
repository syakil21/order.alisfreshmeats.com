// Lalamove-style address picker (checkout and member page): a map with a fixed centre pin, a search box
// on top and a "locate me" button. Move the map to put the pin on the door; the address text updates.
// Uses Google Maps when a key is set and working, otherwise OpenStreetMap (Leaflet + Photon search),
// so the map always works.
(function () {
  const KL = { lat: 3.139, lng: 101.6869 };
  const MY_BBOX = '99.5,0.8,119.5,7.5';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const distM = (a, b) => {
    const R = 6371000, r = (x) => (x * Math.PI) / 180;
    const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = rej; document.head.appendChild(s); });

  // ---- Google ----
  let googlePromise = null; let googleBroken = false; const brokenListeners = [];
  window.gm_authFailure = () => { googleBroken = true; brokenListeners.forEach((f) => f()); };
  function loadGoogle(key) {
    if (window.google?.maps?.importLibrary) return Promise.resolve();
    if (googlePromise) return googlePromise;
    googlePromise = new Promise((resolve, reject) => {
      window.__afmMaps = resolve;
      loadScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&libraries=places&callback=__afmMaps`).catch((e) => { googlePromise = null; reject(e); });
      setTimeout(() => reject(new Error('Google Maps timed out')), 12000);
    });
    return googlePromise;
  }
  async function googleMap(el, c, z) {
    const { Map } = await google.maps.importLibrary('maps');
    const map = new Map(el, { center: c, zoom: z, disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy', clickableIcons: false });
    return {
      kind: 'google',
      center: () => { const p = map.getCenter(); return { lat: p.lat(), lng: p.lng() }; },
      set: (p, zoom) => { map.setCenter(p); if (zoom) map.setZoom(zoom); },
      zoom: () => map.getZoom(),
      onMoveStart: (f) => map.addListener('dragstart', f),
      onIdle: (f) => map.addListener('idle', f),
      onTap: (f) => map.addListener('click', (e) => e.latLng && f({ lat: e.latLng.lat(), lng: e.latLng.lng() })),
      pan: (p) => map.panTo(p),
      resize: () => {},
    };
  }
  async function googleReverse(lat, lng) {
    const { Geocoder } = await google.maps.importLibrary('geocoding');
    const r = await new Geocoder().geocode({ location: { lat, lng } });
    return r.results?.[0]?.formatted_address || '';
  }

  // ---- OpenStreetMap ----
  let leafletPromise = null;
  function loadLeaflet() {
    if (window.L?.map) return Promise.resolve();
    if (!leafletPromise) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
      leafletPromise = loadScript('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js').catch((e) => { leafletPromise = null; throw e; });
    }
    return leafletPromise;
  }
  async function osmMap(el, c, z) {
    await loadLeaflet();
    const map = L.map(el, { zoomControl: true, attributionControl: true }).setView([c.lat, c.lng], z);
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    return {
      kind: 'osm',
      center: () => { const p = map.getCenter(); return { lat: p.lat, lng: p.lng }; },
      set: (p, zoom) => map.setView([p.lat, p.lng], zoom || map.getZoom(), { animate: false }),
      zoom: () => map.getZoom(),
      onMoveStart: (f) => map.on('dragstart', f),
      onIdle: (f) => map.on('moveend', f),
      onTap: (f) => map.on('click', (e) => f({ lat: e.latlng.lat, lng: e.latlng.lng })),
      pan: (p) => map.panTo([p.lat, p.lng]),
      resize: () => map.invalidateSize(),
    };
  }
  const photonText = (p) => {
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    const parts = [p.name, street, p.district || p.locality, [p.postcode, p.city].filter(Boolean).join(' '), p.state];
    return parts.filter((x, i) => x && parts.indexOf(x) === i).join(', ');
  };
  async function osmReverse(lat, lng) {
    const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=en`);
    const f = (await r.json()).features?.[0];
    return f ? photonText(f.properties) : '';
  }
  async function osmSearch(q, near) {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=7&lang=en&lat=${near.lat}&lon=${near.lng}&bbox=${MY_BBOX}`);
    return ((await r.json()).features || []).filter((f) => !f.properties.countrycode || f.properties.countrycode === 'MY').map((f) => {
      const p = f.properties; const title = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city || '';
      return { title, sub: photonText({ ...p, name: '' }), text: photonText(p), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
    }).filter((x) => x.title);
  }

  const PIN = '<svg class="pin" viewBox="0 0 34 44" aria-hidden="true"><path d="M17 0C7.6 0 0 7.5 0 16.8 0 29.4 17 44 17 44s17-14.6 17-27.2C34 7.5 26.4 0 17 0z" fill="#d42a1f"/><circle cx="17" cy="16.5" r="6.5" fill="#fff"/></svg>';
  const LOCATE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>';
  const SEARCH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>';

  window.AddressPicker = function (root, { mapsKey = '', onChange = () => {}, toast = (m) => alert(m), center = null } = {}) {
    root.innerHTML = `
      <div class="lm">
        <div class="lm-search">${SEARCH}<div class="lm-ac"><input class="lm-q" type="search" placeholder="Search building, street or area" autocomplete="off" enterkeyhint="search" aria-label="Search address"></div>
          <ul class="lm-sugg" hidden></ul></div>
        <div class="lm-map">
          <div class="lm-mapel"></div><span class="pin-dot"></span>${PIN}
          <div class="lm-bubble">Move map to set pin</div>
          <button type="button" class="lm-locate" aria-label="Use my current location">${LOCATE}</button>
        </div>
        <div class="lm-card">
          <div class="lm-title">Set your delivery spot</div>
          <div class="lm-sub">Search above, tap ◎ for your location, or drag the map so the pin sits on your door.</div>
          <button type="button" class="linkbtn lm-edit" hidden>Edit address text</button>
          <textarea class="inp lm-text" rows="2" maxlength="300" hidden placeholder="Building, street, area, postcode"></textarea>
        </div>
        <div class="msg err ap-err"></div>
      </div>`;
    const q = (s) => root.querySelector(s);
    let address = null; let meta = ''; let map = null; let engine = ''; let moved = false; let seq = 0; let started = false;
    let editing = false;

    function render(state) {
      const has = address && address.text;
      const [first, ...rest] = String(address?.text || '').split(', ');
      q('.lm-title').textContent = state === 'locating' ? 'Finding address…' : has ? first : 'Set your delivery spot';
      q('.lm-sub').textContent = has ? [rest.join(', '), meta].filter(Boolean).join(' · ') : state === 'locating' ? '' : 'Search above, tap ◎ for your location, or drag the map so the pin sits on your door.';
      q('.lm-bubble').textContent = state === 'locating' ? 'Locating…' : has ? 'Deliver here' : 'Move map to set pin';
      q('.lm-bubble').classList.toggle('set', !!has && state !== 'locating');
      q('.lm-edit').hidden = !has || editing;
      q('.lm-text').hidden = !editing;
    }
    function set(a, { silent = false, fromMap = false } = {}) {
      address = a && isFinite(a.lat) && isFinite(a.lng) ? { text: String(a.text || ''), lat: Number(a.lat), lng: Number(a.lng) } : null;
      editing = false; q('.ap-err').textContent = '';
      render();
      if (!fromMap && address && map) { map.set(address, Math.max(map.zoom() || 0, 17)); }
      if (!silent) onChange(get());
    }
    const get = () => (address && address.text && isFinite(address.lat) ? { ...address } : null);

    async function reverse(lat, lng) {
      if (engine === 'google' && !googleBroken) { try { const t = await googleReverse(lat, lng); if (t) return t; } catch {} }
      try { return await osmReverse(lat, lng); } catch { return ''; }
    }
    async function pinTo(pos, { force = false } = {}) {
      const s = ++seq;
      render('locating');
      let text = '';
      if (!force && address?.text && distM(address, pos) < 25) text = address.text; // tiny nudge: keep the text
      else text = (await reverse(pos.lat, pos.lng)) || `Pinned location ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
      if (s !== seq) return;
      set({ text, lat: pos.lat, lng: pos.lng }, { fromMap: true });
    }

    async function makeMap(kind) {
      const el = q('.lm-mapel'); el.innerHTML = ''; el.className = 'lm-mapel';
      const c = address || center || KL; const z = address ? 17 : center ? 13 : 12;
      map = kind === 'google' ? await googleMap(el, c, z) : await osmMap(el, c, z);
      engine = kind;
      root.querySelector('.lm').dataset.engine = kind;
      map.onMoveStart(() => { moved = true; q('.lm-map').classList.add('moving'); });
      map.onTap((p) => { moved = true; map.pan(p); });
      map.onIdle(() => {
        q('.lm-map').classList.remove('moving');
        const pos = map.center();
        // only react to the customer moving the map (drag, tap, or a pinch that shifted the centre)
        if (!(moved || (address && distM(address, pos) > 8))) return;
        moved = false;
        pinTo(pos);
      });
      if ('ResizeObserver' in window) new ResizeObserver(() => map?.resize()).observe(q('.lm-map'));
    }

    async function setupSearch(kind) {
      const host = q('.lm-ac');
      if (kind === 'google') {
        try {
          const { PlaceAutocompleteElement } = await google.maps.importLibrary('places');
          const el = new PlaceAutocompleteElement({ includedRegionCodes: ['my'] });
          el.setAttribute('placeholder', 'Search building, street or area');
          host.innerHTML = ''; host.appendChild(el);
          const use = async (place) => {
            await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
            const name = place.displayName || ''; const fa = place.formattedAddress || '';
            set({ text: name && !fa.startsWith(name) ? `${name}, ${fa}` : fa, lat: place.location.lat(), lng: place.location.lng() });
          };
          el.addEventListener('gmp-select', (ev) => use(ev.placePrediction.toPlace()).catch(() => (q('.ap-err').textContent = 'Could not use that address, please try another.')));
          el.addEventListener('gmp-placeselect', (ev) => use(ev.place).catch(() => {}));
          return;
        } catch (e) { console.warn('Google search unavailable, using OpenStreetMap search', e); }
      }
      // OpenStreetMap search (Photon)
      const input = q('.lm-q'); const list = q('.lm-sugg');
      let t = null; let results = []; let sseq = 0;
      const hide = () => { list.hidden = true; };
      input.addEventListener('input', () => {
        clearTimeout(t);
        const v = input.value.trim();
        if (v.length < 3) return hide();
        t = setTimeout(async () => {
          const my = ++sseq;
          try { results = await osmSearch(v, map ? map.center() : KL); } catch { results = []; }
          if (my !== sseq) return;
          list.innerHTML = results.length
            ? results.map((r, i) => `<li><button type="button" data-i="${i}"><b>${esc(r.title)}</b><span>${esc(r.sub)}</span></button></li>`).join('')
            : '<li class="none">No match. Try a nearby road or area, then move the pin.</li>';
          list.hidden = false;
        }, 350);
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); list.querySelector('button')?.click(); } if (e.key === 'Escape') hide(); });
      list.addEventListener('click', (e) => {
        const b = e.target.closest('[data-i]'); if (!b) return;
        const r = results[Number(b.dataset.i)]; hide(); input.value = ''; input.blur();
        set({ text: r.text, lat: r.lat, lng: r.lng });
      });
      document.addEventListener('click', (e) => { if (!root.contains(e.target)) hide(); });
    }

    async function start() {
      if (started) { map?.resize(); return; }
      started = true;
      let kind = 'osm';
      if (mapsKey && !googleBroken) {
        try { await loadGoogle(mapsKey); await google.maps.importLibrary('maps'); kind = 'google'; } catch (e) { console.warn('Google Maps unavailable, using OpenStreetMap', e); }
      }
      try { await makeMap(kind); }
      catch (e) {
        if (kind === 'google') { try { await makeMap('osm'); kind = 'osm'; } catch (e2) { console.warn(e2); } }
        if (!map) q('.ap-err').textContent = 'The map could not load. Use the ◎ button or search for your address.';
      }
      await setupSearch(kind);
      // Google key rejected after loading (billing/API not enabled): switch to OpenStreetMap
      brokenListeners.push(async () => {
        if (engine !== 'google') return;
        try { q('.lm-ac').innerHTML = '<input class="lm-q" type="search" placeholder="Search building, street or area" autocomplete="off" aria-label="Search address">'; await makeMap('osm'); await setupSearch('osm'); } catch (e) { console.warn(e); }
      });
      setTimeout(() => map?.resize(), 250);
    }

    q('.lm-locate').addEventListener('click', () => {
      if (!navigator.geolocation) return toast('Location is not available on this device.');
      const btn = q('.lm-locate'); btn.classList.add('busy');
      navigator.geolocation.getCurrentPosition(async (pos) => {
        btn.classList.remove('busy');
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (map) { map.set(p, 18); }
        await pinTo(p, { force: true });
      }, () => { btn.classList.remove('busy'); toast('Could not get your location. Please allow location access, or search instead.'); }, { enableHighAccuracy: true, timeout: 12000 });
    });
    q('.lm-edit').addEventListener('click', () => {
      editing = true; render();
      const ta = q('.lm-text'); ta.value = address?.text || ''; ta.focus();
    });
    q('.lm-text').addEventListener('change', () => {
      const t = q('.lm-text').value.trim();
      if (t && address) { address.text = t; editing = false; render(); onChange(get()); }
    });
    q('.lm-text').addEventListener('blur', () => { if (editing) { editing = false; render(); } });

    render();
    return {
      start, set, get,
      setMeta(t) { meta = t || ''; render(); },
    };
  };
})();
