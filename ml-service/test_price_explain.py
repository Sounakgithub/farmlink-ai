"""
Tests for the Explainable-AI layer on the price advisor.

Plain Python (the project has no pytest) - run it like the Node smoke tests:

    python app.py            # in one terminal
    python test_price_explain.py

It checks two layers:
  * the SHAP logic directly against the loaded pipeline (no server needed)
  * the live POST /predict-price endpoint, if it is reachable

Validates:
  1. price prediction still works
  2. a SHAP explanation is returned
  3. SHAP contributions reconstruct the real model output (base + sum ~= pred)
  4. feature names map back to the 5 user-facing features, correctly
  5. increase / decrease / neutral directions match the signed contributions
  6. existing /predict-price consumers still see `recommended_price`
  7. a SHAP failure does not break normal prediction
"""

import io
import json
import os
import sys
import urllib.error
import urllib.request

# make sure prints of rupee symbols don't crash on a cp1252 console
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

import joblib  # noqa: E402
import pandas as pd  # noqa: E402

from price_explainer import (  # noqa: E402
    ORIGINAL_FEATURES,
    PriceExplainer,
    build_explainer,
    explain_prediction,
)

ENDPOINT = os.environ.get("ML_URL", "http://localhost:8000") + "/predict-price"
TOL = 0.05  # rupees/kg - SHAP additivity + rounding slack

passed = 0
failed = 0


def check(label, ok, detail=""):
    global passed, failed
    mark = "PASS" if ok else "FAIL"
    if ok:
        passed += 1
    else:
        failed += 1
    line = f"  {mark}  {label}"
    if detail and not ok:
        line += f"  ->  {detail}"
    print(line)


def post(payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        ENDPOINT, data=body, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}")
    except urllib.error.URLError:
        return None, None


# ---------------------------------------------------------------------------
# Layer 1 - the explainer against the real pipeline
# ---------------------------------------------------------------------------
print("\nLayer 1: SHAP explainer vs the loaded RandomForest pipeline\n")

pipeline = joblib.load(os.path.join(BASE_DIR, "price_model.pkl"))
explainer = build_explainer(pipeline)
check("explainer builds from the existing price_model.pkl", explainer is not None)

CASES = [
    {"crop": "Tomato", "location": "Delhi", "quantity": 500, "demand": 8, "market_price": 26},
    {"crop": "Onion", "location": "Mumbai", "quantity": 100, "demand": 9, "market_price": 30},
    {"crop": "Potato", "location": "Pune", "quantity": 700, "demand": 4, "market_price": 20},
    {"crop": "Spinach", "location": "Delhi", "quantity": 50, "demand": 9, "market_price": 20},
    {"crop": "Cabbage", "location": "Mumbai", "quantity": 400, "demand": 7, "market_price": 20},
]

for case in CASES:
    tag = f"{case['crop']}/{case['location']}"
    model_price = round(float(pipeline.predict(pd.DataFrame([case]))[0]), 2)
    result = explainer.explain(case)

    check(f"[{tag}] explanation returned", result is not None)
    if result is None:
        continue

    # (4) feature names are exactly the 5 user-facing ones
    names = [f["feature"] for f in result["features"]]
    check(
        f"[{tag}] features are the 5 original inputs",
        sorted(names) == sorted(ORIGINAL_FEATURES),
        detail=str(names),
    )

    # (3) additivity: base + sum(contributions) ~= model output
    total = result["base_value"] + sum(f["impact"] for f in result["features"])
    check(
        f"[{tag}] base + SHAP contributions reconstruct the model price "
        f"({result['base_value']} + Sigma = {round(total, 2)} ~= {result['predicted_value']})",
        abs(total - result["predicted_value"]) <= TOL,
        detail=f"delta={total - result['predicted_value']:.4f}",
    )

    # explanation must match the price the rest of the service computes
    check(
        f"[{tag}] predicted_value matches pipeline.predict ({model_price})",
        abs(result["predicted_value"] - model_price) <= TOL,
        detail=f"{result['predicted_value']} vs {model_price}",
    )

    # (5) direction matches the sign of the contribution
    ok_dir = all(
        (f["impact"] > TOL and f["direction"] == "increase")
        or (f["impact"] < -TOL and f["direction"] == "decrease")
        or (abs(f["impact"]) <= TOL and f["direction"] == "neutral")
        for f in result["features"]
    )
    check(f"[{tag}] increase/decrease/neutral match the signed contributions", ok_dir)

    # sorted by absolute impact, descending
    abs_impacts = [f["abs_impact"] for f in result["features"]]
    check(f"[{tag}] features sorted by influence", abs_impacts == sorted(abs_impacts, reverse=True))

    # statements are farmer-friendly: no raw SHAP jargon
    joined = " ".join(f["statement"] for f in result["features"]).lower()
    check(
        f"[{tag}] statements avoid technical SHAP wording",
        "shap" not in joined and "coefficient" not in joined and "vector" not in joined,
    )
    check(
        f"[{tag}] statements say 'contributed', not 'caused'",
        "caus" not in joined,
    )


