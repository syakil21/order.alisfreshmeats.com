// Bahasa Melayu for the customer pages (shop, checkout, order tracking, account).
// The pages are written in English; when the customer picks BM, every piece of text on the page is looked up
// here and swapped, including text added later (cart, prices, messages). Text that is not listed stays in English,
// so a missing line never breaks the page. To fix or add a translation, edit WORDS (exact text) or PATTERNS
// (text with a changing part, e.g. a price or a name) below.
(function () {
  let lang = null;
  try { lang = localStorage.getItem('afm.lang'); } catch {}
  if (lang !== 'ms' && lang !== 'en') lang = /^ms\b/i.test(navigator.language || '') ? 'ms' : 'en';

  const WORDS = {
    // ---- header, home ----
    'Since 1975': 'Sejak 1975', 'Log in': 'Log masuk', 'Sign up': 'Daftar', 'My account': 'Akaun saya',
    'Fresh lamb & mutton,': 'Lamb & mutton segar,', 'cut the way you cook': 'dipotong ikut cara anda masak',
    'Pay online · FPX & cards': 'Bayar online · FPX & kad', 'Lalamove delivery or self pickup': 'Penghantaran Lalamove atau ambil sendiri',
    'Get deal alerts': 'Dapatkan makluman promosi', 'Deal alerts on': 'Makluman promosi dihidupkan',
    'Prices in RM, per kg unless stated. Every order is cut and weighed fresh.': 'Harga dalam RM, sekilogram kecuali dinyatakan. Setiap pesanan dipotong dan ditimbang segar.',
    'Every order is cut and weighed fresh.': 'Setiap pesanan dipotong dan ditimbang segar.', 'Final weight may vary slightly.': 'Berat akhir mungkin berbeza sedikit.',
    'Closed now': 'Tutup sekarang', 'Closed now · order ahead': 'Tutup sekarang · pesan awal',
    "We're closed now.": 'Kami tutup sekarang.', "We're closed today.": 'Kami tutup hari ini.',
    'You can still browse the menu.': 'Anda masih boleh melihat menu.',
    'Pay now and we prepare your order as soon as we open, or choose a self pickup time.': 'Bayar sekarang dan kami sediakan pesanan anda sebaik kedai dibuka, atau pilih masa ambil sendiri.',
    'Online ordering is paused right now.': 'Pesanan online dihentikan buat sementara.', 'Please WhatsApp us to order.': 'Sila WhatsApp kami untuk memesan.', 'Please check back soon.': 'Sila cuba lagi sebentar nanti.',
    'Online delivery is being set up.': 'Penghantaran online sedang disediakan.', 'Please WhatsApp us to order for now.': 'Buat masa ini, sila WhatsApp kami untuk memesan.',
    'Menu could not load.': 'Menu tidak dapat dimuatkan.', 'Please refresh, or WhatsApp us to order.': 'Sila muat semula, atau WhatsApp kami untuk memesan.',
    'We deliver up to Kuala Kubu Bharu, Kuala Selangor and Seremban.': 'Kami menghantar hingga Kuala Kubu Bharu, Kuala Selangor dan Seremban.',
    'Local Fresh Meat': 'Daging Segar Tempatan', 'Imported Mutton': 'Mutton Import', 'Lamb Selection': 'Pilihan Lamb',
    // ---- menu and item sheet ----
    '✂ Choose your cut': '✂ Pilih potongan anda', 'Sold out': 'Habis dijual', 'Add': 'Tambah', 'View cart': 'Lihat troli', 'Add to cart': 'Tambah ke troli',
    'Amount': 'Jumlah', 'How should we cut it?': 'Bagaimana kami potong?', 'No preference': 'Tiada pilihan khusus',
    'By size': 'Ikut saiz', 'By piece weight': 'Ikut berat sepotong', 'Cut each into': 'Potong setiap satu kepada', 'Number of pieces': 'Bilangan potongan', 'Slice thickness': 'Ketebalan hirisan',
    'Custom': 'Lain-lain', 'Cooking style': 'Cara masak', 'Comment': 'Komen', '(optional)': '(pilihan)', 'pieces': 'potong',
    'All remaining stock is in your cart': 'Semua stok yang tinggal sudah ada dalam troli anda',
    'Choose a piece size.': 'Pilih saiz potongan.', 'Type the piece size you want.': 'Taip saiz potongan yang anda mahu.', 'Choose a piece weight.': 'Pilih berat sepotong.',
    'Choose a slice thickness.': 'Pilih ketebalan hirisan.', 'Type the slice thickness.': 'Taip ketebalan hirisan.', 'Choose how many pieces to cut each into.': 'Pilih berapa potong bagi setiap satu.',
    // ---- checkout ----
    'Your order': 'Pesanan anda', 'Items': 'Barang', 'How do you want it?': 'Bagaimana anda mahu terima?', 'Delivery': 'Penghantaran', 'Self pickup': 'Ambil sendiri',
    'Delivery address': 'Alamat penghantaran', 'Unit / floor': 'Unit / tingkat', 'Delivery notes': 'Nota penghantaran', 'Save to my addresses as': 'Simpan ke alamat saya sebagai',
    'Pick up from': 'Ambil di', 'Pickup time': 'Masa ambil', 'Note for the shop': 'Nota untuk kedai', 'Open in Maps': 'Buka dalam Maps',
    'Your details': 'Maklumat anda', 'Name': 'Nama', 'Phone': 'Telefon', 'Email': 'E-mel', '(for receipt)': '(untuk resit)',
    'Discounts': 'Diskaun', 'Apply': 'Guna', 'Pay': 'Bayar',
    'Secure payment by Billplz: online banking (FPX), cards and e-wallets': 'Pembayaran selamat melalui Billplz: perbankan dalam talian (FPX), kad dan e-dompet',
    'Ordering as': 'Memesan sebagai', 'Have an account?': 'Sudah ada akaun?', '· New member?': '· Ahli baharu?',
    'Your cart is empty.': 'Troli anda kosong.', 'Your cart is empty': 'Troli anda kosong', 'Edit cut': 'Ubah potongan', 'Add cutting preference': 'Tambah pilihan potongan', 'Remove': 'Buang',
    'When do you want it?': 'Bila anda mahu terima?', 'As soon as possible': 'Secepat mungkin', 'When the shop opens': 'Apabila kedai dibuka', 'Choose a day and time': 'Pilih hari dan masa',
    'Choose the day and time.': 'Pilih hari dan masa.', 'Our driver leaves the shop around then.': 'Pemandu bertolak dari kedai sekitar masa itu.', 'Choose a delivery time': 'Pilih masa penghantaran',
    'That delivery time is no longer available.': 'Masa penghantaran itu tidak lagi tersedia.', 'Please choose another.': 'Sila pilih yang lain.',
    '+ New address': '+ Alamat baharu', 'Today': 'Hari ini', 'Tomorrow': 'Esok',
    'No pickup times left.': 'Tiada lagi masa ambil.', 'Please choose delivery or WhatsApp us.': 'Sila pilih penghantaran atau WhatsApp kami.',
    'We have it cut and packed for you.': 'Kami potong dan bungkus siap untuk anda.',
    'Match faster for quick deliveries': 'Pemandu dipadankan lebih cepat', 'Regular': 'Biasa', 'Driver comes right after you pay': 'Pemandu datang sebaik selepas bayaran',
    'Save more. Delivered in 4–6 hours': 'Lebih jimat. Dihantar dalam 4–6 jam',
    'Use': 'Guna', 'for': 'untuk', 'Members earn': 'Ahli mendapat',
    'Subtotal': 'Jumlah kecil', 'Free': 'Percuma', 'Total': 'Jumlah', 'Set your address': 'Tetapkan alamat anda', 'Small order fee': 'Caj pesanan kecil',
    'Closed for orders now': 'Tutup untuk pesanan sekarang', 'Updating prices…': 'Mengemas kini harga…', 'Updating…': 'Mengemas kini…',
    'Choose a pickup time': 'Pilih masa ambil', 'Choose a pickup time.': 'Pilih masa ambil.', 'No pickup times available': 'Tiada masa ambil', 'No pickup times available right now.': 'Tiada masa ambil buat masa ini.',
    'Set your delivery address': 'Tetapkan alamat penghantaran', 'Outside delivery area': 'Di luar kawasan penghantaran', 'Delivery not available': 'Penghantaran tidak tersedia',
    'Getting delivery price…': 'Mendapatkan harga penghantaran…', 'Opening payment…': 'Membuka pembayaran…',
    'Please enter your name.': 'Sila masukkan nama anda.', 'Please enter your phone number.': 'Sila masukkan nombor telefon anda.',
    'Please enter a valid Malaysian phone number.': 'Sila masukkan nombor telefon Malaysia yang sah.', 'Please check your email address.': 'Sila semak alamat e-mel anda.',
    'Please choose your delivery address on the map.': 'Sila pilih alamat penghantaran anda pada peta.',
    'Could not get a delivery price for this address.': 'Harga penghantaran untuk alamat ini tidak dapat diperoleh.', 'Please check the address or WhatsApp us.': 'Sila semak alamat atau WhatsApp kami.',
    'Sorry, this address is outside our delivery area.': 'Maaf, alamat ini di luar kawasan penghantaran kami.', 'You can choose Self pickup instead.': 'Anda boleh pilih Ambil sendiri.',
    'An item in your cart is no longer sold.': 'Satu barang dalam troli anda tidak lagi dijual.', 'This coupon code is not valid.': 'Kod kupon ini tidak sah.', 'This coupon has expired.': 'Kupon ini telah tamat tempoh.',
    'You have already used this coupon.': 'Anda sudah menggunakan kupon ini.', 'This coupon has been fully used.': 'Kupon ini telah habis digunakan.',
    'Online payment is unavailable right now.': 'Pembayaran online tidak tersedia buat masa ini.', 'Please try again shortly or WhatsApp us.': 'Sila cuba sebentar lagi atau WhatsApp kami.',
    'Too many attempts, please wait a few minutes.': 'Terlalu banyak percubaan, sila tunggu beberapa minit.',
    // ---- address picker ----
    'Set your delivery spot': 'Tetapkan lokasi penghantaran', 'Move map to set pin': 'Gerakkan peta untuk letak pin', 'Edit address text': 'Ubah teks alamat', 'Finding address…': 'Mencari alamat…',
    'Search above, tap ◎ for your location, or drag the map so the pin sits on your door.': 'Cari di atas, tekan ◎ untuk lokasi anda, atau gerakkan peta supaya pin berada di pintu anda.',
    'No match. Try a nearby road or area, then move the pin.': 'Tiada padanan. Cuba jalan atau kawasan berdekatan, kemudian gerakkan pin.',
    'Could not use that address, please try another.': 'Alamat itu tidak dapat digunakan, sila cuba yang lain.',
    'Location is not available on this device.': 'Lokasi tidak tersedia pada peranti ini.',
    'Could not get your location.': 'Lokasi anda tidak dapat diperoleh.', 'Please allow location access, or search instead.': 'Sila benarkan akses lokasi, atau buat carian.',
    // ---- order page ----
    '✅ Order confirmed': '✅ Pesanan disahkan', 'Log in or sign up to order.': 'Log masuk atau daftar untuk memesan.', 'It takes a minute, and your cart is kept.': 'Hanya seminit, dan troli anda disimpan.', 'Log in or sign up to pay': 'Log masuk atau daftar untuk bayar',
    'Please log in or sign up to place your order.': 'Sila log masuk atau daftar untuk membuat pesanan.',
    'Not confirmed yet': 'Belum disahkan', 'Not paid: order cancelled': 'Tidak dibayar: pesanan dibatalkan', 'We only prepare your order after you pay.': 'Kami hanya menyediakan pesanan selepas anda membayar.',
    'Nothing was charged and nothing will be prepared.': 'Tiada caj dikenakan dan tiada apa yang akan disediakan.',
    'Waiting for payment': 'Menunggu pembayaran', 'Payment not completed': 'Pembayaran belum selesai', 'Complete payment to confirm it.': 'Selesaikan pembayaran untuk mengesahkannya.',
    'Change my order': 'Ubah pesanan saya', 'Order cancelled': 'Pesanan dibatalkan', 'Please WhatsApp us if you have any questions about your refund.': 'Sila WhatsApp kami jika ada soalan tentang bayaran balik anda.',
    'Delivered.': 'Telah dihantar.', 'Collected.': 'Telah diambil.', 'Enjoy!': 'Selamat menjamu selera!', 'Ready for collection': 'Sedia untuk diambil',
    'Payment received': 'Pembayaran diterima', 'Collected': 'Telah diambil', 'Finding a Lalamove driver': 'Mencari pemandu Lalamove', 'Driver on the way to our shop': 'Pemandu dalam perjalanan ke kedai kami',
    'Out for delivery': 'Sedang dihantar', 'Delivered': 'Telah dihantar', 'Track driver live': 'Jejak pemandu secara langsung',
    '🔔 Notify me when my order moves': '🔔 Maklumkan saya apabila pesanan bergerak', 'Turning on…': 'Menghidupkan…', '✅ We’ll notify you on this phone': '✅ Kami akan maklumkan pada telefon ini',
    'Keep this page to check your order.': 'Simpan halaman ini untuk menyemak pesanan anda.', 'Order again': 'Pesan lagi', 'Order not found': 'Pesanan tidak dijumpai',
    'Please check your link, or WhatsApp us for help.': 'Sila semak pautan anda, atau WhatsApp kami untuk bantuan.', 'Back to shop': 'Kembali ke kedai', 'Need help?': 'Perlukan bantuan?', 'WhatsApp us': 'WhatsApp kami',
    'Show order number': 'Tunjukkan nombor pesanan', 'at the counter.': 'di kaunter.', 'Directions to the shop': 'Arah ke kedai', 'Replaced by your newer order': 'Diganti dengan pesanan baharu anda',
    'Loading…': 'Memuatkan…',
    // ---- account ----
    'Password': 'Kata laluan', 'Phone number': 'Nombor telefon', 'Phone number or email': 'Nombor telefon atau e-mel', 'Create my account': 'Cipta akaun saya', 'Forgot your password?': 'Lupa kata laluan?',
    'My details': 'Maklumat saya', 'My addresses': 'Alamat saya', 'My orders': 'Pesanan saya', 'Save details': 'Simpan maklumat', 'Save address': 'Simpan alamat', 'Log out': 'Log keluar',
    'Change password': 'Tukar kata laluan', 'Current password': 'Kata laluan semasa', 'New password': 'Kata laluan baharu', 'New address': 'Alamat baharu', 'Name this address': 'Namakan alamat ini',
    'Cancel': 'Batal', 'Order now': 'Pesan sekarang', 'Notifications on this phone': 'Notifikasi pada telefon ini', 'Your name': 'Nama anda',
    // ---- placeholders ----
    'e.g. B-12-3': 'cth. B-12-3', 'e.g. Leave with guard': 'cth. Tinggalkan pada pengawal', "e.g. I'll come by car": 'cth. Saya datang dengan kereta', 'optional': 'pilihan', 'Coupon code': 'Kod kupon',
    'Search building, street or area': 'Cari bangunan, jalan atau kawasan', 'Building, street, area, postcode': 'Bangunan, jalan, kawasan, poskod',
    'e.g. remove fat, keep bones separate': 'cth. buang lemak, asingkan tulang', 'Weight per piece': 'Berat sepotong', 'How many pieces': 'Berapa potong',
    'e.g. 1.5 inch, small cubes': 'cth. 1.5 inci, kiub kecil', 'e.g. 0.75 inch': 'cth. 0.75 inci',
    // ---- page titles ----
    "Ali's Fresh Meats · Order Online": "Ali's Fresh Meats · Pesan Online", "Your order · Ali's Fresh Meats": "Pesanan anda · Ali's Fresh Meats", "My account · Ali's Fresh Meats": "Akaun saya · Ali's Fresh Meats",
  };

  const day = (s) => String(s).replace(/^Today\b/, 'Hari ini').replace(/^Tomorrow\b/, 'Esok').replace(/^today\b/, 'hari ini').replace(/^tomorrow\b/, 'esok');
  const speed = { Priority: 'Priority', Regular: 'biasa', Pooling: 'Pooling' };
  // [pattern, replacement]: $1, $2… are the changing parts; a function gets them as arguments
  const PATTERNS = [
    [/^Open for orders until (.+)$/, 'Buka untuk pesanan hingga $1'],
    [/^Order ahead for (.+)\.$/, (m, a) => `Pesan awal untuk ${day(a)}.`],
    [/^Online orders are taken (.+)\.$/, 'Pesanan online diterima $1.'],
    [/^Online ordering is paused until (.+)\.$/, 'Pesanan online dihentikan sehingga $1.'],
    [/^Track your order (.*)→$/, 'Jejak pesanan anda $1→'],
    [/^Hi, (.+)$/, 'Hai, $1'],
    [/^New member\? Get RM(\S+) off your first order\.$/, 'Ahli baharu? Dapat potongan RM$1 untuk pesanan pertama.'],
    [/^Min\. spend RM(\S+)\.$/, 'Belanja minimum RM$1.'],
    [/^Only (\d+) left\.$/, 'Tinggal $1 sahaja.'],
    [/^Your RM(\S+) new member offer is ready\.$/, 'Tawaran ahli baharu RM$1 anda sedia digunakan.'],
    [/^It comes off at checkout(?: \(min\. spend RM(\S+)\))?\.$/, (m, a) => `Ditolak semasa bayaran${a ? ` (belanja minimum RM${a})` : ''}.`],
    [/^and get RM(\S+) off$/, 'dan dapat potongan RM$1'],
    [/^Only (.+) left · (.+) more can be added$/, 'Tinggal $1 sahaja · $2 lagi boleh ditambah'],
    [/^Only (.+) left$/, 'Tinggal $1 sahaja'],
    [/^(.+) in cart$/, '$1 dalam troli'],
    [/^Add to cart · (.+)$/, 'Tambah ke troli · $1'],
    [/^Update item · (.+)$/, 'Kemas kini · $1'],
    [/^Added (.+)$/, 'Ditambah: $1'], [/^Updated (.+)$/, 'Dikemas kini: $1'],
    [/^Choose a time(?: \((.+)\))?\.$/, (m, a) => `Pilih masa${a ? ` (${day(a)})` : ''}.`],
    [/^Pickup (.+)$/, (m, a) => `Ambil ${day(a)}`],
    [/^Driver collects about (\d+) min after you pay$/, 'Pemandu ambil kira-kira $1 minit selepas bayaran'],
    [/^Driver leaves our shop around (.+)$/, (m, a) => `Pemandu bertolak dari kedai sekitar ${day(a)}`],
    [/^Driver collects around (.+)$/, (m, a) => `Pemandu ambil sekitar ${day(a)}`],
    [/^(\d+) points$/, '$1 mata'], [/^You have (\d+) points$/, 'Anda ada $1 mata'], [/^You have (\d+) points\.$/, 'Anda ada $1 mata.'],
    [/^Every (\d+) points = RM(\S+) off\.$/, 'Setiap $1 mata = potongan RM$2.'],
    [/^You’ll earn (\d+) points with this order\.$/, 'Anda akan dapat $1 mata dengan pesanan ini.'],
    [/^on this order \((\d+) points = RM(\S+) off\)\.$/, 'untuk pesanan ini ($1 mata = potongan RM$2).'],
    [/^Points \((\d+)\)$/, 'Mata ($1)'],
    [/^(Priority|Regular|Pooling) delivery$/, (m, a) => `Penghantaran ${speed[a]}`],
    [/^\(orders under (RM .+)\)$/, '(pesanan bawah $1)'],
    [/^Add (RM .+) more to remove this fee$/, 'Tambah $1 lagi untuk elak caj ini'],
    [/^Coupon (\S+) \((\S+)% off\)$/, 'Kupon $1 (diskaun $2%)'], [/^Coupon (\S+) applied\.$/, 'Kupon $1 digunakan.'], [/^Coupon (\S+)$/, 'Kupon $1'],
    [/^Member discount \((\S+)% off\)$/, 'Diskaun ahli ($1%)'], [/^New member offer \(RM(\S+) off\)$/, 'Tawaran ahli baharu (potongan RM$1)'],
    [/^Pay (RM .+)$/, 'Bayar $1'],
    [/^(.+) is sold out at our (.+) shop\.$/, '$1 habis dijual di kedai $2 kami.'],
    [/^(.+): only (.+) left at our (.+) shop\.$/, '$1: tinggal $2 sahaja di kedai $3 kami.'],
    [/^(.+) is sold out right now\.$/, '$1 habis dijual buat masa ini.'], [/^(.+) is sold out\.$/, '$1 habis dijual.'],
    [/^Minimum order is (RM\S+)\.$/, 'Pesanan minimum ialah $1.'],
    [/^Please choose a valid amount for (.+)\.$/, 'Sila pilih jumlah yang sah untuk $1.'],
    [/^Spend at least (RM\S+) to use this coupon\.$/, 'Belanja sekurang-kurangnya $1 untuk guna kupon ini.'],
    [/^Sent from our (.+) shop \((.+) has run out of something in your order\)\.$/, 'Dihantar dari kedai $1 kami (stok di $2 tidak mencukupi untuk pesanan anda).'],
    [/^From our (.+) shop( · .+)?$/, (m, a, b) => `Dari kedai ${a} kami${b || ''}`],
    [/^\(about (\d+) km from our (.+) shop\)$/, '(kira-kira $1 km dari kedai $2 kami)'],
    // order page
    [/^Payment received: (RM \S+)(?: on (.+?))?(?: · Billplz receipt (\S+))?$/, (m, a, b, c) => `Bayaran diterima: ${a}${b ? ` pada ${day(b)}` : ''}${c ? ` · resit Billplz ${c}` : ''}`],
    [/^New members get RM(\S+) off\.$/, 'Ahli baharu dapat potongan RM$1.'],
    [/^We have not received payment for (\S+)\.$/, 'Kami belum menerima bayaran untuk $1.'], [/^Pay before (.+) or it is cancelled\.$/, 'Bayar sebelum $1 atau pesanan dibatalkan.'],
    [/^We did not receive payment for (\S+), so it was cancelled\.$/, 'Kami tidak menerima bayaran untuk $1, jadi pesanan dibatalkan.'],
    [/^Order (\S+) is saved\.$/, 'Pesanan $1 disimpan.'], [/^Order (\S+) was not paid\.$/, 'Pesanan $1 tidak dibayar.'], [/^You checked out again as (\S+)\.$/, 'Anda membuat pesanan semula sebagai $1.'],
    [/^Go to order (\S+)$/, 'Pergi ke pesanan $1'], [/^Order (\S+)\.$/, 'Pesanan $1.'],
    [/^Complete payment · (.+)$/, 'Selesaikan pembayaran · $1'],
    [/^Thank you, (.+)!$/, 'Terima kasih, $1!'],
    [/^Order (\S+) · paid (RM \S+)(.*)$/, (m, a, b, c) => `Pesanan ${a} · dibayar ${b}${c.replace('self pickup', 'ambil sendiri').replace('priority delivery', 'penghantaran priority').replace('pooling delivery', 'penghantaran pooling')}`],
    [/^We're cutting and packing your order(?: at (.+))?$/, (m, a) => `Kami sedang memotong dan membungkus pesanan anda${a ? ` di ${a}` : ''}`],
    [/^We prepare your order fresh for (.+) at (.+)$/, (m, a, b) => `Kami sediakan pesanan anda segar untuk ${day(a)} di ${b}`],
    [/^We prepare your order when our (.+) shop opens$/, 'Kami sediakan pesanan anda apabila kedai $1 kami dibuka'],
    [/^Your pickup time: (.+)$/, (m, a) => `Masa ambil anda: ${day(a)}`],
    [/^\+(\d+) points added to your account\.$/, '+$1 mata ditambah ke akaun anda.'],
    [/^Collect at Ali's Fresh Meats (.+)$/, "Ambil di Ali's Fresh Meats $1"],
  ];

  function one(core) {
    if (Object.prototype.hasOwnProperty.call(WORDS, core)) return WORDS[core];
    for (const [re, rep] of PATTERNS) if (re.test(core)) return core.replace(re, rep);
    return null;
  }
  // whole text first; otherwise sentence by sentence (untranslated sentences stay as they are)
  function tr(s) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(String(s));
    const core = m[2]; if (!core || !/[A-Za-z]/.test(core)) return s;
    let out = one(core);
    if (out == null) {
      // split after . ! ? and around "(about 12 km …)", without regex look-behind (older iPhones don't have it)
      const parts = core.replace(/Min\. /g, 'Min.\u0002').replace(/([.!?])\s+/g, '$1\u0001').replace(/\)\s+(?=[A-Z])/g, ')\u0001').replace(/\s+(?=\(about )/g, '\u0001')
        .split('\u0001').map((p) => p.replace(/\u0002/g, ' '));
      if (parts.length < 2) return s;
      let hit = false;
      out = parts.map((p) => { const t = one(p); if (t != null) hit = true; return t ?? p; }).join(' ');
      if (!hit) return s;
    }
    return m[1] + out + m[3];
  }

  const ATTRS = ['placeholder', 'aria-label', 'title'];
  const done = new WeakMap(); // text node → the translation we wrote (so our own change is not translated again)
  function text(n) {
    if (done.get(n) === n.nodeValue) return;
    const p = n.parentNode; if (p && /^(SCRIPT|STYLE|TEXTAREA)$/.test(p.nodeName)) return;
    const t = tr(n.nodeValue);
    if (t !== n.nodeValue) { done.set(n, t); n.nodeValue = t; }
  }
  function attrs(el) {
    for (const a of ATTRS) if (el.hasAttribute(a)) { const v = el.getAttribute(a); const t = tr(v); if (t !== v) el.setAttribute(a, t); }
  }
  function walk(root) {
    if (root.nodeType === 3) return text(root);
    if (root.nodeType !== 1 || /^(SCRIPT|STYLE)$/.test(root.nodeName) || root.closest?.('[data-noi18n]')) return;
    attrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) text(n); else attrs(n); }
  }

  function addToggle() {
    const bar = document.querySelector('header.top .wrap'); if (!bar || document.getElementById('langBtn')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'langBtn'; b.className = 'langbtn'; b.setAttribute('data-noi18n', '');
    b.textContent = lang === 'ms' ? 'EN' : 'BM';
    b.setAttribute('aria-label', lang === 'ms' ? 'Switch to English' : 'Tukar ke Bahasa Melayu');
    b.onclick = () => { try { localStorage.setItem('afm.lang', lang === 'ms' ? 'en' : 'ms'); } catch {} location.reload(); };
    const before = bar.querySelector('.acct, .wa');
    if (before) bar.insertBefore(b, before); else bar.appendChild(b);
  }

  function start() {
    addToggle();
    if (lang !== 'ms') return;
    document.documentElement.lang = 'ms';
    document.title = tr(document.title);
    walk(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') text(m.target);
        else if (m.type === 'attributes') attrs(m.target);
        else for (const n of m.addedNodes) walk(n);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  window.AFMLang = { lang, t: (s) => (lang === 'ms' ? tr(s) : s) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
