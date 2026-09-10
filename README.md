# FarmLink AI

A direct farmer-to-buyer marketplace with AI assistance and role-based dashboards.

- **Backend** (`backend/`) – Node/Express 5 + MongoDB + JWT auth
- **Frontend** (`frontend/`) – React 19 + Vite + Tailwind 4 + React Router 7
- **ML service** (`ml-service/`) – Flask microservice for pricing and demand forecasting

## Roles

Each role logs in and lands on its own dashboard, sees only its own navigation,
and is blocked (redirected home) from other roles' pages.

| | Farmer 👨‍🌾 | Buyer 🧑‍🍳 | Driver 🚚 |
| --- | --- | --- | --- |
| Lands on | `/farmer` | `/buyer` | `/driver` |
| Own pages | My Crops (add / edit / delete), Incoming Orders (accept / reject), **AI Insights** (price advisor + demand forecast) | Marketplace, Cart, My Orders (cancel, reorder, live tracking) | Optimised delivery route, start / complete deliveries |
| Everyone | Messages · Profile · Log out | | |
| Marketplace | ✅ (compare prices) | ✅ (shop) | — |

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

## AI / algorithms

| Feature | Where | How it works |
| --- | --- | --- |
| Smart price advisor | `ml-service` `POST /predict-price` | RandomForest on crop / location / quantity / demand / market price, trained on 3,600 generated rows covering 10 crops x 8 cities. Every prediction carries a SHAP explanation (see [Explainable AI](#explainable-ai)) |
| Demand forecasting | `ml-service` `POST /forecast-demand`, `POST /demand-insights` | Gradient-boosted regression trained on 3 years of monthly demand (seasonality, festivals, price elasticity, weather, momentum). R² 0.974, MAE ≈ 8% |
| Delivery route optimisation | `backend` `POST /api/routes/optimize`, `POST /api/routes/optimize-orders` | Haversine distance matrix → nearest-neighbour tour → 2-opt local search. Returns visiting order, per-leg distance, ETA and the saving vs. an unsorted route |

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
# .env needs:  PORT=5000  MONGO_URI=<your mongo uri>  JWT_SECRET=<any long random string>
npm start                          # http://localhost:5000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

Register three accounts (farmer, buyer, driver) to try the whole flow:
farmer lists a crop → buyer orders it → farmer accepts → driver routes and
delivers it → buyer watches the driver live on the map.

## Tests

With the backend running:

```bash
cd backend
node smoke-test.js           # 38 checks: auth, ownership rules, order state machine
node smoke-test-journey.js   # 39 checks: replays every screen's API calls for all 3 roles
node smoke-test-chat.js      # 26 checks: messaging access rules, payment method, delivery notes
```

Each creates its own users and deletes everything it made afterwards.

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
| PATCH | `/api/auth/me` | update name / phone / location |

### Products
| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/products` | public — supports `?search=`, `?crop=`, `?location=`, `?inStock=true` |
| GET | `/api/products/mine` | farmer — **only their own listings** |
| GET | `/api/products/stats` | farmer — dashboard totals |
| POST | `/api/products` | farmer — `farmerId` comes from the token |
| PATCH/DELETE | `/api/products/:id` | farmer — ownership enforced server-side |

### Orders
| Method | Path | Who |
| --- | --- | --- |
| POST | `/api/orders` | buyer — `{items:[{productId, quantity}], deliveryAddress, deliveryInstructions?, paymentMethod?}`; prices and totals are read from the DB, stock is reserved |
| GET | `/api/orders` | scoped: buyer→own, farmer→orders containing their crops, driver→delivery pool. Includes the assigned driver's contact for the buyer |
| GET | `/api/orders/stats` | role-aware totals |
| PATCH | `/api/orders/:id/status` | guarded state machine (see below) |
| PATCH | `/api/orders/:id/instructions` | buyer — edit the delivery note until it ships |
| PATCH | `/api/orders/:id/cancel` | buyer, before it ships (prepaid → refunded) |
| PATCH | `/api/orders/:id/location` | driver GPS ping |

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
Pending ──farmer──> Accepted ──driver──> In Transit ──driver──> Delivered
   │                    │
   ├──farmer──> Rejected│
   └──────buyer─────────┴──> Cancelled     (stock is returned on Rejected/Cancelled)
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
