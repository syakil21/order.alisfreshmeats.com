(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const rm = (sen) => 'RM ' + (Number(sen || 0) / 100).toFixed(2);
  const pretty = (p) => String(p || '').replace(/^\+60/, '0');
  const fmtDate = (ts) => new Date(ts).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const params = new URLSearchParams(location.search);
  const next = (params.get('next') || '').startsWith('/') && !params.get('next').startsWith('//') ? params.get('next') : '';
  let token = store.get('afm_member');
  let catalog = null; let data = null; let picker = null; let editingId = null;

  function toast(m) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 3500); }
  async function api(action, body = {}) {
    const r = await fetch('/api/member', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ action, ...body }) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && !['login', 'signup'].includes(action)) { token = null; store.set('afm_member', null); showAuth(); throw new Error(d.error || 'Please log in again.'); }
    if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
    return d;
  }
  const formData = (f) => Object.fromEntries(new FormData(f).entries());

  // ---------- log in / sign up ----------
  function showAuth(tab = params.get('signup') ? 'signup' : 'login') {
    $('#loading').hidden = true; $('#dash').hidden = true; $('#authView').hidden = false;
    setTab(tab);
    const w = catalog?.welcome;
    if (w) { $('#signupOffer').hidden = false; $('#signupOffer').innerHTML = `<b>Get RM${w.amount} off your first order</b> when you sign up.${w.minSpend ? ` Min. spend RM${w.minSpend}.` : ''} Only ${w.remaining} left.`; }
  }
  function setTab(tab) {
    document.querySelectorAll('[data-auth]').forEach((b) => b.classList.toggle('on', b.dataset.auth === tab));
    $('#loginForm').hidden = tab !== 'login'; $('#signupForm').hidden = tab !== 'signup';
    $('#authErr').textContent = '';
  }
  document.querySelectorAll('[data-auth]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.auth)));
  async function afterAuth(d) {
    token = d.token; store.set('afm_member', token);
    if (next) { location.href = next; return; }
    data = d; showDash();
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#authErr').textContent = '';
    const btn = e.submitter; btn.disabled = true;
    try { await afterAuth(await api('login', formData(e.target))); } catch (err) { $('#authErr').textContent = err.message; } finally { btn.disabled = false; }
  });
  $('#signupForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#authErr').textContent = '';
    const btn = e.submitter; btn.disabled = true;
    try { await afterAuth(await api('signup', formData(e.target))); toast('Welcome! Your account is ready.'); } catch (err) { $('#authErr').textContent = err.message; } finally { btn.disabled = false; }
  });

  // ---------- dashboard ----------
  function showDash() {
    $('#loading').hidden = true; $('#authView').hidden = true; $('#dash').hidden = false;
    const m = data.member;
    $('#hello').textContent = `Hi, ${m.name.split(' ')[0]}`;
    const perks = [];
    const w = data.welcome;
    if (w?.eligible) perks.push(`<div class="offerbox"><b>Your RM${w.amount} new member offer is ready.</b> It comes off your first order at checkout${w.minSpend ? ` (min. spend RM${w.minSpend})` : ''}.</div>`);
    else if (w && m.welcomeUsed) perks.push('<p class="muted">You have used your new member offer. Thank you!</p>');
    if (data.discountPct) perks.push(`<div class="offerbox"><b>${data.discountPct}% regular customer discount</b> on every order.</div>`);
    perks.push(`<p class="muted">Member since ${new Date(m.createdAt).toLocaleDateString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', month: 'long', year: 'numeric' })}</p>`);
    $('#perks').innerHTML = perks.join('');
    const f = $('#profileForm');
    f.name.value = m.name; f.phone.value = pretty(m.phone); f.email.value = m.email || '';
    renderAddrs();
    loadOrders();
  }
  $('#logout').addEventListener('click', async () => { try { await api('logout'); } catch {} token = null; store.set('afm_member', null); location.href = '/'; });

  $('#profileForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = e.submitter; btn.disabled = true; $('#profileOk').textContent = '';
    try { data = await api('profile.save', formData(e.target)); showDash(); $('#profileOk').textContent = 'Saved'; } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = e.submitter; btn.disabled = true; $('#pwOk').textContent = '';
    try { await api('password.change', formData(e.target)); e.target.reset(); $('#pwOk').textContent = 'Password changed'; } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });

  // ---------- addresses ----------
  function renderAddrs() {
    const m = data.member; const list = m.addresses || [];
    $('#addrList').innerHTML = list.length ? list.map((a) => `
      <div class="addr-card">
        <div><b>${esc(a.label)}</b>${a.id === m.defaultAddressId ? ' <span class="tag-def">Default</span>' : ''}
          <div>${esc(a.text)}</div>
          ${a.unit ? `<div class="muted">Unit: ${esc(a.unit)}</div>` : ''}${a.notes ? `<div class="muted">Note: ${esc(a.notes)}</div>` : ''}</div>
        <div class="addr-actions2">
          <button type="button" class="linkbtn" data-edit="${esc(a.id)}">Edit</button>
          ${a.id !== m.defaultAddressId ? `<button type="button" class="linkbtn" data-def="${esc(a.id)}">Make default</button>` : ''}
          <button type="button" class="linkbtn danger" data-del="${esc(a.id)}">Delete</button>
        </div>
      </div>`).join('') : '<p class="muted">No saved addresses yet. Add one now, or tick “Save to my addresses” at checkout.</p>';
  }
  function openAddrForm(a) {
    editingId = a?.id || null;
    $('#addrForm').hidden = false; $('#addAddr').hidden = true; $('#addrErr').textContent = '';
    $('#addrFormTitle').textContent = a ? `Edit ${a.label}` : 'New address';
    $('#addrLabel').value = a?.label || (data.member.addresses?.length ? '' : 'Home');
    $('#addrUnit').value = a?.unit || ''; $('#addrNotes').value = a?.notes || '';
    $('#addrDefault').checked = a ? a.id === data.member.defaultAddressId : !data.member.addresses?.length;
    if (!picker) picker = AddressPicker($('#acctPicker'), { mapsKey: catalog.mapsKey, toast });
    picker.start();
    picker.set(a || null, { silent: true });
    $('#addrForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeAddrForm() { $('#addrForm').hidden = true; $('#addAddr').hidden = false; editingId = null; }
  $('#addAddr').addEventListener('click', () => openAddrForm(null));
  $('#cancelAddr').addEventListener('click', closeAddrForm);
  $('#saveAddrBtn').addEventListener('click', async (e) => {
    const a = picker.get();
    if (!a) { $('#addrErr').textContent = 'Please choose the address (search, use your location, or pick on the map).'; return; }
    e.target.disabled = true;
    try {
      data = await api('address.save', { address: { ...a, id: editingId || undefined, label: $('#addrLabel').value.trim() || 'Home', unit: $('#addrUnit').value.trim(), notes: $('#addrNotes').value.trim() }, makeDefault: $('#addrDefault').checked });
      closeAddrForm(); renderAddrs(); toast('Address saved');
    } catch (err) { $('#addrErr').textContent = err.message; } finally { e.target.disabled = false; }
  });
  $('#addrList').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const list = data.member.addresses || [];
    try {
      if (b.dataset.edit) openAddrForm(list.find((x) => x.id === b.dataset.edit));
      if (b.dataset.def) { data = await api('address.default', { id: b.dataset.def }); renderAddrs(); }
      if (b.dataset.del && confirm('Delete this address?')) { data = await api('address.delete', { id: b.dataset.del }); renderAddrs(); }
    } catch (err) { toast(err.message); }
  });

  // ---------- orders ----------
  async function loadOrders() {
    try {
      const { orders } = await api('orders');
      $('#orders').innerHTML = orders.length ? orders.map((o) => `
        <a class="order-row" href="${esc(o.link)}">
          <div><b>${esc(o.no)}</b> <span class="muted">${fmtDate(o.createdAt)}</span><div class="muted ellipsis">${esc(o.items)}</div></div>
          <div class="r"><b>${rm(o.totalSen)}</b><div class="muted">${esc(o.paid ? o.stageText : 'Not paid')}</div></div>
        </a>`).join('') : '<p class="muted">No orders yet.</p>';
    } catch { $('#orders').innerHTML = '<p class="muted">Could not load your orders.</p>'; }
  }

  // ---------- start ----------
  (async () => {
    try { catalog = await (await fetch('/api/catalog')).json(); } catch { catalog = {}; }
    $('#forgot').href = `https://wa.me/${catalog.shop?.whatsapp || '60162053786'}?text=${encodeURIComponent('Hi, I forgot my password for my Ali\'s Fresh Meats account. My phone number is ')}`;
    if (!token) return showAuth();
    try { data = await api('me'); if (next && params.get('signup')) location.href = next; else showDash(); }
    catch { showAuth(); }
  })();
})();
