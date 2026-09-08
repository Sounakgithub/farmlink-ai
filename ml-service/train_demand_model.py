"""
Train the demand-forecasting model.

Reads demand_dataset.csv (run generate_demand_data.py first if it is missing),
trains a gradient-boosted regression pipeline, and saves:

  demand_model.pkl    - the fitted sklearn pipeline
  demand_context.json - seasonal context per crop+location used at inference
                        time to build the feature row for a future month
"""

import json
import os
import subprocess
import sys

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
import joblib

DATASET = "demand_dataset.csv"
MODEL_FILE = "demand_model.pkl"
CONTEXT_FILE = "demand_context.json"

FEATURES = [
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
CATEGORICAL = ["crop", "location", "season"]
NUMERIC = [
    "month",
    "avg_market_price",
    "prev_demand",
    "festival_flag",
    "rainfall_mm",
    "temperature_c",
]
TARGET = "demand_kg"


def load_dataset() -> pd.DataFrame:
    if not os.path.exists(DATASET):
        print(f"{DATASET} not found - generating it...")
        subprocess.run([sys.executable, "generate_demand_data.py"], check=True)
    return pd.read_csv(DATASET)


def build_context(df: pd.DataFrame) -> dict:
    """Average each month's conditions per crop+location, plus demand quantiles
    per crop so the API can label a prediction Low .. High."""
    monthly = {}
    for (crop, location), group in df.groupby(["crop", "location"]):
        key = f"{crop}|{location}"
        by_month = {}
        for month, mg in group.groupby("month"):
            by_month[str(int(month))] = dict(
                avg_market_price=round(float(mg["avg_market_price"].mean()), 2),
                rainfall_mm=round(float(mg["rainfall_mm"].mean()), 1),
                temperature_c=round(float(mg["temperature_c"].mean()), 1),
                festival_flag=int(mg["festival_flag"].max()),
                demand_kg=round(float(mg["demand_kg"].mean())),
            )
        monthly[key] = by_month

    levels = {}
    for crop, group in df.groupby("crop"):
        q = group["demand_kg"].quantile([0.2, 0.4, 0.6, 0.8])
        levels[crop] = dict(
            q20=round(float(q.loc[0.2])),
            q40=round(float(q.loc[0.4])),
            q60=round(float(q.loc[0.6])),
            q80=round(float(q.loc[0.8])),
        )

    return dict(
        crops=sorted(df["crop"].unique().tolist()),
        locations=sorted(df["location"].unique().tolist()),
        monthly=monthly,
        levels=levels,
    )


def main() -> None:
    df = load_dataset()

    X = df[FEATURES]
    y = df[TARGET]

    preprocessor = ColumnTransformer(
        transformers=[
            ("categorical", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL),
            ("numerical", "passthrough", NUMERIC),
        ]
    )

    model = GradientBoostingRegressor(
        n_estimators=400,
        learning_rate=0.05,
        max_depth=3,
        subsample=0.9,
        random_state=42,
    )

    pipeline = Pipeline(steps=[("preprocessor", preprocessor), ("model", model)])

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    pipeline.fit(X_train, y_train)
    predictions = pipeline.predict(X_test)

    mae = mean_absolute_error(y_test, predictions)
    r2 = r2_score(y_test, predictions)
    mean_demand = float(y.mean())

    print("Demand model trained successfully!")
    print(f"  Samples          : {len(df)}")
    print(f"  Mean Absolute Err : {mae:.1f} kg  ({mae / mean_demand * 100:.1f}% of mean demand)")
    print(f"  R2 score          : {r2:.3f}")

    joblib.dump(pipeline, MODEL_FILE)
    print(f"  Saved {MODEL_FILE}")

    context = build_context(df)
    with open(CONTEXT_FILE, "w") as f:
        json.dump(context, f, indent=2)
    print(f"  Saved {CONTEXT_FILE}")


if __name__ == "__main__":
    main()
