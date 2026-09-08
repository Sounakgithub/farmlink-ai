# FarmLink AI

A direct farmer-to-buyer marketplace with AI assistance and role-based dashboards.

- **Backend** (`backend/`) – Node/Express 5 + MongoDB + JWT auth
- **Frontend** (`frontend/`) – React 19 + Vite + Tailwind 4 + React Router 7
- **ML service** (`ml-service/`) – Flask microservice for pricing and demand forecasting

## Roles

Each role logs in and lands on its own dashboard, and can only reach its own pages.

| | Farmer 👨‍🌾 | Buyer 🧑‍🍳 | Driver 🚚 |
| --- | --- | --- | --- |
| Lands on | `/farmer` | `/buyer` | `/driver` |
| Own pages | My Crops (add/edit/delete), Incoming Orders (accept/reject) | Cart, My Orders (cancel, live tracking) | Optimised delivery route, start/complete deliveries |
| Shared pages | Marketplace · AI Insights · Profile · Log out | | |

## AI / algorithms

| Feature | Where | How it works |
| --- | --- | --- |
| Smart price advisor | `ml-service` `POST /predict-price` | RandomForest on crop / location / quantity / demand / market price |
| Demand forecasting | `ml-service` `POST /forecast-demand`, `POST /demand-insights` | Gradient-boosted regression trained on 3 years of monthly demand (seasonality, festivals, price elasticity, weather, momentum). R² 0.974, MAE ≈ 8% |
| Delivery route optimisation | `backend` `POST /api/routes/optimize`, `POST /api/routes/optimize-orders` | Haversine distance matrix → nearest-neighbour tour → 2-opt local search. Returns visiting order, per-leg distance, ETA and the saving vs. an unsorted route |

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
python train_model.py              # (re)trains the price model
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
```

Both create their own users and delete everything they made afterwards.

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
| POST | `/api/orders` | buyer — `{items:[{productId, quantity}], deliveryAddress}`; prices and totals are read from the DB, stock is reserved |
| GET | `/api/orders` | scoped: buyer→own, farmer→orders containing their crops, driver→delivery pool |
| GET | `/api/orders/stats` | role-aware totals |
| PATCH | `/api/orders/:id/status` | guarded state machine (see below) |
| PATCH | `/api/orders/:id/cancel` | buyer, before it ships |
| PATCH | `/api/orders/:id/location` | driver GPS ping |

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
