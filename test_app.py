"""Run:  python -m unittest discover -s tests -v"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd  # noqa: E402

from app import DF, app, format_inr  # noqa: E402

VALID = {"age": 62, "gender": "Male", "condition": "Myocardial Infarction", "admission_type": "Emergency",
         "severity": "Severe", "ward_type": "ICU", "surgery_performed": "Yes",
         "num_comorbidities": 2, "bmi_category": "Overweight"}
PAGES = ["/", "/analytics", "/patients", "/predict"]
BANNED = re.compile(r"sample|synthetic|demo", re.I)


class AppTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.testing = True
        cls.c = app.test_client()

    # ---------- formatting & calculations
    def test_inr_format(self):
        self.assertEqual(format_inr(0), "₹0")
        self.assertEqual(format_inr(999), "₹999")
        self.assertEqual(format_inr(1000), "₹1,000")
        self.assertEqual(format_inr(124301), "₹1,24,301")
        self.assertEqual(format_inr(12345678), "₹1,23,45,678")
        self.assertEqual(format_inr(None), "—")

    def test_average_cost_matches_raw_data(self):
        raw = pd.read_csv(Path(__file__).resolve().parents[1] / "data" / "patients.csv")
        manual = raw["total_cost"].sum() / len(raw)
        s = self.c.get("/api/stats").get_json()
        self.assertAlmostEqual(s["avg_cost"], manual, delta=0.5)
        self.assertEqual(s["total_patients"], len(raw))
        self.assertAlmostEqual(s["avg_los"], raw["length_of_stay"].mean(), delta=0.05)

    def test_dashboard_shows_rupee_average(self):
        html = self.c.get("/").get_data(as_text=True)
        self.assertIn(format_inr(round(DF["total_cost"].mean())), html)

    def test_patient_ids_unique_and_formatted(self):
        self.assertTrue(DF["patient_id"].is_unique)
        self.assertTrue(DF["patient_id"].str.match(r"^SHM-\d{4}-\d{5}$").all())
        self.assertTrue((DF["discharge_date"] - DF["admission_date"]).dt.days.eq(DF["length_of_stay"]).all())

    # ---------- pages
    def test_pages_render_without_banned_words(self):
        for p in PAGES:
            r = self.c.get(p)
            self.assertEqual(r.status_code, 200, p)
            self.assertIsNone(BANNED.search(r.get_data(as_text=True)), p)

    def test_static_files_clean(self):
        root = Path(__file__).resolve().parents[1] / "static"
        for f in list(root.glob("js/*.js")) + list(root.glob("css/*.css")):
            self.assertIsNone(BANNED.search(f.read_text(encoding="utf-8")), f.name)

    def test_404_pages(self):
        self.assertEqual(self.c.get("/nope").status_code, 404)
        r = self.c.get("/api/nope")
        self.assertEqual(r.status_code, 404)
        self.assertIn("error", r.get_json())

    # ---------- analytics
    def test_analytics_payload(self):
        d = self.c.get("/api/analytics").get_json()
        for k in ("conditions", "age_groups", "los_distribution", "cost_distribution", "model"):
            self.assertIn(k, d)
        self.assertEqual(sum(x["count"] for x in d["conditions"]), len(DF))
        self.assertEqual(sum(x["count"] for x in d["age_groups"]), len(DF))
        self.assertEqual(sum(x["count"] for x in d["los_distribution"]), len(DF))
        self.assertEqual(sum(x["count"] for x in d["cost_distribution"]), len(DF))

    # ---------- patients
    def test_patient_search_and_filter(self):
        d = self.c.get("/api/patients?q=stroke&per_page=5").get_json()
        self.assertEqual(d["total"], int((DF["condition"].str.contains("stroke", case=False)
                                          | DF["name"].str.contains("stroke", case=False)).sum()))
        self.assertLessEqual(len(d["patients"]), 5)
        d = self.c.get("/api/patients?severity=Critical&gender=Female").get_json()
        self.assertTrue(all(p["severity"] == "Critical" and p["gender"] == "Female" for p in d["patients"]))
        sub = DF[(DF.severity == "Critical") & (DF.gender == "Female")]
        self.assertAlmostEqual(d["summary"]["avg_cost"], sub["total_cost"].mean(), delta=0.5)

    def test_patient_lookup_by_id(self):
        pid = DF["patient_id"].iloc[10]
        self.assertEqual(self.c.get(f"/api/patients/{pid}").get_json()["patient_id"], pid)
        self.assertEqual(self.c.get(f"/api/patients/{pid.lower()}").status_code, 200)
        d = self.c.get("/api/patients?q=" + pid).get_json()
        self.assertEqual(d["total"], 1)
        self.assertEqual(self.c.get("/api/patients/SHM-2099-99999").status_code, 404)
        self.assertEqual(self.c.get("/api/patients/bad-id").status_code, 400)

    def test_patient_bad_params(self):
        self.assertEqual(self.c.get("/api/patients?sort=password").status_code, 400)
        self.assertEqual(self.c.get("/api/patients?page=abc").status_code, 400)
        d = self.c.get("/api/patients?page=9999").get_json()      # clamps to the last page
        self.assertEqual(d["page"], d["pages"])

    # ---------- prediction
    def test_prediction_works(self):
        r = self.c.post("/api/predict", json=VALID)
        self.assertEqual(r.status_code, 200)
        d = r.get_json()
        self.assertGreaterEqual(d["rounded_days"], 1)
        self.assertLessEqual(d["range_low"], d["rounded_days"] + 1)
        self.assertGreaterEqual(d["range_high"], d["rounded_days"])
        self.assertGreater(d["estimated_cost"], 0)

    def test_prediction_responds_to_inputs(self):
        mild = self.c.post("/api/predict", json={**VALID, "severity": "Mild", "ward_type": "General",
                                                 "surgery_performed": "No", "age": 30, "num_comorbidities": 0}).get_json()
        severe = self.c.post("/api/predict", json=VALID).get_json()
        self.assertGreater(severe["predicted_days"], mild["predicted_days"])
        self.assertGreater(severe["estimated_cost"], mild["estimated_cost"])

    def test_prediction_validation(self):
        r = self.c.post("/api/predict", json={k: v for k, v in VALID.items() if k != "age"})
        self.assertEqual(r.status_code, 422)
        self.assertIn("age", r.get_json()["fields"])
        r = self.c.post("/api/predict", json={**VALID, "condition": "Unknown"})
        self.assertIn("condition", r.get_json()["fields"])
        r = self.c.post("/api/predict", json={**VALID, "age": 250})
        self.assertIn("age", r.get_json()["fields"])
        r = self.c.post("/api/predict", json={**VALID, "age": "abc"})
        self.assertIn("age", r.get_json()["fields"])
        self.assertEqual(self.c.post("/api/predict", data="not json").status_code, 400)
        self.assertEqual(self.c.get("/api/predict").status_code, 405)


if __name__ == "__main__":
    unittest.main()
