import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.pipeline import Pipeline
from sklearn.metrics import mean_absolute_error
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

# Train the model
pipeline.fit(X_train, y_train)

# Test the model
predictions = pipeline.predict(X_test)

# Calculate error
mae = mean_absolute_error(y_test, predictions)

print("Model trained successfully!")
print("Mean Absolute Error:", round(mae, 2))

# Save the trained model
joblib.dump(pipeline, "price_model.pkl")

print("Model saved as price_model.pkl")