# a second explainer instance must be deterministic
r1 = PriceExplainer(pipeline).explain(CASES[0])
r2 = PriceExplainer(pipeline).explain(CASES[0])
check(
    "explanations are deterministic across explainer instances",
    [f["impact"] for f in r1["features"]] == [f["impact"] for f in r2["features"]],
)


# ---------------------------------------------------------------------------
# Layer 1b - SHAP failure must not break prediction
# ---------------------------------------------------------------------------
print("\nLayer 1b: graceful degradation\n")

# feed the explainer something it cannot transform
broken = explainer.explain({"crop": "Tomato", "location": "Delhi", "quantity": None,
                            "demand": 8, "market_price": 26})
check("explainer returns None on bad input (does not raise)", broken is None)

# simulate 'shap not installed': explain_prediction must no-op, not throw
import price_explainer as pe_mod  # noqa: E402

_saved = pe_mod._explainer
pe_mod._explainer = None
try:
    check("explain_prediction() returns None when no explainer is loaded",
          explain_prediction(CASES[0]) is None)
finally:
    pe_mod._explainer = _saved


# ---------------------------------------------------------------------------
# Layer 2 - the live HTTP endpoint
# ---------------------------------------------------------------------------
print("\nLayer 2: POST /predict-price endpoint\n")

status, body = post(CASES[0])
if status is None:
    print("  SKIP  ML service not running on", ENDPOINT)
else:
    # (1) + (6) price still works, old field name intact
    check("endpoint returns 200", status == 200, detail=str(body))
    check("response still has `recommended_price`", "recommended_price" in (body or {}))
    check(
        "recommended_price is a number",
        isinstance(body.get("recommended_price"), (int, float)),
    )

    # (2) explanation present and well-formed
    expl = body.get("explanation")
    check("response has an `explanation` block", expl is not None, detail=str(body))
    if expl:
        check("explanation.base_value present", "base_value" in expl)
        check("explanation has 5 feature rows", len(expl.get("features", [])) == 5)

        # (3) endpoint-level additivity sanity check
        total = expl["base_value"] + sum(f["impact"] for f in expl["features"])
        check(
            f"endpoint: base + contributions ~= recommended_price "
            f"({round(total, 2)} ~= {body['recommended_price']})",
            abs(total - body["recommended_price"]) <= TOL + 0.5,  # +rounding of the price itself
            detail=f"delta={total - body['recommended_price']:.3f}",
        )

    # several crops / locations / quantities
    varied_ok = True
    for case in CASES[1:]:
        s, b = post(case)
        varied_ok &= (
            s == 200
            and isinstance(b.get("recommended_price"), (int, float))
            and b.get("explanation") is not None
        )
    check("works across multiple crops / locations / quantities", varied_ok)

    # (7) missing field -> 400 with a clear error, never a 500 / crash
    s_missing, b_missing = post({"crop": "Tomato", "location": "Delhi", "quantity": 500})
    check(
        "missing input -> 400 (not a crash)",
        s_missing == 400 and "error" in (b_missing or {}),
        detail=f"{s_missing} {b_missing}",
    )

    # unknown crop -> OneHotEncoder(handle_unknown='ignore') copes; still priced + explained
    s_unknown, b_unknown = post(
        {"crop": "Dragonfruit", "location": "Atlantis", "quantity": 300,
         "demand": 6, "market_price": 40}
    )
    check(
        "unknown crop/location still returns a price",
        s_unknown == 200 and isinstance(b_unknown.get("recommended_price"), (int, float)),
        detail=f"{s_unknown} {b_unknown}",
    )


print(f"\n{passed} passed, {failed} failed\n")
sys.exit(1 if failed else 0)
