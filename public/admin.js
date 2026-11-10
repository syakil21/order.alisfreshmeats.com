(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rm = (sen) => 'RM ' + (Number(sen || 0) / 100).toFixed(2);
  const rmShort = (sen) => { const v = Number(sen || 0) / 100; return v >= 10000 ? `RM ${(v / 1000).toFixed(1)}k` : `RM ${v.toLocaleString('en-MY', { maximumFractionDigits: v >= 1000 ? 0 : 2, minimumFractionDigits: v >= 1000 ? 0 : 2 })}`; };
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
  const tz = { timeZone: 'Asia/Kuala_Lumpur' };
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-MY', { ...tz, hour: 'numeric', minute: '2-digit' });
  const fmtDT = (ts) => new Date(ts).toLocaleString('en-MY', { ...tz, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const dayKey = (ts) => new Date(ts).toLocaleDateString('en-CA', tz);
  const whenText = (ts) => { const d = dayKey(ts); const t = dayKey(Date.now()); const tm = dayKey(Date.now() + 86400000); return `${d === t ? 'Today' : d === tm ? 'Tomorrow' : new Date(ts).toLocaleDateString('en-MY', { ...tz, weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(ts)}`; };
  const ago = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m ago` : fmtDT(ts); };
  const mins = (ts) => Math.max(0, Math.round((Date.now() - ts) / 60000));
  const qtyText = (q, u) => (u === 'kg' ? `${q} kg` : u === 'set' ? `${q} ${q > 1 ? 'sets' : 'set'}` : `${q} ${q > 1 ? 'pcs' : 'pc'}`);
  const prettyPhone = (p) => String(p || '').replace(/^\+60/, '0');
  const FAIL = ['BOOKING_FAILED', 'CANCELED', 'CANCELLED', 'REJECTED', 'EXPIRED'];
  let token = ls.get('afm_admin');
  let me = (() => { try { return JSON.parse(ls.get('afm_admin_me') || 'null'); } catch { return null; } })();
  const isSuper = () => me?.role === 'super';

  function toast(m) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 4000); }
  async function api(action, data = {}) {
    const r = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ action, ...data }) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && action !== 'login') { showLogin(); throw new Error(d.error || 'Please log in'); }
    if (!r.ok) throw new Error(d.error || 'Something went wrong');
    return d;
  }
  async function busy(btn, fn) {
    const t = btn?.innerHTML; if (btn) { btn.disabled = true; btn.textContent = '…'; }
    try { return await fn(); } catch (e) { toast(e.message); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = t; } }
  }

  // ---------- navigation ----------
  const I = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    insights: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14c2.5 0 4 1.3 4.8 4"/>',
    promos: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    staff: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 17c.8-1.8 2.2-2.7 4-2.7s3.2.9 4 2.7"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;
  const ALL_TABS = [['home', 'Home'], ['menu', 'Menu'], ['insights', 'Insights'], ['customers', 'Customers'], ['promos', 'Promotions'], ['activity', 'Activity'], ['staff', 'Staff'], ['settings', 'Settings']];
  let TABS = ALL_TABS; let BOTTOM = ['home', 'menu', 'insights', 'activity', 'more'];
  function buildNav() {
    TABS = isSuper() ? ALL_TABS : ALL_TABS.filter(([k]) => ['home', 'menu'].includes(k));
    BOTTOM = isSuper() ? ['home', 'menu', 'insights', 'activity', 'more'] : ['home', 'menu', 'more'];
    $('#nav').innerHTML = TABS.map(([k, l]) => `<button type="button" data-tab="${k}">${icon(k)}<span>${l}</span>${k === 'home' ? '<span class="dot hidden" id="navDot"></span>' : ''}</button>`).join('');
    $('#bnav').style.gridTemplateColumns = `repeat(${BOTTOM.length}, 1fr)`;
    $('#bnav').innerHTML = BOTTOM.map((k) => `<button type="button" data-tab="${k}">${icon(k)}<span>${k === 'more' ? 'More' : TABS.find((t) => t[0] === k)[1]}</span>${k === 'home' ? '<span class="dot hidden" id="bnavDot"></span>' : ''}</button>`).join('');
    $('#whoami').textContent = me ? `${me.name} · ${isSuper() ? 'Super admin' : 'Staff'}` : '';
    $('#addProduct').classList.toggle('hidden', !isSuper()); $('#saveProducts').classList.toggle('hidden', !isSuper());
  }
  const loaded = {};
  let tab = 'home';
  function showTab(t) {
    if (t === 'more') return openMore();
    tab = t; closeDrawer();
    $$('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t || (b.dataset.tab === 'more' && !BOTTOM.includes(t))));
    $$('[data-view]').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== t));
    $('#topTitle').textContent = TABS.find((x) => x[0] === t)?.[1] || '';
    if (!TABS.some(([k]) => k === t)) t = 'home';
    const loaders = { menu: loadProducts, insights: () => loadInsights(), customers: loadMembers, promos: loadPromos, activity: () => loadActivity(true), settings: loadSettings, staff: loadStaff };
    if (t === 'insights' || t === 'activity' || !loaded[t]) { loaded[t] = true; loaders[t]?.(); }
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
  function openMore() {
    openDrawerHTML(`<div class="row"><h2 class="grow" style="margin:0;font:600 20px Oswald,sans-serif;text-transform:uppercase">More</h2><button class="btn sm" data-close>Close</button></div>
      ${TABS.some(([k]) => !BOTTOM.includes(k)) ? `<div class="card" style="margin-top:12px;padding:6px">${TABS.filter(([k]) => !BOTTOM.includes(k)).map(([k, l]) => `<button type="button" class="btn" data-tab="${k}" style="display:flex;gap:12px;width:100%;border:0;text-align:left;align-items:center">${icon(k)}${l}</button>`).join('')}</div>` : ''}
      <p class="muted" style="margin:14px 2px">Logged in as <b>${esc(me?.name || '')}</b> (${isSuper() ? 'super admin' : 'staff'})</p>
      <button class="btn" type="button" id="logout2" style="width:100%">Log out</button>`);
    $('#logout2').onclick = logout;
  }

  // ---------- login ----------
  function showLogin() { $('#appView').classList.add('hidden'); $('#loginView').classList.remove('hidden'); clearInterval(pollTimer); if (me?.name && me.id !== 'owner') $('#lname').value = me.name; }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#loginErr').textContent = '';
    try { const d = await api('login', { name: $('#lname').value.trim(), password: $('#pass').value }); token = d.token; me = d.me; ls.set('afm_admin', token); ls.set('afm_admin_me', JSON.stringify(me)); start(); }
    catch (err) { $('#loginErr').textContent = err.message; }
  });
  async function logout() { try { await api('logout'); } catch {} token = null; ls.set('afm_admin', null); ls.set('afm_admin_me', null); location.reload(); }
  $('#logout').addEventListener('click', logout);

  // ---------- home: store switch ----------
  let home = null; let pollTimer; const seenPaid = new Set(); let firstLoad = true; const freshIds = new Set();
  let sound = ls.get('afm_sound') === '1'; let actx;
  function chime() {
    if (!sound) return;
    try {
      actx ||= new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18, 0.36].forEach((t, i) => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = [880, 1175, 1568][i]; g.gain.setValueAtTime(0.0001, actx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.3, actx.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + t + 0.3); o.connect(g).connect(actx.destination); o.start(actx.currentTime + t); o.stop(actx.currentTime + t + 0.32); });
    } catch {}
  }
  const paintSound = () => { $('#soundBtn').textContent = sound ? '🔔 Order sound on' : '🔕 Order sound off'; };
  $('#soundBtn').addEventListener('click', () => { sound = !sound; ls.set('afm_sound', sound ? '1' : null); paintSound(); if (sound) chime(); });

  async function loadHome() {
    try {
      const d = await api('home');
      const fresh = [];
      for (const o of d.orders) if (o.paid && !seenPaid.has(o.id)) { if (!firstLoad) { fresh.push(o); freshIds.add(o.id); } seenPaid.add(o.id); }
      home = d; firstLoad = false;
      renderStore(); renderTiles(); renderBoard();
      if (fresh.length) {
        chime(); toast(`New paid order: ${fresh.map((o) => o.no).join(', ')}`);
        document.title = `(${fresh.length}) New order · Ali's`; setTimeout(() => (document.title = "Ali's Staff"), 15000);
        setTimeout(() => fresh.forEach((o) => freshIds.delete(o.id)), 12000);
      }
    } catch (e) { console.warn(e); }
  }
  function renderStore() {
    const s = home.store; const card = $('#storeCard');
    const paused = s.pausedUntil > Date.now();
    const on = s.acceptingOrders && !paused;
    $('#storeSwitch').checked = on;
    card.className = 'store ' + (!s.acceptingOrders ? 'off' : paused ? 'paused' : s.open ? 'open' : 'off');
    let title, sub;
    if (!s.acceptingOrders) { title = 'Online ordering is OFF'; sub = 'Customers can browse but cannot order. Turn the switch on to take orders.'; }
    else if (paused) { title = `Paused until ${fmtTime(s.pausedUntil)}`; sub = 'Orders start again automatically.'; }
    else if (s.open) { title = 'Open for online orders today'; sub = s.message; }
    else { title = 'Closed now'; sub = s.message; }
    $('#storeTitle').textContent = title; $('#storeSub').textContent = sub;
    $('#pauseBtns').innerHTML = paused ? '<button class="btn go" type="button" data-resume>Resume now</button>'
      : s.acceptingOrders ? '<span class="muted" style="align-self:center">Busy? Pause:</span><button class="btn sm" type="button" data-pause="30">30 min</button><button class="btn sm" type="button" data-pause="60">1 hour</button><button class="btn sm" type="button" data-pause="today">Rest of today</button>' : '';
    const ts = $('#topStatus'); ts.textContent = !s.acceptingOrders ? 'Off' : paused ? 'Paused' : s.open ? 'Open' : 'Closed'; ts.className = 'tag ' + (on && s.open ? 't-done' : paused ? 't-prep' : 't-bad');
  }
  $('#storeSwitch').addEventListener('change', async (e) => {
    const want = e.target.checked;
    if (!want && !confirm('Turn OFF online ordering? Customers will not be able to order until you turn it on again.')) { e.target.checked = true; return; }
    try { home = { ...home, ...(await api('store.setOpen', { open: want })) }; renderStore(); toast(want ? 'Online ordering is ON' : 'Online ordering is OFF'); } catch (err) { toast(err.message); e.target.checked = !want; }
  });
  $('#pauseBtns').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    busy(b, async () => {
      const d = b.hasAttribute('data-resume') ? await api('store.setOpen', { open: true }) : await api('store.pause', { minutes: b.dataset.pause === 'today' ? 'today' : Number(b.dataset.pause) });
      home = { ...home, ...d }; renderStore(); renderTiles(); renderBoard();
      toast(b.hasAttribute('data-resume') ? 'Taking orders again' : `Paused until ${fmtTime(d.store.pausedUntil)}`);
    });
  });

  // ---------- home: today's numbers ----------
  const delta = (cur, prev) => {
    if (!prev && !cur) return '<span>same as yesterday</span>';
    if (!prev) return '<span class="up">▲ new</span> vs yesterday';
    const p = Math.round(((cur - prev) / prev) * 100);
    return `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%</span> vs yesterday`;
  };
  function renderTiles() {
    const t = home.today;
    const active = home.orders.filter((o) => o.paid && ['preparing', 'ready'].includes(o.board)).length;
    if (t.salesSen === undefined) { // staff: no sales figures
      $('#todayTiles').innerHTML = `
        <div class="tile"><div class="k">Orders today</div><div class="v">${t.orders}</div><div class="d">${t.delivery} delivery · ${t.pickup} pickup</div></div>
        <div class="tile"><div class="k">In progress</div><div class="v">${active}</div><div class="d">${t.unpaid ? `${t.unpaid} checkout${t.unpaid > 1 ? 's' : ''} not paid` : 'orders being prepared'}</div></div>`;
      return;
    }
    $('#todayTiles').innerHTML = `
      <div class="tile"><div class="k">Sales today</div><div class="v">${rm(t.salesSen)}</div><div class="d">${delta(t.salesSen, t.prev.salesSen)}</div></div>
      <div class="tile"><div class="k">Orders today</div><div class="v">${t.orders}</div><div class="d">${t.delivery} delivery · ${t.pickup} pickup</div></div>
      <div class="tile"><div class="k">Average order</div><div class="v">${rm(t.aovSen)}</div><div class="d">${delta(t.aovSen, t.prev.aovSen)}</div></div>
      <div class="tile"><div class="k">In progress</div><div class="v">${active}</div><div class="d">${t.unpaid ? `${t.unpaid} checkout${t.unpaid > 1 ? 's' : ''} not paid` : 'orders being prepared'}</div></div>`;
  }

  // ---------- home: order board ----------
  let boardTab = 'preparing'; let allOrders = null; let deletedOrders = null;
  const isLater = (o) => o.fulfilment === 'pickup' && o.board === 'preparing' && o.pickupAt && Date.parse(o.pickupAt) - Date.now() > 120 * 60000;
  const GROUPS = [
    ['preparing', 'Preparing', (o) => o.board === 'preparing' && !isLater(o)],
    ['ready', 'Ready / on the way', (o) => o.board === 'ready'],
    ['attention', 'Needs attention', (o) => o.paid && !o.cancelledAt && !!o.problem],
    ['later', 'Later pickups', isLater],
    ['done', 'Done today', (o) => o.board === 'done'],
    ['unpaid', 'Checking out', (o) => o.board === 'unpaid'],
    ['all', 'All orders', () => true],
    ['deleted', 'Deleted', () => true],
  ];
  function speedTag(o) {
    if (o.fulfilment === 'pickup') return `<span class="tag t-pick">🛍 Pickup ${o.pickupAt ? esc(whenText(Date.parse(o.pickupAt))) : ''}</span>`;
    if (o.deliveryOption === 'priority') return '<span class="tag t-dark">⚡ Priority</span>';
    if (o.deliveryOption === 'saver') return '<span class="tag t-pay">Pooling</span>';
    return '<span class="tag t-pay">🛵 Delivery</span>';
  }
  function statusLine(o) {
    if (!o.paid) return o.paymentStatus === 'failed' ? 'Payment failed' : `Checking out (${ago(o.createdAt)})`;
    if (o.cancelledAt) return 'Cancelled';
    if (o.fulfilment === 'pickup') return o.stage === 'collected' ? 'Collected' : o.readyAt ? `Ready since ${fmtTime(o.readyAt)}` : `Prepare for ${o.pickupAt ? whenText(Date.parse(o.pickupAt)) : 'pickup'}`;
    const ds = o.deliveryStatus;
    if (ds === 'ASSIGNING_DRIVER') return `Finding driver · ${mins(o.bookedAt)} min${o.priorityFeeRM ? ` · tip RM${o.priorityFeeRM}` : ''}${o.readyAt ? ' · packed' : ''}`;
    if (ds === 'ON_GOING') return `Driver ${esc(o.driver || '')} coming to shop${o.readyAt ? ' · packed' : ''}`;
    if (ds === 'PICKED_UP') return `On the way with ${esc(o.driver || 'driver')}`;
    if (ds === 'COMPLETED') return 'Delivered';
    if (FAIL.includes(ds)) return `Lalamove ${ds.toLowerCase().replace('_', ' ')}`;
    return o.stageText;
  }
  function cardActions(o) {
    const a = [];
    const b = (act, label, cls = '') => `<button type="button" class="btn sm ${cls}" data-cact="${act}" data-id="${esc(o.id)}">${label}</button>`;
    if (!o.paid) { if (o.paymentStatus !== 'failed') a.push(b('order.checkPayment', 'Check payment')); return a.join(''); }
    if (o.cancelledAt) return '';
    if (o.problem === 'Label not printed') a.push(b('order.reprint', '🖨 Reprint', 'pri'));
    if (o.fulfilment === 'pickup') {
      if (o.stage === 'preparing') a.push(b('order.ready', '✓ Ready for pickup', 'go'));
      else if (o.stage === 'ready') a.push(b('order.collected', '✓ Collected', 'go'));
    } else {
      const ds = o.deliveryStatus;
      if (!o.readyAt && ['ASSIGNING_DRIVER', 'ON_GOING'].includes(ds)) a.push(b('order.ready', '✓ Packed', 'go'));
      if (ds === 'ASSIGNING_DRIVER' && mins(o.bookedAt) >= 8) a.push(b('tip', '+ Add tip', 'pri'));
      if (ds === 'ON_GOING' && o.matchedAt && mins(o.matchedAt) >= 15) a.push(b('open', 'Change driver'));
      if (FAIL.includes(ds) || !ds) a.push(b('open', 'Rebook…', 'pri'));
    }
    return a.join('');
  }
  function orderCard(o) {
    return `<div class="oc ${o.problem && o.paid && !o.cancelledAt ? 'prob' : ''} ${freshIds.has(o.id) ? 'fresh' : ''}" data-oid="${esc(o.id)}">
      <div class="top"><span class="no">${esc(o.no)}</span>${speedTag(o)}<span class="ago">${ago(o.createdAt)}</span></div>
      <div class="who"><b>${esc(o.name)}</b> · ${esc(prettyPhone(o.phone))} <span class="muted">· ${esc(o.branchName)}</span></div>
      <div class="items">${esc(o.items || `${o.itemCount} items`)}</div>
      <div class="meta"><span class="sl">${statusLine(o)}</span><span class="tot">${rm(o.totalSen)}</span></div>
      ${o.problem && o.paid && !o.cancelledAt ? `<div class="warn">⚠ ${esc(o.problem)}</div>` : ''}
      ${o.deletedAt ? `<div class="warn">Deleted by ${esc(o.deletedBy || '')} ${fmtDT(o.deletedAt)}${o.deleteReason ? `: ${esc(o.deleteReason)}` : ''}</div>` : `<div class="acts">${cardActions(o)}</div>`}
    </div>`;
  }
  function renderBoard() {
    if (!home) return;
    const q = $('#search').value.trim().toLowerCase();
    const src = boardTab === 'all' && allOrders ? allOrders : boardTab === 'deleted' ? deletedOrders || [] : home.orders;
    const counts = Object.fromEntries(GROUPS.map(([k, , f]) => [k, home.orders.filter(f).length]));
    $('#boardTabs').innerHTML = GROUPS.filter(([k]) => k !== 'deleted' || isSuper()).map(([k, l]) => `<button type="button" class="chip ${k === boardTab ? 'on' : ''} ${k === 'attention' && counts[k] ? 'alert' : ''}" data-board="${k}">${l}${!['all', 'deleted'].includes(k) ? `<span class="n">${counts[k]}</span>` : ''}</button>`).join('');
    const f = GROUPS.find((g) => g[0] === boardTab)[2];
    let list = q ? src.filter((o) => [o.no, o.name, o.phone, prettyPhone(o.phone)].join(' ').toLowerCase().includes(q)) : src.filter(f);
    if (boardTab === 'later') list = list.sort((a, b) => Date.parse(a.pickupAt) - Date.parse(b.pickupAt));
    if (boardTab === 'preparing') list = list.sort((a, b) => a.createdAt - b.createdAt); // oldest first, like a kitchen queue
    $('#board').innerHTML = list.map(orderCard).join('') || `<div class="empty" style="grid-column:1/-1">${q ? 'No orders match.' : { preparing: 'No orders to prepare. New paid orders appear here with a sound.', ready: 'Nothing waiting for collection or on the way.', attention: 'All good. Nothing needs attention.', later: 'No pickups booked for later.', done: 'No completed orders yet today.', unpaid: 'Nobody is checking out right now.', all: 'No orders yet.', deleted: 'No deleted orders.' }[boardTab]}</div>`;
    const n = counts.preparing + counts.attention;
    for (const id of ['#navDot', '#bnavDot']) { const d = $(id); if (d) { d.textContent = n; d.classList.toggle('hidden', !n); } }
  }
  $('#boardTabs').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-board]'); if (!b) return;
    boardTab = b.dataset.board; renderBoard();
    if (boardTab === 'all') { try { allOrders = (await api('orders.list', { limit: 300 })).orders; renderBoard(); } catch (err) { toast(err.message); } }
    if (boardTab === 'deleted') { try { deletedOrders = (await api('orders.deleted')).orders; renderBoard(); } catch (err) { toast(err.message); } }
  });
  $('#search').addEventListener('input', () => renderBoard());
  $('#board').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cact]');
    if (btn) {
      e.stopPropagation();
      const id = btn.dataset.id; const act = btn.dataset.cact;
      if (act === 'open') return openOrder(id);
      if (act === 'tip') return tipFlow(id, btn);
      return busy(btn, async () => { const r = await api(act, { id }); toast(DONE[act]?.(r) || 'Done'); await loadHome(); });
    }
    const card = e.target.closest('[data-oid]'); if (card) openOrder(card.dataset.oid);
  });
  const DONE = {
    'order.reprint': () => 'Label sent to printer', 'order.rebook': () => 'Lalamove booked', 'order.cancelDelivery': () => 'Lalamove cancelled', 'order.refresh': () => 'Delivery updated',
    'order.checkPayment': (r) => (r.billState === 'paid' ? 'Payment confirmed' : `Billplz says: ${r.billState}`), 'order.ready': (r) => (r.order.fulfilment === 'pickup' ? 'Marked ready. Customer notified.' : 'Marked packed'),
    'order.collected': () => 'Marked collected', 'order.undoReady': () => 'Undone', 'order.cancel': () => 'Order cancelled', 'order.tip': () => 'Tip added on Lalamove', 'order.changeDriver': () => 'Lalamove is finding another driver',
  };
  async function tipFlow(id, btn) {
    const v = prompt('Add a tip for the driver (RM). Lalamove shows it to drivers so one accepts faster. The delivery price stays the same.', '3');
    if (v == null) return;
    await busy(btn, async () => { await api('order.tip', { id, amountRM: Number(v) }); toast(`Tip RM${Number(v).toFixed(2)} added`); await loadHome(); if (openId === id) openOrder(id); });
  }

  // ---------- order drawer ----------
  let openId = null;
  function openDrawerHTML(html) { $('#drawer').classList.add('show'); $('#drawerBody').innerHTML = html; }
  function closeDrawer() { $('#drawer').classList.remove('show'); openId = null; if (/^#(order|no)=/.test(location.hash)) window.history.replaceState(null, '', location.pathname); }
  $('#drawer').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDrawer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  async function openOrder(id) {
    openId = id; openDrawerHTML('<p class="muted">Loading…</p>');
    try { renderOrder((await api('order.get', { id })).order); } catch (e) { $('#drawerBody').innerHTML = `<p class="warn">${esc(e.message)}</p><button class="btn" data-close>Close</button>`; }
  }
  function renderOrder(o) {
    const s = o.summary; const d = o.delivery || {}; const p = o.print || {};
    const paid = o.payment.status === 'paid'; const pickup = o.fulfilment === 'pickup';
    const failed = FAIL.includes(d.status);
    const wa = o.customer.phone.replace('+', '');
    const costRM = (Number(d.feeRM) || 0) + (Number(d.priorityFeeRM) || 0);
    let deliveryTools = '';
    if (paid && !pickup && !o.cancelledAt) {
      if (d.status === 'ASSIGNING_DRIVER') deliveryTools = `<div class="note info"><b>No driver yet${d.bookedAt ? ` (${mins(d.bookedAt)} min)` : ''}?</b> Add a tip instead of cancelling. The original price stays; a cancel + rebook gets a new, often higher, price.</div>
          <div class="row" style="margin-top:8px"><span class="muted">Tip RM</span><input class="inp" id="tipAmt" type="number" min="1" max="100" step="1" value="3" style="width:80px"><button class="btn pri sm" data-act="order.tip">Add tip</button>${d.priorityFeeRM ? `<span class="muted">Current tip RM${Number(d.priorityFeeRM).toFixed(2)}</span>` : ''}</div>`;
      else if (d.status === 'ON_GOING' && d.driver?.id) deliveryTools = `<div class="note info"><b>Driver late or not responding?</b> Ask Lalamove for another driver. Free, same price. Allowed 15 minutes after the driver accepted${d.driver.matchedAt ? ` (accepted ${mins(d.driver.matchedAt)} min ago)` : ''}, before pickup.</div>
          <div class="row" style="margin-top:8px"><select class="inp" id="drvReason"><option value="DRIVER_LATE">Driver is late</option><option value="DRIVER_UNRESPONSIVE">Driver not responding</option><option value="DRIVER_ASKED_CHANGE">Driver asked to change</option><option value="DRIVER_RUDE">Driver was rude</option></select><button class="btn pri sm" data-act="order.changeDriver">Change driver</button></div>`;
      else if (failed || !d.lalamoveOrderId) deliveryTools = `<div class="note"><b>${d.status ? `Lalamove ${esc(d.status.toLowerCase().replace('_', ' '))}.` : 'Not booked yet.'}</b> Check today's price before rebooking. The customer paid ${rm(o.deliverySen)} for delivery.</div>
          <div class="row" style="margin-top:8px"><button class="btn sm" data-act="rebookQuote">Check new price</button><span id="rbq" class="muted"></span></div>`;
    }
    $('#drawerBody').innerHTML = `
      <div class="row"><h2 class="grow" style="margin:0;font:600 22px Oswald,sans-serif">${esc(o.no)}</h2><button class="btn sm" data-close>Close</button></div>
      <div class="row" style="margin:8px 0 12px">${speedTag(s)} <span class="tag ${o.cancelledAt || o.deletedAt ? 't-bad' : paid ? 't-done' : 't-pay'}">${esc(o.deletedAt ? 'Deleted' : o.cancelledAt ? 'Cancelled' : paid ? s.stageText : 'Not paid')}</span>${s.problem && paid && !o.cancelledAt && !o.deletedAt ? `<span class="warn">⚠ ${esc(s.problem)}</span>` : ''}</div>
      ${o.deletedAt ? `<div class="note" style="margin-bottom:14px"><b>Deleted by ${esc(o.deletedBy || '')}</b>, ${fmtDT(o.deletedAt)}${o.deleteReason ? `: ${esc(o.deleteReason)}` : ''}. It no longer shows in orders or sales, but the record stays here and in the Activity log.</div>` : ''}
      <div class="card ${o.deletedAt ? 'hidden' : ''}"><div class="row">
        ${paid ? `<button class="btn pri sm" data-act="order.reprint">🖨 Reprint label</button><button class="btn sm" data-act="labelpdf">Label PDF</button>` : ''}
        ${paid && !o.cancelledAt && pickup && !o.prep?.readyAt ? '<button class="btn go sm" data-act="order.ready">✓ Ready for pickup</button>' : ''}
        ${paid && !o.cancelledAt && pickup && o.prep?.readyAt && !o.prep?.collectedAt ? '<button class="btn go sm" data-act="order.collected">✓ Collected</button>' : ''}
        ${paid && !o.cancelledAt && !pickup && !o.prep?.readyAt && d.lalamoveOrderId && !failed ? '<button class="btn go sm" data-act="order.ready">✓ Packed</button>' : ''}
        ${o.prep?.readyAt ? '<button class="btn sm" data-act="order.undoReady">Undo ready</button>' : ''}
        ${!paid && o.payment.billId ? '<button class="btn sm" data-act="order.checkPayment">Check payment with Billplz</button>' : ''}
        ${d.lalamoveOrderId ? '<button class="btn sm" data-act="order.refresh">Refresh delivery</button>' : ''}
      </div>${deliveryTools ? `<div style="margin-top:12px">${deliveryTools}</div>` : ''}</div>
      <div class="card"><dl class="kv">
        <dt>Customer</dt><dd><b>${esc(o.customer.name)}</b>${o.memberId ? ' <span class="tag t-done">member</span>' : ''}<br><a href="tel:${esc(o.customer.phone)}">${esc(prettyPhone(o.customer.phone))}</a> · <a href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>${o.customer.email ? `<br>${esc(o.customer.email)}` : ''}</dd>
        ${pickup ? `<dt>Self pickup</dt><dd><b>${esc(o.branchName)}</b> · ${o.pickup?.at ? esc(whenText(Date.parse(o.pickup.at))) : ''}${o.address?.notes ? `<br><b>Note:</b> ${esc(o.address.notes)}` : ''}</dd>`
        : `<dt>Deliver to</dt><dd>${esc(o.address.text)}${o.address.unit ? `<br><b>Unit:</b> ${esc(o.address.unit)}` : ''}${o.address.notes ? `<br><b>Note:</b> ${esc(o.address.notes)}` : ''}<br><a href="https://www.google.com/maps?q=${o.address.lat},${o.address.lng}" target="_blank" rel="noopener">Open in Google Maps</a>${o.distanceKm ? ` · ${o.distanceKm} km` : ''}</dd>
        <dt>From</dt><dd>${esc(o.branchName)}</dd>`}
        <dt>Placed</dt><dd>${fmtDT(o.createdAt)}</dd>
      </dl></div>
      <div class="card"><table class="list">
        ${o.items.map((i) => `<tr><td>${esc(i.name)}${i.cutText ? `<div class="cutline">✂ ${esc(i.cutText)}</div>` : ''}</td><td><b>${qtyText(i.qty, i.unit)}</b></td><td class="num">${rm(i.lineSen)}</td></tr>`).join('')}
        <tr><td colspan="2">Subtotal</td><td class="num">${rm(o.subtotalSen)}</td></tr>
        ${(o.discounts || []).map((x) => `<tr><td colspan="2">${esc(x.label)}</td><td class="num">− ${rm(x.sen)}</td></tr>`).join('')}
        ${o.pointsSen ? `<tr><td colspan="2">Points used (${o.pointsUsed})</td><td class="num">− ${rm(o.pointsSen)}</td></tr>` : ''}
        <tr><td colspan="2">${pickup ? 'Self pickup' : `Delivery charged (${({ priority: 'Priority', saver: 'Pooling' })[o.deliveryOption] || 'Regular'})`}</td><td class="num">${rm(o.deliverySen)}</td></tr>
        <tr><td colspan="2"><b>Total</b></td><td class="num"><b>${rm(o.totalSen)}</b></td></tr>
        ${o.originalTotalSen != null && o.originalTotalSen !== o.totalSen ? `<tr><td colspan="2">Customer paid</td><td class="num">${rm(o.originalTotalSen)}</td></tr><tr><td colspan="2"><b class="${o.totalSen > o.originalTotalSen ? 'bad' : 'ok'}">${o.totalSen > o.originalTotalSen ? 'To collect from customer' : 'To refund to customer'}</b></td><td class="num"><b>${rm(Math.abs(o.totalSen - o.originalTotalSen))}</b></td></tr>` : ''}
        ${o.pointsEarned && paid ? `<tr><td colspan="3" class="muted">Customer earned ${o.pointsEarned} points</td></tr>` : ''}
      </table></div>
      <div class="card"><dl class="kv">
        <dt>Payment</dt><dd>${paid ? `<span class="ok">Paid</span> ${o.payment.paidAt ? fmtDT(o.payment.paidAt) : ''}` : `<span class="bad">${esc(o.payment.status)}</span>`}${o.payment.billId ? `<br><span class="muted">Billplz bill ${esc(o.payment.billId)}</span>` : ''}</dd>
        ${pickup ? '' : `<dt>Lalamove</dt><dd>${d.lalamoveOrderId ? `#${esc(d.lalamoveOrderId)} · <b>${esc(d.status)}</b>` : d.status ? `<b>${esc(d.status)}</b>` : '<span class="muted">Not booked</span>'}
          ${d.error ? `<div class="warn">${esc(d.error)}</div>` : ''}
          ${d.feeRM != null ? `<br>Lalamove cost RM${costRM.toFixed(2)}${d.priorityFeeRM ? ` (incl. tip RM${Number(d.priorityFeeRM).toFixed(2)})` : ''} · customer paid ${rm(o.deliverySen)} <span class="${o.deliverySen / 100 - costRM >= 0 ? 'ok' : 'bad'}">(${o.deliverySen / 100 - costRM >= 0 ? '+' : '−'}RM${Math.abs(o.deliverySen / 100 - costRM).toFixed(2)})</span>` : ''}
          ${d.scheduleAt ? `<br>Driver pickup ${fmtDT(Date.parse(d.scheduleAt))}` : ''}
          ${d.driver?.name ? `<br>Driver ${esc(d.driver.name)} ${d.driver.plate ? '· ' + esc(d.driver.plate) : ''} ${d.driver.phone ? `· <a href="tel:${esc(d.driver.phone)}">${esc(d.driver.phone)}</a>` : ''}` : ''}
          ${d.shareLink ? `<br><a href="${esc(d.shareLink)}" target="_blank" rel="noopener">Track on Lalamove</a>` : ''}
          ${d.pod?.image ? `<br><a href="${esc(d.pod.image)}" target="_blank" rel="noopener">Proof of delivery photo</a>` : ''}
          ${(d.history || []).length ? `<br><span class="muted">Earlier bookings: ${d.history.map((h) => `#${esc(h.id)} ${esc(h.status || '')} RM${Number(h.feeRM || 0).toFixed(2)}`).join(', ')}</span>` : ''}</dd>`}
        <dt>Label</dt><dd>${p.status === 'sent' ? `<span class="ok">Printed</span> ${fmtDT(p.at)}${p.count > 1 ? ` (${p.count}×)` : ''}` : p.status ? `<span class="bad">${esc(p.status.replace('_', ' '))}</span><div class="warn">${esc(p.error || '')}</div>` : '<span class="muted">—</span>'}</dd>
      </dl></div>
      <div class="card"><h2>History</h2><ol class="log">${(o.log || []).slice().reverse().map((l) => `<li><span class="muted">${fmtDT(l.at)}</span> ${esc(l.msg)}</li>`).join('')}</ol></div>
      ${!o.deletedAt ? `<div class="row">
        ${paid && !o.cancelledAt && d.lalamoveOrderId && ['ASSIGNING_DRIVER', 'ON_GOING'].includes(d.status) ? '<button class="btn red sm" data-act="order.cancelDelivery" data-confirm="Cancel this Lalamove delivery? Rebooking later gets a new price, which is often higher. Try a tip or change driver first.">Cancel Lalamove</button>' : ''}
        ${isSuper() ? `<button class="btn sm" data-act="edit">✎ Edit order</button>${paid && !o.cancelledAt ? '<button class="btn red sm" data-act="order.cancel">Cancel order…</button>' : ''}<button class="btn red sm" data-act="delete">Delete order…</button>` : ''}
      </div>` : ''}`;
    $('#drawerBody').querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act; const extra = {};
      if (act === 'labelpdf') return window.open(`/api/label?id=${encodeURIComponent(o.id)}&auth=${encodeURIComponent(token)}`, '_blank');
      if (act === 'edit') return editOrder(o);
      if (act === 'delete') {
        const why = prompt(`Delete ${o.no} (${o.customer.name}, ${rm(o.totalSen)})?\n\nIt disappears from orders and sales${o.payment.status === 'paid' ? ', stock and points are put back' : ''}. The record stays in the Activity log.\n\nReason:`, 'Test order');
        if (why == null) return;
        return busy(b, async () => { await api('order.delete', { id: o.id, reason: why }); toast(`${o.no} deleted`); closeDrawer(); deletedOrders = null; await loadHome(); });
      }
      if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
      if (act === 'order.tip') extra.amountRM = Number($('#tipAmt').value);
      if (act === 'order.changeDriver') extra.reason = $('#drvReason').value;
      if (act === 'order.cancel') {
        const why = prompt(`Cancel ${o.no}? ${paid ? `Remember to refund ${rm(o.totalSen)} to the customer (Billplz / bank transfer).` : ''}\n\nReason (shown in the history):`, 'Out of stock');
        if (why == null) return; extra.reason = why;
      }
      if (act === 'rebookQuote') return busy(b, async () => {
        const r = await api('order.rebookQuote', { id: o.id });
        const diff = r.nowRM - r.chargedRM;
        $('#rbq').innerHTML = `Now <b>RM${r.nowRM.toFixed(2)}</b> (first booking RM${r.firstRM.toFixed(2)}, customer paid RM${r.chargedRM.toFixed(2)}${diff > 0.04 ? `, <span class="bad">you pay RM${diff.toFixed(2)} extra</span>` : ''}) <button class="btn pri sm" id="doRebook">Rebook at RM${r.nowRM.toFixed(2)}</button>`;
        $('#doRebook').onclick = (ev) => busy(ev.target, async () => { const x = await api('order.rebook', { id: o.id }); if (openId === o.id) renderOrder(x.order); toast('Lalamove booked'); loadHome(); });
      });
      busy(b, async () => {
        const r = await api(act, { id: o.id, ...extra });
        if (openId === o.id && r.order) renderOrder(r.order);
        toast(DONE[act]?.(r) || 'Done');
        loadHome();
      });
    }));
  }

  // ---------- super admin: edit an order ----------
  function editOrder(o) {
    const pickup = o.fulfilment === 'pickup';
    const local = (iso) => (iso ? new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 16) : '');
    $('#drawerBody').innerHTML = `
      <div class="row"><h2 class="grow" style="margin:0;font:600 22px Oswald,sans-serif">Edit ${esc(o.no)}</h2><button class="btn sm" id="edBack">Back</button></div>
      <p class="muted">Every change is saved in the order history and the Activity log with your name.</p>
      <div class="card"><h2>Customer</h2><div class="grid">
        <label class="f">Name<input class="inp" id="edName" value="${esc(o.customer.name)}"></label>
        <label class="f">Phone<input class="inp" id="edPhone" value="${esc(prettyPhone(o.customer.phone))}"></label>
        <label class="f">Email<input class="inp" id="edEmail" value="${esc(o.customer.email || '')}"></label>
      </div></div>
      <div class="card"><h2>${pickup ? 'Self pickup' : 'Delivery address'}</h2><div class="grid">
        ${pickup ? `<label class="f">Pickup time<input class="inp" id="edPickup" type="datetime-local" value="${local(o.pickup?.at)}"></label>`
        : `<label class="f" style="grid-column:1/-1">Address<input class="inp" id="edAddr" value="${esc(o.address.text || '')}"><small>Changing the text doesn't move the map pin or change the Lalamove booking.</small></label>
           <label class="f">Unit / floor<input class="inp" id="edUnit" value="${esc(o.address.unit || '')}"></label>`}
        <label class="f">Note<input class="inp" id="edNotes" value="${esc(o.address.notes || '')}"></label>
      </div></div>
      <div class="card"><h2>Items</h2><table class="list">${o.items.map((it, i) => `<tr data-ei="${i}">
        <td>${esc(it.name)}<input class="inp" data-ecut value="${esc(it.cutText || '')}" placeholder="Cutting / note" style="width:100%;margin-top:6px"></td>
        <td style="width:110px"><input class="inp" data-eqty type="number" min="0.5" step="${it.unit === 'kg' ? 0.5 : 1}" value="${it.qty}" style="width:100%"><div class="muted">${esc(it.unit)} · RM${(it.priceSen / 100).toFixed(2)}</div></td>
        <td style="width:70px"><label class="ck"><input type="checkbox" data-erm> Remove</label></td></tr>`).join('')}</table>
        <p class="muted">The total is worked out again. If it changes, the order shows how much to collect or refund.</p></div>
      <label class="f">Reason for the change<input class="inp" id="edReason" placeholder="e.g. customer called to add 1 kg"></label>
      <div class="row" style="margin-top:14px"><button class="btn pri" id="edSave" style="flex:1">Save changes</button></div>`;
    $('#edBack').onclick = () => renderOrder(o);
    $('#edSave').onclick = (e) => busy(e.target, async () => {
      const items = $$('#drawerBody [data-ei]').map((tr) => ({ i: Number(tr.dataset.ei), qty: Number($('[data-eqty]', tr).value), cutText: $('[data-ecut]', tr).value, remove: $('[data-erm]', tr).checked }));
      const r = await api('order.edit', {
        id: o.id, reason: $('#edReason').value,
        customer: { name: $('#edName').value, phone: $('#edPhone').value, email: $('#edEmail').value },
        address: pickup ? { notes: $('#edNotes').value } : { text: $('#edAddr').value, unit: $('#edUnit').value, notes: $('#edNotes').value },
        pickupAt: pickup ? $('#edPickup').value : undefined, items,
      });
      renderOrder(r.order); toast('Order updated'); loadHome();
    });
  }

  // ---------- menu ----------
  const MODES = [['size', 'Piece size'], ['weight', 'Piece weight'], ['split', 'Cut each into (2/3 pcs)'], ['count', 'Number of pieces'], ['thickness', 'Slice thickness']];
  let products = []; let dirty = false;
  async function loadProducts() { products = (await api('products.get')).products; dirty = false; renderProducts(); }
  const markDirty = () => { dirty = true; $('#saveProducts').textContent = 'Save changes •'; };
  function renderProducts() {
    $('#saveProducts').textContent = dirty ? 'Save changes •' : 'Save changes';
    const cats = [...new Set(products.map((p) => p.category))];
    $('#menuList').innerHTML = cats.map((c) => `<div class="catname">${esc(c)}</div>` + products.map((p, i) => [p, i]).filter(([p]) => p.category === c).map(([p, i]) => `
      <div class="mi ${p.available ? '' : 'off'}" data-i="${i}">
        <div class="ph2">${p.image ? `<img src="/api/image?id=${esc(p.image)}" alt="">` : 'No photo'}</div>
        <div class="nm" data-editp="${i}"><b>${esc(p.name || '(new item)')}</b><span>${[p.note, (p.cutModes || []).length ? '✂ ' + p.cutModes.map((m) => MODES.find((x) => x[0] === m)?.[1].split(' (')[0].toLowerCase()).join(', ') : ''].filter(Boolean).map(esc).join(' · ')}</span></div>
        ${p.id && (p.stock != null || p.stockHint) ? `<button type="button" class="tag ${p.stock == null ? 't-pay' : p.stock < (Number(p.min) || 0.5) ? 't-bad' : p.stock <= 5 ? 't-prep' : 't-done'}" data-stock="${i}" title="Update stock" style="border:0;cursor:pointer">${p.stock == null ? '+ Stock' : p.stock < (Number(p.min) || 0.5) ? 'Sold out · 0' : `${qtyText(p.stock, p.unit)} left`}</button>` : ''}
        <div class="pr">RM ${Number(p.price).toFixed(2)}<span class="muted">/${esc(p.unit)}</span></div>
        <label class="sw-sm" title="${p.available ? 'On sale' : 'Sold out'}"><input type="checkbox" data-avail="${i}" ${p.available ? 'checked' : ''} aria-label="${esc(p.name)} on sale"><i></i></label>
      </div>`).join('')).join('') || '<p class="muted">No items.</p>';
  }
  $('#menuList').addEventListener('change', async (e) => {
    const i = e.target.dataset.avail; if (i == null) return;
    const p = products[i];
    if (!p.id) { p.available = e.target.checked; markDirty(); return renderProducts(); }
    try { const fresh = (await api('products.toggle', { id: p.id, available: e.target.checked })).products; const f = fresh.find((x) => x.id === p.id); p.available = f.available; renderProducts(); toast(`${p.name}: ${p.available ? 'on sale' : 'sold out'}`); }
    catch (err) { toast(err.message); e.target.checked = !e.target.checked; }
  });
  $('#menuList').addEventListener('click', (e) => {
    const st = e.target.closest('[data-stock]'); if (st) return askStock(products[Number(st.dataset.stock)]);
    const n = e.target.closest('[data-editp]'); if (n && isSuper()) editProduct(Number(n.dataset.editp));
  });
  // Stock: goes down when an order is paid, back up when an order is cancelled or deleted
  async function askStock(p, value) {
    const v = value !== undefined ? value : prompt(`How many ${p.unit === 'kg' ? 'kg' : p.unit === 'set' ? 'sets' : 'pieces'} of ${p.name} do you have now?\n\nIt goes down by itself when orders are paid. Leave empty to stop counting (no limit).`, p.stock ?? '');
    if (v == null) return;
    try {
      const fresh = (await api('stock.set', { id: p.id, qty: String(v).trim() })).products;
      const f = fresh.find((x) => x.id === p.id); p.stock = f.stock; renderProducts();
      toast(p.stock == null ? `${p.name}: not counting stock` : `${p.name}: ${qtyText(p.stock, p.unit)} in stock`);
    } catch (err) { toast(err.message); }
  }
  function editProduct(i) {
    const p = products[i];
    openDrawerHTML(`
      <div class="row"><h2 class="grow" style="margin:0;font:600 20px Oswald,sans-serif;text-transform:uppercase">${esc(p.name || 'New item')}</h2><button class="btn sm" data-close>Done</button></div>
      <div class="card" style="margin-top:12px">
        <div class="row" style="align-items:flex-start;gap:16px">
          <button type="button" class="photo" id="pPhoto">${p.image ? `<img src="/api/image?id=${esc(p.image)}" alt="">` : '+ Photo'}</button>
          <div class="grow">${p.image ? '<button class="btn sm red" type="button" id="pNoPhoto">Remove photo</button>' : ''}<p class="muted">Photos save straight away and show on the shop.${p.id ? '' : ' Save the new item first.'}</p></div>
        </div>
        <div class="grid" style="margin-top:12px">
          <label class="f">Name<input class="inp" data-k="name" value="${esc(p.name)}"></label>
          <label class="f">Category<input class="inp" data-k="category" value="${esc(p.category)}" list="cats"></label>
          <label class="f">Note <small style="display:inline">(e.g. “1 set”)</small><input class="inp" data-k="note" value="${esc(p.note)}"></label>
          <label class="f">Price (RM)<input class="inp" data-k="price" type="number" step="0.01" min="0" value="${esc(p.price)}"></label>
          <label class="f">Sold per<select class="inp" data-k="unit">${['kg', 'set', 'pc'].map((u) => `<option ${p.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
          <label class="f">Stock now${p.id ? '' : ' <small style="display:inline">(save the item first)</small>'}<span class="row" style="gap:6px;flex-wrap:nowrap;margin-top:4px"><input class="inp" id="pStock" type="number" min="0" step="${p.unit === 'kg' ? 0.5 : 1}" value="${p.stock ?? ''}" placeholder="not counted" style="margin:0" ${p.id ? '' : 'disabled'}><button type="button" class="btn sm" id="pStockSave" ${p.id ? '' : 'disabled'}>Update</button></span><small>Empty = no limit. Goes down when orders are paid.</small></label>
        </div>
        <h2 style="margin-top:16px">Cutting choices for customers</h2>
        <div class="modes">${MODES.map(([k, l]) => `<label class="ck"><input type="checkbox" data-mode="${k}" ${(p.cutModes || []).includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}
          <label class="ck"><input type="checkbox" data-k="cooking" ${p.cooking ? 'checked' : ''}> Cooking style</label></div>
        <p class="muted">The options come from Settings → Cutting choices. With only “Cut each into” ticked (marrow bones), the customer must pick 2 or 3 pcs.</p>
        <label class="ck" style="margin-top:8px"><input type="checkbox" data-k="available" ${p.available ? 'checked' : ''}> On sale</label>
      </div>
      <div class="row"><button class="btn sm" type="button" data-mv="-1">↑ Move up</button><button class="btn sm" type="button" data-mv="1">↓ Move down</button><span class="grow"></span><button class="btn red sm" type="button" id="pDel">Delete item</button></div>
      <datalist id="cats">${[...new Set(products.map((x) => x.category))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="row" style="margin-top:14px"><button class="btn pri" type="button" id="pSave" style="flex:1">Save changes</button></div>`);
    const body = $('#drawerBody');
    body.addEventListener('input', (e) => {
      const k = e.target.dataset.k; const m = e.target.dataset.mode;
      if (m) { const set = new Set(p.cutModes || []); e.target.checked ? set.add(m) : set.delete(m); p.cutModes = MODES.map((x) => x[0]).filter((x) => set.has(x)); }
      else if (k) {
        p[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        if (k === 'unit') { p.step = p.unit === 'kg' ? 0.5 : 1; p.min = p.step; }
      }
      markDirty(); renderProducts();
    });
    body.addEventListener('change', (e) => { if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') e.target.dispatchEvent(new Event('input', { bubbles: true })); });
    $('#pPhoto').onclick = () => { if (!p.id) return toast('Save the new item first, then add its photo.'); photoFor = p.id; $('#photoFile').value = ''; $('#photoFile').click(); };
    if ($('#pNoPhoto')) $('#pNoPhoto').onclick = (e) => confirm(`Remove the photo of ${p.name}?`) && busy(e.target, async () => { mergeImages((await api('products.imageRemove', { id: p.id })).products); editProduct(i); });
    $('#pStockSave').onclick = () => askStock(p, $('#pStock').value);
    $('#pDel').onclick = () => { if (confirm(`Delete ${p.name}? Click Save changes afterwards.`)) { products.splice(i, 1); markDirty(); renderProducts(); closeDrawer(); } };
    body.querySelectorAll('[data-mv]').forEach((b) => (b.onclick = () => { const j = i + Number(b.dataset.mv); if (j < 0 || j >= products.length) return; [products[i], products[j]] = [products[j], products[i]]; markDirty(); renderProducts(); editProduct(j); }));
    $('#pSave').onclick = (e) => saveProducts(e.target).then(() => closeDrawer());
  }
  let photoFor = null;
  function mergeImages(fresh) {
    const byId = Object.fromEntries(fresh.map((x) => [x.id, x.image]));
    for (const p of products) if (p.id in byId) p.image = byId[p.id];
    renderProducts();
  }
  async function resizePhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Could not read that photo. Please use a JPG or PNG.')); im.src = url; });
      const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      for (const q of [0.82, 0.7, 0.55]) { const d = c.toDataURL('image/jpeg', q); if (d.length < 900000) return d; }
      throw new Error('Photo is too large.');
    } finally { URL.revokeObjectURL(url); }
  }
  $('#photoFile').addEventListener('change', async () => {
    const f = $('#photoFile').files[0]; if (!f || !photoFor) return;
    toast('Uploading photo…');
    try {
      const dataUrl = await resizePhoto(f); mergeImages((await api('products.image', { id: photoFor, dataUrl })).products); toast('Photo saved. It shows on the shop now.');
      const i = products.findIndex((p) => p.id === photoFor); if (i >= 0 && $('#drawer').classList.contains('show')) editProduct(i);
    } catch (err) { toast(err.message); }
    photoFor = null;
  });
  $('#addProduct').addEventListener('click', () => {
    products.push({ category: products.at(-1)?.category || 'Other', name: '', note: '', price: 0, unit: 'kg', step: 0.5, min: 0.5, cutModes: [], cooking: false, stock: null, image: '', available: true });
    markDirty(); renderProducts(); editProduct(products.length - 1);
  });
  async function saveProducts(btn) { return busy(btn, async () => { products = (await api('products.save', { products })).products; dirty = false; renderProducts(); toast('Menu saved. The shop is updated.'); }); }
  $('#saveProducts').addEventListener('click', (e) => saveProducts(e.target));
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- insights ----------
  const RANGES = [['today', 'Today'], ['7d', 'Last 7 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['30d', 'Last 30 days'], ['custom', 'Custom']];
  let range = 'today'; let ins = null;
  $('#rangeChips').innerHTML = RANGES.map(([k, l]) => `<button type="button" class="chip ${k === range ? 'on' : ''}" data-range="${k}">${l}</button>`).join('');
  $('#rangeChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]'); if (!b) return;
    range = b.dataset.range; $$('#rangeChips .chip').forEach((c) => c.classList.toggle('on', c === b));
    $('#customRange').classList.toggle('hidden', range !== 'custom');
    if (range === 'custom') { if (!$('#rFrom').value) { $('#rTo').value = dayKey(Date.now()); $('#rFrom').value = dayKey(Date.now() - 6 * 86400000); } return; }
    loadInsights();
  });
  $('#rGo').addEventListener('click', () => loadInsights());
  async function loadInsights() {
    $('#insights').style.opacity = 0.5;
    try { ins = await api('insights', { range, from: $('#rFrom').value, to: $('#rTo').value }); renderInsights(); }
    catch (e) { $('#insights').innerHTML = `<p class="warn">${esc(e.message)}</p>`; }
    $('#insights').style.opacity = 1;
  }
  const vsPrev = (cur, prev, label) => {
    if (!prev) return cur ? `<span class="up">▲ new</span> vs ${label}` : `— vs ${label}`;
    const p = Math.round(((cur - prev) / prev) * 100);
    return `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%</span> vs ${label}`;
  };
  function renderInsights() {
    const x = ins; const prevLabel = { today: 'yesterday', '7d': 'previous 7 days', month: 'previous period', lastmonth: 'month before', '30d': 'previous 30 days' }[range] || 'previous period';
    const diff = x.deliveryDiffSen;
    $('#insights').innerHTML = `
      <div class="tiles">
        <div class="tile"><div class="k">Sales</div><div class="v">${rm(x.salesSen)}</div><div class="d">${vsPrev(x.salesSen, x.prev.salesSen, prevLabel)}</div></div>
        <div class="tile"><div class="k">Paid orders</div><div class="v">${x.orders}</div><div class="d">${vsPrev(x.orders, x.prev.orders, prevLabel)}</div></div>
        <div class="tile"><div class="k">Average order</div><div class="v">${rm(x.aovSen)}</div><div class="d">${vsPrev(x.aovSen, x.prev.aovSen, prevLabel)}</div></div>
        <div class="tile"><div class="k">Customers</div><div class="v">${x.customers}</div><div class="d">${x.newMembers} new member${x.newMembers === 1 ? '' : 's'} · ${x.kg} kg sold</div></div>
      </div>
      <div class="card"><div class="row"><h2 class="grow" style="margin:0">Sales by ${x.range.bucket === 'hour' ? 'hour' : 'day'} · ${esc(x.range.label)}</h2><button class="btn sm" type="button" id="tblToggle">Show table</button></div>
        <div class="chart" id="chart" role="img" aria-label="Sales by ${x.range.bucket}"></div>
        <div id="chartTable" class="hidden" style="overflow-x:auto"><table class="list"><thead><tr><th>${x.range.bucket === 'hour' ? 'Hour' : 'Day'}</th><th class="num">Orders</th><th class="num">Sales</th></tr></thead><tbody>${x.series.map((s) => `<tr><td>${esc(s.label)}</td><td class="num">${s.orders}</td><td class="num">${rm(s.salesSen)}</td></tr>`).join('')}</tbody></table></div>
      </div>
      <div class="split2">
        <div class="card"><h2>Delivery &amp; pickup</h2><div class="money">
          <span>Delivery orders</span><span class="num">${x.delivery}</span>
          <span class="muted">· Priority</span><span class="num">${x.priority}</span>
          <span class="muted">· Pooling</span><span class="num">${x.saver}</span>
          <span>Self pickup orders</span><span class="num">${x.pickup}</span>
          <span>Deliveries rebooked</span><span class="num">${x.rebooked}</span>
          <span class="sep"></span>
          <span>Delivery fees customers paid</span><span class="num">${rm(x.deliveryChargedSen)}</span>
          <span>Paid to Lalamove (incl. tips)</span><span class="num">${rm(x.lalamoveSen)}</span>
          <span><b>${diff >= 0 ? 'Covered, extra' : 'Shop paid extra'}</b></span><span class="num ${diff >= 0 ? 'ok' : 'bad'}">${diff >= 0 ? '+' : '−'} ${rm(Math.abs(diff))}</span>
        </div>${diff < 0 ? '<p class="muted" style="margin-bottom:0">Lalamove cost more than customers paid (rebooks, tips, price changes). Raise the delivery buffer in Settings to cover this.</p>' : ''}</div>
        <div class="card"><h2>Discounts &amp; points</h2><div class="money">
          <span>Discounts given</span><span class="num">${rm(x.discountSen)}</span>
          <span>Points used by customers</span><span class="num">${rm(x.pointsSen)}</span>
          <span>Points earned</span><span class="num">${x.pointsEarned}</span>
          <span class="sep"></span>
          <span>Checkouts not paid</span><span class="num">${x.unpaid}</span>
          <span>Cancelled orders</span><span class="num">${x.cancelled}</span>
        </div>${x.coupons.length ? `<table class="list" style="margin-top:10px"><thead><tr><th>Coupon</th><th class="num">Orders</th><th class="num">Discount</th></tr></thead><tbody>${x.coupons.map((c) => `<tr><td>${esc(c.code)}</td><td class="num">${c.orders}</td><td class="num">${rm(c.discountSen)}</td></tr>`).join('')}</tbody></table>` : ''}</div>
      </div>
      <div class="split2">
        <div class="card"><h2>Best sellers</h2>${x.topProducts.length ? `<table class="list bars2"><tbody>${x.topProducts.map((p) => `<tr><td style="width:44%">${esc(p.name)}<div class="muted">${qtyText(p.qty, p.unit)} · ${p.orders} order${p.orders > 1 ? 's' : ''}</div></td><td><div class="hbar" style="width:${Math.max(2, Math.round((p.salesSen / x.topProducts[0].salesSen) * 100))}%"></div></td><td class="num" style="width:90px">${rm(p.salesSen)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No sales in this period.</p>'}</div>
        <div class="card"><h2>By branch</h2>${x.branches.length ? `<table class="list"><thead><tr><th>Branch</th><th class="num">Orders</th><th class="num">Sales</th></tr></thead><tbody>${x.branches.map((b) => `<tr><td>${esc(b.name)}</td><td class="num">${b.orders}</td><td class="num">${rm(b.salesSen)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No sales in this period.</p>'}</div>
      </div>`;
    drawChart();
    $('#tblToggle').onclick = () => { const t = $('#chartTable'); t.classList.toggle('hidden'); $('#tblToggle').textContent = t.classList.contains('hidden') ? 'Show table' : 'Hide table'; };
  }
  // Single-series column chart: one hue, columns ≤ 24px with a 4px rounded top, recessive grid, hover tooltip.
  function niceMax(v) { if (v <= 0) return 100; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  function drawChart() {
    const el = $('#chart'); if (!el || !ins) return;
    const data = ins.series; const W = el.clientWidth; const H = el.clientHeight;
    const m = { l: 56, r: 8, t: 12, b: 26 }; const iw = Math.max(10, W - m.l - m.r); const ih = H - m.t - m.b;
    const max = niceMax(Math.max(...data.map((d) => d.salesSen / 100), 0));
    const band = iw / Math.max(1, data.length); const bw = Math.min(24, Math.max(3, band * 0.66));
    const y = (v) => m.t + ih - (v / max) * ih;
    const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(iw / 46))));
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
    const fmtY = (v) => (v >= 1000 ? `RM${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `RM${v}`);
    const col = (x0, v) => { const h = Math.max(0, (v / max) * ih); if (h <= 0) return ''; const r = Math.min(4, h, bw / 2); const top = m.t + ih - h; const base = m.t + ih; return `<path d="M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${base}Z" fill="var(--series-1)"/>`; };
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
      ${ticks.map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)" stroke-width="1"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${fmtY(t)}</text>`).join('')}
      ${data.map((d, i) => col(m.l + i * band + (band - bw) / 2, d.salesSen / 100)).join('')}
      ${data.map((d, i) => (i % every === 0 ? `<text x="${m.l + i * band + band / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(d.label)}</text>` : '')).join('')}
      <line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}" stroke="#cfc8bd" stroke-width="1"/>
      ${data.map((d, i) => `<rect class="hit" data-i="${i}" x="${m.l + i * band}" y="${m.t}" width="${band}" height="${ih}" fill="transparent" tabindex="0" aria-label="${esc(d.label)}: ${rm(d.salesSen)}, ${d.orders} orders"/>`).join('')}
    </svg><div class="tip" id="tip"></div>`;
    const tip = $('#tip');
    const show = (r) => { const i = Number(r.dataset.i); const d = data[i]; tip.innerHTML = `<b>${esc(d.label)}</b>${rm(d.salesSen)} · ${d.orders} order${d.orders === 1 ? '' : 's'}`; tip.style.left = `${m.l + i * band + band / 2}px`; tip.style.top = `${Math.min(y(d.salesSen / 100), m.t + ih - 4)}px`; tip.style.display = 'block'; };
    el.querySelectorAll('.hit').forEach((r) => { r.addEventListener('mouseenter', () => show(r)); r.addEventListener('focus', () => show(r)); r.addEventListener('mouseleave', () => (tip.style.display = 'none')); r.addEventListener('blur', () => (tip.style.display = 'none')); r.addEventListener('touchstart', () => show(r), { passive: true }); });
  }
  let rsT; window.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(() => tab === 'insights' && drawChart(), 150); });

  // ---------- customers ----------
  let members = []; let editingPhone = ''; let registered = [];
  async function loadMembers() {
    const [c, r] = await Promise.all([api('customers.get'), api('members.list')]);
    members = c.customers; registered = r.members; renderMembers(); renderRegistered();
  }
  function renderRegistered() {
    const q = $('#memberSearch').value.trim().toLowerCase();
    const list = registered.filter((m) => !q || [m.name, m.phone, prettyPhone(m.phone), m.email].join(' ').toLowerCase().includes(q));
    $('#memberCount').textContent = `(${registered.length})`;
    $('#regRows').innerHTML = list.map((m) => `<tr><td><b>${esc(m.name)}</b>${m.email ? `<div class="muted">${esc(m.email)}</div>` : ''}</td><td><a href="https://wa.me/${esc(m.phone.replace('+', ''))}" target="_blank" rel="noopener">${esc(prettyPhone(m.phone))}</a></td>
      <td>${m.orderCount}${m.lastOrderAt ? `<div class="muted">last ${new Date(m.lastOrderAt).toLocaleDateString('en-MY', tz)}</div>` : ''}</td><td><b>${m.points}</b></td><td>${m.discountPct ? `<b>${m.discountPct}%</b>` : '—'}</td>
      <td>${new Date(m.createdAt).toLocaleDateString('en-MY', tz)}${m.welcomeUsed ? '<div class="muted">offer used</div>' : ''}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-pts="${esc(m.id)}">± Points</button> <button class="btn sm" data-disc="${esc(m.phone)}" data-name="${esc(m.name)}">Discount</button> <button class="btn sm" data-reset="${esc(m.id)}">Reset password</button></td></tr>`).join('')
      || `<tr><td colspan="7" class="muted">${registered.length ? 'No members match.' : 'No members yet. Customers sign up from the shop.'}</td></tr>`;
  }
  $('#memberSearch').addEventListener('input', renderRegistered);
  $('#regRows').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pts) {
      const m = registered.find((x) => x.id === b.dataset.pts);
      const v = prompt(`${m.name} has ${m.points} points.\nPoints to add (use a minus to remove, e.g. -50):`, '50'); if (v == null) return;
      const reason = prompt('Reason (the customer sees this in their points history):', 'Thank you gift') ?? '';
      busy(b, async () => { const r = await api('members.points', { id: m.id, delta: Number(v), reason }); m.points = r.points; renderRegistered(); toast(`${m.name} now has ${r.points} points`); });
    }
    if (b.dataset.disc) { const ex = members.find((x) => x.phone === b.dataset.disc); fillMember(ex || { phone: b.dataset.disc, name: b.dataset.name }); $('#memberForm').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#memberForm [name="discountPct"]').focus(); }
    if (b.dataset.reset && confirm('Give this member a new password? Their old password will stop working.')) busy(b, async () => {
      const r = await api('members.resetPassword', { id: b.dataset.reset });
      const msg = `Hi ${r.name}, your new password for Ali's Fresh Meats online ordering is: ${r.password}  You can log in at order.alisfreshmeats.com/account.html and change it under "Change password".`;
      if (confirm(`New password for ${r.name}: ${r.password}\n\nClick OK to send it to them on WhatsApp.`)) window.open(`https://wa.me/${r.phone.replace('+', '')}?text=${encodeURIComponent(msg)}`, '_blank');
    });
  });
  function renderMembers() {
    $('#memberRows').innerHTML = members.map((m) => `<tr><td>${esc(prettyPhone(m.phone))}</td><td>${esc(m.name)}</td><td><b>${m.discountPct}%</b></td><td class="muted">${esc(m.note)}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-edit="${esc(m.phone)}">Edit</button> <button class="btn red sm" data-delm="${esc(m.phone)}">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No special discounts yet.</td></tr>';
  }
  function fillMember(m = {}) { const f = $('#memberForm'); editingPhone = m.phone || ''; f.elements.phone.value = prettyPhone(m.phone || ''); f.elements.name.value = m.name || ''; f.elements.discountPct.value = m.discountPct || ''; f.elements.note.value = m.note || ''; }
  $('#memberRows').addEventListener('click', (e) => {
    if (e.target.dataset.edit) fillMember(members.find((m) => m.phone === e.target.dataset.edit));
    if (e.target.dataset.delm && confirm('Remove this discount?')) busy(e.target, async () => { members = (await api('customers.delete', { phone: e.target.dataset.delm })).customers; renderMembers(); });
  });
  $('#resetMember').addEventListener('click', () => fillMember());
  $('#saveMember').addEventListener('click', (e) => busy(e.target, async () => {
    members = (await api('customers.save', { customer: Object.fromEntries(new FormData($('#memberForm')).entries()), originalPhone: editingPhone })).customers; renderMembers(); fillMember(); toast('Discount saved');
    registered = (await api('members.list')).members; renderRegistered();
  }));

  // ---------- promotions + coupons ----------
  async function loadPromos() {
    const [info, c] = await Promise.all([api('promo.info'), api('coupons.get')]);
    $('#subCount').textContent = info.subscribers;
    renderPromoHistory(info.history);
    coupons = c.coupons; renderCoupons();
  }
  function renderPromoHistory(h) { $('#promoHistory').innerHTML = h.length ? h.map((p) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><b style="color:var(--ink)">${esc(p.title)}</b> · ${fmtDT(p.at)} · ${p.sent} phone${p.sent === 1 ? '' : 's'}</div>`).join('') : 'Nothing sent yet.'; }
  for (const id of ['#pTitle', '#pBody']) $(id).addEventListener('input', () => { $('#pvT').textContent = $('#pTitle').value || 'Title'; $('#pvB').textContent = $('#pBody').value; });
  $('#pSend').addEventListener('click', (e) => {
    const title = $('#pTitle').value.trim(); if (title.length < 3) return toast('Add a title first.');
    if (!confirm(`Send “${title}” to ${$('#subCount').textContent} phone(s) now?`)) return;
    busy(e.target, async () => {
      const r = await api('promo.send', { title, body: $('#pBody').value.trim(), url: $('#pUrl').value });
      toast(`Sent to ${r.sent} phone(s)${r.failed ? `, ${r.failed} failed` : ''}`); $('#subCount').textContent = r.subscribers;
      renderPromoHistory((await api('promo.info')).history);
    });
  });
  let coupons = []; let editingCode = '';
  function couponDesc(c) { return c.type === 'percent' ? `${c.value}% off${c.maxDiscount ? ` (max RM${c.maxDiscount})` : ''}` : `RM${Number(c.value).toFixed(2)} off`; }
  function renderCoupons() {
    const today = dayKey(Date.now());
    $('#couponRows').innerHTML = coupons.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((c) => {
      const expired = c.endsOn && c.endsOn < today; const full = c.maxUses && c.used >= c.maxUses;
      const cond = [c.minSpend ? `min RM${c.minSpend}` : '', c.startsOn ? `from ${c.startsOn}` : '', c.endsOn ? `until ${c.endsOn}` : '', c.oncePerCustomer ? 'once per customer' : '', c.phones?.length ? `${c.phones.length} customer(s) only` : ''].filter(Boolean).join(' · ') || 'none';
      return `<tr><td><b>${esc(c.code)}</b>${c.note ? `<div class="muted">${esc(c.note)}</div>` : ''}</td><td>${esc(couponDesc(c))}</td><td class="muted">${esc(cond)}</td><td>${c.used || 0}${c.maxUses ? ` / ${c.maxUses}` : ''}</td>
        <td>${!c.active ? '<span class="tag t-pay">Off</span>' : expired ? '<span class="tag t-bad">Expired</span>' : full ? '<span class="tag t-bad">Used up</span>' : '<span class="tag t-done">Active</span>'}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-edit="${esc(c.code)}">Edit</button> <button class="btn red sm" data-delc="${esc(c.code)}">✕</button></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">No coupons yet.</td></tr>';
  }
  function fillCoupon(c = {}) {
    const f = $('#couponForm'); editingCode = c.code || '';
    $('#couponFormTitle').textContent = c.code ? `Edit coupon ${c.code}` : 'New coupon';
    for (const k of ['code', 'type', 'value', 'minSpend', 'maxDiscount', 'startsOn', 'endsOn', 'maxUses', 'note']) f.elements[k].value = c[k] ?? (k === 'type' ? 'percent' : '');
    f.elements.phones.value = (c.phones || []).map(prettyPhone).join(', ');
    f.elements.oncePerCustomer.checked = !!c.oncePerCustomer; f.elements.active.checked = c.active !== false;
  }
  $('#couponRows').addEventListener('click', (e) => {
    if (e.target.dataset.edit) { fillCoupon(coupons.find((c) => c.code === e.target.dataset.edit)); $('#couponForm').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    if (e.target.dataset.delc && confirm(`Delete coupon ${e.target.dataset.delc}?`)) busy(e.target, async () => { coupons = (await api('coupons.delete', { code: e.target.dataset.delc })).coupons; renderCoupons(); });
  });
  $('#resetCoupon').addEventListener('click', () => fillCoupon());
  $('#saveCoupon').addEventListener('click', (e) => busy(e.target, async () => {
    const f = $('#couponForm'); const c = Object.fromEntries(new FormData(f).entries());
    c.oncePerCustomer = f.elements.oncePerCustomer.checked; c.active = f.elements.active.checked;
    coupons = (await api('coupons.save', { coupon: c, originalCode: editingCode })).coupons; renderCoupons(); fillCoupon(); toast('Coupon saved');
  }));

  // ---------- activity log ----------
  const ATYPES = [['', 'All'], ['order', 'Orders'], ['payment', 'Payments'], ['delivery', 'Lalamove'], ['print', 'Printing'], ['stock', 'Stock'], ['staff', 'Staff'], ['member', 'Sign-ups'], ['push', 'Notifications'], ['error', 'Errors']];
  let actType = ''; let actNext = 0; let actItems = []; let actT;
  $('#actTypes').innerHTML = ATYPES.map(([k, l]) => `<button type="button" class="chip ${k === actType ? 'on' : ''}" data-atype="${k}">${l}</button>`).join('');
  $('#actTypes').addEventListener('click', (e) => { const b = e.target.closest('[data-atype]'); if (!b) return; actType = b.dataset.atype; $$('#actTypes .chip').forEach((c) => c.classList.toggle('on', c === b)); loadActivity(true); });
  $('#actSearch').addEventListener('input', () => { clearTimeout(actT); actT = setTimeout(() => loadActivity(true), 350); });
  $('#actMore').addEventListener('click', () => loadActivity(false));
  async function loadActivity(reset) {
    if (reset) { actNext = 0; actItems = []; }
    if (actNext == null) return;
    try {
      const r = await api('activity.list', { start: actNext, count: 100, type: actType, q: $('#actSearch').value.trim() });
      actItems = actItems.concat(r.items); actNext = r.next;
      $('#actList').innerHTML = actItems.map((a) => `<div class="act"><time>${dayKey(a.at) === dayKey(Date.now()) ? fmtTime(a.at) : fmtDT(a.at)}</time><span class="tag a-${esc(a.type)}">${esc(ATYPES.find((t) => t[0] === a.type)?.[1].replace(/s$/, '') || a.type)}</span><div class="msg">${a.orderNo ? `<a href="#no=${esc(a.orderNo)}">${esc(a.orderNo)}</a> ` : ''}${esc(a.msg)}</div></div>`).join('') || '<p class="muted" style="padding:12px">Nothing logged yet.</p>';
      $('#actMore').classList.toggle('hidden', actNext == null);
    } catch (e) { toast(e.message); }
  }

  // ---------- staff accounts (super admin) ----------
  let staffList = []; let editingStaff = '';
  async function loadStaff() { staffList = (await api('staff.list')).staff; renderStaff(); }
  function renderStaff() {
    $('#staffRows').innerHTML = `<tr><td><b>Owner passcode</b><div class="muted">ADMIN_PASSCODE in Hostinger</div></td><td><span class="tag t-dark">Super admin</span></td><td><span class="tag t-done">Active</span></td><td></td></tr>`
      + staffList.map((u) => `<tr><td><b>${esc(u.name)}</b>${u.id === me?.id ? ' <span class="muted">(you)</span>' : ''}</td><td>${u.role === 'super' ? '<span class="tag t-dark">Super admin</span>' : '<span class="tag t-pay">Staff</span>'}</td>
        <td>${u.active ? '<span class="tag t-done">Active</span>' : '<span class="tag t-bad">Off</span>'}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-sedit="${esc(u.id)}">Edit</button> <button class="btn red sm" data-sdel="${esc(u.id)}">✕</button></td></tr>`).join('');
  }
  function fillStaff(u = {}) {
    const f = $('#staffForm'); editingStaff = u.id || '';
    $('#staffFormTitle').textContent = u.id ? `Edit ${u.name}` : 'Add a staff member';
    f.elements.name.value = u.name || ''; f.elements.password.value = ''; f.elements.role.value = u.role || 'staff'; f.elements.active.checked = u.active !== false;
    $('#pwHint').textContent = u.id ? 'Leave empty to keep their password' : 'They log in with their name and this password';
  }
  $('#staffRows').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.sedit) { fillStaff(staffList.find((u) => u.id === b.dataset.sedit)); $('#staffForm').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    if (b.dataset.sdel) { const u = staffList.find((x) => x.id === b.dataset.sdel); if (confirm(`Delete ${u.name}'s login?`)) busy(b, async () => { staffList = (await api('staff.delete', { id: u.id })).staff; renderStaff(); toast('Deleted'); }); }
  });
  $('#resetStaff').addEventListener('click', () => fillStaff());
  $('#saveStaff').addEventListener('click', (e) => busy(e.target, async () => {
    const f = $('#staffForm');
    staffList = (await api('staff.save', { user: { id: editingStaff || undefined, name: f.elements.name.value, password: f.elements.password.value, role: f.elements.role.value, active: f.elements.active.checked } })).staff;
    renderStaff(); fillStaff(); toast('Saved');
  }));

  // ---------- settings ----------
  let settings = null; let printers = [];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
  const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] ||= {}), o)[last] = v; };
  async function loadSettings() { const d = await api('settings.get'); settings = d.settings; renderStatus(d.status); renderSettings(); $('#welcomeUsed').textContent = d.welcomeUsed; }
  $('#previewLabel').addEventListener('click', () => window.open(`/api/label?sample=1&preview=1&auth=${encodeURIComponent(token)}`, '_blank'));
  function renderStatus(st) {
    const item = (label, v, hint) => `<div><b>${label}</b><br>${v ? `<span class="ok">✓ ${v === true ? 'Connected' : esc(v)}</span>` : `<span class="bad">Not set</span> <span class="muted">${hint}</span>`}</div>`;
    $('#status').innerHTML = item('Database', st.database, 'Add the Upstash Redis keys') + item('Billplz', st.billplz, 'BILLPLZ_* keys') + item('Lalamove', st.lalamove, 'LALAMOVE_* keys') +
      item('PrintNode', st.printnode, 'PRINTNODE_API_KEY') + item('Google Maps', st.maps, 'Optional. The free OpenStreetMap map is used without it') + item('Lalamove webhook secret', st.lalamoveWebhookSecret, 'LALAMOVE_WEBHOOK_SECRET');
  }
  function renderSettings() {
    const f = $('#settingsForm');
    for (const el of f.querySelectorAll('[name]')) { const v = getPath(settings, el.name); if (el.type === 'checkbox') el.checked = !!v; else el.value = Array.isArray(v) ? v.join(', ') : v ?? ''; }
    $('#closedDays').innerHTML = DAYS.map((d, i) => `<button type="button" class="chip ${settings.hours.closedDays.includes(i) ? 'on' : ''}" data-day="${i}">${d}</button>`).join('');
    renderBranches();
  }
  $('#closedDays').addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]'); if (!b) return; const d = Number(b.dataset.day); const cd = settings.hours.closedDays;
    settings.hours.closedDays = cd.includes(d) ? cd.filter((x) => x !== d) : [...cd, d]; b.classList.toggle('on');
  });
  function renderBranches() {
    $('#branches').innerHTML = settings.branches.map((b, i) => {
      const opts = [...printers]; if (b.printerId && !opts.some((p) => String(p.id) === String(b.printerId))) opts.unshift({ id: b.printerId, name: `Printer ${b.printerId}`, computer: '' });
      return `<div class="branch" data-b="${i}"><div class="grid">
        <label class="f">Branch name<input class="inp" data-k="name" value="${esc(b.name)}"></label>
        <label class="f">Contact phone for driver<input class="inp" data-k="phone" value="${esc(prettyPhone(b.phone))}"></label>
        <label class="f" style="grid-column:1/-1">Shop address<input class="inp" data-k="address" value="${esc(b.address)}" placeholder="Full shop address"><small>Shown to self-pickup customers and given to Lalamove</small></label>
        <label class="f">Coordinates (lat, lng)<input class="inp" data-k="coords" value="${b.lat && b.lng ? esc(`${b.lat}, ${b.lng}`) : ''}" placeholder="3.2389, 101.6500"></label>
        <label class="f">Delivery radius (km)<input class="inp" type="number" min="1" max="300" data-k="radiusKm" value="${esc(b.radiusKm ?? '')}"></label>
        <label class="f">Label printer<select class="inp" data-k="printerId"><option value="">— none —</option>${opts.map((p) => `<option value="${esc(p.id)}" ${String(p.id) === String(b.printerId) ? 'selected' : ''}>${esc(p.name)}${p.computer ? ` (${esc(p.computer)})` : ''}</option>`).join('')}</select><small>${printers.length ? '' : 'Click “Load printers from PrintNode”'}</small></label>
      </div><div class="row" style="margin-top:10px"><label class="ck grow"><input type="checkbox" data-k="active" ${b.active ? 'checked' : ''}> Takes online orders</label>
        <button class="btn sm" type="button" data-test="${esc(b.id)}">Print test label</button><button class="btn red sm" type="button" data-delb>Remove</button></div></div>`;
    }).join('');
  }
  $('#branches').addEventListener('input', (e) => {
    const box = e.target.closest('[data-b]'); if (!box) return; const b = settings.branches[box.dataset.b]; const k = e.target.dataset.k;
    if (k === 'coords') { const [lat, lng] = e.target.value.split(',').map((s) => s.trim()); b.lat = lat || ''; b.lng = lng || ''; }
    else b[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  });
  $('#branches').addEventListener('change', (e) => { if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') e.target.dispatchEvent(new Event('input', { bubbles: true })); });
  $('#branches').addEventListener('click', (e) => {
    const box = e.target.closest('[data-b]'); if (!box) return;
    if (e.target.hasAttribute('data-delb') && confirm('Remove this branch?')) { settings.branches.splice(box.dataset.b, 1); renderBranches(); }
    if (e.target.dataset.test) busy(e.target, async () => { const r = await api('print.test', { branchId: e.target.dataset.test }); toast(`Test label sent (job ${r.jobId})`); });
  });
  $('#addBranch').addEventListener('click', () => { settings.branches.push({ name: '', address: '', lat: '', lng: '', phone: '', printerId: '', radiusKm: 30, active: true }); renderBranches(); });
  $('#loadPrinters').addEventListener('click', (e) => busy(e.target, async () => { printers = (await api('printers.list')).printers; renderBranches(); toast(`${printers.length} printer(s) found`); }));
  $('#settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const f = $('#settingsForm');
      for (const el of f.querySelectorAll('[name]')) setPath(settings, el.name, el.type === 'checkbox' ? el.checked : el.value);
      const d = await api('settings.save', { settings }); settings = d.settings; renderStatus(d.status); renderSettings(); $('#welcomeUsed').textContent = d.welcomeUsed;
      $('#settingsOut').textContent = 'Saved ' + fmtTime(Date.now()); toast('Settings saved');
    });
  });
  $('#llmSetup').addEventListener('click', (e) => busy(e.target, async () => {
    const r = await api('lalamove.setup');
    $('#llmSetupOut').innerHTML = r.webhook === 'ok' ? '<span class="ok">✓ Lalamove will now send delivery updates</span>' : `<span class="bad">${esc(r.webhook)}</span>`;
    $('#llmServices').innerHTML = r.services.length ? 'Vehicles for Kuala Lumpur: ' + r.services.map((s) => `<b>${esc(s.key)}</b>${s.specialRequests?.length ? ` <span title="${esc(s.specialRequests.map((x) => `${x.name}: ${x.description}`).join('\n'))}">(${s.specialRequests.length} special requests, hover)</span>` : ''}`).join(', ') : '';
  }));

  // ---------- staff phone alerts (web push) ----------
  let swReg = null;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then((r) => { swReg = r; paintPush(); }).catch(() => {});
  const b64ToBytes = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); };
  const pushOn = () => ls.get('afm_staffpush') === '1' && 'Notification' in window && Notification.permission === 'granted';
  function paintPush() { $('#pushBtn').textContent = pushOn() ? '📱 New-order alerts on this phone: ON' : '📱 Turn on new-order alerts on this phone'; }
  $('#pushBtn').addEventListener('click', (e) => busy(e.target, async () => {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window.matchMedia('(display-mode: standalone)').matches || navigator.standalone);
    if (ios) throw new Error('On iPhone: tap Share → Add to Home Screen, open “Ali\'s Staff” from the Home Screen, then turn alerts on there.');
    if (!swReg || !('PushManager' in window)) throw new Error('This browser does not support phone alerts. Use Chrome on Android or Safari (installed app) on iPhone.');
    let sub = await swReg.pushManager.getSubscription();
    if (pushOn()) { if (sub) await api('staffPush.save', { subscription: sub.toJSON(), on: false }); ls.set('afm_staffpush', null); toast('Alerts turned off on this phone'); return; }
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked. Allow them in the browser settings for this site.');
    if (!sub) { const k = await (await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'key' }) })).json(); sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(k.key) }); }
    await api('staffPush.save', { subscription: sub.toJSON() });
    ls.set('afm_staffpush', '1'); toast('Alerts on. You should get a test notification now.');
  }).then(paintPush));

  // ---------- start ----------
  async function start() {
    try { me = (await api('me')).me; ls.set('afm_admin_me', JSON.stringify(me)); } catch { return; }
    $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden');
    buildNav(); paintSound(); paintPush(); showTab('home');
    await loadHome();
    clearInterval(pollTimer); pollTimer = setInterval(loadHome, 15000);
    openFromHash();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && token && home) loadHome(); });
  // #order=<id> or #no=AFM-1006 (label QR code, activity log links)
  async function openFromHash() {
    const m = location.hash.match(/^#order=(.+)$/); if (m) return openOrder(decodeURIComponent(m[1]));
    const n = location.hash.match(/^#no=([\w-]+)$/);
    if (n) {
      const no = n[1].toUpperCase();
      const hit = home?.orders.find((o) => o.no === no);
      try { openOrder(hit ? hit.id : (await api('order.byNo', { no })).id); } catch (e) { toast(e.message); }
    }
  }
  window.addEventListener('hashchange', openFromHash);
  if (token) start(); else showLogin();
})();
