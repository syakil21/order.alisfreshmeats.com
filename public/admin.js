(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rm = (sen) => 'RM ' + (Number(sen || 0) / 100).toFixed(2);
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
  const tz = { timeZone: 'Asia/Kuala_Lumpur' };
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-MY', { ...tz, hour: 'numeric', minute: '2-digit' });
  const fmtDT = (ts) => new Date(ts).toLocaleString('en-MY', { ...tz, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const dayKey = (ts) => new Date(ts).toLocaleDateString('en-CA', tz);
  const qtyText = (q, u) => (u === 'kg' ? `${q} kg` : u === 'set' ? `${q} ${q > 1 ? 'sets' : 'set'}` : `${q} ${q > 1 ? 'pcs' : 'pc'}`);
  const prettyPhone = (p) => String(p || '').replace(/^\+60/, '0');
  let token = ls.get('afm_admin');

  function toast(m) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 4000); }
  async function api(action, data = {}) {
    const r = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ action, ...data }) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && action !== 'login') { showLogin(); throw new Error(d.error || 'Please log in'); }
    if (!r.ok) throw new Error(d.error || 'Something went wrong');
    return d;
  }
  async function busy(btn, fn) {
    const t = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = '…'; }
    try { return await fn(); } catch (e) { toast(e.message); } finally { if (btn) { btn.disabled = false; btn.textContent = t; } }
  }

  // ---------- login ----------
  function showLogin() { $('#appView').classList.add('hidden'); $('#loginView').classList.remove('hidden'); clearInterval(pollTimer); }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#loginErr').textContent = '';
    try { const d = await api('login', { passcode: $('#pass').value }); token = d.token; ls.set('afm_admin', token); start(); }
    catch (err) { $('#loginErr').textContent = err.message; }
  });

  // ---------- tabs ----------
  const loaded = {};
  function showTab(tab) {
    $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $$('[data-view]').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== tab));
    if (!loaded[tab]) { loaded[tab] = true; ({ products: loadProducts, coupons: loadCoupons, members: loadMembers, settings: loadSettings })[tab]?.(); }
  }
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

  // ---------- orders ----------
  let orders = []; let filter = 'active'; let pollTimer; const seenPaid = new Set(); let firstLoad = true; let sound = ls.get('afm_sound') === '1'; let actx;
  const tagFor = (o) => {
    const cls = { awaiting_payment: 't-pay', payment_failed: 't-bad', preparing: 't-prep', finding_driver: 't-prep', driver_assigned: 't-drv', on_the_way: 't-drv', delivered: 't-done' }[o.stage] || 't-pay';
    return `<span class="tag ${cls}">${esc(o.paid ? o.stageText.replace(' · finding a driver', ', finding driver') : o.paymentStatus === 'failed' ? 'Payment failed' : 'Unpaid')}</span>`;
  };
  function chime() {
    if (!sound) return;
    try {
      actx ||= new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18, 0.36].forEach((t, i) => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = [880, 1175, 1568][i]; g.gain.setValueAtTime(0.0001, actx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.3, actx.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + t + 0.3); o.connect(g).connect(actx.destination); o.start(actx.currentTime + t); o.stop(actx.currentTime + t + 0.32); });
    } catch {}
  }
  function updateSoundBtn() { $('#soundBtn').textContent = sound ? '🔔 Alert sound on' : '🔕 Turn on order alert sound'; }
  $('#soundBtn').addEventListener('click', () => { sound = !sound; ls.set('afm_sound', sound ? '1' : null); updateSoundBtn(); if (sound) chime(); });

  async function loadOrders() {
    try {
      const d = await api('orders.list');
      const fresh = [];
      for (const o of d.orders) if (o.paid && !seenPaid.has(o.id)) { if (!firstLoad) fresh.push(o); seenPaid.add(o.id); }
      orders = d.orders; firstLoad = false;
      renderOrders(new Set(fresh.map((o) => o.id)));
      if (fresh.length) { chime(); toast(`New paid order: ${fresh.map((o) => o.no).join(', ')}`); document.title = `(${fresh.length}) New order · Ali's`; setTimeout(() => (document.title = "Orders · Ali's Fresh Meats"), 15000); }
    } catch (e) { console.warn(e); }
  }
  function renderOrders(newIds = new Set()) {
    const q = $('#search').value.trim().toLowerCase();
    const today = dayKey(Date.now());
    const list = orders.filter((o) => {
      if (q) return [o.no, o.name, o.phone, prettyPhone(o.phone)].join(' ').toLowerCase().includes(q);
      if (filter === 'active') return (o.paid && o.stage !== 'delivered') || (o.paid && o.problem);
      if (filter === 'today') return dayKey(o.createdAt) === today;
      if (filter === 'problem') return o.paid && o.problem;
      if (filter === 'unpaid') return !o.paid;
      return true;
    });
    const probCount = orders.filter((o) => o.paid && o.problem).length;
    $('[data-f="problem"]').textContent = `Needs attention${probCount ? ` (${probCount})` : ''}`;
    $('#orderRows').innerHTML = list.map((o) => `
      <tr class="click ${newIds.has(o.id) ? 'new' : ''}" data-id="${esc(o.id)}">
        <td><b>${esc(o.no)}</b><div class="muted">${o.itemCount} item${o.itemCount > 1 ? 's' : ''}${o.pickupAt && o.paid ? ` · pickup ${fmtTime(Date.parse(o.pickupAt))}` : ''}</div></td>
        <td class="hide-sm">${fmtDT(o.createdAt)}</td>
        <td>${esc(o.name)}<div class="muted">${esc(prettyPhone(o.phone))}</div></td>
        <td class="hide-sm">${esc(o.branchName)}</td>
        <td>${tagFor(o)}${o.paid && o.problem ? `<div class="warn">⚠ ${esc(o.problem)}</div>` : ''}</td>
        <td class="num">${rm(o.totalSen)}</td>
      </tr>`).join('');
    $('#ordersEmpty').textContent = list.length ? '' : q ? 'No orders match.' : filter === 'active' ? 'No active orders right now. New paid orders appear here automatically.' : 'No orders.';
  }
  $('#filters').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f; $$('#filters .chip').forEach((c) => c.classList.toggle('on', c === b)); renderOrders(); });
  $('#search').addEventListener('input', () => renderOrders());
  $('#orderRows').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) openOrder(tr.dataset.id); });

  // ---------- order drawer ----------
  let openId = null;
  function closeDrawer() { $('#drawer').classList.remove('show'); openId = null; if (location.hash.startsWith('#order=')) history.replaceState(null, '', location.pathname); }
  $('#drawer').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDrawer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  async function openOrder(id) {
    openId = id; $('#drawer').classList.add('show'); $('#drawerBody').innerHTML = '<p class="muted">Loading…</p>';
    try { renderOrder((await api('order.get', { id })).order); } catch (e) { $('#drawerBody').innerHTML = `<p class="warn">${esc(e.message)}</p>`; }
  }
  function renderOrder(o) {
    const s = o.summary; const d = o.delivery || {}; const p = o.print || {};
    const llmFailed = ['BOOKING_FAILED', 'CANCELED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(d.status);
    const canRebook = o.payment.status === 'paid' && (!d.lalamoveOrderId || llmFailed);
    const canCancel = d.lalamoveOrderId && ['ASSIGNING_DRIVER', 'ON_GOING'].includes(d.status);
    const wa = o.customer.phone.replace('+', '');
    $('#drawerBody').innerHTML = `
      <div class="row"><h2 class="grow" style="margin:0">${esc(o.no)}</h2><button class="btn sm" data-close>Close</button></div>
      <div style="margin:6px 0 12px">${tagFor(s)} ${s.problem && o.payment.status === 'paid' ? `<span class="warn">⚠ ${esc(s.problem)}</span>` : ''}</div>
      <div class="card"><div class="row">
        ${o.payment.status === 'paid' ? `<button class="btn pri sm" data-act="order.reprint">🖨 Reprint label</button><button class="btn sm" data-act="labelpdf">Label PDF</button>` : ''}
        ${o.payment.status !== 'paid' && o.payment.billId ? `<button class="btn sm" data-act="order.checkPayment">Check payment with Billplz</button>` : ''}
        ${d.lalamoveOrderId ? `<button class="btn sm" data-act="order.refresh">Refresh delivery</button>` : ''}
        ${canRebook ? `<button class="btn sm" data-act="order.rebook">${d.lalamoveOrderId || d.status ? 'Rebook Lalamove' : 'Book Lalamove'}</button>` : ''}
        ${canCancel ? `<button class="btn red sm" data-act="order.cancelDelivery" data-confirm="Cancel this Lalamove delivery?">Cancel Lalamove</button>` : ''}
      </div></div>
      <div class="card"><dl class="kv">
        <dt>Customer</dt><dd><b>${esc(o.customer.name)}</b><br><a href="tel:${esc(o.customer.phone)}">${esc(prettyPhone(o.customer.phone))}</a> · <a href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>${o.customer.email ? `<br>${esc(o.customer.email)}` : ''}</dd>
        <dt>Deliver to</dt><dd>${esc(o.address.text)}${o.address.unit ? `<br><b>Unit:</b> ${esc(o.address.unit)}` : ''}${o.address.notes ? `<br><b>Note:</b> ${esc(o.address.notes)}` : ''}<br><a href="https://www.google.com/maps?q=${o.address.lat},${o.address.lng}" target="_blank" rel="noopener">Open in Google Maps</a>${o.distanceKm ? ` · ${o.distanceKm} km` : ''}</dd>
        <dt>Branch</dt><dd>${esc(o.branchName)}</dd>
        <dt>Placed</dt><dd>${fmtDT(o.createdAt)}</dd>
      </dl></div>
      <div class="card"><table class="list">
        ${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td><b>${qtyText(i.qty, i.unit)}</b></td><td class="num">${rm(i.lineSen)}</td></tr>`).join('')}
        <tr><td colspan="2">Subtotal</td><td class="num">${rm(o.subtotalSen)}</td></tr>
        ${(o.discounts || []).map((x) => `<tr><td colspan="2">${esc(x.label)}</td><td class="num">− ${rm(x.sen)}</td></tr>`).join('')}
        <tr><td colspan="2">Delivery charged</td><td class="num">${rm(o.deliverySen)}</td></tr>
        <tr><td colspan="2"><b>Total</b></td><td class="num"><b>${rm(o.totalSen)}</b></td></tr>
      </table></div>
      <div class="card"><dl class="kv">
        <dt>Payment</dt><dd>${o.payment.status === 'paid' ? `<span class="ok">Paid</span> ${o.payment.paidAt ? fmtDT(o.payment.paidAt) : ''}` : `<span class="bad">${esc(o.payment.status)}</span>`}${o.payment.billId ? `<br><span class="muted">Billplz bill ${esc(o.payment.billId)}</span>` : ''}</dd>
        <dt>Lalamove</dt><dd>${d.lalamoveOrderId ? `#${esc(d.lalamoveOrderId)} · <b>${esc(d.status)}</b>` : d.status ? `<b>${esc(d.status)}</b>` : '<span class="muted">Not booked</span>'}
          ${d.error ? `<div class="warn">${esc(d.error)}</div>` : ''}
          ${d.feeRM != null ? `<br>Fee RM${Number(d.feeRM).toFixed(2)} <span class="muted">(quoted RM${Number(o.deliveryQuoteRM || 0).toFixed(2)} at checkout)</span>` : ''}
          ${d.scheduleAt ? `<br>Pickup ${fmtDT(Date.parse(d.scheduleAt))}` : ''}
          ${d.driver?.name ? `<br>Driver ${esc(d.driver.name)} ${d.driver.plate ? '· ' + esc(d.driver.plate) : ''} ${d.driver.phone ? `· <a href="tel:${esc(d.driver.phone)}">${esc(d.driver.phone)}</a>` : ''}` : ''}
          ${d.shareLink ? `<br><a href="${esc(d.shareLink)}" target="_blank" rel="noopener">Track on Lalamove</a>` : ''}
          ${d.pod?.image ? `<br><a href="${esc(d.pod.image)}" target="_blank" rel="noopener">Proof of delivery photo</a>` : ''}</dd>
        <dt>Label</dt><dd>${p.status === 'sent' ? `<span class="ok">Printed</span> ${fmtDT(p.at)}${p.count > 1 ? ` (${p.count}×)` : ''}` : p.status ? `<span class="bad">${esc(p.status.replace('_', ' '))}</span><div class="warn">${esc(p.error || '')}</div>` : '<span class="muted">—</span>'}</dd>
      </dl></div>
      <h3>History</h3><ol class="log">${(o.log || []).slice().reverse().map((l) => `<li><span class="muted">${fmtDT(l.at)}</span> ${esc(l.msg)}</li>`).join('')}</ol>`;
    $('#drawerBody').querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'labelpdf') return window.open(`/api/label?id=${encodeURIComponent(o.id)}&auth=${encodeURIComponent(token)}`, '_blank');
      if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
      busy(b, async () => {
        const r = await api(act, { id: o.id });
        if (openId === o.id) renderOrder(r.order);
        toast({ 'order.reprint': 'Label sent to printer', 'order.rebook': 'Lalamove booked', 'order.cancelDelivery': 'Lalamove cancelled', 'order.refresh': 'Delivery updated', 'order.checkPayment': r.billState === 'paid' ? 'Payment confirmed' : `Billplz says: ${r.billState}` }[act] || 'Done');
        loadOrders();
      });
    }));
  }

  // ---------- products ----------
  let products = [];
  async function loadProducts() { products = (await api('products.get')).products; renderProducts(); }
  function renderProducts() {
    $('#productRows').innerHTML = products.map((p, i) => `
      <tr data-i="${i}">
        <td><input class="inp" data-k="category" value="${esc(p.category)}" list="cats"></td>
        <td><input class="inp" data-k="name" value="${esc(p.name)}"></td>
        <td class="hide-sm"><input class="inp" data-k="note" value="${esc(p.note)}"></td>
        <td style="width:100px"><input class="inp" data-k="price" type="number" step="0.01" min="0" value="${esc(p.price)}"></td>
        <td style="width:84px"><select class="inp" data-k="unit">${['kg', 'set', 'pc'].map((u) => `<option ${p.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></td>
        <td style="text-align:center"><input type="checkbox" data-k="available" ${p.available ? 'checked' : ''}></td>
        <td style="white-space:nowrap"><button class="btn sm" data-mv="-1" title="Move up">↑</button> <button class="btn sm" data-mv="1" title="Move down">↓</button> <button class="btn red sm" data-del title="Delete">✕</button></td>
      </tr>`).join('') + `<datalist id="cats">${[...new Set(products.map((p) => p.category))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`;
  }
  $('#productRows').addEventListener('input', (e) => {
    const tr = e.target.closest('tr[data-i]'); if (!tr) return;
    const p = products[tr.dataset.i]; const k = e.target.dataset.k;
    p[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'unit') { p.step = p.unit === 'kg' ? 0.5 : 1; p.min = p.step; }
  });
  $('#productRows').addEventListener('change', (e) => { if (e.target.type === 'checkbox') e.target.dispatchEvent(new Event('input', { bubbles: true })); });
  $('#productRows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-i]'); if (!tr) return; const i = Number(tr.dataset.i);
    if (e.target.dataset.mv) { const j = i + Number(e.target.dataset.mv); if (j < 0 || j >= products.length) return; [products[i], products[j]] = [products[j], products[i]]; renderProducts(); }
    if (e.target.hasAttribute('data-del') && confirm(`Delete ${products[i].name}?`)) { products.splice(i, 1); renderProducts(); }
  });
  $('#addProduct').addEventListener('click', () => { products.push({ category: products.at(-1)?.category || 'Other', name: '', note: '', price: 0, unit: 'kg', step: 0.5, min: 0.5, available: true }); renderProducts(); $$('#productRows tr').at(-1).querySelector('[data-k="name"]').focus(); });
  $('#saveProducts').addEventListener('click', (e) => busy(e.target, async () => { products = (await api('products.save', { products })).products; renderProducts(); toast('Prices saved. The shop is updated.'); }));

  // ---------- coupons ----------
  let coupons = []; let editingCode = '';
  async function loadCoupons() { coupons = (await api('coupons.get')).coupons; renderCoupons(); }
  function couponDesc(c) { return c.type === 'percent' ? `${c.value}% off${c.maxDiscount ? ` (max RM${c.maxDiscount})` : ''}` : `RM${Number(c.value).toFixed(2)} off`; }
  function renderCoupons() {
    const today = dayKey(Date.now());
    $('#couponRows').innerHTML = coupons.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((c) => {
      const expired = c.endsOn && c.endsOn < today; const full = c.maxUses && c.used >= c.maxUses;
      const cond = [c.minSpend ? `min RM${c.minSpend}` : '', c.startsOn ? `from ${c.startsOn}` : '', c.endsOn ? `until ${c.endsOn}` : '', c.oncePerCustomer ? 'once per customer' : '', c.phones?.length ? `${c.phones.length} customer(s) only` : ''].filter(Boolean).join(' · ') || 'none';
      return `<tr><td><b>${esc(c.code)}</b>${c.note ? `<div class="muted">${esc(c.note)}</div>` : ''}</td><td>${esc(couponDesc(c))}</td><td class="hide-sm muted">${esc(cond)}</td><td>${c.used || 0}${c.maxUses ? ` / ${c.maxUses}` : ''}</td>
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
    if (e.target.dataset.edit) { fillCoupon(coupons.find((c) => c.code === e.target.dataset.edit)); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    if (e.target.dataset.delc && confirm(`Delete coupon ${e.target.dataset.delc}?`)) busy(e.target, async () => { coupons = (await api('coupons.delete', { code: e.target.dataset.delc })).coupons; renderCoupons(); });
  });
  $('#resetCoupon').addEventListener('click', () => fillCoupon());
  $('#saveCoupon').addEventListener('click', (e) => busy(e.target, async () => {
    const f = $('#couponForm'); const c = Object.fromEntries(new FormData(f).entries());
    c.oncePerCustomer = f.elements.oncePerCustomer.checked; c.active = f.elements.active.checked;
    coupons = (await api('coupons.save', { coupon: c, originalCode: editingCode })).coupons; renderCoupons(); fillCoupon(); toast('Coupon saved');
  }));

  // ---------- members ----------
  let members = []; let editingPhone = '';
  async function loadMembers() { members = (await api('customers.get')).customers; renderMembers(); }
  function renderMembers() {
    $('#memberRows').innerHTML = members.map((m) => `<tr><td>${esc(prettyPhone(m.phone))}</td><td>${esc(m.name)}</td><td><b>${m.discountPct}%</b></td><td class="hide-sm muted">${esc(m.note)}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-edit="${esc(m.phone)}">Edit</button> <button class="btn red sm" data-delm="${esc(m.phone)}">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No member discounts yet.</td></tr>';
  }
  function fillMember(m = {}) { const f = $('#memberForm'); editingPhone = m.phone || ''; f.elements.phone.value = prettyPhone(m.phone || ''); f.elements.name.value = m.name || ''; f.elements.discountPct.value = m.discountPct || ''; f.elements.note.value = m.note || ''; }
  $('#memberRows').addEventListener('click', (e) => {
    if (e.target.dataset.edit) fillMember(members.find((m) => m.phone === e.target.dataset.edit));
    if (e.target.dataset.delm && confirm('Remove this member discount?')) busy(e.target, async () => { members = (await api('customers.delete', { phone: e.target.dataset.delm })).customers; renderMembers(); });
  });
  $('#resetMember').addEventListener('click', () => fillMember());
  $('#saveMember').addEventListener('click', (e) => busy(e.target, async () => {
    members = (await api('customers.save', { customer: Object.fromEntries(new FormData($('#memberForm')).entries()), originalPhone: editingPhone })).customers; renderMembers(); fillMember(); toast('Member saved');
  }));

  // ---------- settings ----------
  let settings = null; let printers = [];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
  const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] ||= {}), o)[last] = v; };
  async function loadSettings() { const d = await api('settings.get'); settings = d.settings; renderStatus(d.status); renderSettings(); }
  function renderStatus(st) {
    const item = (label, v, hint) => `<div><b>${label}</b><br>${v ? `<span class="ok">✓ ${v === true ? 'Connected' : esc(v)}</span>` : `<span class="bad">Not set</span> <span class="muted">${hint}</span>`}</div>`;
    $('#status').innerHTML = item('Database', st.database, 'Add the Upstash Redis keys') + item('Billplz', st.billplz, 'BILLPLZ_* keys') + item('Lalamove', st.lalamove, 'LALAMOVE_* keys') +
      item('PrintNode', st.printnode, 'PRINTNODE_API_KEY') + item('Google Maps', st.maps, 'GOOGLE_MAPS_API_KEY') + item('Lalamove webhook secret', st.lalamoveWebhookSecret, 'LALAMOVE_WEBHOOK_SECRET');
  }
  function renderSettings() {
    const f = $('#settingsForm');
    for (const el of f.querySelectorAll('[name]')) { const v = getPath(settings, el.name); if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? ''; }
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
        <label class="f" style="grid-column:1/-1">Pickup address<input class="inp" data-k="address" value="${esc(b.address)}" placeholder="Full shop address"></label>
        <label class="f">Coordinates (lat, lng)<input class="inp" data-k="coords" value="${b.lat && b.lng ? esc(`${b.lat}, ${b.lng}`) : ''}" placeholder="3.2389, 101.6500"></label>
        <label class="f">Label printer<select class="inp" data-k="printerId"><option value="">— none —</option>${opts.map((p) => `<option value="${esc(p.id)}" ${String(p.id) === String(b.printerId) ? 'selected' : ''}>${esc(p.name)}${p.computer ? ` (${esc(p.computer)})` : ''}</option>`).join('')}</select><small>${printers.length ? '' : 'Click “Load printers from PrintNode”'}</small></label>
      </div><div class="row" style="margin-top:10px"><label class="f grow"><input type="checkbox" data-k="active" ${b.active ? 'checked' : ''}> Takes online orders</label>
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
  $('#addBranch').addEventListener('click', () => { settings.branches.push({ name: '', address: '', lat: '', lng: '', phone: '', printerId: '', active: true }); renderBranches(); });
  $('#loadPrinters').addEventListener('click', (e) => busy(e.target, async () => { printers = (await api('printers.list')).printers; renderBranches(); toast(`${printers.length} printer(s) found`); }));
  $('#settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = e.submitter;
    busy(btn, async () => {
      const f = $('#settingsForm');
      for (const el of f.querySelectorAll('[name]')) setPath(settings, el.name, el.type === 'checkbox' ? el.checked : el.value);
      const d = await api('settings.save', { settings }); settings = d.settings; renderStatus(d.status); renderSettings();
      $('#settingsOut').textContent = 'Saved ' + fmtTime(Date.now()); toast('Settings saved');
    });
  });
  $('#llmSetup').addEventListener('click', (e) => busy(e.target, async () => {
    const r = await api('lalamove.setup');
    $('#llmSetupOut').innerHTML = r.webhook === 'ok' ? '<span class="ok">✓ Lalamove will now send delivery updates</span>' : `<span class="bad">${esc(r.webhook)}</span>`;
    $('#llmServices').innerHTML = r.services.length ? 'Vehicles for Kuala Lumpur: ' + r.services.map((s) => `<b>${esc(s.key)}</b>${s.specialRequests?.length ? ` <span title="${esc(s.specialRequests.map((x) => `${x.name}: ${x.description}`).join('\n'))}">(${s.specialRequests.length} special requests — hover)</span>` : ''}`).join(', ') : '';
  }));

  // ---------- start ----------
  async function start() {
    $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden');
    updateSoundBtn();
    await loadOrders();
    clearInterval(pollTimer); pollTimer = setInterval(loadOrders, 15000);
    const m = location.hash.match(/^#order=(.+)$/); if (m) openOrder(decodeURIComponent(m[1]));
  }
  window.addEventListener('hashchange', () => { const m = location.hash.match(/^#order=(.+)$/); if (m) openOrder(decodeURIComponent(m[1])); });
  if (token) start(); else showLogin();
})();
