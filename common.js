/* Shared helpers: Indian rupee formatting, API access, mobile menu */
const inrFull = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

function formatINR(value) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? "—" : inrFull.format(Math.round(value));
}

function compactINR(v) {
  const n = Math.abs(v), sign = v < 0 ? "-" : "";
  if (n >= 1e7) return `${sign}₹${+(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${sign}₹${+(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `${sign}₹${+(n / 1e3).toFixed(1)}K`;
  return `${sign}₹${Math.round(n)}`;
}

async function api(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (e) {
    throw new Error("Cannot reach the server. Check that the application is running.");
  }
  let body = null;
  try { body = await res.json(); } catch (e) { /* non-JSON error page */ }
  if (!res.ok) {
    const err = new Error((body && body.error) || `Request failed (${res.status}).`);
    err.fields = body && body.fields;
    throw err;
  }
  return body;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

(function menu() {
  const side = document.getElementById("sidebar"), scrim = document.getElementById("scrim"), btn = document.getElementById("menuBtn");
  if (!btn) return;
  const toggle = open => { side.classList.toggle("open", open); scrim.classList.toggle("show", open); };
  btn.addEventListener("click", () => toggle(!side.classList.contains("open")));
  scrim.addEventListener("click", () => toggle(false));
})();
