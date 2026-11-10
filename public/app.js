// Shared by the customer pages: installs the service worker, shows the "Install app" bar
// (Android: one tap; iPhone: Share → Add to Home Screen), and turns on push notifications.
(function () {
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  let swReady = null;
  if ('serviceWorker' in navigator) {
    swReady = navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).catch(() => null);
  }

  // ---------- install bar ----------
  let deferred = null;
  const DISMISS_KEY = 'afm.installDismissed';
  const recentlyDismissed = () => Date.now() - Number(store.get(DISMISS_KEY) || 0) < 5 * 86400000;

  function bar(html, onInstall) {
    if (document.getElementById('installBar') || standalone() || recentlyDismissed()) return;
    const el = document.createElement('div');
    el.id = 'installBar'; el.className = 'install-bar'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Install the app');
    el.innerHTML = `<img src="/icons/icon-192.png" alt="" width="40" height="40"><div class="ib-text">${html}</div>${onInstall ? '<button type="button" class="ib-go">Install</button>' : ''}<button type="button" class="ib-x" aria-label="Not now">×</button>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
    el.querySelector('.ib-x').onclick = () => { store.set(DISMISS_KEY, String(Date.now())); close(); };
    if (onInstall) el.querySelector('.ib-go').onclick = async () => { close(); await onInstall(); };
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferred = e;
    setTimeout(() => bar('<b>Install Ali\'s Fresh Meats</b><span>Order in one tap and get delivery updates on your phone.</span>', async () => {
      deferred.prompt();
      const r = await deferred.userChoice.catch(() => ({}));
      if (r.outcome !== 'accepted') store.set(DISMISS_KEY, String(Date.now()));
      deferred = null;
    }), 2500);
  });
  window.addEventListener('appinstalled', () => { document.getElementById('installBar')?.remove(); store.set(DISMISS_KEY, String(Date.now() + 365 * 86400000)); });

  if (isIOS && !standalone()) {
    const share = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="vertical-align:-3px"><path fill="currentColor" d="M12 2l4 4h-3v9h-2V6H8l4-4zm-7 9h3v2H6v8h12v-8h-2v-2h3a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V12a1 1 0 011-1z"/></svg>';
    setTimeout(() => bar(`<b>Install Ali's Fresh Meats</b><span>Tap ${share} <b>Share</b>, then <b>Add to Home Screen</b>.</span>`), 3000);
  }

  // ---------- push notifications ----------
  const b64ToBytes = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); };
  let keyCache = null;
  async function vapidKey() {
    if (keyCache) return keyCache;
    const r = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'key' }) });
    keyCache = (await r.json()).key; return keyCache;
  }
  const push = {
    // 'ok' | 'ios-install' (iPhone: must add to Home Screen first) | 'unsupported'
    support() {
      if (isIOS && !standalone()) return 'ios-install';
      return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window ? 'ok' : 'unsupported';
    },
    permission: () => ('Notification' in window ? Notification.permission : 'denied'),
    async current() {
      if (push.support() !== 'ok') return null;
      const reg = await swReady; return reg ? reg.pushManager.getSubscription() : null;
    },
    // opts: { promos, orderId, token, memberToken }. Returns the subscription id, or throws with a friendly message.
    async enable(opts = {}) {
      const s = push.support();
      if (s === 'ios-install') throw new Error('On iPhone, first add this app to your Home Screen (Share → Add to Home Screen), then open it from there to turn on notifications.');
      if (s !== 'ok') throw new Error('This browser does not support notifications.');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them for this site in your browser settings.');
      const reg = await swReady; if (!reg) throw new Error('Could not start notifications. Please reload and try again.');
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(await vapidKey()) });
      const headers = { 'Content-Type': 'application/json' };
      if (opts.memberToken) headers.Authorization = `Bearer ${opts.memberToken}`;
      const r = await fetch('/api/push', { method: 'POST', headers, body: JSON.stringify({ action: 'subscribe', subscription: sub.toJSON(), promos: opts.promos, orderId: opts.orderId, token: opts.token }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not turn on notifications.');
      store.set('afm.pushId', d.id);
      if (opts.promos !== undefined) store.set('afm.promos', opts.promos ? '1' : '0');
      return d.id;
    },
    async disable() {
      const sub = await push.current();
      if (sub) { await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'unsubscribe', endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
      store.set('afm.promos', '0');
    },
    id: () => store.get('afm.pushId'),
    promosOn: () => store.get('afm.promos') === '1' && push.permission() === 'granted',
  };

  window.AFM = { push, isIOS, isAndroid, standalone, store };
})();
