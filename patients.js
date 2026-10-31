(function () {
  const $ = id => document.getElementById(id);
  const filterIds = ["condition", "department", "gender", "age_group", "severity", "admission_type"];
  const state = { page: 1, per_page: 15 };
  let timer, ticket = 0;

  function params() {
    const [sort, order] = $("sort").value.split(":");
    const p = new URLSearchParams({ page: state.page, per_page: state.per_page, sort, order });
    if ($("q").value.trim()) p.set("q", $("q").value.trim());
    filterIds.forEach(id => { if ($(id).value) p.set(id, $(id).value); });
    return p;
  }

  async function load() {
    const mine = ++ticket, body = $("patientTable").querySelector("tbody");
    try {
      const d = await api("/api/patients?" + params());
      if (mine !== ticket) return;                              // a newer request replaced this one
      state.page = d.page;
      $("resultBar").innerHTML = d.total
        ? `<span><strong>${d.total.toLocaleString("en-IN")}</strong> patients found</span>
           <span>Average bill: <strong>${formatINR(d.summary.avg_cost)}</strong></span>
           <span>Average stay: <strong>${d.summary.avg_los} days</strong></span>`
        : `<span>No patients match these filters.</span>`;
      body.innerHTML = d.patients.length ? d.patients.map(p => `
        <tr data-id="${esc(p.patient_id)}" tabindex="0">
          <td class="mono">${esc(p.patient_id)}</td><td>${esc(p.name)}</td><td class="nw">${p.age} · ${esc(p.gender)}</td>
          <td>${esc(p.condition)}</td><td>${esc(p.department)}</td>
          <td><span class="tag ${esc(p.severity)}">${esc(p.severity)}</span></td>
          <td class="nw">${fmtDate(p.admission_date)}</td><td class="num">${p.length_of_stay} days</td>
          <td class="num">${formatINR(p.total_cost)}</td></tr>`).join("")
        : `<tr><td colspan="9" class="muted">No records found. Try a different search or reset the filters.</td></tr>`;
      pager(d);
    } catch (e) {
      body.innerHTML = `<tr><td colspan="9" class="muted">${esc(e.message)}</td></tr>`;
    }
  }

  function pager(d) {
    const from = d.total ? (d.page - 1) * d.per_page + 1 : 0, to = Math.min(d.page * d.per_page, d.total);
    const nums = [];
    for (let i = Math.max(1, d.page - 2); i <= Math.min(d.pages, d.page + 2); i++) nums.push(i);
    $("pager").innerHTML = `
      <span class="muted">Showing ${from}–${to} of ${d.total.toLocaleString("en-IN")}</span>
      <div class="btns">
        <button data-p="${d.page - 1}" ${d.page <= 1 ? "disabled" : ""}>‹ Prev</button>
        ${nums[0] > 1 ? `<button data-p="1">1</button>${nums[0] > 2 ? "<span class='muted'>…</span>" : ""}` : ""}
        ${nums.map(n => `<button data-p="${n}" class="${n === d.page ? "on" : ""}">${n}</button>`).join("")}
        ${nums[nums.length - 1] < d.pages ? `${nums[nums.length - 1] < d.pages - 1 ? "<span class='muted'>…</span>" : ""}<button data-p="${d.pages}">${d.pages}</button>` : ""}
        <button data-p="${d.page + 1}" ${d.page >= d.pages ? "disabled" : ""}>Next ›</button>
      </div>`;
  }

  async function openDetail(id) {
    try {
      const p = await api("/api/patients/" + encodeURIComponent(id));
      $("mTitle").textContent = p.name;
      $("mSub").textContent = `${p.patient_id} · ${p.age} years · ${p.gender}`;
      const rows = [["Condition", p.condition], ["Department", p.department], ["Severity", p.severity], ["Admission type", p.admission_type],
        ["Ward", p.ward_type], ["Surgery", p.surgery_performed], ["Other conditions", p.num_comorbidities], ["BMI category", p.bmi_category],
        ["Admitted", fmtDate(p.admission_date)], ["Discharged", fmtDate(p.discharge_date)], ["Length of stay", p.length_of_stay + " days"],
        ["Total bill", formatINR(p.total_cost)], ["Bill per day", formatINR(p.total_cost / p.length_of_stay)], ["Payment mode", p.payment_mode], ["Outcome", p.outcome]];
      $("mBody").innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
      $("modal").hidden = false;
    } catch (e) { alert(e.message); }
  }

  const reload = () => { state.page = 1; load(); };
  $("q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(reload, 250); });
  [...filterIds, "sort"].forEach(id => $(id).addEventListener("change", reload));
  $("resetBtn").addEventListener("click", () => { $("filterForm").reset(); reload(); });
  $("filterForm").addEventListener("submit", e => e.preventDefault());
  $("pager").addEventListener("click", e => {
    const b = e.target.closest("button[data-p]");
    if (b && !b.disabled) { state.page = +b.dataset.p; load(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
  $("patientTable").addEventListener("click", e => { const r = e.target.closest("tr[data-id]"); if (r) openDetail(r.dataset.id); });
  $("patientTable").addEventListener("keydown", e => { if (e.key === "Enter") { const r = e.target.closest("tr[data-id]"); if (r) openDetail(r.dataset.id); } });
  $("modalClose").addEventListener("click", () => ($("modal").hidden = true));
  $("modal").addEventListener("click", e => { if (e.target === $("modal")) $("modal").hidden = true; });
  document.addEventListener("keydown", e => { if (e.key === "Escape") $("modal").hidden = true; });
  load();
})();
