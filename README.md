# FarmLink AI

A direct farmer-to-buyer marketplace with AI assistance and role-based dashboards.

- **Backend** (`backend/`) – Node/Express 5 + MongoDB + JWT auth
- **Frontend** (`frontend/`) – React 19 + Vite + Tailwind 4 + React Router 7
- **ML service** (`ml-service/`) – Flask microservice for pricing and demand forecasting

## Roles

Each role logs in and lands on its own dashboard, sees only its own navigation,
and is blocked (redirected home) from other roles' pages.

| | Farmer 👨‍🌾 | Buyer 🧑‍🍳 | Driver 🚚 | Logistics company 🏢 | Admin 🛡 |
| --- | --- | --- | --- | --- | --- |
| Lands on | `/farmer` | `/buyer` | `/driver` | `/logistics` | `/admin` |
| Own pages | My Crops (add / edit / delete, bulk tiers), Incoming Orders (accept / reject, payout), **AI Insights** (price advisor + demand forecast) | Marketplace, Cart (delivered-price quote), My Orders (cancel, reorder, live tracking, confirm delivery), **Wholesale** (bulk quotes, invoices, API keys) | Optimised delivery route, pickup inspection, complete deliveries, join a company | Delivery offers (accept / decline), fleet and join code, rate card and liability cover | Overview, disputes, business and carrier verification, settings, audit log |
| Everyone | Messages · Profile · Log out | | | | |
| Marketplace | ✅ (compare prices) | ✅ (shop) | — | — | — |

Admin accounts are created on the server (`npm run create-admin`), never
through sign-up.

The AI planning tools (price advisor, demand forecasting) are farmer-only. A
buyer or driver never sees them.

## Messaging

Every role has a **Messages** page (`/messages`) with an unread badge in the nav.

| Thread | Started from | Purpose |
| --- | --- | --- |
| Buyer ↔ Farmer | a crop in the marketplace, or an order | ask about freshness / harvest date, negotiate price |
| Buyer ↔ Driver | an order that is out for delivery | delivery instructions (gate code, call on arrival, …) |

A buyer↔driver thread only opens once a driver has picked the order up. Quick-reply
chips speed up the common messages. Backend: `models/Conversation.js`,
`routes/conversationRoutes.js`.

## Ordering

- **Choose quantity** — the buyer picks how many kg (stepper, presets, live
  subtotal) in a modal before the crop enters the cart.
- **Payment method** — Cash on Delivery, UPI, Card or Net Banking, chosen at
  checkout. Non-COD is a mock "instant" prepaid transaction (`paymentStatus`
  flips to `Paid`); COD settles on delivery. Cancelling a prepaid order refunds it.
- **Delivery instructions** — a free-text note on the order, editable until it
  ships, plus the driver chat.
- **Reorder** — one click re-adds a past order's items to the cart.

## Operations: money, quality, carriers, wholesale

The marketplace runs on an operations layer that sits alongside the order
lifecycle rather than replacing it. `order.totalAmount` is still the produce
total; everything below lives in new fields (`charges`, `settlement`,
`inspection`, `logistics`, `invoice`).

### Delivered price and fees (`utils/fees.js`, `utils/orderPricing.js`)

Every channel (checkout, wholesale, partner API) prices a cart in one place:

```
buyer pays     produce  +  delivery fee
delivery fee = carrier rate  +  logistics markup %
farmer gets    produce  -  commission %
carrier gets   its rate
platform keeps commission  +  markup
```

- Line prices come from the database with the farmer's **bulk tiers** applied
  (e.g. 100 kg+ at 27, 500 kg+ at 25).
- The carrier rate is quoted on **real road distance** for the whole
  multi-farm run (see routing below).
- Consumer and verified-business accounts have separate fee tiers, editable by
  an admin (defaults 4% / 8% consumer, 2.5% / 6% business).
- All arithmetic is in integer paise, so the split always sums to what the
  buyer paid, to the paisa (a unit test checks 2,000 random carts).

### Escrow (`utils/settlement.js`, `models/LedgerEntry.js`)

