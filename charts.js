/* MiniChart - small dependency-free canvas charts (bar, horizontal bar, line, doughnut).
   Written for this project so the site works fully offline with no external libraries. */
(function () {
  const PAL = ["#0b2a5b", "#1d6fb8", "#7cc4f2", "#3a8fd6", "#14468a", "#a8d8f7", "#5b7fb0", "#cfe8fa"];
  const FONT = '12px "Segoe UI", system-ui, -apple-system, sans-serif';
  const INK = "#5d6f8a", GRID = "#e3ecf6";
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  document.body.appendChild(tip);

  function nice(max) {
    if (!(max > 0)) return { max: 1, step: 0.25 };
    const raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    return { step, max: Math.ceil(max / step - 1e-9) * step };
  }
  function trunc(ctx, text, maxW) {
    text = String(text);
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
    return text + "…";
  }
  function topRound(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h); ctx.closePath();
  }
  function rightRound(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x, y + h); ctx.closePath();
  }
  const hideTip = () => { tip.style.display = "none"; };

  function make(canvas, painter) {
    const hits = [];
    function render() {
      const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); ctx.font = FONT;
      hits.length = 0; painter(ctx, w, h, hits);
    }
    function move(e) {
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const hit = hits.find(k => k.test(x, y));
      if (!hit) { hideTip(); canvas.style.cursor = "default"; return; }
      tip.innerHTML = hit.text; tip.style.display = "block"; canvas.style.cursor = "pointer";
      tip.style.left = Math.max(8, Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8)) + "px";
      tip.style.top = Math.max(8, Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 8)) + "px";
    }
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("click", move);
    canvas.addEventListener("mouseleave", hideTip);
    if ("ResizeObserver" in window) new ResizeObserver(render).observe(canvas.parentElement);
    else window.addEventListener("resize", render);
    render();
  }

  function axes(ctx, w, h, o, n) {
    const fmt = o.fmt || String, axisFmt = o.axisFmt || fmt;
    const sc = nice(Math.max(...o.values));
    const ticks = []; for (let v = 0; v <= sc.max + 1e-9; v += sc.step) ticks.push(v);
    const left = Math.max(...ticks.map(t => ctx.measureText(axisFmt(t)).width)) + 16;
    const right = 10, top = 16;
    const rotate = n > 5 && (w - left - right) / n < 78;
    const bottom = rotate ? 84 : 32;
    const pw = w - left - right, ph = h - top - bottom;
    ctx.strokeStyle = GRID; ctx.fillStyle = INK; ctx.lineWidth = 1; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ticks.forEach(t => {
      const y = top + ph - (t / sc.max) * ph;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
      ctx.fillText(axisFmt(t), left - 8, y);
    });
    return { fmt, max: sc.max, left, right, top, bottom, pw, ph, rotate };
  }
  function xLabel(ctx, a, text, cx, slot) {
    ctx.fillStyle = INK; ctx.save();
    if (a.rotate) {
      ctx.translate(cx, a.top + a.ph + 12); ctx.rotate(-Math.PI / 4);
      ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(trunc(ctx, text, 100), 0, 0);
    } else {
      ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(trunc(ctx, text, slot - 4), cx, a.top + a.ph + 9);
    }
    ctx.restore();
  }

  function bar(canvas, o) {
    make(canvas, (ctx, w, h, hits) => {
      const n = o.values.length, a = axes(ctx, w, h, o, n), slot = a.pw / n, bw = Math.min(slot * 0.62, 56);
      o.values.forEach((v, i) => {
        const x = a.left + slot * i + (slot - bw) / 2, bh = (v / a.max) * a.ph, y = a.top + a.ph - bh;
        ctx.fillStyle = o.colors ? o.colors[i % o.colors.length] : (o.color || PAL[0]);
        topRound(ctx, x, y, bw, bh, 5); ctx.fill();
        if (o.labelFmt && slot >= 46) {
          ctx.fillStyle = "#12233f"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
          ctx.fillText(o.labelFmt(v), x + bw / 2, y - 3);
        }
        xLabel(ctx, a, o.labels[i], a.left + slot * i + slot / 2, slot);
        const x0 = a.left + slot * i;
        hits.push({ test: (px, py) => px >= x0 && px <= x0 + slot && py >= a.top && py <= a.top + a.ph + 4,
                    text: `<b>${o.labels[i]}</b><br>${a.fmt(v)}` });
      });
    });
  }

  function hbar(canvas, o) {
    make(canvas, (ctx, w, h, hits) => {
      const n = o.values.length, lf = o.labelFmt || o.fmt || String, fmt = o.fmt || String;
      const labelW = Math.min(w * 0.42, Math.max(...o.labels.map(l => ctx.measureText(l).width)) + 6);
      const valW = Math.max(...o.values.map(v => ctx.measureText(lf(v)).width)) + 10;
      const left = labelW + 10, right = valW + 6, top = 2, pw = Math.max(w - left - right, 20);
      const max = Math.max(...o.values) || 1, slot = (h - top - 2) / n, bh = Math.min(slot * 0.62, 22);
      o.values.forEach((v, i) => {
        const y = top + slot * i + (slot - bh) / 2, bw = Math.max((v / max) * pw, 2);
        ctx.fillStyle = INK; ctx.textAlign = "right"; ctx.textBaseline = "middle";
        ctx.fillText(trunc(ctx, o.labels[i], labelW), labelW, y + bh / 2);
        ctx.fillStyle = o.colors ? o.colors[i % o.colors.length] : (o.color || PAL[0]);
        rightRound(ctx, left, y, bw, bh, 5); ctx.fill();
        ctx.fillStyle = "#12233f"; ctx.textAlign = "left"; ctx.fillText(lf(v), left + bw + 6, y + bh / 2);
        const y0 = top + slot * i;
        hits.push({ test: (px, py) => py >= y0 && py <= y0 + slot, text: `<b>${o.labels[i]}</b><br>${fmt(v)}` });
      });
    });
  }

  function line(canvas, o) {
    make(canvas, (ctx, w, h, hits) => {
      const n = o.values.length, a = axes(ctx, w, h, o, 0), slot = a.pw / n;
      const pts = o.values.map((v, i) => [a.left + slot * (i + 0.5), a.top + a.ph - (v / a.max) * a.ph]);
      const grad = ctx.createLinearGradient(0, a.top, 0, a.top + a.ph);
      grad.addColorStop(0, "rgba(124,196,242,.55)"); grad.addColorStop(1, "rgba(124,196,242,.04)");
      ctx.beginPath(); ctx.moveTo(pts[0][0], a.top + a.ph);
      pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.lineTo(pts[n - 1][0], a.top + a.ph); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.strokeStyle = PAL[0]; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.stroke();
      const every = Math.ceil(n / Math.max(Math.floor(a.pw / 62), 1));
      pts.forEach((p, i) => {
        if (n <= 24) { ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, 7); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = PAL[0]; ctx.lineWidth = 2; ctx.stroke(); }
        if (i % every === 0) { ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(o.labels[i], p[0], a.top + a.ph + 9); }
        const x0 = a.left + slot * i;
        hits.push({ test: (px, py) => px >= x0 && px <= x0 + slot && py >= a.top && py <= a.top + a.ph + 4,
                    text: `<b>${o.labels[i]}</b><br>${a.fmt(o.values[i])}` });
      });
    });
  }

  function doughnut(canvas, o) {
    make(canvas, (ctx, w, h, hits) => {
      const total = o.values.reduce((s, v) => s + v, 0), below = w < 430, fmt = o.fmt || String;
      const size = below ? Math.min(w - 16, h * 0.42) : Math.min(h - 8, w * 0.46);
      const cx = below ? w / 2 : size / 2 + 6, cy = below ? size / 2 + 4 : h / 2, R = size / 2, r = R * 0.62;
      let a0 = -Math.PI / 2;
      const spans = o.values.map(v => { const s = (v / total) * Math.PI * 2, seg = [a0, a0 + s]; a0 += s; return seg; });
      spans.forEach((sp, i) => {
        ctx.beginPath(); ctx.arc(cx, cy, R, sp[0], sp[1]); ctx.arc(cx, cy, r, sp[1], sp[0], true); ctx.closePath();
        ctx.fillStyle = PAL[i % PAL.length]; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
        hits.push({ test: (px, py) => {
          const d = Math.hypot(px - cx, py - cy); if (d < r || d > R) return false;
          let ang = Math.atan2(py - cy, px - cx); if (ang < -Math.PI / 2) ang += Math.PI * 2;
          return ang >= sp[0] && ang <= sp[1]; },
          text: `<b>${o.labels[i]}</b><br>${fmt(o.values[i])} (${(o.values[i] / total * 100).toFixed(1)}%)` });
      });
      ctx.fillStyle = "#0b2a5b"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif'; ctx.fillText(total.toLocaleString("en-IN"), cx, cy - 6);
      ctx.font = FONT; ctx.fillStyle = INK; ctx.fillText(o.centerLabel || "total", cx, cy + 14);
      const rows = o.labels.length, rowH = Math.min(22, ((below ? h - size - 16 : h - 8)) / rows);
      let lx = below ? 10 : cx + R + 26, ly = below ? size + 16 : cy - (rows * rowH) / 2 + rowH / 2;
      o.labels.forEach((l, i) => {
        ctx.fillStyle = PAL[i % PAL.length]; ctx.fillRect(lx, ly - 5, 10, 10);
        ctx.fillStyle = "#12233f"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(trunc(ctx, `${l}  ${(o.values[i] / total * 100).toFixed(0)}%`, w - lx - 24), lx + 18, ly);
        ly += rowH;
      });
    });
  }

  window.MiniChart = { bar, hbar, line, doughnut, PAL };
})();
