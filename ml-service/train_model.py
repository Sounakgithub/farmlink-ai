"""Train the FarmLink price advisor.

    python generate_price_dataset.py    # writes dataset.csv (synthetic)
    python train_model.py               # writes price_model.pkl

The model and the preprocessing are unchanged - OneHotEncoder on the two text
columns, passthrough on the three numeric ones, RandomForestRegressor(100).
What changed is the data underneath it: dataset.csv went from 26 hand-written
rows (6 crops, 3 cities) to 3,600 generated ones covering all 10 crops and 8
cities the UI offers. See generate_price_dataset.py.

NOTE: dataset.csv is SYNTHETIC. The metrics below say how well the forest
recovered the generator's own rules - not how well it would price a real
harvest. See the README's "Explainable AI" and dataset sections.
"""

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.pipeline import Pipeline
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import joblib

# Load dataset
data = pd.read_csv("dataset.csv")

# Features used for prediction
X = data[
    [
        "crop",
        "location",
        "quantity",
        "demand",
        "market_price",
    ]
]

# Target value we want to predict
y = data["recommended_price"]

# Columns containing text
categorical_features = ["crop", "location"]

# Columns containing numbers
numerical_features = [
    "quantity",
    "demand",
    "market_price",
]

# Convert text columns into numbers
preprocessor = ColumnTransformer(
    transformers=[
        (
            "categorical",
            OneHotEncoder(handle_unknown="ignore"),
            categorical_features,
        ),
        (
            "numerical",
            "passthrough",
            numerical_features,
        ),
    ]
)

# Create the ML model
model = RandomForestRegressor(
    n_estimators=100,
    random_state=42,
)

# Combine preprocessing + model
pipeline = Pipeline(
    steps=[
        ("preprocessor", preprocessor),
        ("model", model),
    ]
)

# Split dataset into training and testing data
X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.2,
    random_state=42,
)

print("Training data")
print("-" * 62)
print(f"  rows            {len(data)}  ({len(X_train)} train / {len(X_test)} test)")
print(f"  crops           {data['crop'].nunique()}")
print(f"  locations       {data['location'].nunique()}")
print(f"  target range    {y.min():.2f} - {y.max():.2f} per kg")

# Train the model
pipeline.fit(X_train, y_train)

# Test the model
predictions = pipeline.predict(X_test)

mae = mean_absolute_error(y_test, predictions)
rmse = float(np.sqrt(mean_squared_error(y_test, predictions)))
r2 = r2_score(y_test, predictions)

print("\nHeld-out performance (20% test split)")
print("-" * 62)
print(f"  MAE             {mae:.3f} per kg")
print(f"  RMSE            {rmse:.3f} per kg")
print(f"  R2              {r2:.4f}")

# A naive "just quote the market price" baseline, for context: if the model
# cannot beat this, it has not learned anything the farmer didn't already know.
baseline_mae = mean_absolute_error(y_test, X_test["market_price"])
print(f"  (baseline: quoting market_price unchanged -> MAE {baseline_mae:.3f})")

# Which features the forest actually leaned on. One-hot columns are summed
# back into the original feature so this lines up with what the SHAP layer
# reports to the farmer.
transformed_names = pipeline.named_steps["preprocessor"].get_feature_names_out()
importances = pipeline.named_steps["model"].feature_importances_

grouped = {}
for name, importance in zip(transformed_names, importances):
    stripped = name.split("__", 1)[-1]
    owner = next(
        (
            feature
            for feature in categorical_features + numerical_features
            if stripped == feature or stripped.startswith(feature + "_")
        ),
        stripped,
    )
    grouped[owner] = grouped.get(owner, 0.0) + float(importance)

print("\nFeature importance (impurity-based, one-hots summed per feature)")
print("-" * 62)
for feature, importance in sorted(grouped.items(), key=lambda kv: kv[1], reverse=True):
    bar = "#" * max(1, round(importance * 40))
    print(f"  {feature:<14} {importance:6.3f}  {bar}")

# Save the trained model
joblib.dump(pipeline, "price_model.pkl")

print("\nModel saved as price_model.pkl")
print("Reminder: trained on SYNTHETIC data - see generate_price_dataset.py")
