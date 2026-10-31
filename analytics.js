(async function () {
  const $ = id => document.getElementById(id);
  const note = $("analyticsNote");
  try {
    const d = await api("/api/analytics");
    const P = MiniChart.PAL, desc = (arr, k) => [...arr].sort((a, b) => b[k] - a[k]);
    const names = a => a.map(x => x.name);
    const total = d.conditions.reduce((s, x) => s + x.count, 0);
    const avgCost = d.conditions.reduce((s, x) => s + x.avg_cost * x.count, 0) / total;   // weighted by patients
    const avgLos = d.conditions.reduce((s, x) => s + x.avg_los * x.count, 0) / total;
    note.textContent = `Analysis of ${total.toLocaleString("en-IN")} patient records · average hospital cost ${formatINR(avgCost)} · average stay ${avgLos.toFixed(1)} days`;

    MiniChart.hbar($("condChart"), { labels: names(d.conditions), values: d.conditions.map(x => x.count), fmt: v => `${v} patients`, color: P[0] });
    $("condInsight").textContent = `Most common: ${d.conditions[0].name}`;

    MiniChart.bar($("ageChart"), { labels: names(d.age_groups), values: d.age_groups.map(x => x.count), fmt: v => `${v} patients`, labelFmt: String, color: P[1] });
    const big = desc(d.age_groups, "count")[0];
    $("ageInsight").textContent = `Largest group: ${big.name} years`;

    MiniChart.bar($("losChart"), { labels: names(d.los_distribution), values: d.los_distribution.map(x => x.count), fmt: v => `${v} patients`, labelFmt: String, color: P[0] });
    MiniChart.bar($("costDistChart"), { labels: names(d.cost_distribution), values: d.cost_distribution.map(x => x.count), fmt: v => `${v} patients`, labelFmt: String, color: P[1] });

    const byLos = desc(d.conditions, "avg_los"), byCost = desc(d.conditions, "avg_cost");
    MiniChart.hbar($("losCondChart"), { labels: names(byLos), values: byLos.map(x => x.avg_los), fmt: v => `${v} days`, labelFmt: v => `${v} d`, color: P[1] });
    MiniChart.hbar($("costCondChart"), { labels: names(byCost), values: byCost.map(x => x.avg_cost), fmt: formatINR, labelFmt: compactINR, color: P[0] });

    MiniChart.bar($("costAgeChart"), { labels: names(d.age_groups), values: d.age_groups.map(x => x.avg_cost), fmt: formatINR, axisFmt: compactINR, color: P[1] });
    MiniChart.bar($("wardChart"), { labels: names(d.wards), values: d.wards.map(x => x.avg_cost), fmt: formatINR, axisFmt: compactINR, color: P[0] });
    MiniChart.doughnut($("sevChart"), { labels: names(d.severity), values: d.severity.map(x => x.count), centerLabel: "patients", fmt: v => `${v} patients` });

    MiniChart.line($("trendChart"), {
      labels: d.monthly.map(m => m.month.slice(0, 3) + " ’" + m.month.slice(-2)), values: d.monthly.map(m => m.count), fmt: v => `${v} admissions`,
    });

    const imp = Object.entries(d.model.feature_importance).sort((a, b) => b[1] - a[1]);
    const nice = { age: "Age", gender: "Gender", condition: "Diagnosis", admission_type: "Admission type", severity: "Severity",
                   ward_type: "Ward type", surgery_performed: "Surgery", bmi_category: "BMI category", num_comorbidities: "Other conditions" };
    $("importanceList").innerHTML = imp.map(([k, v]) => `
      <div class="bar-row"><span>${nice[k] || k}</span><div class="bar-track"><div class="bar-fill" style="width:${(v / imp[0][1]) * 100}%"></div></div><strong>${(v * 100).toFixed(1)}%</strong></div>`).join("");
    $("modelStrip").innerHTML = `
      <div><span class="kpi-label">Accuracy (R²)</span><strong>${d.model.r2}</strong></div>
      <div><span class="kpi-label">Average error</span><strong>±${d.model.mae_days} days</strong></div>
      <div><span class="kpi-label">Validation R² (5-fold)</span><strong>${d.model.cv_r2_mean}</strong></div>`;
  } catch (e) {
    note.textContent = e.message; note.classList.add("bad");
  }
})();
