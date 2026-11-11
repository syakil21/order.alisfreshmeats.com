# Browser tests

These open the shop and the staff dashboard in a real (hidden) browser and click through them like a customer
and a staff member would. They run against the local demo server (`scripts/dev-server.js`), which uses a
throw-away database and **fake** Billplz, Lalamove and PrintNode, so nothing is charged, booked or printed.

Run them before publishing a change:

```
cd scripts/e2e
npm install              # first time only
npx playwright install chromium   # first time only
cd ../..
npm run test:e2e         # all tests (about 3 minutes)
node scripts/e2e/run.js extras    # just one file
```

| File | What it checks |
| --- | --- |
| `board.js` | Dashboard, menu, stock per branch, shop, map, checkout, delivery and pickup, tips, rebooking, staff roles, edit / delete, stickers |
| `payments.js` | Pressing Pay twice, changed carts, missed or forged Billplz notices |
| `sections.js` | Renaming, moving and adding menu sections |
| `extras.js` | Small order fee, ordering while closed, alerts when a booking or sticker fails, the dashboard's quick check, spreadsheet export, daily summary, Bahasa Melayu, security headers |

Screenshots and the downloaded spreadsheet are saved in `scripts/e2e/.out/`.
`npm test` (no browser needed) runs the quick checks in `scripts/test-core.js`.
