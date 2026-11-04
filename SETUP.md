# Ali's Fresh Meats online ordering: setup guide

How it works: customer orders on **order.alisfreshmeats.com** → pays with Billplz → the system books Lalamove right away and prints the order label on the Clabel CT221B at the branch → staff pack it → driver collects → customer tracks the delivery on their order page.

- Shop: `order.alisfreshmeats.com`
- Staff dashboard: `order.alisfreshmeats.com/admin.html`
- Your existing website on `alisfreshmeats.com` stays as it is. Add an **Order online** button there that links to `https://order.alisfreshmeats.com`.

Setup takes about an hour. Do the steps in order. Use **sandbox/test** keys for Billplz and Lalamove first, place a test order, then switch to live keys.

---

## 1. Hosting: Hostinger (or Vercel)
The app runs on either one. Use **one** of them.

**Hostinger** (your current host). This needs the **Business** web hosting plan, any **Cloud** plan, or a **VPS**. Premium and Single plans can't run Node.js apps. Check your plan name in hPanel.
1. Upload everything inside the `alisfreshmeats` folder to a **private** GitHub repository. The top level must show `server.js`, `api`, `lib`, `public` and `package.json`.
2. hPanel → **Websites → Add website → Node.js Apps** → **Import Git repository**, and choose the repo. Alternatively, upload a zip of the folder without `node_modules`.
3. Build settings: Framework **Other**, Node.js **22**, Entry file **`server.js`**. Leave Build command and Output directory empty.
4. For the domain, enter **order.alisfreshmeats.com**. Hostinger requires the subdomain to be its **own website**, not a subfolder, and this leaves your main site untouched. The domain is already with Hostinger, so DNS is handled for you. Make sure SSL (https) is on for the subdomain.
5. Add the environment variables from step 8, then deploy.

