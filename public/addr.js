// Address picker used at checkout and on the member page.
// With a Google Maps key: search box, "use my current location", and a map with a fixed centre pin
// (move the map to move the pin, like Lalamove/Grab). Without a key: current location + typed address.
(function () {
  const KL = { lat: 3.139, lng: 101.6869 };
  let mapsPromise = null;
  function loadMaps(key) {
    if (window.google?.maps?.importLibrary) return Promise.resolve();
    if (mapsPromise) return mapsPromise;
    mapsPromise = new Promise((resolve, reject) => {
      window.__afmMaps = resolve;
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&libraries=places&callback=__afmMaps`;
      s.async = true; s.onerror = (e) => { mapsPromise = null; reject(e); }; document.head.appendChild(s);
    });
    return mapsPromise;
  }
  const distM = (a, b) => {
    const R = 6371000, r = (x) => (x * Math.PI) / 180;
    const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const PIN = '<svg class="pin" viewBox="0 0 34 44" aria-hidden="true"><path d="M17 0C7.6 0 0 7.5 0 16.8 0 29.4 17 44 17 44s17-14.6 17-27.2C34 7.5 26.4 0 17 0z" fill="#d42a1f"/><circle cx="17" cy="16.5" r="6.5" fill="#fff"/></svg>';

  window.AddressPicker = function (root, { mapsKey = '', onChange = () => {}, toast = (m) => alert(m) } = {}) {
    root.innerHTML = `
      <div class="ap-search">
        <label class="f"><span>Search your address or building</span><div class="ap-ac"></div></label>
        <div class="addr-actions"><button class="linkbtn ap-loc" type="button">Use my current location</button><button class="linkbtn ap-pick" type="button" hidden>Pick on map</button></div>
      </div>
      <div class="addr-picked ap-picked"><b class="ap-text"></b><span class="muted ap-meta"></span><br><button type="button" class="ap-change">Change address</button></div>
      <div class="mapwrap ap-map" hidden><div class="ap-mapel"></div><span class="pin-dot"></span>${PIN}<div class="maphint ap-hint"></div></div>
      <div class="ap-manual" hidden><label class="f"><span>Address <i>(street, area, postcode)</i></span><input class="inp ap-manual-in" placeholder="e.g. 12 Jalan Ipoh, Selayang 68100"></label></div>
      <div class="msg err ap-err"></div>`;
    const q = (s) => root.querySelector(s);
    let address = null; let mapsReady = false; let map = null; let moved = false; let picking = false; let pinSeq = 0; let started = false; let meta = '';

    function render() {
      const picked = !!(address && address.text);
      q('.ap-picked').style.display = picked ? 'block' : 'none';
      q('.ap-search').style.display = picked ? 'none' : 'block';
      if (picked) { q('.ap-text').textContent = address.text; q('.ap-meta').textContent = meta; }
      if (!picked && !picking) q('.ap-map').hidden = true;
    }
    function set(a, { silent = false, fromMap = false } = {}) {
      address = a && isFinite(a.lat) ? { text: a.text || '', lat: Number(a.lat), lng: Number(a.lng) } : null;
      q('.ap-err').textContent = '';
      render();
      if (!fromMap && address?.text) showMap(address, 17);
      if (!silent) onChange(address);
    }
    async function showMap(center, zoom) {
      if (!mapsReady) return;
      const wrap = q('.ap-map'); wrap.hidden = false;
      q('.ap-hint').textContent = address?.text ? 'Not exact? Drag the map so the pin sits on your door.' : 'Drag the map to put the pin on your delivery spot.';
      try {
        if (!map) {
          const { Map } = await google.maps.importLibrary('maps');
          map = new Map(q('.ap-mapel'), { center: { lat: center.lat, lng: center.lng }, zoom, disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy', clickableIcons: false });
          map.addListener('dragstart', () => { moved = true; wrap.classList.add('moving'); });
          map.addListener('click', (e) => { if (e.latLng) { moved = true; map.panTo(e.latLng); } });
          map.addListener('idle', onIdle);
        } else { map.setCenter({ lat: center.lat, lng: center.lng }); if (zoom) map.setZoom(zoom); }
      } catch (e) { console.warn('Map failed', e); wrap.hidden = true; }
    }
    async function reverseGeocode(lat, lng) {
      try {
        const { Geocoder } = await google.maps.importLibrary('geocoding');
        const r = await new Geocoder().geocode({ location: { lat, lng } });
        return r.results?.[0]?.formatted_address || '';
      } catch { return ''; }
    }
    async function onIdle() {
      q('.ap-map').classList.remove('moving');
      const c = map.getCenter(); const pos = { lat: c.lat(), lng: c.lng() };
      const hasPin = address && isFinite(address.lat);
      // a drag/tap, or a pinch-zoom that shifted the centre away from the current pin
      if (!(moved || (hasPin && address.text && distM(address, pos) > 5))) return;
      moved = false;
      const seq = ++pinSeq;
      let text = address?.text || '';
      if (!text || !hasPin || distM(address, pos) > 40) text = (await reverseGeocode(pos.lat, pos.lng)) || text || `Pinned location ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
      if (seq !== pinSeq) return; // moved again meanwhile
      const wasPicking = picking; picking = false;
      set({ text, lat: pos.lat, lng: pos.lng }, { fromMap: true });
      if (wasPicking && map.getZoom() < 16) map.setZoom(17);
      q('.ap-hint').textContent = 'Pin set. Drag again to fine-tune.';
    }
    async function placeToAddress(place) {
      await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
      const name = place.displayName || ''; const fa = place.formattedAddress || '';
      set({ text: name && !fa.startsWith(name) ? `${name}, ${fa}` : fa, lat: place.location.lat(), lng: place.location.lng() });
    }

    async function start() {
      if (started) return; started = true;
      const host = q('.ap-ac');
      if (mapsKey) {
        try {
          await loadMaps(mapsKey);
          const { PlaceAutocompleteElement } = await google.maps.importLibrary('places');
          const el = new PlaceAutocompleteElement({ includedRegionCodes: ['my'] });
          host.appendChild(el);
          el.addEventListener('gmp-select', async (ev) => { try { await placeToAddress(ev.placePrediction.toPlace()); } catch { q('.ap-err').textContent = 'Could not use that address, please try another.'; } });
          el.addEventListener('gmp-placeselect', async (ev) => { try { await placeToAddress(ev.place); } catch {} });
          mapsReady = true;
          q('.ap-pick').hidden = false;
          if (address?.text) showMap(address, 17);
          return;
        } catch (e) { console.warn('Maps failed', e); }
      }
      host.innerHTML = '<p class="muted" style="margin:0">Tap “Use my current location” while at the delivery address, then type the street address below.</p>';
      q('.ap-manual').hidden = false;
    }

    q('.ap-change').addEventListener('click', () => {
      picking = false; set(null);
      setTimeout(() => q('.ap-ac').querySelector('input,gmp-place-autocomplete')?.focus(), 50);
    });
    q('.ap-pick').addEventListener('click', () => {
      picking = true;
      showMap(address && isFinite(address.lat) ? address : KL, address ? 17 : 12);
      setTimeout(() => q('.ap-map').scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    });
    q('.ap-loc').addEventListener('click', () => {
      if (!navigator.geolocation) return toast('Location is not available on this device.');
      const btn = q('.ap-loc'); btn.textContent = 'Finding you…';
      navigator.geolocation.getCurrentPosition(async (pos) => {
        btn.textContent = 'Use my current location';
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        let text = q('.ap-manual-in').value.trim();
        if (!text && mapsReady) text = await reverseGeocode(lat, lng);
        if (!text) {
          address = { text: '', lat, lng }; q('.ap-manual').hidden = false; q('.ap-manual-in').focus();
          q('.ap-err').textContent = 'Got your location. Now type your street address.';
          onChange(null); return;
        }
        set({ text, lat, lng });
      }, () => { btn.textContent = 'Use my current location'; toast('Could not get your location. Please allow location access.'); }, { enableHighAccuracy: true, timeout: 12000 });
    });
    q('.ap-manual-in').addEventListener('change', () => {
      const t = q('.ap-manual-in').value.trim();
      if (t && address && isFinite(address.lat)) set({ ...address, text: t });
    });

    render();
    return {
      start, set,
      get: () => (address && address.text && isFinite(address.lat) ? { ...address } : null),
      setMeta(t) { meta = t || ''; if (address?.text) q('.ap-meta').textContent = meta; },
    };
  };
})();
