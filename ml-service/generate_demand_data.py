"""
Generate a synthetic but realistic monthly crop-demand dataset.

The goal is to give the demand-forecasting model something to learn that has
the structure real demand has: seasonality, festival spikes, price elasticity,
weather sensitivity and month-to-month momentum (autocorrelation).

Output: demand_dataset.csv
"""

import numpy as np
import pandas as pd

RNG = np.random.default_rng(42)

# base       -> typical monthly demand (kg) in a mid-size market
# price      -> typical market price (Rs/kg)
# peak_month -> calendar month where demand naturally peaks
# amp        -> strength of the seasonal swing (0-1)
# elasticity -> change in demand (kg) per Rs/kg the price moves above normal
# rain_sens  -> how much heavy rain suppresses demand (leafy > root)
CROPS = {
    "Tomato":      dict(base=4200, price=26, peak_month=1,  amp=0.45, elasticity=-32, rain_sens=0.6),
    "Potato":      dict(base=6000, price=22, peak_month=12, amp=0.30, elasticity=-20, rain_sens=0.25),
    "Onion":       dict(base=5200, price=30, peak_month=10, amp=0.40, elasticity=-38, rain_sens=0.35),
    "Carrot":      dict(base=2600, price=36, peak_month=12, amp=0.38, elasticity=-24, rain_sens=0.30),
    "Spinach":     dict(base=1500, price=20, peak_month=12, amp=0.55, elasticity=-16, rain_sens=0.75),
    "Cabbage":     dict(base=2400, price=18, peak_month=1,  amp=0.42, elasticity=-14, rain_sens=0.55),
    "Brinjal":     dict(base=2000, price=24, peak_month=11, amp=0.35, elasticity=-19, rain_sens=0.50),
    "Cauliflower": dict(base=2200, price=28, peak_month=12, amp=0.52, elasticity=-22, rain_sens=0.55),
    "Peas":        dict(base=1800, price=40, peak_month=1,  amp=0.65, elasticity=-30, rain_sens=0.40),
    "Beans":       dict(base=1600, price=38, peak_month=2,  amp=0.46, elasticity=-25, rain_sens=0.45),
}

# market size multiplier per city
LOCATIONS = {
    "Delhi": 1.25,
    "Mumbai": 1.35,
    "Pune": 1.00,
    "Bangalore": 1.15,
    "Kolkata": 1.10,
    "Patna": 0.75,
    "Hyderabad": 1.05,
    "Chennai": 1.00,
}

# Dussehra / Diwali festival window -> higher vegetable buying
FESTIVAL_MONTHS = {10, 11}

YEARS = [2022, 2023, 2024]


def season_of(month: int) -> str:
    if month in (12, 1, 2):
        return "Winter"
    if month in (3, 4, 5):
        return "Summer"
    if month in (6, 7, 8, 9):
        return "Monsoon"
    return "Autumn"  # 10, 11


def seasonal_rainfall(month: int) -> float:
    # mm of rain, peaking July-August
    base = 20 + 180 * max(0.0, np.cos(2 * np.pi * (month - 7.5) / 12))
    return float(max(0.0, base + RNG.normal(0, 15)))


def seasonal_temperature(month: int) -> float:
    # deg C, peaking May-June for northern-plains style climate
    return float(30 - 9 * np.cos(2 * np.pi * (month - 5) / 12) + RNG.normal(0, 1.5))


def build() -> pd.DataFrame:
    rows = []
    for crop, c in CROPS.items():
        for location, market_mult in LOCATIONS.items():
            prev_demand = c["base"] * market_mult  # seed for the first month
            for year in YEARS:
                for month in range(1, 13):
                    season = season_of(month)
                    rainfall = seasonal_rainfall(month)
                    temperature = seasonal_temperature(month)

                    # seasonal demand shape
                    seasonal = 1 + c["amp"] * np.cos(
                        2 * np.pi * (month - c["peak_month"]) / 12
                    )
                    festival = 1.18 if month in FESTIVAL_MONTHS else 1.0

                    # price: higher in the off-season, plus noise and a mild
                    # year-on-year drift so the model can't just memorise a constant
                    off_season = 1 + 0.12 * (1 - (seasonal - (1 - c["amp"])) / (2 * c["amp"] + 1e-9))
                    drift = 1 + 0.03 * (year - 2023)
                    price = c["price"] * off_season * drift + RNG.normal(0, 1.4)
                    price = float(max(5.0, price))

                    demand = c["base"] * market_mult * seasonal * festival
                    demand += c["elasticity"] * (price - c["price"])
                    demand -= c["rain_sens"] * max(0.0, rainfall - 120)
                    demand += 0.25 * (prev_demand - c["base"] * market_mult)  # momentum
                    demand += RNG.normal(0, 0.06 * c["base"] * market_mult)   # noise
                    demand = float(max(50.0, round(demand)))

                    rows.append(
                        dict(
                            crop=crop,
                            location=location,
                            year=year,
                            month=month,
                            season=season,
                            avg_market_price=round(price, 2),
                            prev_demand=round(prev_demand),
                            festival_flag=1 if month in FESTIVAL_MONTHS else 0,
                            rainfall_mm=round(rainfall, 1),
                            temperature_c=round(temperature, 1),
                            demand_kg=demand,
                        )
                    )
                    prev_demand = demand

    return pd.DataFrame(rows)


if __name__ == "__main__":
    df = build()
    df.to_csv("demand_dataset.csv", index=False)
    print(f"Wrote demand_dataset.csv  ({len(df)} rows)")
    print(df.head(12).to_string(index=False))
