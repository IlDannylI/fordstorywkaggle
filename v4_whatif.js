/*
 * View 4 -- build-a-car estimator. Sliders and selects change the car; the page shows the model's price estimate, an 80% band
 * from past errors, how many real, similar cars exist, and one bar per feature = % effect on price vs a typical Fiesta.
 * Shared state: the car lives in State.s.car, so clicking a car in View 2 or View 6 loads it here and into View 5.
 */
(function () {
  'use strict';
  const { core, F, tokens, fmt, tip, watch, svg, clamp } = UI;
  const C = F.cols, L = F.levels, co = F.models[6].coefs;
  const $ = (id) => document.getElementById(id);
  const host = $('v4-chart'), box = $('v4-controls');
  let width = 0;

  const SL = [
    { k: 'age', label: 'Age', min: 0, max: 12, step: 1, show: (v) => `${v} yr (model year ${fmt.year(v)})` },
    { k: 'mileage', label: 'Mileage', min: 0, max: 120000, step: 500, show: (v) => fmt.n(v) + ' mi' },
    { k: 'engineSize', label: 'Engine size', min: 1, max: 5, step: 0.1, show: (v) => v.toFixed(1) + ' L' },
    { k: 'mpg', label: 'Fuel economy', min: 20, max: 90, step: 0.1, show: (v) => v.toFixed(1) + ' mpg' },
    { k: 'tax', label: 'Road tax', min: 0, max: 580, step: 5, show: (v) => '£' + v + ' / yr' },
  ];
  const SEL = [{ k: 'model', label: 'Model', opts: L.model }, { k: 'fuelType', label: 'Fuel', opts: L.fuel }, { k: 'transmission', label: 'Gearbox', opts: L.trans }];
  const inputs = {}, outs = {};

  // ---------- controls ----------
  SEL.forEach((d) => {
    const w = document.createElement('div'); w.className = 'ctl';
    const lab = document.createElement('label'); lab.textContent = d.label; lab.htmlFor = 'v4-' + d.k;
    const s = document.createElement('select'); s.id = 'v4-' + d.k;
    d.opts.forEach((o) => { const op = document.createElement('option'); op.textContent = o; s.appendChild(op); });
    s.onchange = () => State.setCar(Object.assign({}, State.s.car, { [d.k]: s.value }), null);
    w.append(lab, s); box.appendChild(w); inputs[d.k] = s;
  });
  SL.forEach((d) => {
    const w = document.createElement('div'); w.className = 'ctl';
    const lab = document.createElement('label'); lab.textContent = d.label; lab.htmlFor = 'v4-' + d.k;
    const o = document.createElement('output'); o.htmlFor = 'v4-' + d.k;
    const r = document.createElement('input'); r.type = 'range'; r.id = 'v4-' + d.k; r.min = d.min; r.max = d.max; r.step = d.step;
    r.oninput = () => State.setCar(Object.assign({}, State.s.car, { [d.k]: +r.value }), null);
    w.append(lab, o, r); box.appendChild(w); inputs[d.k] = r; outs[d.k] = o;
  });
  const row = document.createElement('div'); row.className = 'ctl-row';
  const b1 = document.createElement('button'); b1.className = 'btn'; b1.textContent = 'Typical Fiesta'; b1.onclick = () => State.setCar(core.referenceCar(), null);
  const b2 = document.createElement('button'); b2.className = 'btn'; b2.textContent = 'Random real car';
  b2.onclick = () => { const idx = State.idx().length ? State.idx() : core.filter({}); State.setCarFromRow(idx[Math.floor(Math.random() * idx.length)]); };
  row.append(b1, b2); box.appendChild(row);

  function syncControls() {
    const car = State.s.car;
    SL.forEach((d) => { const v = clamp(car[d.k], d.min, d.max); inputs[d.k].value = v; outs[d.k].textContent = d.show(car[d.k]); });
    SEL.forEach((d) => { inputs[d.k].value = car[d.k]; });
  }

  // ---------- estimate + evidence ----------
  function estimate() {
    const car = State.s.car, p = core.interval(co, car), sim = core.similar(car), row = State.s.carRow;
    $('v4-price').textContent = fmt.gbp(p.mid);
    $('v4-band').textContent = `80% of past estimates landed between ${fmt.gbp(p.lo)} and ${fmt.gbp(p.hi)}`;
    const ev = $('v4-evidence'); ev.textContent = '';
    const add = (...nodes) => { const d = document.createElement('div'); d.append(...nodes); ev.appendChild(d); };
    const b = (t) => { const e = document.createElement('b'); e.textContent = t; return e; };
    if (row != null) { const diff = p.mid / C.price[row] - 1; add('Loaded from a real listing asking ', b(fmt.gbp(C.price[row])), `; the model says ${fmt.gbp(p.mid)} (${fmt.signedPct(diff)}). ${core.carAt(row).isTest ? 'This car was held out of model fitting.' : 'This car was part of the training data.'}`); }
    if (sim.n > 0) add(b(fmt.n(sim.n)), ` similar real cars (same model and fuel, within 1 year, 15,000 miles and 0.3 L) have a median asking price of `, b(fmt.gbp(sim.median)), sim.n >= 5 ? ` (middle 80%: ${fmt.gbp(sim.q10)} to ${fmt.gbp(sim.q90)}).` : '. Very few cars, so treat this as a rough guide.');
    else { const w = document.createElement('span'); w.className = 'warn'; w.textContent = '⚠ No comparable cars exist in the data: this estimate is extrapolation.'; add(w); }
  }

  // ---------- effect bars ----------
  function bars() {
    if (!width) return;
    const T = tokens(), car = State.s.car, ref = core.referenceCar(), eff = core.effects(co, car, ref);
    const rowH = 42, m = { l: 150, r: 70, t: 34, b: 40 }, H = m.t + eff.length * rowH + m.b;
    const s = svg(host, width, H); s.attr('aria-label', 'Bars showing how much each feature changes the price compared with a typical Fiesta');
    const pcts = eff.map((e) => e.factor - 1), lim = Math.max(0.25, Math.ceil(d3.max(pcts, Math.abs) * 4) / 4);
    const x = d3.scaleLinear([-lim, lim], [m.l, width - m.r]), x0 = x(0);
    const refP = core.predict(co, ref), total = eff.reduce((a, e) => a * e.factor, 1);
    s.append('text').attr('class', 'ink2').attr('x', m.l).attr('y', 14).text(`Starting point: typical Fiesta, about ${fmt.gbp(refP)}`);
    s.append('g').attr('class', 'grid').attr('transform', `translate(0,${m.t - 6})`).call(d3.axisBottom(x).ticks(5).tickSize(H - m.t - m.b + 6).tickFormat('')).call((g) => g.select('.domain').remove());
    s.append('line').attr('x1', x0).attr('x2', x0).attr('y1', m.t - 6).attr('y2', H - m.b).attr('stroke', T.axis);
    s.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(8).tickFormat((d) => (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d * 100).toFixed(0) + '%')).call((g) => g.select('.domain').remove());
    s.append('text').attr('class', 'axis-title').attr('x', (m.l + width - m.r) / 2).attr('y', H - 8).attr('text-anchor', 'middle').text('Effect on price compared with the typical Fiesta');

    const detail = (e) => (e.unit === 'mi' ? `${fmt.n(e.from)} → ${fmt.n(e.to)} mi` : e.unit ? `${(+e.from).toFixed(e.key === 'engineSize' || e.key === 'mpg' ? 1 : 0)} → ${(+e.to).toFixed(e.key === 'engineSize' || e.key === 'mpg' ? 1 : 0)} ${e.unit === '£' ? '(£)' : e.unit}` : `${e.from} → ${e.to}`);
    eff.forEach((e, i) => {
      const yc = m.t + i * rowH + rowH / 2, pct = e.factor - 1, w = Math.abs(x(pct) - x0), th = 22, col = pct >= 0 ? T.pos : T.neg, r = Math.min(4, w);
      const g = s.append('g');
      g.append('text').attr('class', 'ink').attr('x', m.l - 14).attr('y', yc - 2).attr('text-anchor', 'end').attr('font-weight', 600).text(e.label);
      g.append('text').attr('x', m.l - 14).attr('y', yc + 12).attr('text-anchor', 'end').style('font-size', '11px').text(Math.abs(pct) < 5e-4 && e.from === e.to ? 'same as reference' : detail(e));
      if (w > 0.5) {
        // 4px rounded data end, square at the baseline
        const xe = x(pct), dir = pct >= 0 ? 1 : -1, y0 = yc - th / 2, y1 = yc + th / 2;
        g.append('path').attr('fill', col).attr('d', `M${x0},${y0} H${xe - dir * r} Q${xe},${y0} ${xe},${y0 + r} V${y1 - r} Q${xe},${y1} ${xe - dir * r},${y1} H${x0} Z`);
        g.append('text').attr('class', 'ink').attr('x', xe + dir * 8).attr('y', yc + 4).attr('text-anchor', dir > 0 ? 'start' : 'end').text(fmt.signedPct(pct));
      } else g.append('text').attr('class', 'ink2').attr('x', x0 + 8).attr('y', yc + 4).text('no change');
      g.append('rect').attr('x', 0).attr('width', width).attr('y', yc - rowH / 2).attr('height', rowH).attr('fill', 'transparent')
        .on('pointermove', (ev) => tip.show(ev, `${e.label}: ${detail(e)}`, [{ label: 'Multiplies the price by', value: '×' + e.factor.toFixed(3) }, { label: 'Change in price', value: fmt.signedPct(pct) }]))
        .on('pointerleave', () => tip.hide());
    });
    s.append('text').attr('class', 'ink').attr('x', m.l).attr('y', H - m.b + 32 + 0).style('display', 'none');
    const sum = s.append('text').attr('class', 'ink2').attr('x', width - m.r).attr('y', 14).attr('text-anchor', 'end');
    sum.text(`All effects together: ×${total.toFixed(2)}`);
  }

  const refresh = () => { syncControls(); estimate(); bars(); };
  State.on(['car', 'theme'], refresh);
  watch(host, (w) => { width = w; refresh(); });
  window.V4 = { reset() { State.setCar(core.referenceCar(), null); } };
  const note = document.createElement('p'); note.className = 'panel-sub'; note.style.marginTop = '4px';
  { const r = core.referenceCar(); note.textContent = `Reference car: Fiesta, petrol, manual, ${r.age} years old, ${fmt.n(r.mileage)} miles, ${r.engineSize.toFixed(1)} L, ${r.mpg.toFixed(1)} mpg, £${r.tax} tax (the typical values in the cleaned data). Bars multiply, so their order does not matter.`; }
  host.insertAdjacentElement('afterend', note);
})();
