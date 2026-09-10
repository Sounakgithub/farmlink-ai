"""
Generate the training dataset for the FarmLink price advisor.

    python generate_price_dataset.py        # writes dataset.csv

=============================================================================
THIS IS SYNTHETIC DATA. IT IS NOT REAL AGRICULTURAL MARKET DATA.
Prices, demand levels and volumes here are produced by the generative model
described below. They are plausible in shape and scale, but they are invented.
Nothing produced by this script - or by a model trained on it - should be
presented as a measurement of any real mandi, city or crop, or used as advice
for an actual sale.
=============================================================================

Why this exists
---------------
The original dataset.csv held 26 hand-written rows covering 6 crops and 3
cities. Two problems followed from that:

1. `market_price` swamped every SHAP explanation. With 26 rows there was
   almost nothing else for the forest to learn, so `location` and `quantity`
   contributed a few paise each.
2. The price form in the UI offers 10 crops and 8 cities (see
   frontend/src/lib/constants.js), but the model had only ever seen 6 and 3.
   `OneHotEncoder(handle_unknown="ignore")` turns anything else into an
   all-zero row, so picking Chennai or Peas fed the model *no* signal for
   that feature and it silently contributed exactly nothing.

This script fixes both: it covers the full 10 crops x 8 cities the UI offers,
with enough varied observations for the forest to learn a real structure.

Schema (unchanged - train_model.py, app.py and price_explainer.py all depend
on these exact columns):

    crop, location, quantity, demand, market_price, recommended_price

The generative model
--------------------
Each row is one farmer offering one lot. `market_price` is what the local
market is paying for that crop today; `recommended_price` is the price the
advisor should suggest, modelled as the market price times a margin:

    recommended_price = market_price * (1 + base + demand + volume + crop + city + noise)

The margin terms are what make features other than `market_price` carry real,
*independent* information:

  * demand  - a thin market pays less than a hungry one            (+-9%)
  * volume  - a large lot is sold at a bulk discount               (0 .. -8%)
  * crop    - handling and shelf life: potatoes store, spinach wilts
  * city    - metros support a wider margin than smaller markets
  * noise   - everything not modelled: haggling, quality, timing

`market_price` itself varies by crop, by city (a cost-of-living index) and by
month, so it still sets the overall level and will remain the strongest
feature. That is honest: a selling price genuinely does track the market
price, and this script does not try to disguise it. What changes is that the
other four features now carry signal that survives *after* market price is
known, instead of being noise.

Seasonality: the price schema has no month column, and adding one would break
the trained pipeline, /predict-price and the SHAP layer. So the season is not
a feature - it is a hidden variable that shifts `market_price` and `demand`,
which is how a real seasonal effect would reach this model anyway.

Reproducibility: SEED is fixed, so the same dataset.csv is produced every run.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

SEED = 20240517
ROWS_PER_CROP_CITY = 45  # 10 crops x 8 cities x 45 = 3600 rows

OUTPUT = "dataset.csv"

# ---------------------------------------------------------------------------
# Crops. Must match frontend/src/lib/constants.js KNOWN_CROPS.
#
#   base_price   typical rupees/kg in an average city in an average month
#   amplitude    how strongly the price swings across the year (0 = flat)
#   peak_month   month the price peaks (lean season / low supply)
#   margin       handling + shelf life: what the crop adds to the margin.
#                Storable crops (potato, onion) hold out for a better price;
#                perishables (spinach, tomato) must move and take less.
#   typical_lot  median lot size in kg, the centre of a lognormal draw
# ---------------------------------------------------------------------------
CROPS = {
    "Tomato":      dict(base_price=25.0, amplitude=0.32, peak_month=7,  margin=-0.020, typical_lot=280),
    "Potato":      dict(base_price=18.0, amplitude=0.16, peak_month=9,  margin=+0.020, typical_lot=620),
    "Onion":       dict(base_price=28.0, amplitude=0.30, peak_month=10, margin=+0.025, typical_lot=540),
    "Carrot":      dict(base_price=34.0, amplitude=0.22, peak_month=6,  margin=+0.010, typical_lot=240),
    "Spinach":     dict(base_price=20.0, amplitude=0.26, peak_month=5,  margin=-0.030, typical_lot=90),
    "Cabbage":     dict(base_price=17.0, amplitude=0.20, peak_month=6,  margin=+0.000, typical_lot=380),
    "Cauliflower": dict(base_price=24.0, amplitude=0.28, peak_month=7,  margin=-0.010, typical_lot=300),
    "Brinjal":     dict(base_price=26.0, amplitude=0.18, peak_month=8,  margin=-0.005, typical_lot=260),
    "Peas":        dict(base_price=45.0, amplitude=0.34, peak_month=8,  margin=+0.040, typical_lot=170),
    "Beans":       dict(base_price=40.0, amplitude=0.24, peak_month=9,  margin=+0.030, typical_lot=150),
}

# ---------------------------------------------------------------------------
# Cities. Must match frontend/src/lib/constants.js DEMAND_LOCATIONS.
#
#   price_index  multiplies the market price (cost of living / freight)
#   margin       what the city adds to the margin *given* the market price.
#                This is the part a model cannot read off market_price, and
#                it is why `location` becomes informative.
#   demand_pull  shifts the demand distribution (big metros absorb more)
# ---------------------------------------------------------------------------
CITIES = {
    "Mumbai":    dict(price_index=1.18, margin=+0.055, demand_pull=+1.1),
    "Delhi":     dict(price_index=1.10, margin=+0.035, demand_pull=+0.9),
    "Bangalore": dict(price_index=1.12, margin=+0.045, demand_pull=+0.7),
    "Hyderabad": dict(price_index=1.04, margin=+0.010, demand_pull=+0.2),
    "Chennai":   dict(price_index=1.06, margin=+0.020, demand_pull=+0.3),
    "Kolkata":   dict(price_index=0.98, margin=-0.010, demand_pull=+0.0),
    "Pune":      dict(price_index=1.02, margin=+0.005, demand_pull=-0.2),
    "Patna":     dict(price_index=0.90, margin=-0.040, demand_pull=-0.8),
}

BASE_MARGIN = 0.10       # the advisor's floor: ~10% over the market price
DEMAND_SWING = 0.09      # +-9% between demand 1 and demand 10
BULK_DISCOUNT = 0.055    # per decade of quantity above ~100 kg
MARGIN_NOISE = 0.022     # everything not modelled


def seasonal_factor(month: int, amplitude: float, peak_month: int) -> float:
    """A smooth yearly cycle, peaking at `peak_month`."""
    return 1.0 + amplitude * math.cos(2 * math.pi * (month - peak_month) / 12)


def build() -> pd.DataFrame:
    rng = np.random.default_rng(SEED)
    rows = []

    for crop, c in CROPS.items():
        for city, t in CITIES.items():
            for _ in range(ROWS_PER_CROP_CITY):
                month = int(rng.integers(1, 13))
                season = seasonal_factor(month, c["amplitude"], c["peak_month"])

                # --- market price: crop level x city index x season x noise --
                market_price = (
                    c["base_price"]
                    * t["price_index"]
                    * season
                    * rng.lognormal(mean=0.0, sigma=0.075)
                )
                market_price = float(np.clip(round(market_price * 2) / 2, 5.0, 120.0))

                # --- demand: 1-10 --------------------------------------------
                # Deliberately NOT a function of market_price alone. Scarcity
                # (the seasonal term) lifts both, which is real, but the
                # independent noise term is the largest single component, so
                # demand carries information market_price does not.
                demand_score = (
                    5.5
                    + 1.6 * (season - 1.0) / max(c["amplitude"], 1e-6)
                    + t["demand_pull"]
                    + rng.normal(0.0, 2.0)
                )
                demand = int(np.clip(round(demand_score), 1, 10))

                # --- quantity: lognormal around the crop's typical lot -------
                quantity = int(
                    np.clip(rng.lognormal(math.log(c["typical_lot"]), 0.62), 10, 2500)
                )

                # --- the margin over market price ---------------------------
                demand_term = (demand - 5.5) / 4.5 * DEMAND_SWING
                volume_term = -BULK_DISCOUNT * math.log10(max(quantity, 10) / 100.0)
                volume_term = float(np.clip(volume_term, -0.085, 0.030))

                margin = (
                    BASE_MARGIN
                    + demand_term
                    + volume_term
                    + c["margin"]
                    + t["margin"]
                    + rng.normal(0.0, MARGIN_NOISE)
                )
                margin = float(np.clip(margin, -0.05, 0.40))

                recommended_price = round(market_price * (1.0 + margin), 2)

                rows.append(
                    {
                        "crop": crop,
                        "location": city,
                        "quantity": quantity,
                        "demand": demand,
                        "market_price": market_price,
                        "recommended_price": recommended_price,
                    }
                )

    frame = pd.DataFrame(rows)
    return frame.sample(frac=1.0, random_state=SEED).reset_index(drop=True)


# ---------------------------------------------------------------------------
# Quality checks - run before anything is written to disk
# ---------------------------------------------------------------------------
def quality_report(df: pd.DataFrame) -> list:
    """Validate the generated frame. Returns a list of problems (empty = good)."""
    problems = []

    def check(label, bad_count, detail=""):
        status = "ok" if bad_count == 0 else "FAIL"
        print(f"  [{status:>4}] {label:<46} {bad_count}{(' ' + detail) if detail else ''}")
        if bad_count:
            problems.append(f"{label}: {bad_count}")

    print("\nData quality checks")
    print("-" * 74)

    check("missing values", int(df.isna().sum().sum()))
    check("duplicate rows", int(df.duplicated().sum()))
    check("non-positive market_price", int((df["market_price"] <= 0).sum()))
    check("non-positive recommended_price", int((df["recommended_price"] <= 0).sum()))
    check("negative or zero quantity", int((df["quantity"] <= 0).sum()))
    check("demand outside 1-10", int((~df["demand"].between(1, 10)).sum()))
    check("unknown crop", int((~df["crop"].isin(CROPS)).sum()))
    check("unknown location", int((~df["location"].isin(CITIES)).sum()))

    # a recommendation wildly detached from the market price is not credible
    ratio = df["recommended_price"] / df["market_price"]
    check(
        "implausible price ratio (<0.8x or >1.6x market)",
        int((~ratio.between(0.8, 1.6)).sum()),
        f"[observed {ratio.min():.2f}x - {ratio.max():.2f}x]",
    )

    # Extreme outliers, Tukey 3x IQR. A long right tail on quantity is
    # expected from the lognormal draw, so these are reported, not failed.
    for column in ("quantity", "market_price", "recommended_price"):
        q1, q3 = df[column].quantile([0.25, 0.75])
        iqr = q3 - q1
        outliers = int((~df[column].between(q1 - 3 * iqr, q3 + 3 * iqr)).sum())
        print(f"  [info] extreme outliers in {column:<30} {outliers} ({outliers / len(df) * 100:.1f}%)")

    # pandas <3 reports text columns as `object`, pandas >=3 as `str`;
    # accept either rather than failing on the pandas version.
    expected_types = {
        "crop": ("object", "str"), "location": ("object", "str"),
        "quantity": ("int",), "demand": ("int",),
        "market_price": ("float",), "recommended_price": ("float",),
    }
    mismatched = [
        f"{col}={df[col].dtype}"
        for col, kinds in expected_types.items()
        if not any(kind in str(df[col].dtype) for kind in kinds)
    ]
    check("inconsistent column types", len(mismatched), str(mismatched) if mismatched else "")

    return problems


def summarise(df: pd.DataFrame) -> None:
    n_crops = df["crop"].nunique()
    n_cities = df["location"].nunique()

    print("\nDataset summary")
    print("-" * 74)
    print(f"  rows                 {len(df)}")
    print(f"  crops                {n_crops}  ({', '.join(sorted(df['crop'].unique()))})")
    print(f"  locations            {n_cities}  ({', '.join(sorted(df['location'].unique()))})")
    print(f"  rows per crop-city   {len(df) // (n_crops * n_cities)}")

    print("\n  numeric ranges")
    print(
        df[["quantity", "demand", "market_price", "recommended_price"]]
        .describe().round(2).to_string()
    )

    print("\n  correlation with recommended_price")
    for column in ("market_price", "demand", "quantity"):
        print(f"    {column:<16} {df[column].corr(df['recommended_price']):+.3f}")
    print(
        f"    {'demand~market':<16} {df['demand'].corr(df['market_price']):+.3f}"
        "   (kept low on purpose: demand must carry its own signal)"
    )

    print("\n  median recommended_price by location (same crop mix everywhere)")
    by_city = df.groupby("location")["recommended_price"].median().sort_values(ascending=False)
    for city, value in by_city.items():
        print(f"    {city:<12} {value:6.2f}")

    print("\n  Onion only - median market vs recommended, by city")
    onion = (
        df[df["crop"] == "Onion"]
        .groupby("location")[["market_price", "recommended_price"]]
        .median()
        .round(2)
    )
    onion["margin_%"] = ((onion["recommended_price"] / onion["market_price"] - 1) * 100).round(1)
    print(onion.to_string())


if __name__ == "__main__":
    print(__doc__.split("Why this exists")[0].strip())

    data = build()
    issues = quality_report(data)
    summarise(data)

    if issues:
        raise SystemExit(f"\nRefusing to write {OUTPUT}: {len(issues)} check(s) failed -> {issues}")

    data.to_csv(OUTPUT, index=False)
    print(f"\nWrote {OUTPUT}  ({len(data)} rows, seed {SEED})")
    print("Reminder: this is SYNTHETIC data, not real market observations.")
