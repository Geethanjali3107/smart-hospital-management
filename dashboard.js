(async function () {
  const $ = id => document.getElementById(id);
  try {
    const d = await api("/api/dashboard");
    const short = m => m.slice(0, 3) + " ’" + m.slice(-2);

    MiniChart.line($("monthlyChart"), {
      labels: d.monthly.map(m => short(m.month)), values: d.monthly.map(m => m.count),
      fmt: v => `${v} admissions`,
    });
    MiniChart.doughnut($("deptChart"), {
      labels: d.departments.map(x => x.name), values: d.departments.map(x => x.count),
      centerLabel: "patients", fmt: v => `${v} patients`,
    });
    MiniChart.hbar($("topCondChart"), {
      labels: d.top_conditions.map(x => x.name), values: d.top_conditions.map(x => x.count),
      fmt: v => `${v} patients`, color: MiniChart.PAL[1],
    });
    MiniChart.doughnut($("typeChart"), {
      labels: d.admission_types.map(x => x.name), values: d.admission_types.map(x => x.count),
      centerLabel: "patients", fmt: v => `${v} patients`,
    });

    $("recentTable").querySelector("tbody").innerHTML = d.recent.map(p => `
      <tr>
        <td class="mono">${esc(p.patient_id)}</td><td>${esc(p.name)}</td><td>${esc(p.condition)}</td>
        <td>${esc(p.department)}</td><td class="nw">${fmtDate(p.admission_date)}</td>
        <td class="num">${p.length_of_stay} days</td><td class="num">${formatINR(p.total_cost)}</td>
      </tr>`).join("");
  } catch (e) {
    $("recentTable").querySelector("tbody").innerHTML = `<tr><td colspan="7" class="muted">${esc(e.message)}</td></tr>`;
  }
})();
