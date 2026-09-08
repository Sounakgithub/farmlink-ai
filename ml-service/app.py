from datetime import date
import json
import os

from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import pandas as pd

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ----------------------------------------------------------------------------
# Load models
# ----------------------------------------------------------------------------
price_model = joblib.load(os.path.join(BASE_DIR, "price_model.pkl"))

demand_model = None
demand_context = {"crops": [], "locations": [], "monthly": {}, "levels": {}}

_demand_model_path = os.path.join(BASE_DIR, "demand_model.pkl")
_demand_context_path = os.path.join(BASE_DIR, "demand_context.json")

if os.path.exists(_demand_model_path) and os.path.exists(_demand_context_path):
    demand_model = joblib.load(_demand_model_path)
    with open(_demand_context_path) as f:
        demand_context = json.load(f)
else:
    print(
        "WARNING: demand_model.pkl / demand_context.json not found. "
        "Run `python train_demand_model.py` to enable demand forecasting."
    )

DEMAND_FEATURES = [
    "crop",
    "location",
    "season",
    "month",
    "avg_market_price",
    "prev_demand",
    "festival_flag",
    "rainfall_mm",
    "temperature_c",
]

FESTIVAL_MONTHS = {10, 11}


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def season_of(month: int) -> str:
    if month in (12, 1, 2):
        return "Winter"
    if month in (3, 4, 5):
        return "Summer"
    if month in (6, 7, 8, 9):
        return "Monsoon"
    return "Autumn"


def _wrap_month(month: int) -> int:
    return (month - 1) % 12 + 1


def _context_key(crop: str, location: str) -> str:
    return f"{crop}|{location}"


def _month_context(crop: str, location: str, month: int):
    """Return the historical seasonal conditions for a crop+location+month.

    Falls back to the crop's average across all locations, then to None.
    """
    monthly = demand_context.get("monthly", {})
    key = _context_key(crop, location)
    month_str = str(_wrap_month(month))

    if key in monthly and month_str in monthly[key]:
        return monthly[key][month_str]

    # fall back: average this month across every location we have for the crop
    matches = [
        v[month_str]
        for k, v in monthly.items()
        if k.startswith(f"{crop}|") and month_str in v
    ]
    if matches:
        return {
            "avg_market_price": sum(m["avg_market_price"] for m in matches) / len(matches),
            "rainfall_mm": sum(m["rainfall_mm"] for m in matches) / len(matches),
            "temperature_c": sum(m["temperature_c"] for m in matches) / len(matches),
            "festival_flag": max(m["festival_flag"] for m in matches),
            "demand_kg": sum(m["demand_kg"] for m in matches) / len(matches),
        }
    return None


def demand_level(crop: str, value: float) -> str:
    levels = demand_context.get("levels", {}).get(crop)
    if not levels:
        return "Unknown"
    if value < levels["q20"]:
        return "Low"
    if value < levels["q40"]:
        return "Medium-Low"
    if value < levels["q60"]:
        return "Medium"
    if value < levels["q80"]:
        return "Medium-High"
    return "High"


def predict_demand(crop, location, month, price=None, prev_demand=None):
    """Predict demand (kg) for one crop+location in a given calendar month."""
    month = _wrap_month(int(month))
    ctx = _month_context(crop, location, month)
    prev_ctx = _month_context(crop, location, month - 1)

    if ctx is None:
        raise KeyError(
            f"No historical context for crop '{crop}'. "
            f"Known crops: {demand_context.get('crops', [])}"
        )

    row = {
        "crop": crop,
        "location": location,
        "season": season_of(month),
        "month": month,
        "avg_market_price": float(price) if price is not None else ctx["avg_market_price"],
        "prev_demand": float(prev_demand)
        if prev_demand is not None
        else (prev_ctx["demand_kg"] if prev_ctx else ctx["demand_kg"]),
        "festival_flag": 1 if month in FESTIVAL_MONTHS else int(ctx["festival_flag"]),
        "rainfall_mm": ctx["rainfall_mm"],
        "temperature_c": ctx["temperature_c"],
    }

    frame = pd.DataFrame([row])[DEMAND_FEATURES]
    predicted = float(demand_model.predict(frame)[0])
    predicted = max(0.0, round(predicted))

    baseline = round(ctx["demand_kg"])
    trend_pct = round((predicted - baseline) / baseline * 100, 1) if baseline else 0.0

    return {
        "crop": crop,
        "location": location,
        "month": month,
        "season": row["season"],
        "predicted_demand_kg": predicted,
        "historical_avg_kg": baseline,
        "trend_pct": trend_pct,
        "level": demand_level(crop, predicted),
        "assumed_market_price": round(row["avg_market_price"], 2),
    }