**Vercel** (only if your Hostinger plan can't run Node.js). Import the same GitHub repo in Vercel with Framework **Other**, then add `order.alisfreshmeats.com` under Settings → Domains. At Hostinger → Domains → DNS, add the one **CNAME** record Vercel shows (name `order`). Your main site isn't affected. Vercel's free Hobby plan is for non-commercial use, so a shop needs Pro.

## 2. Database (Upstash Redis, free tier is enough to start)
Create a free account at **upstash.com** → **Create Database** (Redis, region Singapore) → **REST API** section. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` into your environment variables.
On Vercel you can instead connect Upstash under **Storage**, which adds the keys for you.

## 3. Domain
- **Hostinger:** covered in step 1.
- **Vercel:** add the `order` CNAME record Vercel shows at Hostinger → Domains → DNS.

## 4. Billplz (payments)
1. Until your live account is approved, sign up separately at **billplz-sandbox.com**. The sandbox is a separate account with its own keys.
2. Under **Settings → Keys & Integration**, copy the **API Secret Key** and the **X Signature Key**. If X Signature is off, turn it on.
3. Under **Billing → Collections**, create a collection (e.g. "Online orders") and copy its **Collection ID**.
4. Add these as environment variables: `BILLPLZ_API_KEY`, `BILLPLZ_X_SIGNATURE_KEY`, `BILLPLZ_COLLECTION_ID`, and `BILLPLZ_SANDBOX=true`.
5. **Going live:** replace the three keys with the ones from your approved billplz.com account, and set `BILLPLZ_SANDBOX=false`.

You don't need to set callback URLs in Billplz. The app sends them with every bill.

## 5. Lalamove (delivery)
1. Log in to the **Partner Portal** (partnerportal.lalamove.com) with your Lalamove business account and choose **Malaysia**.
2. Under **Developers**, copy the API key and secret. Sandbox keys start with `pk_test` / `sk_test`.
3. Add them as `LALAMOVE_API_KEY` and `LALAMOVE_API_SECRET`. Also add `LALAMOVE_WEBHOOK_SECRET`, which can be any long random text you make up.
4. **Going live:** top up your Lalamove Wallet. Production keys (`pk_prod` / `sk_prod`) only appear after a top-up. Replace the two keys.
5. After every key change: open **Dashboard → Settings → Connect Lalamove updates**. This registers the delivery-update link with Lalamove. In the Partner Portal webhook section, the webhook version should be **v3**.

Bookings are paid from your Lalamove Wallet, so keep it topped up. If the wallet runs out, the order shows **"Lalamove booking failed"** in the dashboard. Top up, then press **Rebook Lalamove**.

## 6. Label printer at each branch (PrintNode)
Each branch needs a Windows PC that stays on during opening hours, with the Clabel CT221B plugged in by USB.

1. Install the **Clabel Windows driver** (the Clabel manual has a driver install guide).
2. In Windows: **Printers → Clabel → Printing preferences**. Set the paper size to your label roll size (default **50 × 30 mm**), then print a Windows test page.
3. Create an account at **printnode.com**, install the **PrintNode Client** on the PC, sign in, and set it to start with Windows.
4. Copy your PrintNode API key (**Account → API Keys**) into the environment variables as `PRINTNODE_API_KEY`.
5. In **Dashboard → Settings → Branches**, click **Load printers from PrintNode**, pick the Clabel printer for that branch, then click **Save settings** and **Print test label**.

If your labels aren't 50 × 30 mm, change the size in **Settings → Labels** to match the roll.

## 7. Google Maps (address search at checkout)
1. In Google Cloud Console, create a project, add billing, and enable **Maps JavaScript API**, **Places API (New)** and **Geocoding API**.
2. Create an API key and restrict it to **Websites**: `order.alisfreshmeats.com/*`.
3. Add the key as `GOOGLE_MAPS_API_KEY`.

Without this key, customers can still order using "Use my current location" plus a typed address, but address search won't work.

## 8. Environment variables
`.env.example` lists every variable. On top of the keys from the steps above, add:
- `SITE_URL=https://order.alisfreshmeats.com`
- `ADMIN_PASSCODE`: a long passcode for staff

After any change, **redeploy** so it takes effect (Hostinger: the app's **Redeploy** button; Vercel: Deployments → ⋯ → Redeploy).

## 9. First login: fill in Settings
Open `order.alisfreshmeats.com/admin.html` → **Settings**:
- **Connections**: every item should show ✓.
- **Branches**: for Selayang and Brickfields, fill in the full pickup address, the coordinates, the phone number the driver should call, and the printer. To get coordinates, right-click the shop on Google Maps and click the numbers to copy them. Orders go to the branch nearest the customer. Untick **Takes online orders** for a branch that shouldn't receive orders.
- **Ordering hours**, closed days and minimum order.
- **Prep time before pickup**: Lalamove is booked as soon as the customer pays, and the driver is scheduled to arrive this many minutes later (default 30). Set it to 0 for immediate pickup.
- **Vehicle**: MOTORCYCLE by default, switching to CAR for orders heavier than 15 kg. After you click "Connect Lalamove updates", the vehicle names Lalamove accepts in KL are listed. If Lalamove offers an insulated or thermal bag request, you can add its key under special requests.

Then check **Prices** (loaded from your current price lists).

## 10. Test, then go live
With sandbox keys, place a real order on the site, pay on the Billplz sandbox page, and check that:
- the label prints,
- the order appears in the dashboard with a chime,
- a Lalamove sandbox order is created and the order page shows its status.

When everything works, switch Billplz and Lalamove to live keys (steps 4.5 and 5.4), redeploy, and click **Connect Lalamove updates** again.

---

## Day to day
- Keep the dashboard open at the counter and click **Turn on order alert sound** once. New paid orders chime and flash.
- Scanning the **QR code on a label** opens that order in the dashboard.
- **Prices**: change prices any time, untick "On sale" for sold-out items, then click **Save prices**. The shop updates immediately.
- **Coupons**: set % or RM off, minimum spend, dates, usage limits, one use per customer, or restrict to specific phone numbers.
- **Members**: give a regular customer a standing % discount by phone number. They get the bigger of their member discount or a coupon, unless you allow both in Settings.

## When something goes wrong
| You see | Do this |
|---|---|
| ⚠ Label not printed | Check the branch PC is on and PrintNode is running, then click **Reprint label**. Or click **Label PDF** and print it from the browser. |
| ⚠ Lalamove booking failed / expired / rejected | Read the error (often a low wallet balance), fix it, then click **Rebook Lalamove**. |
| Customer says they paid but the order shows Unpaid | Open the order and click **Check payment with Billplz**. If Billplz confirms payment, it books the delivery and prints the label. |
| Need to stop orders (holiday, out of stock) | Go to **Settings** → untick **Accepting online orders**. |

## Notes
- Delivery fee: the customer pays the Lalamove price quoted at checkout. Lalamove is re-quoted when it's booked after payment, and the small difference, if any, is yours. The dashboard shows both amounts. You can add a fixed amount on top in Settings.
- Customers pay for the weight they ordered. The checkout note tells them final weight may vary slightly. You can edit that text in Settings.
- Customer details are kept for order handling only. Mention online orders in your privacy notice (PDPA).

## Try it on a computer first (optional)
`npm install`, then `npm run dev`, then open http://localhost:3000. This runs the whole flow with **fake** Billplz, Lalamove and PrintNode, so no accounts are needed. The dashboard is at `/admin.html` with passcode `1234`. To move a fake delivery forward, open `/__mock/calls` to find the Lalamove order id, then visit `/__mock/lalamove/advance/<id>`.
