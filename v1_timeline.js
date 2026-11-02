/*
 * View 1 -- depreciation timeline. Median asking price by age, one line per model, revealed progressively by an age cursor.
 * Inputs : filter bar (models picked, fuel, gearbox) + local controls (cursor, play/pause/step, price vs % of year-1 price).
 * Output : SVG built with D3 (grey context lines for every model, coloured lines for the picked models).
 */
(function () {
  'use strict';
  const { core, F, tokens, fmt, tip, watch, svg, clamp } = UI;
  const MIN_BIN = 15;       // a median of fewer cars than this is not drawn
  const XMAX = 10;          // ages beyond 10 years have too few cars for most models
  const $ = (id) => document.getElementById(id);
  const host = $('v1-chart');

  let cursor = XMAX, playing = false, mode = 'price', raf = 0, last = 0, width = 0, cacheIdx = null, cacheBy = null;

  function medians() {
    const idx = State.idxNoModel();
    if (idx !== cacheIdx) { cacheIdx = idx; cacheBy = core.medianByModelAge(idx, MIN_BIN); }
    return cacheBy;
  }
  /** value by age (0..XMAX) for one model: null where the bin is thin or missing. */
  function track(rows) {
    const price = new Array(XMAX + 1).fill(null), n = new Array(XMAX + 1).fill(0), q = new Array(XMAX + 1).fill(null);
    (rows || []).forEach((r) => { if (r.age <= XMAX) { n[r.age] = r.n; if (!r.thin) { price[r.age] = r.median; q[r.age] = [r.q25, r.q75]; } } });
    let base = null;
    for (let a = 1; a <= XMAX && base == null; a++) if (price[a] != null) base = a;
    const pct = price.map((p) => (p == null || base == null ? null : (p / price[base]) * 100));
    return { price, n, q, pct, base };
  }
  const val = (t, a) => (mode === 'price' ? t.price[a] : t.pct[a]);

  function render() {
    if (!width) return;
    const T = tokens(), by = medians(), sel = State.s.models;
    const names = [...by.keys()];
    const tracks = new Map(names.map((m) => [m, track(by.get(m))]));
    const H = clamp(Math.round(width * 0.44), 300, 440);
    const m = { l: 56, r: 96, t: 14, b: 40 };
    const s = svg(host, width, H);
    s.attr('aria-label', 'Line chart of median asking price against age for each Ford model');
    if (!names.length) { s.append('text').attr('x', width / 2).attr('y', H / 2).attr('text-anchor', 'middle').text('No cars match these filters. Loosen fuel or gearbox.'); renderTiles(tracks); return; }

    let ymax = 0;
    tracks.forEach((t) => (mode === 'price' ? t.price : t.pct).forEach((v) => { if (v != null && v > ymax) ymax = v; }));
    ymax = mode === 'price' ? Math.ceil((ymax * 1.04) / 5000) * 5000 : Math.max(110, Math.ceil(ymax / 10) * 10);
    const x = d3.scaleLinear([0, XMAX], [m.l, width - m.r]);
    const y = d3.scaleLinear([0, ymax], [H - m.b, m.t]);

    // grid + axes
    s.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-(width - m.l - m.r)).tickFormat(''));
    s.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).ticks(XMAX).tickFormat((d) => d)).call((g) => g.selectAll('text').attr('dy', '1.2em'));
    s.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8).tickFormat((d) => (mode === 'price' ? '£' + d / 1000 + 'k' : d + '%')))
      .call((g) => g.select('.domain').remove());
    s.append('text').attr('class', 'axis-title').attr('x', m.l + (width - m.l - m.r) / 2).attr('y', H - 6).attr('text-anchor', 'middle')
      .text('Age in years (model year 2020 = 0)');
    s.append('text').attr('class', 'axis-title').attr('transform', `translate(14,${(m.t + H - m.b) / 2}) rotate(-90)`).attr('text-anchor', 'middle')
      .text(mode === 'price' ? 'Median price (£)' : 'Median price as % of the age-1 median');
    if (mode === 'pct') s.append('line').attr('x1', m.l).attr('x2', width - m.r).attr('y1', y(100)).attr('y2', y(100)).attr('stroke', T.axis);

    // active age window (from the filter bar), only drawn when it is narrower than the full axis
    const { ageMin, ageMax } = State.s;
    if (ageMin > 0 || ageMax < XMAX) {
      s.append('rect').attr('x', x(ageMin - 0.5)).attr('width', Math.max(0, x(Math.min(ageMax, XMAX) + 0.5) - x(ageMin - 0.5))).attr('y', m.t)
        .attr('height', H - m.b - m.t).attr('fill', T.ink3).attr('opacity', 0.1);
    }

    // line builder for a track, truncated at the cursor (interpolating inside the last year)
    const upTo = (t) => {
      const pts = [], c = Math.min(cursor, XMAX), a0 = Math.floor(c);
      for (let a = 0; a <= a0; a++) pts.push(val(t, a) == null ? null : { x: a, y: val(t, a) });
      const f = c - a0;
      if (f > 1e-6 && a0 < XMAX && val(t, a0) != null && val(t, a0 + 1) != null) pts.push({ x: c, y: val(t, a0) + f * (val(t, a0 + 1) - val(t, a0)) });
      return pts;
    };
    const line = d3.line().defined((d) => d != null).x((d) => x(d.x)).y((d) => y(d.y)).curve(d3.curveMonotoneX);

    // grey context: every model that is not picked
    const ctx = s.append('g').attr('fill', 'none').attr('stroke', T.ink3).attr('stroke-opacity', 0.38).attr('stroke-width', 1);
    names.filter((n) => !sel.includes(n)).forEach((n) => ctx.append('path').attr('d', line(upTo(tracks.get(n)))));

    // picked models: 2px line + end dot with a 2px surface ring + direct label
    const ends = [];
    sel.forEach((n) => {
      const t = tracks.get(n); if (!t) return;
      const col = State.modelColor(n), pts = upTo(t);
      s.append('path').attr('d', line(pts)).attr('fill', 'none').attr('stroke', col).attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
      const lastPt = [...pts].reverse().find((p) => p);
      if (lastPt) {
        s.append('circle').attr('cx', x(lastPt.x)).attr('cy', y(lastPt.y)).attr('r', 4).attr('fill', col).attr('stroke', T.surface).attr('stroke-width', 2);
        ends.push({ n, x: x(lastPt.x), y: y(lastPt.y) });
      }
    });
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) ends[i].ly = Math.max(ends[i].y, (ends[i - 1].ly ?? ends[i - 1].y) + 14);
    ends.forEach((e) => s.append('text').attr('class', 'ink2').attr('x', e.x + 10).attr('y', (e.ly ?? e.y) + 4).text(e.n));

    // crosshair + tooltip (snaps to a whole year)
    const cross = s.append('g').style('display', 'none');
    cross.append('line').attr('y1', m.t).attr('y2', H - m.b).attr('stroke', T.ink3).attr('stroke-width', 1);
    const dots = cross.append('g');
    s.append('rect').attr('x', m.l).attr('y', m.t).attr('width', width - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', (ev) => {
        const [px] = d3.pointer(ev), a = clamp(Math.round(x.invert(px)), 0, XMAX);
        cross.style('display', null).select('line').attr('x1', x(a)).attr('x2', x(a));
        dots.selectAll('*').remove();
        const rows = [];
        sel.forEach((n) => {
          const t = tracks.get(n); if (!t) return;
          const v = a <= cursor + 1e-6 ? val(t, a) : null;
          if (v != null) dots.append('circle').attr('cx', x(a)).attr('cy', y(v)).attr('r', 4).attr('fill', State.modelColor(n)).attr('stroke', T.surface).attr('stroke-width', 2);
          rows.push({ color: State.modelColor(n), label: n, value: v == null ? (t.n[a] ? `n=${t.n[a]} (too few)` : 'no cars') : (mode === 'price' ? fmt.gbp(v) : v.toFixed(0) + '%') + `  · n=${t.n[a]}` });
        });
        tip.show(ev, `Age ${a} · model year ${fmt.year(a)}${a > cursor ? ' (not drawn yet)' : ''}`, rows.length ? rows : [{ label: 'Pick models in the filter bar to see values' }]);
      })
      .on('pointerleave', () => { cross.style('display', 'none'); tip.hide(); });

    renderTiles(tracks);
  }

  function renderTiles(tracks) {
    const box = $('v1-tiles'), a = clamp(Math.round(cursor), 0, XMAX), sel = State.s.models;
    box.textContent = '';
    if (!sel.length) { const p = document.createElement('p'); p.className = 'panel-sub'; p.textContent = 'No models picked: showing every model in grey. Pick up to three models in the filter bar to highlight them.'; box.appendChild(p); }
    sel.forEach((n) => {
      const t = tracks.get(n), tile = document.createElement('div'); tile.className = 'tile';
      const lab = document.createElement('div'); lab.className = 't-label';
      const dot = document.createElement('i'); dot.style.background = State.modelColor(n); lab.appendChild(dot); lab.appendChild(document.createTextNode(`${n} at age ${a}`));
      const v = document.createElement('div'); v.className = 't-value'; const sub = document.createElement('div'); sub.className = 't-sub';
      if (!t) { v.textContent = '–'; sub.textContent = 'No cars of this model pass the filters.'; }
      else if (t.price[a] == null) { v.textContent = '–'; sub.textContent = t.n[a] ? `Only ${t.n[a]} cars at this age (fewer than ${MIN_BIN}), so no median is shown.` : 'No cars of this model at this age.'; }
      else {
        v.textContent = fmt.gbp(t.price[a]);
        sub.textContent = (t.pct[a] != null && t.base != null ? `${t.pct[a].toFixed(0)}% of its age-${t.base} price · ` : '') + `${fmt.n(t.n[a])} cars`;
      }
      tile.append(lab, v, sub); box.appendChild(tile);
    });
    // legend (identity never relies on colour alone: names also appear as direct labels)
    const lg = $('v1-legend'); lg.textContent = '';
    sel.forEach((n) => { const sp = document.createElement('span'); const k = document.createElement('i'); k.style.borderColor = State.modelColor(n); sp.append(k, document.createTextNode(n)); lg.appendChild(sp); });
    const g = document.createElement('span'); const gk = document.createElement('i'); gk.style.borderColor = tokens().ink3; gk.style.opacity = 0.5;
    g.append(gk, document.createTextNode(`All other models (median shown only where ${MIN_BIN}+ cars)`)); lg.appendChild(g);
    // table view
    const tb = $('v1-table'); tb.textContent = '';
    if (sel.length) {
      const t = document.createElement('table'); t.className = 'tbl';
      const hr = t.createTHead().insertRow(); ['Age (model year)', ...sel].forEach((h) => { const c = document.createElement('th'); c.textContent = h; hr.appendChild(c); });
      const body = t.createTBody();
      for (let age = 0; age <= XMAX; age++) {
        const r = body.insertRow(); r.insertCell().textContent = `${age} (${fmt.year(age)})`;
        sel.forEach((n) => { const tr = tracks.get(n); r.insertCell().textContent = !tr ? '–' : tr.price[age] == null ? (tr.n[age] ? `n=${tr.n[age]} (too few)` : '–') : `${fmt.gbp(tr.price[age])} (n=${fmt.n(tr.n[age])})`; });
      }
      tb.appendChild(t);
    }
  }

  // ---------- controls ----------
  function syncControls() {
    $('v1-scrub').value = cursor; $('v1-play').textContent = playing ? 'Pause' : 'Play';
    const a = clamp(Math.round(cursor), 0, XMAX);
    $('v1-age-out').textContent = `age ${cursor >= XMAX - 1e-6 || Math.abs(cursor - a) < 0.025 ? a : cursor.toFixed(1)} (model year ${fmt.year(a)})`;
    $('v1-m-price').setAttribute('aria-pressed', mode === 'price'); $('v1-m-pct').setAttribute('aria-pressed', mode === 'pct');
  }
  function stop() { playing = false; cancelAnimationFrame(raf); syncControls(); }
  function tick(ts) {
    if (!playing) return;
    const dt = Math.min(0.1, (ts - last) / 1000); last = ts;
    cursor = Math.min(XMAX, cursor + dt * 1.15);
    render(); syncControls();
    if (cursor >= XMAX) { stop(); return; }
    raf = requestAnimationFrame(tick);
  }
  function play() {
    if (playing) { stop(); return; }
    if (cursor >= XMAX - 1e-6) cursor = 0;
    playing = true; last = performance.now(); syncControls(); raf = requestAnimationFrame(tick);
  }
  $('v1-play').onclick = play;
  $('v1-back').onclick = () => { stop(); cursor = clamp(Math.round(cursor) - 1, 0, XMAX); render(); syncControls(); };
  $('v1-fwd').onclick = () => { stop(); cursor = clamp(Math.round(cursor) + 1, 0, XMAX); render(); syncControls(); };
  $('v1-scrub').oninput = (e) => { stop(); cursor = +e.target.value; render(); syncControls(); };
  $('v1-m-price').onclick = () => { mode = 'price'; render(); syncControls(); };
  $('v1-m-pct').onclick = () => { mode = 'pct'; render(); syncControls(); };

  window.V1 = {
    reset() { stop(); cursor = XMAX; mode = 'price'; render(); syncControls(); },
    autoplay() { cursor = 0; render(); play(); },
  };
  State.on(['models', 'fuel', 'trans', 'age', 'theme'], render);
  watch(host, (w) => { width = w; render(); });
  syncControls();
})();
