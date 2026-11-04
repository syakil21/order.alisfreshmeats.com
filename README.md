# Ali's Fresh Meats: online ordering

Customer shop + Billplz payment + automatic Lalamove booking + automatic label printing (Clabel CT221B via PrintNode) + staff dashboard. Runs on Hostinger (Node.js app, entry `server.js`) or Vercel, with Upstash Redis as the database.

**Setup:** see [SETUP.md](SETUP.md).

```
public/   shop (index.html), order tracking (order.html), staff dashboard (admin.html)
api/      catalog, quote, checkout, billplz-callback, billplz-return, order, lalamove-webhook, admin, label
lib/      pricing & coupons, Billplz, Lalamove v3, PrintNode, label PDF, fulfilment, storage
scripts/  dev-server.js (local demo with fake services), test-core.js
```

- `npm test`: checks the Billplz X Signature against Billplz's published samples, plus pricing, coupons, phone numbers and opening hours.
- `npm start`: production server (`server.js`).
- `npm run dev`: local demo at http://localhost:3000.

After payment (`lib/fulfil.js`): mark the order paid (once, even though Billplz sends both a callback and a redirect), book Lalamove with pickup at payment time + prep minutes, then print the label. Delivery status is always re-read from Lalamove's API when its webhook fires. Prices, discounts and the delivery fee are always recalculated on the server.