# ----------------------------------------------------------------------------
# Price endpoint (unchanged behaviour)
# ----------------------------------------------------------------------------
@app.route("/predict-price", methods=["POST"])
def predict_price():
    data = request.json

    input_data = pd.DataFrame([
        {
            "crop": data["crop"],
            "location": data["location"],
            "quantity": data["quantity"],
            "demand": data["demand"],
            "market_price": data["market_price"],
        }
    ])

    prediction = price_model.predict(input_data)
    recommended_price = round(float(prediction[0]), 2)

    return jsonify({"recommended_price": recommended_price})


# ----------------------------------------------------------------------------
# Demand forecasting endpoints
# ----------------------------------------------------------------------------
@app.route("/forecast-demand", methods=["POST"])
def forecast_demand():
    if demand_model is None:
        return jsonify({"error": "Demand model not trained. Run train_demand_model.py"}), 503

    data = request.get_json(force=True) or {}
    crop = data.get("crop")
    location = data.get("location", "Delhi")

    if not crop:
        return jsonify({"error": "'crop' is required"}), 400

    horizon = int(data.get("horizon", 3))
    horizon = max(1, min(horizon, 12))

    start_month = int(data.get("month", _wrap_month(date.today().month + 1)))
    price_override = data.get("market_price")
    prev_demand = data.get("prev_demand")

    try:
        forecast = []
        for step in range(horizon):
            month = _wrap_month(start_month + step)
            result = predict_demand(
                crop,
                location,
                month,
                price=price_override if step == 0 else None,
                prev_demand=prev_demand if step == 0 else None,
            )
            forecast.append(result)
    except KeyError as exc:
        return jsonify({"error": str(exc)}), 422

    return jsonify(
        {
            "crop": crop,
            "location": location,
            "horizon": horizon,
            "forecast": forecast,
        }
    )


@app.route("/demand-insights", methods=["POST"])
def demand_insights():
    if demand_model is None:
        return jsonify({"error": "Demand model not trained. Run train_demand_model.py"}), 503

    data = request.get_json(force=True) or {}
    location = data.get("location", "Delhi")
    crops = data.get("crops") or demand_context.get("crops", [])
    month = int(data.get("month", _wrap_month(date.today().month + 1)))

    insights = []
    for crop in crops:
        try:
            insights.append(predict_demand(crop, location, month))
        except KeyError:
            continue

    insights.sort(key=lambda item: item["predicted_demand_kg"], reverse=True)

    return jsonify(
        {
            "location": location,
            "month": month,
            "season": season_of(month),
            "generated_on": date.today().isoformat(),
            "insights": insights,
        }
    )


@app.route("/")
def home():
    return jsonify(
        {
            "message": "FarmLink AI ML service is running",
            "endpoints": ["/predict-price", "/forecast-demand", "/demand-insights"],
            "demand_model_loaded": demand_model is not None,
            "known_crops": demand_context.get("crops", []),
            "known_locations": demand_context.get("locations", []),
        }
    )


if __name__ == "__main__":
    app.run(port=8000, debug=True)