| Payment | On order | On delivery | Released when |
| --- | --- | --- | --- |
| UPI / Card / Net Banking | captured → **held** | release window starts | buyer confirms good condition, or 48 h pass without a dispute |
| Cash on Delivery | awaiting payment | cash captured → **held** | same |
| Invoice (wholesale) | **invoiced** | — | invoice paid → held → released |

Rejected or cancelled orders are refunded (or voided if no money moved). Every
movement is a ledger row, and each order's ledger provably closes to zero.
Payments use a mock rail: there are no gateway credentials in this project, so
a real gateway only has to supply a `gatewayRef`.

### Two-point quality inspection (`utils/inspection.js`)

1. **At the farm gate** the collecting driver grades the produce (A/B/C/REJECT),
   checks freshness, pests, packaging and moisture, and weighs it. Goods
   **cannot go In Transit** without a passed pickup inspection (admin setting).
   A REJECT, a failed freshness/pest check, or weight short beyond tolerance
   fails the load: the order is rejected and the buyer refunded. Failures need
   notes; REJECT needs a photo.
2. **At delivery** the buyer reports the condition. Good releases payment;
   damaged/short/spoiled freezes it as a dispute.

Liability is suggested from the chain of custody: failed at pickup → farmer;
passed at pickup and arrived damaged → carrier; grade C that deteriorated →
shared; weight lost between the two scales → carrier; no pickup record →
undetermined. An admin makes the final decision. The buyer always gets the
decided refund; the liable party funds it from their payout, then the platform,
and anything beyond that is advanced by the platform and recorded as a claim
against the carrier within the liability cover it published.

Pickup pass rates also feed the farmer's **reliability pillar** in AI matching.

### Logistics companies (`utils/logistics.js`)

- A `logistics` account creates a company: coverage cities, rate card, largest
  load, refrigeration and damage-liability cover. Drivers join with its code.
- An admin verifies the company before it receives work.
- When a farmer accepts an order, the job is **offered** to the cheapest
  eligible carrier whose own rate fits the payout locked at checkout. Offers
  expire (30 min default) and move on; a decline moves on immediately.
- If no carrier is eligible, the order falls back to the **independent driver
  pool** exactly as before, so nothing changes for deployments without carriers.

### Road routing (`utils/roadRouting.js`)

Google Distance Matrix when `GOOGLE_MAPS_API_KEY` is set, otherwise OSRM
(`OSRM_URL`, default the public demo server, which has a fair-use limit), with a
straight-line fallback that is always flagged approximate. Results are cached
for five minutes. The tracking map draws the real road when one is available.

### Wholesale and the partner API (`routes/b2bRoutes.js`, `routes/publicApiRoutes.js`)

A buyer requests a business account with a company name and GSTIN; until an
admin verifies it they stay a consumer. Verified businesses get the business
fee tier, multi-line bulk quotes (50 kg minimum per line by default), optional
net-15/net-30 invoices up to a credit limit, and API keys for `/api/v1`. Keys
are shown once, stored as SHA-256 hashes, scoped, rate limited per key and
revocable. Rate limiting is in-memory, which is correct for one API process; a
multi-instance deployment needs a shared store such as Redis.

### Admin console and audit trail

Admins cannot sign up. Create one on the server:

```bash
cd backend
npm run create-admin -- --email ops@example.com --name "Ops Lead" --password "at-least-12-chars"
npm run create-admin -- --email existing@example.com --promote
```

The console (`/admin`) shows money and queues, resolves disputes, verifies
business accounts and carriers, edits fees and operating settings, and browses
the audit log. Every state change (orders, settlement, inspections, carrier
offers, settings, API keys) writes an append-only `AuditLog` entry.

## AI / algorithms

