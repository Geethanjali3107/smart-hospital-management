"""Smart Hospital Management - Flask application.

Run:  python app.py      then open http://127.0.0.1:5000
"""
import json
import logging
import math
import os
import re
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

BASE = Path(__file__).parent
DATA_FILE = BASE / "data" / "patients.csv"
MODEL_FILE = BASE / "model" / "los_model.joblib"
METRICS_FILE = BASE / "model" / "metrics.json"
OPTIONS_FILE = BASE / "model" / "options.json"

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("smart-hospital")

AGE_BINS = [-1, 12, 18, 30, 45, 60, 75, 200]
AGE_LABELS = ["0-12", "13-18", "19-30", "31-45", "46-60", "61-75", "76+"]
FEATURES = ["age", "num_comorbidities", "gender", "condition", "admission_type",
            "severity", "ward_type", "surgery_performed", "bmi_category"]
SORTABLE = {"patient_id", "name", "age", "condition", "department", "admission_date",
            "length_of_stay", "total_cost", "severity"}
FILTERS = ["condition", "department", "gender", "severity", "admission_type", "age_group"]
ID_PATTERN = re.compile(r"^SHM-\d{4}-\d{5}$")


# --------------------------------------------------------------------------- helpers
def format_inr(value, decimals=0):
    """Indian digit grouping with the rupee sign, e.g. 1234567 -> ₹12,34,567."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "—"
    negative = value < 0
    whole, _, frac = f"{abs(float(value)):.{decimals}f}".partition(".")
    if len(whole) > 3:
        head, tail, groups = whole[:-3], whole[-3:], []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return f"{'-' if negative else ''}₹{whole}{('.' + frac) if frac else ''}"


app.jinja_env.filters["inr"] = format_inr


def load_data():
    if not DATA_FILE.exists():
        from generate_dataset import main as make_data
        make_data()
    df = pd.read_csv(DATA_FILE, parse_dates=["admission_date", "discharge_date"])
    df["age_group"] = pd.cut(df["age"], AGE_BINS, labels=AGE_LABELS).astype(str)
    return df


def load_model():
    """Load the trained pipeline; retrain automatically if it is missing or incompatible."""
    try:
        model = joblib.load(MODEL_FILE)
        metrics = json.loads(METRICS_FILE.read_text())
        options = json.loads(OPTIONS_FILE.read_text())
        return model, metrics, options
    except Exception as exc:  # missing file, different scikit-learn version, ...
        log.warning("Could not load saved model (%s). Retraining...", exc)
        from train_model import train
        return train(verbose=False)


DF = load_data()
MODEL, METRICS, OPTIONS = load_model()
log.info("Loaded %d patient records and the length-of-stay model", len(DF))


def num(x, nd=1):
    return None if x is None or pd.isna(x) else round(float(x), nd)


def record(row):
    r = row.to_dict()
    r["admission_date"] = r["admission_date"].strftime("%Y-%m-%d")
    r["discharge_date"] = r["discharge_date"].strftime("%Y-%m-%d")
    for k, v in r.items():
        if isinstance(v, (np.integer,)):
            r[k] = int(v)
    return r


def group_summary(col, order=None):
    g = DF.groupby(col).agg(count=("patient_id", "count"), avg_los=("length_of_stay", "mean"),
                            avg_cost=("total_cost", "mean"))
    g = g.reindex(order).dropna() if order else g.sort_values("count", ascending=False)
    return [{"name": str(i), "count": int(r["count"]), "avg_los": num(r["avg_los"]),
             "avg_cost": num(r["avg_cost"], 0)} for i, r in g.iterrows()]


def compute_stats(df=DF):
    total = len(df)
    last = df["admission_date"].max()
    recent = df[df["admission_date"] > last - pd.Timedelta(days=30)]
    prev = df[(df["admission_date"] <= last - pd.Timedelta(days=30)) &
              (df["admission_date"] > last - pd.Timedelta(days=60))]
    return {
        "total_patients": total,
        "avg_los": num(df["length_of_stay"].mean()),
        "avg_cost": num(df["total_cost"].mean(), 0),          # mean of every patient's bill
        "median_cost": num(df["total_cost"].median(), 0),
        "total_revenue": int(df["total_cost"].sum()),
        "avg_cost_per_day": num(df["total_cost"].sum() / df["length_of_stay"].sum(), 0),
        "emergency_pct": num((df["admission_type"] == "Emergency").mean() * 100),
        "icu_pct": num((df["ward_type"] == "ICU").mean() * 100),
        "recovery_pct": num(df["outcome"].isin(["Recovered", "Improved"]).mean() * 100),
        "surgery_pct": num((df["surgery_performed"] == "Yes").mean() * 100),
        "recent_admissions": int(len(recent)),
        "previous_admissions": int(len(prev)),
        "departments": int(df["department"].nunique()),
        "conditions": int(df["condition"].nunique()),
        "latest_admission": last.strftime("%d %b %Y"),
    }


@app.context_processor
def inject_globals():
    return {"records_through": DF["discharge_date"].max().strftime("%d %b %Y")}


# --------------------------------------------------------------------------- pages
@app.route("/")
def dashboard():
    return render_template("dashboard.html", stats=compute_stats(), page="dashboard")


@app.route("/analytics")
def analytics():
    return render_template("analytics.html", page="analytics")


@app.route("/patients")
def patients():
    return render_template("patients.html", page="patients", options=OPTIONS,
                           departments=sorted(DF.department.unique()), age_groups=AGE_LABELS)


@app.route("/predict")
def predict_page():
    return render_template("predict.html", page="predict", options=OPTIONS, metrics=METRICS)


# --------------------------------------------------------------------------- API
@app.get("/api/health")
def health():
    return jsonify(status="ok", patients=len(DF), model="loaded")


@app.get("/api/options")
def api_options():
    return jsonify(OPTIONS)


@app.get("/api/stats")
def api_stats():
    return jsonify(compute_stats())


@app.get("/api/dashboard")
def api_dashboard():
    monthly = (DF.groupby(DF["admission_date"].dt.to_period("M"))
                 .agg(count=("patient_id", "count"), avg_cost=("total_cost", "mean")).tail(12))
    recent = DF.sort_values(["admission_date", "patient_id"], ascending=False).head(8)
    return jsonify({
        "monthly": [{"month": p.strftime("%b %Y"), "count": int(r["count"]),
                     "avg_cost": num(r["avg_cost"], 0)} for p, r in monthly.iterrows()],
        "departments": group_summary("department"),
        "admission_types": group_summary("admission_type"),
        "top_conditions": group_summary("condition")[:5],
        "recent": [record(r) for _, r in recent.iterrows()],
    })


@app.get("/api/analytics")
def api_analytics():
    los_bins = [0, 2, 4, 6, 8, 10, 14, 20, 200]
    los_labels = ["1-2", "3-4", "5-6", "7-8", "9-10", "11-14", "15-20", "21+"]
    los_dist = pd.cut(DF["length_of_stay"], los_bins, labels=los_labels).value_counts().reindex(los_labels)

    cost_bins = [0, 25000, 50000, 100000, 200000, 300000, 500000, float("inf")]
    cost_labels = ["< ₹25K", "₹25K–50K", "₹50K–1L", "₹1L–2L", "₹2L–3L", "₹3L–5L", "₹5L+"]
    cost_dist = pd.cut(DF["total_cost"], cost_bins, labels=cost_labels, right=False).value_counts().reindex(cost_labels)

    monthly = (DF.groupby(DF["admission_date"].dt.to_period("M"))
                 .agg(count=("patient_id", "count"), avg_cost=("total_cost", "mean")))
    return jsonify({
        "conditions": group_summary("condition"),
        "age_groups": group_summary("age_group", AGE_LABELS),
        "severity": group_summary("severity", ["Mild", "Moderate", "Severe", "Critical"]),
        "wards": group_summary("ward_type", ["General", "Semi-Private", "Private", "ICU"]),
        "departments": group_summary("department"),
        "los_distribution": [{"name": k, "count": int(v)} for k, v in los_dist.items()],
        "cost_distribution": [{"name": k, "count": int(v)} for k, v in cost_dist.items()],
        "monthly": [{"month": p.strftime("%b %Y"), "count": int(r["count"]),
                     "avg_cost": num(r["avg_cost"], 0)} for p, r in monthly.iterrows()],
        "model": METRICS,
    })


@app.get("/api/patients")
def api_patients():
    q = request.args.get("q", "").strip()
    sort = request.args.get("sort", "admission_date")
    order = request.args.get("order", "desc")
    if sort not in SORTABLE:
        return jsonify(error=f"Cannot sort by '{sort}'.", allowed=sorted(SORTABLE)), 400
    if order not in ("asc", "desc"):
        return jsonify(error="order must be 'asc' or 'desc'."), 400
    try:
        page = max(int(request.args.get("page", 1)), 1)
        per_page = min(max(int(request.args.get("per_page", 15)), 1), 100)
    except ValueError:
        return jsonify(error="page and per_page must be whole numbers."), 400

    df = DF
    if q:
        hay = (df["patient_id"] + " " + df["name"] + " " + df["condition"] + " " + df["department"])
        df = df[hay.str.contains(q, case=False, regex=False, na=False)]
    for col in FILTERS:
        val = request.args.get(col, "").strip()
        if val:
            df = df[df[col] == val]

    total = len(df)
    pages = max(math.ceil(total / per_page), 1)
    page = min(page, pages)
    df = df.sort_values([sort, "patient_id"], ascending=[order == "asc", True], kind="stable")
    chunk = df.iloc[(page - 1) * per_page: page * per_page]
    return jsonify({
        "patients": [record(r) for _, r in chunk.iterrows()],
        "total": total, "page": page, "pages": pages, "per_page": per_page,
        "summary": {"avg_cost": num(df["total_cost"].mean(), 0) if total else None,
                    "avg_los": num(df["length_of_stay"].mean()) if total else None},
    })


@app.get("/api/patients/<patient_id>")
def api_patient(patient_id):
    pid = patient_id.strip().upper()
    if not ID_PATTERN.match(pid):
        return jsonify(error="Patient IDs look like SHM-2025-00123."), 400
    row = DF[DF["patient_id"] == pid]
    if row.empty:
        return jsonify(error=f"No patient found with ID {pid}."), 404
    return jsonify(record(row.iloc[0]))


def validate_prediction_input(data):
    errors = {}
    clean = {}
    for field in FEATURES:
        if field not in data or data[field] in (None, ""):
            errors[field] = "This field is required."
            continue
        value = data[field]
        if field in ("age", "num_comorbidities"):
            limits = OPTIONS[field]
            try:
                if isinstance(value, bool) or float(value) != int(float(value)):
                    raise ValueError
                value = int(float(value))
            except (TypeError, ValueError):
                errors[field] = "Enter a whole number."
                continue
            if not limits["min"] <= value <= limits["max"]:
                errors[field] = f"Must be between {limits['min']} and {limits['max']}."
                continue
        elif str(value) not in OPTIONS[field]:
            errors[field] = f"Choose one of: {', '.join(OPTIONS[field])}."
            continue
        else:
            value = str(value)
        clean[field] = value
    return clean, errors


@app.post("/api/predict")
def api_predict():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="Send the patient details as a JSON object."), 400
    clean, errors = validate_prediction_input(data)
    if errors:
        return jsonify(error="Some inputs are missing or invalid.", fields=errors), 422

    X = pd.DataFrame([clean])[FEATURES]
    predicted = float(MODEL.predict(X)[0])
    # spread of the individual trees gives a realistic range around the point estimate
    Xt = MODEL.named_steps["prep"].transform(X)
    tree_preds = np.array([t.predict(Xt)[0] for t in MODEL.named_steps["rf"].estimators_])
    low, high = np.percentile(tree_preds, [10, 90])

    days = max(int(round(predicted)), 1)
    low_d, high_d = max(int(math.floor(low)), 1), max(int(math.ceil(high)), days)

    # cost estimate: average daily bill of comparable past patients x predicted stay
    similar = DF[(DF["condition"] == clean["condition"]) & (DF["severity"] == clean["severity"])
                 & (DF["ward_type"] == clean["ward_type"])]
    basis = "same condition, severity and ward"
    if len(similar) < 8:
        similar = DF[DF["condition"] == clean["condition"]]
        basis = "same condition"
    daily = similar["total_cost"].sum() / similar["length_of_stay"].sum()
    band = ("Short stay" if days <= 3 else "Moderate stay" if days <= 7
            else "Extended stay" if days <= 14 else "Prolonged stay")
    return jsonify({
        "predicted_days": round(predicted, 1), "rounded_days": days,
        "range_low": low_d, "range_high": high_d, "stay_band": band,
        "estimated_cost": int(round(daily * predicted, -2)),
        "estimated_cost_low": int(round(daily * low_d, -2)),
        "estimated_cost_high": int(round(daily * high_d, -2)),
        "avg_daily_cost": int(round(daily)),
        "similar_patients": int(len(similar)), "similar_basis": basis,
        "similar_avg_los": num(similar["length_of_stay"].mean()),
        "inputs": clean,
    })


@app.get("/api/model")
def api_model():
    return jsonify(METRICS)


# --------------------------------------------------------------------------- errors
@app.errorhandler(Exception)
def handle_error(exc):
    code = exc.code if isinstance(exc, HTTPException) else 500
    if code == 500:
        log.exception("Unhandled error")
    messages = {400: "The request could not be understood.", 404: "We could not find that page.",
                405: "That action is not allowed here.", 500: "Something went wrong on our side."}
    message = messages.get(code, getattr(exc, "description", "Unexpected error."))
    if request.path.startswith("/api/"):
        return jsonify(error=message), code
    return render_template("error.html", code=code, message=message, page=""), code


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)), debug=False)
