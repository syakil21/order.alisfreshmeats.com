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

Without this key (or if Google rejects it), the checkout uses a free OpenStreetMap map instead: customers still search, tap ◎ for their location and drag the map to put the pin on their door, like in the Lalamove app. Google gives better building names, so the key is still worth adding.

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
The dashboard (`/admin.html`) works like a food-delivery merchant app. Log in with your name and password (the owner passcode `ADMIN_PASSCODE` works with any name and is always super admin). On a phone, open it in Chrome (Android) or Safari (iPhone → Share → Add to Home Screen) to install it as **Ali's Staff**.
- **Home**: the big switch turns online ordering on/off. **Busy? Pause** stops orders for 30 min, 1 hour or the rest of the day and reopens by itself.
- Today's sales, orders and average order sit under the switch.
- The order board has tabs: **Preparing**, **Ready / on the way**, **Needs attention**, **Later pickups**, **Done today**, **Checking out** (not paid yet) and **All orders**. Tap a card for full details.
- Card buttons: **Ready for pickup** (the customer gets a notification), **Collected**, **Packed**, **Add tip**, **Change driver**, **Rebook**, **Reprint**.
- Click **Order sound** once so new paid orders chime. **New-order alerts on this phone** sends a phone notification for every paid order, even when the dashboard is closed.
- Scanning the **QR code on a label** opens that order.
- **Menu sections** (super admin): next to each section title (Local Fresh Meat, Imported Mutton, Lamb Selection) use **✎ Rename**, **↑ ↓** to reorder, or **+ Item** to add an item to it. Changes show on the shop straight away. The sticker tag is the first word of the section name.
- **Menu**: switch an item off when it's sold out (saves at once). Tap the **stock tag** to enter how many you have. Super admins tap an item to change its price, photo or cutting choices.
- **Staff** (super admin): give each person their own login, and choose their **branch** (Selayang only, Brickfields only, or all). Branch staff only see, print and handle that branch's orders, and their phone alerts are only for that branch.
- **Staff** accounts: **Staff** can see orders, print, tip / change driver / cancel / rebook Lalamove, call or WhatsApp customers, and update sold-out and stock. **Super admin** can also edit and delete orders, change prices and settings, and see Insights, Customers, Promotions and Activity. Every change is logged with the person's name.
- **Edit / delete an order** (super admin): open the order → **Edit order** (customer, address, pickup time, quantities, cutting) or **Delete order…** (for test orders). A deleted order leaves orders and sales, puts stock and points back, and stays under the **Deleted** tab and in Activity.
- **Insights**: sales, orders, average order, customers, sales by hour or day, best sellers, branches, delivery vs pickup, Lalamove cost vs what customers paid, discounts and points. Choose Today, Last 7 days, This month, Last month, Last 30 days or Custom.
- **Customers**: members with their points (± Points to give or remove), special % discounts by phone, password reset.
- **Promotions**: send a notification to every phone that turned on deal alerts. Coupons live here too.
- **Activity**: everything that happened (orders, payments, Lalamove, printing, staff changes, sign-ups, errors), with filters and search. Use it to trace a problem.