| Feature | Where | How it works |
| --- | --- | --- |
| Smart price advisor | `ml-service` `POST /predict-price` | RandomForest on crop / location / quantity / demand / market price, trained on 3,600 generated rows covering 10 crops x 8 cities. Every prediction carries a SHAP explanation (see [Explainable AI](#explainable-ai)) |
| Demand forecasting | `ml-service` `POST /forecast-demand`, `POST /demand-insights` | Gradient-boosted regression trained on 3 years of monthly demand (seasonality, festivals, price elasticity, weather, momentum). R² 0.974, MAE ≈ 8% |
| Delivery route optimisation | `backend` `POST /api/routes/optimize`, `POST /api/routes/optimize-orders` | Haversine distance matrix → nearest-neighbour tour → 2-opt local search. Returns visiting order, per-leg distance, ETA and the saving vs. an unsorted route |
| Shortest road route | `backend` `POST /api/routes/optimal` | Google Distance Matrix or OSRM road distance, drive time and geometry between two places, straight-line fallback flagged approximate, plus priced carrier options |

## Explainable AI

Every price the advisor returns comes with a breakdown of **why** the model
picked that number. The farmer sees a "Why this price?" panel; the API returns
an `explanation` block next to the price.

### Why SHAP, and why it fits this model

A price the farmer cannot question is a price the farmer will not trust. The
advisor is a `RandomForestRegressor` — 100 trees voting — so there are no
coefficients to read off and no single rule to point at.

[SHAP](https://github.com/shap/shap) (SHapley Additive exPlanations) solves
exactly this. It borrows the Shapley value from cooperative game theory: treat
the five inputs as players and the prediction as a payout, then split the payout
between them fairly. It is a good fit here for three reasons:

- **It is exact for trees.** `shap.TreeExplainer` computes Shapley values for
  tree ensembles analytically, not by sampling, so the same input always yields
  the same explanation — no random wobble between two identical requests.
- **It is additive.** The contributions and the base value always add back up to
  the model's own output, which means the explanation cannot drift away from the
  price actually shown.
- **It is local.** It explains *this* prediction for *this* farmer, not the
  model's average behaviour, which is what a farmer pricing one specific harvest
  actually needs.

### What a SHAP value means

The explainer starts from a **base value** — the average price the model
predicts across everything it was trained on (₹32.42/kg in the shipped model).
Each feature's SHAP value is how many rupees per kg that feature pushed the
prediction away from that average:

```
base_value  +  Σ(feature contributions)  =  the model's prediction
   32.42    +          -0.21             =        32.21
```

That identity is the guarantee. A positive value pushed the price up, a negative
value pulled it down, and the size is how strongly.

### How it is wired in

`ml-service/price_explainer.py` explains the **existing** `price_model.pkl` —
nothing is retrained, re-fit or approximated:

- The pipeline is `ColumnTransformer(OneHotEncoder on [crop, location] +
  passthrough on [quantity, demand, market_price]) → RandomForestRegressor`.
  `TreeExplainer` only understands the forest, so it is fed the **transformed**
  12-column matrix, not the raw input.
- The 9 one-hot columns are then **summed back** into their original feature.
  Summing is valid because SHAP values are additive, and it is what turns
  `crop_Tomato = +0.4, crop_Onion = 0.0, …` into a single **Crop type** row.
  The mapping is read from the fitted `ColumnTransformer`'s `output_indices_`
  and `categories_`, not by string-splitting column names — so a crop or city
  containing an underscore cannot silently be attributed to the wrong feature.
- The `TreeExplainer` is built **once at startup** and reused. A request costs
  one `transform` plus one `shap_values` call on a single row.

### From SHAP values to something a farmer can read

Raw SHAP output is a vector of floats. The service converts it into:

- a **label** (`market_price` → "Current market price") and the value entered,
- a **direction** (`increase` / `decrease` / `neutral`, derived from the same
  rounded number the API publishes, so the two can never disagree),
- a **plain sentence** — *"The current market price of ₹32/kg contributed about
  ₹7.0/kg upward to the model's predicted price."*

Features are sorted by absolute contribution, and the UI shows the top 3–5, so
nobody has to read twelve encoded columns. The word "SHAP" never reaches the
screen.

### Limitations — please read

**SHAP explains the model, not the market.** A SHAP value says how much a
feature moved *this model's* output, given how it was trained. It is not
evidence that changing that feature in the real world would change the real
price. That is why every statement says *"contributed to the model's
prediction"* and never *"caused the price to rise"*.

Two further caveats: the model can only reflect its training data
(`ml-service/dataset.csv`), so an explanation inherits any bias or gap in it;
and when two features move together (demand and market price often do), SHAP
splits the credit between them — the split is fair, but it is not a measurement
of independent influence.

### Example response

`POST /predict-price`

```json
{
  "crop": "Onion",
  "location": "Patna",
  "quantity": 400,
  "demand": 7,
  "market_price": 30
}
```

```json
{
  "recommended_price": 32.21,
  "explanation": {
    "method": "shap.TreeExplainer",
    "base_value": 32.42,
    "predicted_value": 32.21,
    "reconstructed_value": 32.21,
    "features": [
      {
        "feature": "location",
        "label": "Location",
        "value": "Patna",
        "impact": -1.15,
        "abs_impact": 1.15,
        "direction": "decrease",
        "statement": "Selling in Patna contributed about ₹1.1/kg downward to the model's predicted price."
      },
      {
        "feature": "market_price",
        "label": "Current market price",
        "value": 30,
        "impact": 0.53,
        "abs_impact": 0.53,
        "direction": "increase",
        "statement": "The current market price of ₹30/kg contributed about ₹0.5/kg upward to the model's predicted price."
      },
      {
        "feature": "demand",
        "label": "Demand level",
        "value": 7,
        "impact": 0.48,
        "abs_impact": 0.48,
        "direction": "increase",
        "statement": "A demand level of 7 out of 10 contributed about ₹0.5/kg upward to the model's predicted price."
      }
    ]
  }
}
```

Features are truncated above for brevity — the API returns all five.

### The training data is synthetic

`ml-service/dataset.csv` is **generated, not measured**. `generate_price_dataset.py`
builds it from a fixed seed, so the same 3,600 rows come back every run:

```bash
cd ml-service
python generate_price_dataset.py   # writes dataset.csv, with quality checks
python train_model.py              # writes price_model.pkl
```

It covers all 10 crops and 8 cities the UI offers, and models
`recommended_price` as the market price times a margin that responds to demand,
lot size, crop shelf life and city. The generator refuses to write the file if
any quality check fails (missing values, duplicates, impossible prices,
negative quantities, unknown categories, implausible price ratios, wrong dtypes).

**These are invented numbers.** They are plausible in shape and scale, but no
row corresponds to a real mandi, city or sale, and neither the dataset nor the
model trained on it should be presented as real agricultural market data or
used to price an actual harvest. Held-out metrics (MAE ₹0.79/kg, R² 0.995) say
how well the forest recovered the generator's own rules — they are **not**
evidence of real-world pricing accuracy, and would be much worse on real data.

This replaced an earlier 26-row hand-written file, which was too small and too
narrow for the model to learn anything but "follow the market price". It also
only knew 6 crops and 3 cities, so the other 4 crops and 5 cities fell through
`handle_unknown="ignore"` as an all-zero row and contributed *nothing* — the
model returned an identical price for Chennai, Hyderabad, Kolkata, Patna and
Bangalore.

### If SHAP is unavailable

The explanation is strictly additive to the old contract. `recommended_price` is
unchanged, and if `shap` is not installed, the explainer fails to build, or an
individual explanation errors, the response is simply:

```json
{ "recommended_price": 32.21, "explanation": null }
```

The price still works, and the UI drops the "Why this price?" panel rather than
breaking. `GET /` reports `price_explainer_loaded` so you can tell which mode
the service is in.


## Running locally

### Quick start (Windows)

```powershell
.\start-all.ps1
```

Checks your dependencies (installing anything missing), trains the ML models if
they aren't built yet, launches all three services in their own windows, waits
for each to answer, and opens the app.

```powershell
.\start-all.ps1 -Stop        # shut everything down
.\start-all.ps1 -SkipMl      # run without the Flask ML service
.\start-all.ps1 -NoBrowser   # don't open the browser
```

If PowerShell blocks the script, run it once as:
`powershell -ExecutionPolicy Bypass -File .\start-all.ps1`

### Manual start

Three terminals, one per service.

### 1. ML service

```bash
cd ml-service
pip install -r requirements.txt
python generate_demand_data.py     # writes demand_dataset.csv
python train_demand_model.py       # writes demand_model.pkl + demand_context.json
python generate_price_dataset.py   # writes dataset.csv   (3,600 synthetic rows)
python train_model.py              # writes price_model.pkl
python app.py                      # http://localhost:8000
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env               # MONGO_URI, JWT_SECRET; routing settings are optional
npm start                          # http://localhost:5000
npm run create-admin -- --email you@example.com --name "You" --password "a-long-password"
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

Register three accounts (farmer, buyer, driver) to try the whole flow:
farmer lists a crop → buyer orders it → farmer accepts → driver inspects,
routes and delivers it → buyer watches the driver live on the map and confirms
the delivery, which releases payment.

### Docker

```bash
docker compose up --build          # MongoDB, ML service, API and the built frontend
# app: http://localhost:5173   API: http://localhost:5000   ML: http://localhost:8000
docker compose exec backend npm run create-admin -- --email you@example.com --name "You" --password "a-long-password"
```

Set `JWT_SECRET` (and optionally `GOOGLE_MAPS_API_KEY` / `OSRM_URL`) in a `.env`
file next to `docker-compose.yml` for anything beyond local use.

## Tests

With the backend running:

```bash
cd backend
npm run test:unit                 # 23 tests, no server needed: fee split, inspection rules,
                                  # liability, bulk tiers, API key hashing, rate limiting, routing
npm test                          # unit tests, then every smoke suite below

node smoke-test.js                # 38 checks: auth, ownership rules, order state machine
node smoke-test-journey.js        # 39 checks: replays every screen's API calls (1 skips without ML)
node smoke-test-chat.js           # 26 checks: messaging access rules, payment method, delivery notes
node smoke-test-delivery.js       # 57 checks: delivery addresses, tracking, driver GPS
node smoke-test-value.js          # 65 checks: driver assignment and fair-deal pricing
node smoke-test-matching.js       # 73 checks: AI farmer-buyer matching
node smoke-test-operations.js     # 112 checks: fees and escrow, carrier offers, inspections,
                                  # disputes, wholesale credit, partner API, admin, audit
```

Each creates its own users and deletes everything it made afterwards (the
operations suite also restores any platform setting it changes). CI
(`.github/workflows/ci.yml`) runs all of them against a MongoDB service with
straight-line routing, plus the ML tests and the frontend lint and build.

ML service (with `python app.py` running, or on its own for the offline layer):

```bash
cd ml-service
python test_price_explain.py   # 54 checks: prediction, SHAP additivity,
                               # feature mapping, directions, API compatibility,
                               # and graceful degradation when SHAP fails
```

## API

### Auth
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/register` | `{name, email, password, role, location?}` → `{token, user}` |
| POST | `/api/auth/login` | → `{token, user}` |
| GET | `/api/auth/me` | restores the session on page refresh |
| PATCH | `/api/auth/me` | update name / phone / location / exact `coordinates` |

Sign-up roles: `farmer`, `buyer`, `driver`, `logistics`.

### Products
| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/products` | public — supports `?search=`, `?crop=`, `?location=`, `?inStock=true` |
| GET | `/api/products/mine` | farmer — **only their own listings** |
| GET | `/api/products/stats` | farmer — dashboard totals |
| POST | `/api/products` | farmer — `farmerId` comes from the token; optional `bulkTiers`, `coordinates`, `needsRefrigeration` |
| PATCH/DELETE | `/api/products/:id` | farmer — ownership enforced server-side |

### Orders
| Method | Path | Who |
| --- | --- | --- |
| POST | `/api/orders/quote` | buyer — checkout preview: tier prices, road distance, delivery options, fee breakdown. Creates nothing |
| POST | `/api/orders` | buyer — `{items:[{productId, quantity}], deliveryAddress, deliveryInstructions?, paymentMethod?}`; prices and totals are read from the DB, stock is reserved, escrow opened |
| GET | `/api/orders/:id/operations` | buyer / farmer / carrier / admin — inspections, escrow state, carrier, and the ledger rows that viewer may see |
| GET | `/api/orders/:id/tracking` | buyer / farmer / assigned driver — journey, live position, road geometry, carrier and inspection status |
| GET | `/api/orders` | scoped: buyer→own, farmer→orders containing their crops, driver→delivery pool. Includes the assigned driver's contact for the buyer |
| GET | `/api/orders/stats` | role-aware totals |
| PATCH | `/api/orders/:id/status` | guarded state machine (see below) |
| PATCH | `/api/orders/:id/instructions` | buyer — edit the delivery note until it ships |
| PATCH | `/api/orders/:id/cancel` | buyer, before it ships (prepaid → refunded) |
| PATCH | `/api/orders/:id/location` | driver GPS ping |

### Inspections, logistics, wholesale, admin
| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/inspections/policy` | anyone signed in — grades, failure rules, tolerance |
| POST | `/api/inspections/order/:id/pickup` | collecting driver or admin — or send `inspection` with the In Transit status change |
| POST | `/api/inspections/order/:id/delivery` | buyer, once delivered — releases payment or opens a dispute |
| GET | `/api/inspections/farmer/me` | farmer — own quality record |
| POST | `/api/routes/optimal` | signed in — `{from, to, weightKg?}` road distance, ETA, geometry, carrier options |
| GET/PUT | `/api/logistics/provider/me` | logistics — company profile, rate card, liability |
| GET | `/api/logistics/assignments` | logistics — offers and accepted jobs (drop shown as a region until accepted) |
| POST | `/api/logistics/assignments/:id/accept` · `/reject` | logistics — accept with one of its drivers, or decline |
| GET · DELETE | `/api/logistics/drivers` · `/drivers/:id` | logistics — fleet and join code |
| POST | `/api/logistics/join` · `/leave` | driver — join a company by code, or go independent |
| GET/POST | `/api/b2b/account` | buyer — status, or request a business account `{companyName, gstin}` |
| POST | `/api/b2b/quote` · `/orders` | verified business — bulk quote; order on `Invoice` or upfront |
| GET · POST | `/api/b2b/invoices` · `/invoices/:orderId/pay` | buyer — invoices and credit position; pay (mock rail) |
| GET/POST/DELETE | `/api/b2b/api-keys` | verified business — create (shown once), list, revoke |
| GET · POST · GET | `/api/v1/products` · `/quotes` · `/orders` | partner — `X-API-Key`, scoped and rate limited |
| GET | `/api/admin/overview` · `/audit` · `/pairs` · `/ledger/:orderId` | admin |
| GET/PUT | `/api/admin/settings` | admin — fees, rate card, tolerance, release window, offer expiry |
| GET · POST | `/api/admin/disputes` · `/disputes/:orderId/resolve` | admin — `{liability, refundPct, notes}` |
| GET · POST | `/api/admin/business-accounts` · `/business-accounts/:userId` | admin — approve with terms and credit limit, or decline |
| GET · PATCH | `/api/admin/providers` · `/providers/:id` | admin — verify or suspend carriers |

### Conversations
| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/conversations` | participant — list, newest first, with unread counts |
| GET | `/api/conversations/unread-count` | participant — nav badge |
| POST | `/api/conversations` | `{kind:"buyer-farmer"\|"buyer-driver", productId?, orderId?}` → opens or reuses a thread |
| GET | `/api/conversations/:id` | participant only — full thread, marks it read |
| POST | `/api/conversations/:id/messages` | `{body}` |

Order lifecycle — each arrow is enforced by role on the server:

```
Pending ──farmer──> Accepted ──driver──> In Transit ──driver──> Delivered ──buyer confirms──> paid out
   │                    │     (needs a passed         │                         └─reports a problem─> dispute
   ├──farmer──> Rejected│      pickup inspection;     │
   └──────buyer─────────┴──> Cancelled                 a failed one rejects and refunds)
                              (stock is returned on Rejected/Cancelled)
```

## Notes on the farmer listing/deletion fix

Three separate bugs were making crops fail to list or delete:

1. The dashboard's add form never sent `farmerId`, which is required by the
   schema — so **every add silently 400'd**. The server now fills `farmerId`
   and `farmerName` in from the auth token, so the client cannot get it wrong.
2. `fetchProducts()` called `GET /api/products` with no filter, so a farmer saw
   **every farmer's crops** as "your listings". There is now a dedicated
   `GET /api/products/mine`.
3. `DELETE /api/products/:id` had **no ownership check**, so one farmer could
   delete another's crop. Ownership is now verified server-side, and a crop
   that belongs to an active order is protected from deletion.
