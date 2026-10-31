(function () {
  const form = document.getElementById("predictForm"), $ = id => document.getElementById(id);
  const alertBox = $("formAlert"), btn = $("submitBtn");

  function clearErrors() {
    alertBox.hidden = true;
    form.querySelectorAll(".err").forEach(el => (el.textContent = ""));
    form.querySelectorAll("select").forEach(el => el.classList.remove("invalid"));
  }
  function showErrors(fields) {
    Object.entries(fields).forEach(([name, msg]) => {
      const el = form.querySelector(`[name="${name}"]`), out = form.querySelector(`.err[data-for="${name}"]`);
      if (el) el.classList.add("invalid");
      if (out) out.textContent = msg;
    });
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    clearErrors();
    const data = Object.fromEntries(new FormData(form).entries());
    const missing = {};
    [...form.querySelectorAll("select[required]")].forEach(s => { if (s.value === "") missing[s.name] = "Please choose an option."; });
    if (Object.keys(missing).length) { showErrors(missing); return; }

    btn.disabled = true; btn.textContent = "Predicting…";
    try {
      const r = await api("/api/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      $("emptyState").hidden = true; $("result").hidden = false;
      $("rDays").textContent = r.rounded_days;
      $("rBand").textContent = r.stay_band;
      $("rRange").textContent = r.range_low === r.range_high ? `${r.range_low} days` : `${r.range_low} – ${r.range_high} days`;
      $("rExact").textContent = `${r.predicted_days} days`;
      $("rCost").textContent = formatINR(r.estimated_cost);
      $("rCostRange").textContent = `Likely between ${formatINR(r.estimated_cost_low)} and ${formatINR(r.estimated_cost_high)}`;
      $("rCostBasis").textContent = `Based on ${r.similar_patients} past patients (${r.similar_basis}) averaging ${formatINR(r.avg_daily_cost)} per day. Their average stay was ${r.similar_avg_los} days.`;
      $("result").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      if (err.fields) showErrors(err.fields);
      alertBox.textContent = err.message; alertBox.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = "Predict length of stay";
    }
  });

  form.addEventListener("reset", () => { clearErrors(); $("result").hidden = true; $("emptyState").hidden = false; });
})();
