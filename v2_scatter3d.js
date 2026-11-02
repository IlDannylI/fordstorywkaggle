/*
 * View 2 -- every car in 3D: age (x) x mileage (depth) x price (up).
 * Hand-written 3D on a 2D canvas (no 3D library): rotation matrices + light perspective + nearest-point picking.
 * Inputs : filter bar (models, fuel, gearbox, age range), colour-by, camera presets, rotate, fitted-surface toggle.
 * Output : canvas; hover shows a car's values, click loads that car into Views 4 and 5.
 */
(function () {
  'use strict';
  const { core, F, tokens, fmt, tip, watch, clamp } = UI;
  const C = F.cols, L = F.levels, N = core.N;
  const AGE_MAX = 12, MILE_MAX = 120000, PRICE_MAX = 35000;      // axis ranges (cars beyond them are counted, not drawn)
  const PRESETS = { '3d': [-0.75, 0.5], age: [0, 0], mile: [-Math.PI / 2, 0], top: [0, Math.PI / 2] };
  const $ = (id) => document.getElementById(id);
  const host = $('v2-chart');
  const H = 540;

  // normalised cube coordinates in [-1, 1] for every row, computed once
  const NX = new Float32Array(N), NY = new Float32Array(N), NZ = new Float32Array(N), IN = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    NX[i] = (C.age[i] / AGE_MAX) * 2 - 1; NY[i] = (C.mileage[i] / MILE_MAX) * 2 - 1; NZ[i] = (C.price[i] / PRICE_MAX) * 2 - 1;
    IN[i] = C.age[i] <= AGE_MAX && C.mileage[i] <= MILE_MAX && C.price[i] <= PRICE_MAX ? 1 : 0;
  }
  const PX = new Float32Array(N), PY = new Float32Array(N), SHOWN = new Uint8Array(N);

  let yaw = PRESETS['3d'][0], pitch = PRESETS['3d'][1], zoom = 1, colorBy = 'model', rotating = false, surface = false;
  let rows = new Int32Array(0), buckets = [], bucketInfo = [], hidden = 0, total = 0, hover = -1, drag = null, width = 0, tween = 0, drawQueued = false, lastIdx = null;

  // ---------- buckets: which colour each shown row gets ----------
  function build() {
    const idx = State.idx(), T = tokens();
    total = idx.length;
    const keep = []; hidden = 0;
    for (let j = 0; j < idx.length; j++) { if (IN[idx[j]]) keep.push(idx[j]); else hidden++; }
    rows = Int32Array.from(keep); SHOWN.fill(0); rows.forEach((i) => { SHOWN[i] = 1; });
    let mode = colorBy;
    if (mode === 'model' && !State.s.models.length) mode = 'fuel';
    let groups;                                    // [{label, color, test(i)}]
    if (mode === 'model') groups = State.s.models.map((n) => ({ label: n, color: State.modelColor(n), key: core.modelIdx.get(n), of: (i) => C.mi[i] }));
    else if (mode === 'fuel') groups = L.fuel.map((n, k) => ({ label: n, color: T.s[k], key: k, of: (i) => C.fu[i] }));
    else if (mode === 'trans') groups = L.trans.map((n, k) => ({ label: n, color: T.s[k], key: k, of: (i) => C.tr[i] }));
    else {                                         // engine size: 8 sequential steps from 1.0 L to 2.0 L and above
      const ramp = d3.interpolateRgb(T.rampLo, T.rampHi);
      groups = d3.range(8).map((k) => ({ label: k === 0 ? '1.0 L' : k === 7 ? '2.0 L +' : '', color: ramp(k / 7), key: k, of: (i) => Math.min(7, Math.max(0, Math.floor(((C.eng[i] - 1.0) / 1.0) * 7.999))) }));
    }
    const lists = groups.map(() => []);
    const lookup = new Map(groups.map((g, k) => [g.key, k]));
    for (let j = 0; j < rows.length; j++) { const k = lookup.get(groups[0].of(rows[j])); if (k != null) lists[k].push(rows[j]); }
    buckets = lists.map((l) => Int32Array.from(l)); bucketInfo = groups.map((g, k) => ({ label: g.label, color: g.color, n: lists[k].length })); bucketInfo.mode = mode;
    legend(mode);
    $('v2-foot').textContent = total
      ? `${fmt.n(rows.length)} of ${fmt.n(total)} cars drawn. ${hidden ? fmt.n(hidden) + ' cars beyond the axes (older than 12 years, over 120,000 miles or above £35,000) are not drawn. ' : ''}Drag to rotate · Shift + scroll or +/− keys to zoom · double-click to reset the camera.`
      : 'No cars match these filters.';
  }
  function legend(mode) {
    const lg = $('v2-legend'); lg.textContent = '';
    if (mode === 'eng') {
      const T = tokens(), sp = document.createElement('span'), r = document.createElement('i');
      r.className = 'ramp'; r.style.border = '0'; r.style.height = '8px'; r.style.background = `linear-gradient(90deg, ${T.rampLo}, ${T.rampHi})`;
      sp.append('Engine size 1.0 L', r, '2.0 L and above'); lg.appendChild(sp);
    } else {
      bucketInfo.forEach((b) => { const sp = document.createElement('span'), d = document.createElement('i'); d.className = 'dot'; d.style.background = b.color; sp.append(d, `${b.label} (${fmt.n(b.n)})`); lg.appendChild(sp); });
      if (colorBy === 'model' && mode !== 'model') { const sp = document.createElement('span'); sp.textContent = 'No models picked, so cars are coloured by fuel.'; lg.appendChild(sp); }
    }
    if (surface) { const sp = document.createElement('span'), k = document.createElement('i'); k.style.borderColor = tokens().ink2; sp.append(k, 'Fitted surface: price from age and mileage alone'); lg.appendChild(sp); }
  }

  // ---------- projection ----------
  let S = 1, cx = 0, cy0 = 0, cyw = 1, syw = 0, cp = 1, sp = 0;
  function setCamera() {
    S = Math.min(width, H) * 0.285 * zoom; cx = width / 2; cy0 = H / 2 + 8;
    cyw = Math.cos(yaw); syw = Math.sin(yaw); cp = Math.cos(pitch); sp = Math.sin(pitch);
  }
  function proj(x, y, z) {
    const x1 = x * cyw - y * syw, y1 = x * syw + y * cyw;
    const y2 = y1 * cp - z * sp, z2 = y1 * sp + z * cp, k = 1 / (1 + 0.1 * y2);
    return [cx + S * x1 * k, cy0 - S * z2 * k, k];
  }

  // ---------- drawing ----------
  function draw() {
    drawQueued = false;
    if (!width) return;
    const T = tokens(), { c, ctx } = UI.canvas(host, H);
    c.setAttribute('role', 'img'); c.setAttribute('tabindex', '0');
    c.setAttribute('aria-label', 'Three-dimensional scatter plot of used Ford age, mileage and price. Use arrow keys to rotate.');
    ctx.clearRect(0, 0, width, H);
    setCamera();

    // cube edges
    const V = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map((v) => proj(...v));
    ctx.strokeStyle = T.axis; ctx.lineWidth = 1; ctx.beginPath();
    [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) => { ctx.moveTo(V[a][0], V[a][1]); ctx.lineTo(V[b][0], V[b][1]); });
    ctx.stroke();

    // fitted surface from the age + mileage model (step M2): price = exp(b0 + b_age*age + b_m10*mileage/10,000)
    if (surface) {
      const co = F.models[2].coefs, g = 12, seg = 24;
      ctx.strokeStyle = T.ink2; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
      const pz = (a, m) => clamp((Math.exp(co.intercept + co.age * a + co.m10 * (m / 1e4)) / PRICE_MAX) * 2 - 1, -1, 1);
      for (let u = 0; u <= g; u++) {
        ctx.beginPath();
        for (let v = 0; v <= seg; v++) { const a = (u / g) * AGE_MAX, m = (v / seg) * MILE_MAX, p = proj((a / AGE_MAX) * 2 - 1, (m / MILE_MAX) * 2 - 1, pz(a, m)); v ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
        ctx.stroke(); ctx.beginPath();
        for (let v = 0; v <= seg; v++) { const m = (u / g) * MILE_MAX, a = (v / seg) * AGE_MAX, p = proj((a / AGE_MAX) * 2 - 1, (m / MILE_MAX) * 2 - 1, pz(a, m)); v ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // points, drawn one colour at a time (alpha keeps dense regions readable)
    for (let j = 0; j < rows.length; j++) { const i = rows[j], p = proj(NX[i], NY[i], NZ[i]); PX[i] = p[0]; PY[i] = p[1]; }
    ctx.globalAlpha = 0.5;
    buckets.forEach((list, k) => {
      ctx.fillStyle = bucketInfo[k].color;
      for (let j = 0; j < list.length; j++) { const i = list[j]; ctx.fillRect(PX[i] - 1.25, PY[i] - 1.25, 2.5, 2.5); }
    });
    ctx.globalAlpha = 1;

    // tick labels and axis titles (halo keeps them readable over points)
    const label = (txt, p, dx, dy, anchor, strong) => {
      ctx.font = `${strong ? 12 : 11}px ${getComputedStyle(document.body).fontFamily}`; ctx.textAlign = anchor; ctx.lineWidth = 3;
      ctx.strokeStyle = T.surface; ctx.strokeText(txt, p[0] + dx, p[1] + dy); ctx.fillStyle = strong ? T.ink2 : T.ink3; ctx.fillText(txt, p[0] + dx, p[1] + dy);
    };
    for (let a = 0; a <= AGE_MAX; a += 2) label(a, proj((a / AGE_MAX) * 2 - 1, -1, -1), 0, 16, 'center');
    for (let m = 0; m <= MILE_MAX; m += 20000) label(m / 1000 + 'k', proj(1, (m / MILE_MAX) * 2 - 1, -1), 10, 14, 'left');
    for (let p = 0; p <= PRICE_MAX; p += 5000) label('£' + p / 1000 + 'k', proj(-1, -1, (p / PRICE_MAX) * 2 - 1), -8, 4, 'right');
    label('Age (years)', proj(0, -1, -1), 0, 34, 'center', true);
    label('Mileage (miles)', proj(1, 0, -1), 30, 32, 'left', true);
    label('Price (£)', proj(-1, -1, 1), -8, -12, 'right', true);

    // selected car (from View 4 / 5 / 6) and hovered car
    const ring = (i, col, r) => { ctx.beginPath(); ctx.arc(PX[i], PY[i], r, 0, 7); ctx.lineWidth = 2; ctx.strokeStyle = T.surface; ctx.stroke(); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(PX[i], PY[i], r - 1, 0, 7); ctx.strokeStyle = col; ctx.stroke(); };
    const cr = State.s.carRow;
    if (cr != null && SHOWN[cr]) { ring(cr, T.ink, 8); label('your car', [PX[cr], PY[cr]], 12, -10, 'left', true); }
    if (hover >= 0 && SHOWN[hover]) ring(hover, T.ink, 6);
  }
  function requestDraw() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(draw); } }

  // ---------- picking, drag, keyboard ----------
  function pick(mx, my) {
    let best = -1, bd = 12 * 12;
    for (let j = 0; j < rows.length; j++) { const i = rows[j], dx = PX[i] - mx, dy = PY[i] - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
    return best;
  }
  const carRows = (i) => { const c = core.carAt(i); return [
    { label: 'Price', value: fmt.gbp(c.price) }, { label: 'Age', value: `${c.age} yr (model year ${fmt.year(c.age)})` }, { label: 'Mileage', value: fmt.n(c.mileage) + ' mi' },
    { label: 'Engine', value: `${c.engineSize.toFixed(1)} L ${c.fuelType.toLowerCase()}` }, { label: 'Gearbox', value: c.transmission }, { label: 'Economy · tax', value: `${c.mpg} mpg · £${c.tax}` }]; };
  host.addEventListener('pointerdown', (e) => { host.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, moved: 0 }; tip.hide(); });
  host.addEventListener('pointermove', (e) => {
    const r = host.getBoundingClientRect();
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      yaw += dx * 0.008; pitch = clamp(pitch + dy * 0.008, -Math.PI / 2, Math.PI / 2); requestDraw(); return;
    }
    const i = pick(e.clientX - r.left, e.clientY - r.top);
    if (i !== hover) { hover = i; requestDraw(); }
    if (i >= 0) tip.show(e, `${core.carAt(i).model} · click to load this car`, carRows(i)); else tip.hide();
  });
  host.addEventListener('pointerup', (e) => {
    const r = host.getBoundingClientRect(), moved = drag ? drag.moved : 99; drag = null;
    if (moved < 4) { const i = pick(e.clientX - r.left, e.clientY - r.top); if (i >= 0) State.setCarFromRow(i); }
  });
  host.addEventListener('pointerleave', () => { if (!drag) { hover = -1; tip.hide(); requestDraw(); } });
  host.addEventListener('dblclick', () => goTo(...PRESETS['3d'], 1));
  host.addEventListener('wheel', (e) => { if (!e.shiftKey) return; e.preventDefault(); zoom = clamp(zoom * Math.exp(-(e.deltaY || e.deltaX) * 0.0015), 0.6, 2.6); requestDraw(); }, { passive: false });
  host.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft') yaw -= 0.1; else if (k === 'ArrowRight') yaw += 0.1; else if (k === 'ArrowUp') pitch = clamp(pitch - 0.1, -Math.PI / 2, Math.PI / 2);
    else if (k === 'ArrowDown') pitch = clamp(pitch + 0.1, -Math.PI / 2, Math.PI / 2); else if (k === '+' || k === '=') zoom = clamp(zoom * 1.1, 0.6, 2.6);
    else if (k === '-') zoom = clamp(zoom / 1.1, 0.6, 2.6); else return;
    e.preventDefault(); requestDraw();
  });

  // ---------- camera animation ----------
  function goTo(ty, tp, tz) {
    cancelAnimationFrame(tween);
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const y0 = yaw, p0 = pitch, z0 = zoom, dy = wrap(ty - yaw), t0 = performance.now(), dur = UI.reducedMotion() ? 1 : 650;
    const step = (t) => {
      const u = Math.min(1, (t - t0) / dur), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      yaw = y0 + dy * e; pitch = p0 + (tp - p0) * e; zoom = z0 + (tz - z0) * e; draw();
      if (u < 1) tween = requestAnimationFrame(step);
    };
    tween = requestAnimationFrame(step);
  }
  let spin = 0;
  function spinLoop() { if (!rotating) return; if (!drag) yaw += 0.006; draw(); spin = requestAnimationFrame(spinLoop); }

  // ---------- controls ----------
  function syncButtons() {
    document.querySelectorAll('#v2-chart ~ *, .toolbar [data-c]').forEach(() => {});
    document.querySelectorAll('[data-c]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.c === colorBy));
    $('v2-rot').setAttribute('aria-pressed', rotating); $('v2-rot').textContent = rotating ? 'Stop rotating' : 'Rotate';
    $('v2-surface').checked = surface;
  }
  document.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => { colorBy = b.dataset.c; build(); syncButtons(); requestDraw(); }; });
  document.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { rotating = false; cancelAnimationFrame(spin); syncButtons(); goTo(...PRESETS[b.dataset.p], 1); }; });
  $('v2-rot').onclick = () => { rotating = !rotating; syncButtons(); if (rotating) spinLoop(); else cancelAnimationFrame(spin); };
  $('v2-surface').onchange = (e) => { surface = e.target.checked; build(); requestDraw(); };

  const refresh = () => { build(); requestDraw(); };
  State.on(['models', 'fuel', 'trans', 'age', 'theme'], refresh);
  State.on(['car'], requestDraw);
  watch(host, (w) => { width = w; refresh(); });
  window.V2 = {
    reset() { rotating = false; cancelAnimationFrame(spin); colorBy = 'model'; surface = false; hover = -1; yaw = PRESETS['3d'][0]; pitch = PRESETS['3d'][1]; zoom = 1; build(); syncButtons(); requestDraw(); },
    stats: () => ({ shown: rows.length, hidden, total }),
  };
  syncButtons();
})();
