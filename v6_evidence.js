/*
 * View 6 -- evidence. Seven nested models (step 0 = one typical price ... step 6 = age, mileage, engine, economy, tax, gearbox, fuel, model).
 * Panels: predicted-vs-actual scatter (animated between steps), error by step, and the models that are hardest to price.
 * Scoring defaults to the 20% of cars held out of model fitting, and respects every filter in the filter bar.
 */
(function () {
  'use strict';
  const { core, F, tokens, fmt, tip, watch, svg, clamp } = UI;
  const C = F.cols, MODELS = F.models, MAXP = 35000;
  const $ = (id) => document.getElementById(id);
  const hs = $('v6-scatter'), hb = $('v6-steps'), hm = $('v6-miss');
  const SH = 380;

  let step = 6, from = 6, e = 1, subset = 'test', playing = false, timer = 0, anim = 0, rows = new Int32Array(0), width = 0, hover = -1;
  const SX = new Float32Array(core.N), SY = new Float32Array(core.N);

  function computeRows() { const idx = State.idx(); rows = subset === 'test' ? idx.filter((i) => C.test[i] === 1) : idx; }
  const metricsAll = () => MODELS.map((_, k) => core.metrics(k, rows));

  // ---------- scatter (canvas) ----------
  function drawScatter() {
    if (!width) return;
    const T = tokens(), { c, ctx, w, h } = UI.canvas(hs, SH);
    c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'Scatter plot of predicted against actual price for the cars scored');
    const m = { l: 50, r: 12, t: 10, b: 38 };
    ctx.clearRect(0, 0, w, h);
    const x = d3.scaleLinear([0, MAXP], [m.l, w - m.r]), y = d3.scaleLinear([0, MAXP], [h - m.b, m.t]);
    ctx.font = `12px ${getComputedStyle(document.body).fontFamily}`; ctx.lineWidth = 1;
    [0, 10000, 20000, 30000].forEach((v) => {
      ctx.strokeStyle = T.grid; ctx.beginPath(); ctx.moveTo(m.l, Math.round(y(v)) + 0.5); ctx.lineTo(w - m.r, Math.round(y(v)) + 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(Math.round(x(v)) + 0.5, m.t); ctx.lineTo(Math.round(x(v)) + 0.5, h - m.b); ctx.stroke();
      ctx.fillStyle = T.ink3; ctx.textAlign = 'right'; ctx.fillText('£' + v / 1000 + 'k', m.l - 6, y(v) + 4); ctx.textAlign = 'center'; ctx.fillText('£' + v / 1000 + 'k', x(v), h - m.b + 16);
    });
    ctx.fillStyle = T.ink2; ctx.textAlign = 'center'; ctx.fillText('Actual asking price', (m.l + w - m.r) / 2, h - 6);
    ctx.save(); ctx.translate(12, (m.t + h - m.b) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('Model’s predicted price', 0, 0); ctx.restore();
    ctx.strokeStyle = T.axis; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x(0), y(0)); ctx.lineTo(x(MAXP), y(MAXP)); ctx.stroke();
    ctx.fillStyle = T.ink3; ctx.textAlign = 'right'; ctx.fillText('perfect prediction', x(MAXP) - 4, y(MAXP) + 16);

    const pa = core.predAll(from), pb = core.predAll(step);
    ctx.globalAlpha = 0.38; ctx.fillStyle = T.s[0];
    for (let j = 0; j < rows.length; j++) {
      const i = rows[j], a = C.price[i], p = pa[i] + (pb[i] - pa[i]) * e;
      SX[i] = x(a); SY[i] = y(Math.min(p, MAXP * 1.05));
      if (a <= MAXP) ctx.fillRect(SX[i] - 1.3, SY[i] - 1.3, 2.6, 2.6);
    }
    ctx.globalAlpha = 1;
    const ring = (i, r) => { ctx.lineWidth = 2; ctx.strokeStyle = T.surface; ctx.beginPath(); ctx.arc(SX[i], SY[i], r, 0, 7); ctx.stroke(); ctx.strokeStyle = T.ink; ctx.beginPath(); ctx.arc(SX[i], SY[i], r - 1, 0, 7); ctx.stroke(); };
    const cr = State.s.carRow; if (cr != null && rows.includes(cr)) ring(cr, 8);
    if (hover >= 0) ring(hover, 6);
  }
  function pick(mx, my) { let best = -1, bd = 144; for (let j = 0; j < rows.length; j++) { const i = rows[j], dx = SX[i] - mx, dy = SY[i] - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } } return best; }
  hs.addEventListener('pointermove', (ev) => {
    const r = hs.getBoundingClientRect(), i = pick(ev.clientX - r.left, ev.clientY - r.top);
    if (i !== hover) { hover = i; drawScatter(); }
    if (i < 0) { tip.hide(); return; }
    const car = core.carAt(i), p = core.predAll(step)[i];
    tip.show(ev, `${car.model} · click to load this car`, [
      { label: 'Actual price', value: fmt.gbp(car.price) }, { label: `Predicted (step ${step})`, value: fmt.gbp(p) }, { label: 'Error', value: fmt.signedPct(p / car.price - 1) },
      { label: 'Car', value: `${car.age} yr · ${fmt.n(car.mileage)} mi · ${car.engineSize.toFixed(1)} L ${car.fuelType.toLowerCase()}` }, { label: 'Split', value: car.isTest ? 'held out (not used to fit)' : 'training car' }]);
  });
  hs.addEventListener('pointerleave', () => { hover = -1; tip.hide(); drawScatter(); });
  hs.addEventListener('click', (ev) => { const r = hs.getBoundingClientRect(), i = pick(ev.clientX - r.left, ev.clientY - r.top); if (i >= 0) State.setCarFromRow(i); });

  // ---------- step bars and misses (SVG) ----------
  function stepBars(ms) {
    const w = hb.clientWidth; if (!w) return;
    const T = tokens(), rh = 40, m = { l: 150, r: 92, t: 6, b: 6 }, H = m.t + MODELS.length * rh + m.b, s = svg(hb, w, H);
    s.attr('aria-label', 'Bar chart of held-out error for each model step');
    const x = d3.scaleLinear([0, d3.max(ms, (d) => d.rmse) || 1], [m.l, w - m.r]);
    ms.forEach((d, k) => {
      const yc = m.t + k * rh + rh / 2, on = k === step, g = s.append('g').style('cursor', 'pointer');
      g.append('text').attr('class', on ? 'ink' : 'ink2').attr('x', m.l - 10).attr('y', yc + 4).attr('text-anchor', 'end').attr('font-weight', on ? 650 : 400).text(`${k}  ${MODELS[k].label.replace('Baseline: ', '').replace(/ \(.*\)$/, '').replace('running costs', 'mpg & tax')}`);
      if (isFinite(d.rmse)) {
        const bw = Math.max(0, x(d.rmse) - m.l), r = Math.min(4, bw);
        g.append('path').attr('fill', T.s[0]).attr('opacity', on ? 1 : 0.35).attr('d', `M${m.l},${yc - 11} H${m.l + bw - r} Q${m.l + bw},${yc - 11} ${m.l + bw},${yc - 11 + r} V${yc + 11 - r} Q${m.l + bw},${yc + 11} ${m.l + bw - r},${yc + 11} H${m.l} Z`);
        g.append('text').attr('class', 'ink').attr('x', m.l + bw + 8).attr('y', yc + 4).attr('font-weight', on ? 650 : 400).text(fmt.gbp(d.rmse));
      } else g.append('text').attr('class', 'ink2').attr('x', m.l + 8).attr('y', yc + 4).text('no cars');
      g.append('rect').attr('x', 0).attr('y', yc - rh / 2).attr('width', w).attr('height', rh).attr('fill', 'transparent')
        .on('click', () => go(k)).on('pointermove', (ev) => tip.show(ev, `Step ${k}: ${MODELS[k].label}`, [{ label: 'Typical error (RMSE)', value: fmt.gbp(d.rmse) }, { label: 'Average error (MAE)', value: fmt.gbp(d.mae) }, { label: 'Variation explained (R²)', value: isFinite(d.r2) ? d.r2.toFixed(3) : '–' }])).on('pointerleave', () => tip.hide());
    });
  }
  function missBars() {
    const w = hm.clientWidth; if (!w) return;
    const T = tokens(), idx = State.idxNoModel(), pool = subset === 'test' ? idx.filter((i) => C.test[i] === 1) : idx, by = new Map();
    pool.forEach((i) => { const k = C.mi[i]; if (!by.has(k)) by.set(k, []); by.get(k).push(i); });
    const list = [...by.entries()].filter(([, r]) => r.length >= 20).map(([k, r]) => ({ name: F.levels.model[k], n: r.length, ...core.metrics(step, Int32Array.from(r)) })).sort((a, b) => b.medAPE - a.medAPE);
    const top = list.slice(0, 8);
    $('v6-miss-sub').textContent = list.length ? `Median % error at step ${step}. Worst ${top.length} of ${list.length} models with 20+ scored cars.` : 'Not enough cars per model to rank.';
    const rh = 40, m = { l: 150, r: 60, t: 6, b: 6 }, H = Math.max(60, m.t + top.length * rh + m.b), s = svg(hm, w, H); s.attr('aria-label', 'Bar chart of median percentage error for the hardest models to price');
    const x = d3.scaleLinear([0, d3.max(top, (d) => d.medAPE) || 0.1], [m.l, w - m.r]);
    top.forEach((d, k) => {
      const yc = m.t + k * rh + rh / 2, bw = Math.max(0, x(d.medAPE) - m.l), r = Math.min(4, bw), g = s.append('g');
      g.append('text').attr('class', 'ink2').attr('x', m.l - 10).attr('y', yc + 4).attr('text-anchor', 'end').text(`${d.name} (${d.n})`);
      g.append('path').attr('fill', T.s[0]).attr('d', `M${m.l},${yc - 11} H${m.l + bw - r} Q${m.l + bw},${yc - 11} ${m.l + bw},${yc - 11 + r} V${yc + 11 - r} Q${m.l + bw},${yc + 11} ${m.l + bw - r},${yc + 11} H${m.l} Z`);
      g.append('text').attr('class', 'ink').attr('x', m.l + bw + 8).attr('y', yc + 4).text(fmt.pct(d.medAPE, 0));
      g.append('rect').attr('x', 0).attr('y', yc - rh / 2).attr('width', w).attr('height', rh).attr('fill', 'transparent')
        .on('pointermove', (ev) => tip.show(ev, d.name, [{ label: 'Median % error', value: fmt.pct(d.medAPE, 1) }, { label: 'Typical error (RMSE)', value: fmt.gbp(d.rmse) }, { label: 'Cars scored', value: fmt.n(d.n) }])).on('pointerleave', () => tip.hide());
    });
  }

  // ---------- tiles and table ----------
  function tiles(ms) {
    const box = $('v6-tiles'), d = ms[step], prev = step > 0 ? ms[step - 1] : null; box.textContent = '';
    const mk = (label, value, sub) => { const t = document.createElement('div'); t.className = 'tile'; const l = document.createElement('div'); l.className = 't-label'; l.textContent = label; const v = document.createElement('div'); v.className = 't-value'; v.textContent = value; const s = document.createElement('div'); s.className = 't-sub'; s.textContent = sub; t.append(l, v, s); box.appendChild(t); };
    const dl = (a, b, f) => (prev && isFinite(a) && isFinite(b) ? `${f(a - b)} vs step ${step - 1}` : 'start of the ladder');
    mk(`Step ${step}: ${MODELS[step].label.replace('Baseline: ', '')}`, d.n ? fmt.n(d.n) + ' cars' : 'no cars', subset === 'test' ? 'held out of model fitting' : 'training and held-out cars together');
    mk('Typical error (RMSE)', fmt.gbp(d.rmse), dl(d.rmse, prev && prev.rmse, (v) => (v < 0 ? '−' : '+') + fmt.gbp(Math.abs(v))));
    mk('Variation explained (R²)', isFinite(d.r2) ? d.r2.toFixed(2) : '–', dl(d.r2, prev && prev.r2, (v) => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2)));
    mk('Median error', fmt.pct(d.medAPE, 0), dl(d.medAPE, prev && prev.medAPE, (v) => (v < 0 ? '−' : '+') + Math.abs(v * 100).toFixed(1) + ' pts'));
  }
  function table(ms) {
    const box = $('v6-table'); box.textContent = '';
    const t = document.createElement('table'); t.className = 'tbl'; const hr = t.createTHead().insertRow();
    ['Step', 'Features in the model', 'Cars', 'RMSE (£)', 'MAE (£)', 'R²', 'Median % error'].forEach((h) => { const c = document.createElement('th'); c.textContent = h; hr.appendChild(c); });
    const b = t.createTBody();
    ms.forEach((d, k) => { const r = b.insertRow(); [k, MODELS[k].features.length ? MODELS[k].features.join(', ') : 'none (one price for every car)', fmt.n(d.n), fmt.gbp(d.rmse), fmt.gbp(d.mae), isFinite(d.r2) ? d.r2.toFixed(3) : '–', fmt.pct(d.medAPE, 1)].forEach((v) => { r.insertCell().textContent = v; }); });
    box.appendChild(t);
  }

  // ---------- controls ----------
  function syncControls() {
    $('v6-scrub').value = step; $('v6-step-out').textContent = `${step}: ${MODELS[step].label.replace('Baseline: ', '')}`;
    $('v6-play').textContent = playing ? 'Pause' : 'Play steps';
    document.querySelectorAll('[data-s]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.s === subset));
  }
  function go(k) {
    k = clamp(k, 0, MODELS.length - 1); if (k === step && e >= 1) return;
    cancelAnimationFrame(anim); from = step; step = k; e = 0;
    const t0 = performance.now(), dur = UI.reducedMotion() ? 1 : 750;
    const f = (t) => { const u = Math.min(1, (t - t0) / dur); e = 1 - Math.pow(1 - u, 3); drawScatter(); if (u < 1) anim = requestAnimationFrame(f); };
    anim = requestAnimationFrame(f);
    renderPanels();
  }
  function stopPlay() { playing = false; clearTimeout(timer); syncControls(); }
  function playLoop() { if (!playing) return; if (step >= MODELS.length - 1) { stopPlay(); return; } go(step + 1); timer = setTimeout(playLoop, 1700); }
  $('v6-play').onclick = () => { if (playing) { stopPlay(); return; } playing = true; if (step >= MODELS.length - 1) { from = step = 0; e = 1; renderPanels(); drawScatter(); } syncControls(); timer = setTimeout(playLoop, 700); };
  $('v6-back').onclick = () => { stopPlay(); go(step - 1); };
  $('v6-fwd').onclick = () => { stopPlay(); go(step + 1); };
  $('v6-scrub').oninput = (ev) => { stopPlay(); go(+ev.target.value); };
  document.querySelectorAll('[data-s]').forEach((b) => { b.onclick = () => { subset = b.dataset.s; refresh(); }; });

  function renderPanels() { const ms = metricsAll(); syncControls(); tiles(ms); table(ms); stepBars(ms); missBars(); }
  function refresh() { computeRows(); renderPanels(); drawScatter(); }

  window.V6 = { reset() { stopPlay(); cancelAnimationFrame(anim); step = from = 6; e = 1; subset = 'test'; hover = -1; refresh(); } };
  State.on(['models', 'fuel', 'trans', 'age', 'theme'], refresh);
  State.on(['car'], drawScatter);
  watch(hs, (w) => { width = w; refresh(); });
  watch(hb, () => { renderPanels(); });
})();