## When something goes wrong
| You see | Do this |
|---|---|
| ⚠ Label not printed | Check the branch PC is on and PrintNode is running, then click **Reprint label**. Or click **Label PDF** and print it from the browser. |
| Lalamove still finding a driver after ~10 min | Click **Add tip** (e.g. RM3). It keeps the original booking and price; don't cancel and rebook. |
| Driver accepted but is late or not answering | Open the order → **Change driver** (allowed 15 min after the driver accepted, before pickup; free, same price). |
| ⚠ Lalamove booking failed / expired / rejected | Read the error (often a low wallet balance). Open the order → **Check new price** shows today's price next to what the customer paid → **Rebook**. |
| Customer says they paid but the order shows Unpaid | The app now asks Billplz by itself (while the customer's order page is open, and from the dashboard for checkouts in the last 6 hours). You can also open the order → **Check payment with Billplz**. If Billplz says the bill is still **due**, the customer paid a different checkout (the dashboard names it), or compare the bill number on their receipt. |
| Activity shows "wrong X Signature" | The **BILLPLZ_X_SIGNATURE_KEY** in Hostinger doesn't match Billplz (Billplz → Settings → X Signature). Payments still go through because the app re-checks with Billplz, but fix the key and redeploy. |
| Need to stop orders (holiday, too busy) | **Home** → turn the switch off, or **Pause** for a while. |
| Need to cancel a paid order | Open it → **Cancel order…**, then refund the customer in Billplz or by bank transfer. Points are returned automatically. |

## Notes
- Delivery fee: the customer pays the Lalamove price quoted at checkout (Regular or Priority). Lalamove is re-quoted when it's booked after payment, so there can be a small difference. **Settings → Delivery options → Delivery buffer** adds a fixed RM to every delivery to cover price changes and the odd rebook. **Insights** shows what customers paid vs what Lalamove cost.
- **Pooling**: Lalamove's API supports Regular and Priority but not Pooling. Ask your Lalamove account manager whether they can turn it on for your API account and give you the service type, then tick **Offer Pooling** and enter it. Until then customers see Priority and Regular.
- Customers pay for the weight they ordered. The checkout note tells them final weight may vary slightly. You can edit that text in Settings.
- Customer details are kept for order handling only. Mention online orders in your privacy notice (PDPA).

## Try it on a computer first (optional)
`npm install`, then `npm run dev`, then open http://localhost:3000. This runs the whole flow with **fake** Billplz, Lalamove and PrintNode, so no accounts are needed. The dashboard is at `/admin.html` with passcode `1234`. To move a fake delivery forward, open `/__mock/calls` to find the Lalamove order id, then visit `/__mock/lalamove/advance/<id>`.

---

## Member accounts, photos, cutting, delivery area and labels

**Member accounts:** `order.alisfreshmeats.com/account.html`
- Customers sign up with name, phone, optional email and a password, then log in with their phone **or** email.
- On their page they can update their details, save addresses (with the map pin), change their password and see their orders.
- At checkout, members don't type their details again, and their default address is filled in.
- Forgotten password: the customer WhatsApps you. Go to **Customers → Registered members → Reset password** and send them the new one on WhatsApp.

**New member offer:** RM15 off the first paid order, for the first 100 members.
- Each phone number can only have one account.
- Phone numbers that already have a paid order don't get the offer.
- Change the amount, the limit or a minimum spend under **Settings → New member offer**.
- By default customers get the single biggest discount: member %, new member offer or coupon. Tick **Discounts can be combined** to allow all of them together.

**Product photos:** **Prices** → click the photo box → choose a picture.
- It's resized automatically and shows on the shop straight away.
- Click **remove** to delete it.

**Cutting options:** on products with **Cutting** ticked (Prices tab), customers can choose:
- **piece size**: 1 to 4 inch, or type their own
- **piece weight**: 10 to 100 g, or type their own
- **cooking style**: curry cut, kurma, chukka or briyani
- a comment

These show in the dashboard and on the label. Edit the lists under **Settings → Cutting options**.

**Delivery area:** each shop has a delivery radius (straight-line distance) under **Settings → Branches**. The defaults are Selayang 48 km and Brickfields 55 km:
- Inside: Kuala Kubu Bharu (~35 km from Selayang), Kuala Selangor (~45 km from Selayang) and Seremban (~53 km from Brickfields).
- Outside: places further out, such as Tanjung Malim and Port Dickson.

After entering your real shop coordinates, check the radius values and adjust if needed. Customers outside the area see the delivery area message and can't pay.

**Labels:** the shop's stickers are 80 × 50 mm. In Windows → Printing preferences, the paper size must be **50 wide × 80 high** (as it comes out of the printer). In Settings → Labels, the sticker size is **80 × 50** (as you read it). Then use **Print test label**. The QR code on each label opens that order in the staff dashboard (log in once on the staff phone). You can turn it off in Settings → Labels.
- **Turn print 90°** is on by default. It fixes labels coming out sideways (portrait).
- If the label is still sideways, untick it. If it's upside down, tick **Turn print 180°**.
- **Preview label** shows the layout.

---

## Delivery speed, self pickup, points, notifications and installing the app

**Cutting choices per item** (Menu → tap the item):
- Piece size, piece weight, **cut each into** (2 or 3 pcs), **number of pieces** and **slice thickness**, plus cooking style.
- Marrow bones offer only "cut each into", so customers must pick 2 pcs or 3 pcs.
- Lamb chop shoulder slices offer number of pieces or slice thickness (0.5, 1, 1.5 inch, or their own).
- Edit the lists under **Settings → Cutting choices**.

**Stock (inventory), separate for each shop:** head, feet, brain, spleen, liver, tripe and lamb shank show **+ Selayang** and **+ Brickfields** tags in Menu. Tap a tag and enter how many that shop has.
- Stock goes down when that shop's order is paid, and back up if the order is cancelled, deleted or edited down. Leave it empty to stop counting at that shop (no limit).
- Self pickup: the customer can only order what the chosen shop has ("Head is sold out at our Selayang shop", so they can pick the other shop).
- Delivery: if both shops reach the address and the nearer one has run out, the order goes to the other shop automatically.
- The shop menu shows "Only 3 left" / "Sold out" based on the shop with the most.
- Branch staff only see and change their own shop's stock. Any other item can be counted from its edit page.

**Editing at checkout:** each cart line has **Edit cut** and **Remove**, plus +/−.

**Delivery options:** the same as the Lalamove app. **Priority** uses Lalamove's own Priority price (booked as Priority, faster driver matching) and **Regular** the normal price. **Pooling** appears only once Lalamove enables it for your API account (see Notes).

**Self pickup:** the customer picks a branch and a time slot (every 30 minutes, today and tomorrow, from prep time onwards). No Lalamove is booked. The label says SELF PICKUP with the time. Mark **Ready for pickup** and the customer gets a notification. Change slots under **Settings → Self pickup**.

**Loyalty points (members):** 1 point per RM1 spent on meat after discounts. 100 points = RM5 off, up to 50% of the meat total. Points are added when an order is paid and returned if you cancel it. Change the rates under **Settings → Loyalty points**.

**Install as an app:** on Android, customers see an **Install** bar. On iPhone, the bar shows how to install: Share → Add to Home Screen.

**Notifications:**
- Customers tap **Get deal alerts** on the shop, or **Notify me** on their order page, or use the switches on their account page.
- On iPhone, notifications only work after the app is added to the Home Screen.
- Order updates: confirmed, driver on the way, out for delivery, delivered, ready for pickup.

---

## Stickers and Lalamove drivers

**Meat type on the sticker:** each line ends with a black tag, **LOCAL**, **IMPORTED** or **LAMB** (the first word of the menu category), and items are grouped by type. The per-item labels show the full category on top.

**How the driver knows which order to collect:**
- In the Lalamove app, the pickup stop is named "Ali's Fresh Meats Selayang - AFM-1012".
- The note to the driver starts with **ORDER NO: AFM-1012 (tell the shop this number)**, followed by unit, delivery note and the map pin.
- The driver gives that number at the counter, and staff match it to the sticker.

**How staff know which driver is for which order:** on the dashboard, once a driver accepts, the order card shows **🛵 driver name · plate number** with a **📞 Driver** button. The order page has the driver's phone and the Lalamove tracking link.

## Small order fee, orders while closed, alerts, export, Bahasa Melayu

**Small order fee.** Settings → Ordering hours. Orders whose meat comes to less than RM50 pay RM1.25 (both numbers
can be changed; untick "Charge the small order fee" to stop). It counts the meat only, before discounts and
delivery, and applies to delivery and self pickup. The checkout tells the customer how much more to add to
remove the fee. It is listed on the order, in Insights ("Small order fees collected") and in the spreadsheet.

**Orders while closed.** With "Take orders while closed" ticked, customers can order and pay after hours:

- Delivery: Lalamove is booked straight away for the next opening time plus the prep time (closed at 6pm, open
  9am, prep 30 min → the driver comes around 9:30am). Only Regular delivery is offered.
- Self pickup: the customer picks one of the next free time slots.
- The sticker is sent to the printer at payment; it prints when the shop computer is switched on.
- Pausing orders or turning the store switch off still stops everything, including orders while closed.

**Alerts when something fails.** If Lalamove could not be booked, or the sticker did not print, staff phones for
that branch get their own alert, and Home shows a red bar ("2 orders need attention") until it is fixed.

**Day's sales on your phone.** About 20 minutes after the last order time, super admins who turned on phone
alerts get one message with the day's sales, orders and sales per branch. Open the dashboard once on that
phone after this update so it knows the phone belongs to a super admin. Untick it in Settings to stop.

**Spreadsheet for the accounts.** Insights → choose the period → "Download spreadsheet". One row per paid order
(items, discounts, fees, delivery charged, Lalamove cost, Billplz bill number). Opens in Excel or Google Sheets.
Super admins only.

**Bahasa Melayu.** Customers switch with the BM / EN button at the top of the shop, order and account pages;
phones set to Malay start in BM. The translations are in `public/i18n.js` (plain list, English on the left).
Product names and section names you type in the Menu are shown as typed.

**Database use.** The dashboard now asks the server "anything new?" every 15 seconds with a tiny request and
only reloads the board when something changed (and every 5 minutes anyway). An open dashboard uses about 350
database commands an hour instead of about 1,900, which keeps two shops inside Upstash's free 500,000 a month.
If Upstash ever warns that you are near the limit, add a card there (pay as you go, about USD 0.20 per 100,000).

**Link previews.** Sharing https://order.alisfreshmeats.com on WhatsApp or Facebook now shows the logo, a title
and a short description (`public/icons/share.jpg`). WhatsApp keeps old previews for a while.

**Tests.** `npm test` for the quick checks; `npm run test:e2e` for the browser tests (see `scripts/e2e/README.md`).

## Selling more than meat (chicken, vegetables, cooking oil, papadom…)

Menu → **+ New section**, type its name (e.g. Chicken, Vegetables, Cooking Oil & Groceries) and fill in its first
item. A section exists as long as it has at least one item; rename or move it with the buttons on its title.
Each section gets its own tab on the shop and its first word is the tag on the sticker (CHICKEN, VEGETABLES).

For each item choose **Sold per**: kg, set, pc, pack, bottle, bunch, box, tray or bird.

- kg items: "Customers add" 0.25, 0.5 or 1 kg at a time (0.25 suits vegetables).
- counted items: "Weight of one (kg)", e.g. 5 for a 5 kg bottle of oil. Orders heavier than the limit in
  Settings → Delivery are sent by car instead of motorcycle, so this keeps heavy grocery orders off a bike.
- Leave all the cutting boxes unticked for items that are not cut.

## Advance orders (delivery on a later day)

At checkout, under the address, the customer sees "When do you want it?": **As soon as possible** or **Choose a
day and time** (hourly times inside the opening hours, up to 7 days ahead, closed days skipped). They pay now.

- Lalamove is booked at payment for the chosen time, so the delivery fee is the normal Regular price.
- Stock is taken at payment, so limited items are held for that customer.
- The sticker prints at payment with the date on it. Keep it with the order list, or reprint on the day.
- On the dashboard the order waits under **For later** (with later pickups) until 2 hours before, then moves to
  Preparing. The card says "Lalamove booked for Fri 13 Nov 10:00am".
- Settings → Ordering hours: untick "Advance delivery orders" to stop, or change the days ahead (1 to 7).
- Self pickup has its own "Days ahead" in Settings → Self pickup.

## Checkouts that are not paid

A customer who fills the cart and opens the payment page, but does not pay, has **not** placed an order.

- Nothing is printed, booked or alerted. The checkout only appears under Home → **Not paid**, with a red
  "NOT PAID · not an order" tag. Paid orders are the ones under Preparing, with a sticker.
- The customer's page says "Not confirmed yet. We have not received payment" and the time to pay by.
- After the time to pay (Settings → Ordering hours → "Time to pay", 30 minutes) the checkout is cancelled
  automatically and its Billplz bill is closed, so it cannot be paid days later. Before cancelling, the system
  asks Billplz one last time; if the money did arrive, the order is confirmed instead.
- Open a not-paid checkout → "Remind to pay on WhatsApp" sends the customer their payment link.
- If someone says they ordered: ask for the order number and the Billplz receipt. Search the number on Home.
  Paid shows "Paid" with the time; not paid shows the red tag.

## Members only, and the order confirmation

- **Members only** (Settings → Ordering hours, off by default so guests can order): when ticked, a customer must log in or sign up before paying.
  A guest can still browse and fill the cart; the Pay button reads "Log in or sign up to pay" and takes them to
  the sign-up page, then straight back to the checkout with the cart kept.
- **Order confirmation**: after Billplz confirms the payment, the customer's order page shows a green
  "✅ Order confirmed" box with the amount, the time and the Billplz receipt number. Without payment the page
  says "Not confirmed yet" and never shows that box. Ask a customer for this page if there is any doubt.
