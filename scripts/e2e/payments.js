// Payments: pressing Pay twice, changed carts, missed or forged Billplz notices. Run with: node scripts/e2e/run.js
const B = process.env.BASE || 'http://localhost:3000';
const J = async (path, body, tok) => { const r = await fetch(B + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) }); return { status: r.status, d: await r.json() }; };
const errors = []; const ok = (c, m) => { if (!c) errors.push(m); console.log(c ? '✓' : '✗', m); };
(async () => {
  const items = [{ productId: 'boneless-meat', qty: 1 }];
  const q = (await J('/api/quote', { items, fulfilment: 'pickup' })).d;
  const order = async () => (await J('/api/checkout', { items, fulfilment: 'pickup', pickupBranchId: q.branch.id, pickupAt: q.pickupSlots[0].at, customer: { name: 'Pay Tester', phone: '0124445555' }, address: {} })).d;
  const A = await order(); const A2 = await order();
  ok(A2.orderId === A.orderId && A2.paymentUrl === A.paymentUrl, 'pressing Pay again with the same cart reuses the same order and bill');
  const order2 = async () => (await J('/api/checkout', { items: [{ productId: 'boneless-meat', qty: 1.5 }], fulfilment: 'pickup', pickupBranchId: q.branch.id, pickupAt: q.pickupSlots[0].at, customer: { name: 'Pay Tester', phone: '0124445555' }, address: {} })).d;
  const Bo = await order2(); // changed the cart → new order; the first try is marked replaced
  const login0 = await J('/api/admin', { action: 'login', name: 'Syakil', password: '1234' });
  const oa = (await J('/api/admin', { action: 'order.get', id: A.orderId }, login0.d.token)).d.order;
  ok(Bo.orderId !== A.orderId && oa.payment.status === 'replaced' && oa.summary.stageText === `Not paid, replaced by ${(await J('/api/admin', { action: 'order.get', id: Bo.orderId }, login0.d.token)).d.order.no}`, 'changed cart: new order, earlier try marked "Not paid, replaced by …"');
  const oldPage = await (await fetch(`${B}/api/order?id=${A.orderId}&t=${A.token}`)).json();
  ok(oldPage.replacedBy && /order\.html/.test(oldPage.replacedBy.link), 'old order link points the customer to the new order');
  const C = await (async () => (await J('/api/checkout', { items: [{ productId: 'boneless-meat', qty: 2 }], fulfilment: 'pickup', pickupBranchId: q.branch.id, pickupAt: q.pickupSlots[0].at, customer: { name: 'Other', phone: '0126667777' }, address: {} })).d)();
  const billOf = (o) => o.paymentUrl.split('/').pop();
  // B paid at Billplz but the notice never arrived → order page check marks it paid
  await fetch(`${B}/__mock/billplz/${billOf(Bo)}/paysilent`);
  const ob = await (await fetch(`${B}/api/order?id=${Bo.orderId}&t=${Bo.token}`)).json();
  ok(ob.paid === true, `missed Billplz notice: order page asked Billplz and marked ${ob.no} paid`);
  // staff checks A (an earlier try) → Billplz says due, and points to B
  const login = await J('/api/admin', { action: 'login', name: 'Syakil', password: '1234' });
  const tok = login.d.token;
  const cp = await J('/api/admin', { action: 'order.checkPayment', id: A.orderId }, tok);
  ok(cp.d.billState === 'due' && cp.d.paidInstead?.no === ob.no, `check payment: A is due, customer paid ${cp.d.paidInstead?.no} instead`);
  const oa2 = (await J('/api/admin', { action: 'order.get', id: A.orderId }, tok)).d.order;
  ok(oa2.payment.status === 'replaced', 'earlier try stays "replaced" (not paid)');
  // C: paid, then a notice with a wrong X Signature arrives → not trusted, re-checked with Billplz → paid
  await fetch(`${B}/__mock/billplz/${billOf(C)}/paysilent`);
  const r = await fetch(`${B}/api/billplz-callback`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id: billOf(C), paid: 'true', state: 'paid', amount: '8500', paid_amount: '8500', x_signature: 'wrong' }).toString() });
  const oc = (await J('/api/admin', { action: 'order.get', id: C.orderId }, tok)).d.order;
  ok(r.status === 200 && oc.payment.status === 'paid', 'wrong X Signature: re-checked with Billplz, order paid');
  // forged "paid" notice for an unpaid bill does NOT mark it paid
  const D = (await J('/api/checkout', { items: [{ productId: 'boneless-meat', qty: 3 }], fulfilment: 'pickup', pickupBranchId: q.branch.id, pickupAt: q.pickupSlots[0].at, customer: { name: 'Third', phone: '0128889999' }, address: {} })).d;
  await fetch(`${B}/api/billplz-callback`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id: billOf(D), paid: 'true', state: 'paid', amount: '8500', paid_amount: '8500', x_signature: 'forged' }).toString() });
  const od = (await J('/api/admin', { action: 'order.get', id: D.orderId }, tok)).d.order;
  ok(od.payment.status === 'pending', 'forged notice for an unpaid bill is ignored');
  const act = (await J('/api/admin', { action: 'activity.list', type: 'error' }, tok)).d.items;
  ok(act.some((x) => /wrong X Signature/.test(x.msg)), 'activity log flags the wrong X Signature');
  const st = (await J('/api/admin', { action: 'settings.get' }, tok)).d.status;
  ok(/\/api\/billplz-callback$/.test(st.billplzCallback), `settings shows where Billplz notices go (${st.billplzCallback})`);
  console.log(errors.length ? 'PROBLEMS: ' + errors.join('; ') : 'ALL GOOD');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
