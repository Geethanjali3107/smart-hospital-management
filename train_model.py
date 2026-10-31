"""Trains the Random Forest length-of-stay model and saves it to model/.

Run:  python train_model.py
Outputs: model/los_model.joblib, model/metrics.json, model/options.json
"""
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

BASE = Path(__file__).parent
DATA_FILE = BASE / "data" / "patients.csv"
MODEL_FILE = BASE / "model" / "los_model.joblib"
METRICS_FILE = BASE / "model" / "metrics.json"
OPTIONS_FILE = BASE / "model" / "options.json"

TARGET = "length_of_stay"
NUMERIC = ["age", "num_comorbidities"]
CATEGORICAL = ["gender", "condition", "admission_type", "severity", "ward_type",
               "surgery_performed", "bmi_category"]
FEATURES = NUMERIC + CATEGORICAL
SEVERITY_ORDER = ["Mild", "Moderate", "Severe", "Critical"]
WARD_ORDER = ["General", "Semi-Private", "Private", "ICU"]
BMI_ORDER = ["Underweight", "Normal", "Overweight", "Obese"]


def build_pipeline():
    prep = ColumnTransformer(
        [("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL)],
        remainder="passthrough")
    forest = RandomForestRegressor(n_estimators=200, min_samples_leaf=3, max_features=0.6,
                                   random_state=42, n_jobs=-1)
    return Pipeline([("prep", prep), ("rf", forest)])


def train(verbose=True):
    if not DATA_FILE.exists():
        from generate_dataset import main as make_data
        make_data()
    df = pd.read_csv(DATA_FILE).dropna(subset=FEATURES + [TARGET])
    X, y = df[FEATURES], df[TARGET]
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42)

    model = build_pipeline().fit(X_tr, y_tr)
    pred = model.predict(X_te)
    cv_r2 = cross_val_score(build_pipeline(), X_tr, y_tr, cv=5, scoring="r2", n_jobs=1)

    # importance per original feature (one-hot columns are summed back together)
    names = model.named_steps["prep"].get_feature_names_out()
    imp = model.named_steps["rf"].feature_importances_
    grouped = {f: 0.0 for f in FEATURES}
    for n, v in zip(names, imp):
        n = n.split("__", 1)[1]
        feat = next((f for f in CATEGORICAL if n.startswith(f + "_")), n)
        grouped[feat] += float(v)

    metrics = {
        "algorithm": "Random Forest Regressor",
        "n_estimators": 200,
        "train_records": int(len(X_tr)),
        "test_records": int(len(X_te)),
        "mae_days": round(float(mean_absolute_error(y_te, pred)), 2),
        "rmse_days": round(float(np.sqrt(mean_squared_error(y_te, pred))), 2),
        "r2": round(float(r2_score(y_te, pred)), 3),
        "cv_r2_mean": round(float(cv_r2.mean()), 3),
        "feature_importance": dict(sorted(((k, round(v, 4)) for k, v in grouped.items()),
                                          key=lambda kv: -kv[1])),
    }
    options = {
        "gender": sorted(df.gender.unique()),
        "condition": sorted(df.condition.unique()),
        "admission_type": sorted(df.admission_type.unique()),
        "severity": [s for s in SEVERITY_ORDER if s in set(df.severity)],
        "ward_type": [w for w in WARD_ORDER if w in set(df.ward_type)],
        "surgery_performed": ["No", "Yes"],
        "bmi_category": [b for b in BMI_ORDER if b in set(df.bmi_category)],
        "age": {"min": 0, "max": 100},
        "num_comorbidities": {"min": 0, "max": 5},
    }
    MODEL_FILE.parent.mkdir(exist_ok=True)
    joblib.dump(model, MODEL_FILE, compress=3)
    METRICS_FILE.write_text(json.dumps(metrics, indent=2))
    OPTIONS_FILE.write_text(json.dumps(options, indent=2))
    if verbose:
        print(f"Trained on {len(X_tr)} records, tested on {len(X_te)}")
        print(f"MAE {metrics['mae_days']} days | RMSE {metrics['rmse_days']} | "
              f"R2 {metrics['r2']} | 5-fold CV R2 {metrics['cv_r2_mean']}")
        print("Feature importance:", metrics["feature_importance"])
    return model, metrics, options


if __name__ == "__main__":
    train()
