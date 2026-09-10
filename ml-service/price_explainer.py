"""
Explainable AI for the FarmLink price advisor.

This module explains the EXISTING trained Random Forest pipeline
(`price_model.pkl`) with SHAP. Nothing here trains, replaces or approximates
the model - it reads the pipeline that `train_model.py` produced and asks SHAP
why it predicted a particular price.

The pipeline is:

    Pipeline(
        preprocessor = ColumnTransformer(
            "categorical" : OneHotEncoder(handle_unknown="ignore")  on [crop, location]
            "numerical"   : passthrough                             on [quantity, demand, market_price]
        ),
        model = RandomForestRegressor(...)
    )

SHAP's TreeExplainer only understands the tree model, so it is given the
*transformed* feature matrix (12 columns: 6 crop one-hots + 3 location one-hots
+ 3 numeric passthroughs). The one-hot columns for `crop` and `location` are
then summed back into their single original feature, so a farmer sees
"Crop" / "Location" rather than "crop_Tomato".

Design notes
------------
* The TreeExplainer is built ONCE (at import) and reused for every request.
* A single prediction costs one `preprocessor.transform` + one
  `explainer.shap_values` on a 1-row / 12-column matrix. No retraining, ever.
* `shap_values(..., check_additivity=True)` (SHAP's default) guarantees that
  base_value + sum(contributions) reconstructs the model output; if the feed
  were wrong it would raise, and we return `None` instead of a wrong answer.
* Every public entry point is wrapped so that if SHAP is missing or anything
  fails, the caller still gets the price and `explanation = None`.
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

log = logging.getLogger("farmlink.price_explainer")

# The 5 user-facing features, in the order the model was trained on.
ORIGINAL_FEATURES = ["crop", "location", "quantity", "demand", "market_price"]
NUMERIC_FEATURES = {"quantity", "demand", "market_price"}

# Contributions smaller than this (in rupees/kg) are treated as "no real effect".
NEUTRAL_THRESHOLD = 0.05

FEATURE_LABELS = {
    "crop": "Crop type",
    "location": "Location",
    "quantity": "Available quantity",
    "demand": "Demand level",
    "market_price": "Current market price",
}


def _round_money(value: float) -> float:
    return round(float(value), 2)


def _direction(impact: float) -> str:
    """Direction of one contribution.

    Takes the ALREADY-ROUNDED impact (the number the API publishes), so the
    `impact` and `direction` a caller sees can never disagree at the boundary.
    """
    if impact > NEUTRAL_THRESHOLD:
        return "increase"
    if impact < -NEUTRAL_THRESHOLD:
        return "decrease"
    return "neutral"


def _statement(feature: str, value: Any, impact: float, direction: str) -> str:
    """A plain-language sentence about one feature's SHAP contribution.

    Wording deliberately says "contributed to the model's prediction", never
    "caused" - SHAP explains the model, not the real world.
    """
    rupees = abs(round(impact, 1))
    if direction == "neutral":
        return (
            f"{FEATURE_LABELS[feature]} had little effect on the model's "
            f"prediction this time."
        )

    updown = "upward" if direction == "increase" else "downward"

    if feature == "crop":
        lead = f"Choosing {value}"
    elif feature == "location":
        lead = f"Selling in {value}"
    elif feature == "quantity":
        lead = f"Offering {value} kg"
    elif feature == "demand":
        lead = f"A demand level of {value} out of 10"
    elif feature == "market_price":
        lead = f"The current market price of ₹{value}/kg"
    else:  # pragma: no cover - future features
        lead = FEATURE_LABELS.get(feature, feature)

    return (
        f"{lead} contributed about ₹{rupees}/kg {updown} to the model's "
        f"predicted price."
    )


class PriceExplainer:
    """Wraps a fitted price pipeline with a reusable SHAP TreeExplainer."""

    def __init__(self, pipeline):
        import shap  # imported here so a missing SHAP only breaks explanations

        self.pipeline = pipeline
        self.preprocessor = pipeline.named_steps["preprocessor"]
        self.model = pipeline.named_steps["model"]

        # transformed-column -> original user-facing feature
        self._column_owner = self._map_columns_to_original(self.preprocessor)
        self._n_transformed = len(self._column_owner)

        self.explainer = shap.TreeExplainer(self.model)

        # expected_value is the model's average output over the training data -
        # the SHAP "base value" every explanation starts from.
        self.base_value = float(np.ravel(self.explainer.expected_value)[0])

        log.info(
            "PriceExplainer ready: %d transformed columns, base value %.3f",
            self._n_transformed,
            self.base_value,
        )

    # -- setup -----------------------------------------------------------------
    @staticmethod
    def _map_columns_to_original(preprocessor) -> list[str]:
        """For every transformed column, record which of the 5 original
        user-facing features it came from.

        Works off the fitted ColumnTransformer's structure - `output_indices_`
        (the output slice each sub-transformer owns) and `categories_` (how
        many one-hot columns each input column expanded to) - rather than
        string-parsing feature names, so it stays correct even if a crop or
        location label contains an underscore. A name-parsing pass only fills
        anything the structural pass could not resolve.
        """
        transformed_names = list(preprocessor.get_feature_names_out())
        owners: list[str | None] = [None] * len(transformed_names)
        output_indices = getattr(preprocessor, "output_indices_", {})

        for name, transformer, columns in preprocessor.transformers_:
            if name == "remainder":
                continue
            output_slice = output_indices.get(name)
            if output_slice is None:
                continue
            out_positions = list(range(output_slice.start, output_slice.stop))
            if not out_positions:
                continue

            categories = getattr(transformer, "categories_", None)
            if categories is not None:
                # OneHotEncoder: columns[i] expands to len(categories[i]) outputs
                cursor = 0
                for original_col, cats in zip(columns, categories):
                    for _ in range(len(cats)):
                        if cursor < len(out_positions):
                            owners[out_positions[cursor]] = original_col
                            cursor += 1
                while cursor < len(out_positions):  # infrequent / trailing cols
                    owners[out_positions[cursor]] = columns[-1]
                    cursor += 1
            elif len(out_positions) == len(columns):
                # passthrough / any 1-to-1 transformer: same order as input
                for out_pos, original_col in zip(out_positions, columns):
                    owners[out_pos] = original_col

        # fallback: resolve anything left by matching the transformed name
        for index, owner in enumerate(owners):
            if owner is not None:
                continue
            stripped = transformed_names[index].split("__", 1)[-1]
            owners[index] = next(
                (
                    feature
                    for feature in ORIGINAL_FEATURES
                    if stripped == feature or stripped.startswith(feature + "_")
                ),
                ORIGINAL_FEATURES[-1],
            )

        return owners  # type: ignore[return-value]

    # -- explanation ---------------------------------------------------------
    def explain(self, row: dict) -> dict | None:
        """Return the SHAP explanation for one prediction, or None on any error.

        `row` is the raw user input: {crop, location, quantity, demand,
        market_price}. The prediction is taken from the SAME pipeline the rest
        of the service uses, so the explanation always matches the price shown.
        """
        try:
            import pandas as pd

            # Reject missing / blank inputs up front. Left alone they become
            # NaN in the passthrough columns, and the tree model would happily
            # produce a number - giving the farmer a confident explanation of
            # a value they never entered.
            missing = [
                feature
                for feature in ORIGINAL_FEATURES
                if row.get(feature) is None or row.get(feature) == ""
            ]
            if missing:
                raise ValueError(f"missing input value(s): {', '.join(missing)}")

            values = {k: row[k] for k in ORIGINAL_FEATURES}
            for feature in NUMERIC_FEATURES:
                # a non-numeric quantity/demand/market_price is a bad request,
                # not something to explain
                values[feature] = float(values[feature])

            frame = pd.DataFrame([values])

            transformed = self.preprocessor.transform(frame)
            if hasattr(transformed, "toarray"):
                transformed = transformed.toarray()
            transformed = np.asarray(transformed, dtype=float)

            if transformed.shape[1] != self._n_transformed:
                raise ValueError(
                    f"expected {self._n_transformed} transformed columns, "
                    f"got {transformed.shape[1]}"
                )

            # check_additivity=True (SHAP default) makes SHAP verify that
            # base + sum(values) == model output, raising otherwise.
            shap_values = self.explainer.shap_values(transformed)
            shap_row = np.asarray(shap_values)
            if shap_row.ndim == 3:  # (outputs, samples, features)
                shap_row = shap_row[0]
            shap_row = shap_row[0]  # first (only) sample -> (n_transformed,)

            model_output = float(self.model.predict(transformed)[0])

            # -- collapse one-hot columns back to the 5 originals -------------
            grouped = {feature: 0.0 for feature in ORIGINAL_FEATURES}
            for contribution, owner in zip(shap_row, self._column_owner):
                grouped[owner] += float(contribution)

            contributions_sum = sum(grouped.values())
            reconstructed = self.base_value + contributions_sum

            # Sanity check: the grouped contributions must still reconstruct
            # the model output (grouping is just addition, so this always holds
            # unless something upstream is broken).
            if abs(reconstructed - model_output) > 1e-6:
                raise ValueError(
                    f"SHAP additivity broken: base({self.base_value:.4f}) + "
                    f"contributions({contributions_sum:.4f}) = "
                    f"{reconstructed:.4f} != model({model_output:.4f})"
                )

            features = []
            for feature in ORIGINAL_FEATURES:
                # round first, then derive the direction from the rounded
                # number, so impact and direction always agree
                impact = _round_money(grouped[feature])
                direction = _direction(impact)
                raw_value = row[feature]
                display_value = (
                    _coerce_number(raw_value)
                    if feature in NUMERIC_FEATURES
                    else raw_value
                )
                features.append(
                    {
                        "feature": feature,
                        "label": FEATURE_LABELS[feature],
                        "value": display_value,
                        "impact": impact,
                        "abs_impact": _round_money(abs(impact)),
                        "direction": direction,
                        "statement": _statement(
                            feature, display_value, impact, direction
                        ),
                    }
                )

            # most influential first
            features.sort(key=lambda item: item["abs_impact"], reverse=True)

            return {
                "method": "shap.TreeExplainer",
                "base_value": _round_money(self.base_value),
                "predicted_value": _round_money(model_output),
                "reconstructed_value": _round_money(reconstructed),
                "features": features,
            }

        except Exception:  # noqa: BLE001 - explanation must never break pricing
            log.exception("SHAP explanation failed; returning price without it")
            return None


def _coerce_number(value):
    try:
        number = float(value)
        return int(number) if number.is_integer() else round(number, 2)
    except (TypeError, ValueError):
        return value


# ---------------------------------------------------------------------------
# Module-level singleton, built once from the already-loaded price pipeline.
# ---------------------------------------------------------------------------
_explainer: PriceExplainer | None = None


def build_explainer(pipeline) -> PriceExplainer | None:
    """Create and cache the singleton explainer. Safe to call at startup."""
    global _explainer
    try:
        _explainer = PriceExplainer(pipeline)
    except Exception:  # noqa: BLE001
        log.exception(
            "Could not build the SHAP explainer (is `shap` installed?). "
            "Price predictions will work; explanations will be null."
        )
        _explainer = None
    return _explainer


def explain_prediction(row: dict) -> dict | None:
    """Public entry point used by the Flask app. Never raises."""
    if _explainer is None:
        return None
    return _explainer.explain(row)
