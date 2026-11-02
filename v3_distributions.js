/*
 * View 3 -- scenario comparison: price distributions of groups of cars (picked models, petrol vs diesel, or gearboxes).
 * Inputs : filter bar + "Compare" switch. Output: D3 SVG density curves with medians, hover counts, summary table.
 * Method : Gaussian kernel density, fixed bandwidth of £800 so groups are comparable; computed in core.js (kde).
 */
(function () {
  'use strict';
  const { core, F, tokens, fmt, tip, watch, svg, clamp } = UI;
  const C = F.cols, L = F.levels;
  const PRICE_MAX = 35000, BW = 800, STEP = 250;
  const $ = (id) => document.getElementById(id);
  const host = $('v3-chart');
  let group = 'model', width = 0;
  const xs = d3.range(0, PRICE_MAX + STEP, STEP);

  function groups() {
    const idx = State.idx(), T = tokens(), by = (fn) => { const m = new Map(); idx.forEach((i) => { const k = fn(i); if (!m.has(k)) m.set(k, []); m.get(k).push(i); }); return m; };
    let out = [];
    if (group === 'model') {
      if (!State.s.models.length) out = [{ label: 'All models', color: T.s[0], rows: Array.from(idx) }];
      else { const m = by((i) => C.mi[i]); out = State.s.models.map((n) => ({ label: n, color: State.modelColor(n), rows: m.get(core.modelIdx.get(n)) || [] })); }
    } else if (group === 'fuel') { const m = by((i) => C.fu[i]); out = L.fuel.map((n, k) => ({ label: n, color: T.s[k], rows: m.get(k) || [] })); }
    else { const m = by((i) => C.tr[i]); out = L.trans.map((n, k) => ({ label: n, color: T.s[k], rows: m.get(k) || [] })); }
    return out.filter((g) => g.rows.length).map((g) => {
      const rows = Int32Array.from(g.rows), dens = core.kde(rows, xs, BW).map((d) => d * 1000);
      return Object.assign(g, { rows, dens, sum: core.priceSummary(rows) });
    });
  }

  function render() {
    if (!width) return;
    const T = tokens(), gs = groups(), H = clamp(Math.round(width * 0.36), 280, 380), m = { l: 56, r: 24, t: 14, b: 42 };
    const s = svg(host, width, H); s.attr('aria-label', 'Overlapping price distributions for the groups being compared');
    renderLegend(gs); renderTable(gs);
    if (!gs.length) { s.append('text').attr('x', width / 2).attr('y', H / 2).attr('text-anchor', 'middle').text('No cars match these filters.'); return; }
    const ymax = d3.max(gs, (g) => d3.max(g.dens)) * 1.12;
    const x = d3.scaleLinear([0, PRICE_MAX], [m.l, width - m.r]), y = d3.scaleLinear([0, ymax], [H - m.b, m.t]);
    s.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(width - m.l - m.r)).tickFormat(''));
    s.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(7).tickFormat((d) => '£' + d / 1000 + 'k')).call((g) => g.selectAll('text').attr('dy', '1.2em'));
    s.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(8).tickFormat((d) => d3.format('.0%')(d))).call((g) => g.select('.domain').remove());
    s.append('text').attr('class', 'axis-title').attr('x', m.l + (width - m.l - m.r) / 2).attr('y', H - 6).attr('text-anchor', 'middle').text('Asking price (£)');
    s.append('text').attr('class', 'axis-title').attr('transform', `translate(14,${(m.t + H - m.b) / 2}) rotate(-90)`).attr('text-anchor', 'middle').text('Share of the group’s cars per £1,000');

    const area = d3.area().x((d, i) => x(xs[i])).y0(y(0)).y1((d) => y(d)).curve(d3.curveMonotoneX);
    const line = d3.line().x((d, i) => x(xs[i])).y((d) => y(d)).curve(d3.curveMonotoneX);
    const tags = [];
    gs.forEach((g) => {
      s.append('path').attr('d', area(g.dens)).attr('fill', g.color).attr('opacity', 0.1);
      s.append('path').attr('d', line(g.dens)).attr('fill', 'none').attr('stroke', g.color).attr('stroke-width', 2).attr('stroke-linejoin', 'round');
      // median marker: hairline from the axis to the curve, with a ringed end dot
      const md = clamp(g.sum.median, 0, PRICE_MAX), yi = d3.bisectLeft(xs, md), yd = g.dens[Math.min(yi, xs.length - 1)];
      s.append('line').attr('x1', x(md)).attr('x2', x(md)).attr('y1', y(0)).attr('y2', y(yd)).attr('stroke', g.color).attr('stroke-width', 1).attr('stroke-dasharray', null);
      s.append('circle').attr('cx', x(md)).attr('cy', y(yd)).attr('r', 4).attr('fill', g.color).attr('stroke', T.surface).attr('stroke-width', 2);
      const pk = d3.maxIndex(g.dens); tags.push({ g, x: x(xs[pk]), y: y(g.dens[pk]) });
    });
    tags.sort((a, b) => a.y - b.y);
    for (let i = 1; i < tags.length; i++) if (Math.abs(tags[i].x - tags[i - 1].x) < 90) tags[i].y = Math.max(tags[i].y, tags[i - 1].y + 15);
    tags.forEach((t) => s.append('text').attr('class', 'ink2').attr('x', t.x + 8).attr('y', t.y - 8).text(t.g.label));

    const cross = s.append('line').attr('y1', m.t).attr('y2', H - m.b).attr('stroke', T.ink3).style('display', 'none');
    s.append('rect').attr('x', m.l).attr('y', m.t).attr('width', width - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', (ev) => {
        const p = clamp(Math.round(x.invert(d3.pointer(ev)[0]) / STEP) * STEP, 0, PRICE_MAX);
        cross.style('display', null).attr('x1', x(p)).attr('x2', x(p));
        tip.show(ev, `Cars priced within £500 of ${fmt.gbp(p)}`, gs.map((g) => {
          let k = 0; g.rows.forEach((i) => { if (Math.abs(C.price[i] - p) <= 500) k++; });
          return { color: g.color, label: g.label, value: `${fmt.n(k)} cars · ${fmt.pct(k / g.rows.length, 1)}` };
        }));
      })
      .on('pointerleave', () => { cross.style('display', 'none'); tip.hide(); });
  }

  function renderLegend(gs) {
    const lg = $('v3-legend'); lg.textContent = '';
    gs.forEach((g) => { const sp = document.createElement('span'), k = document.createElement('i'); k.style.borderColor = g.color; sp.append(k, `${g.label} (${fmt.n(g.rows.length)} cars)`); lg.appendChild(sp); });
    const sp = document.createElement('span'); sp.textContent = 'Dot and line mark each group’s median.'; lg.appendChild(sp);
  }
  function renderTable(gs) {
    const box = $('v3-table'); box.textContent = '';
    if (!gs.length) return;
    const t = document.createElement('table'); t.className = 'tbl';
    const hr = t.createTHead().insertRow(); ['Group', 'Cars', 'Median price', 'Middle half of cars (Q1 to Q3)'].forEach((h) => { const c = document.createElement('th'); c.textContent = h; hr.appendChild(c); });
    const b = t.createTBody();
    gs.forEach((g) => { const r = b.insertRow(); r.insertCell().textContent = g.label + (g.rows.length < 30 ? ' (few cars: curve unreliable)' : ''); r.insertCell().textContent = fmt.n(g.sum.n); r.insertCell().textContent = fmt.gbp(g.sum.median); r.insertCell().textContent = `${fmt.gbp(g.sum.q25)} to ${fmt.gbp(g.sum.q75)}`; });
    box.appendChild(t);
  }
  function sync() { document.querySelectorAll('[data-g]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.g === group)); }
  document.querySelectorAll('[data-g]').forEach((b) => { b.onclick = () => { group = b.dataset.g; sync(); render(); }; });

  window.V3 = { reset() { group = 'model'; sync(); render(); } };
  State.on(['models', 'fuel', 'trans', 'age', 'theme'], render);
  watch(host, (w) => { width = w; render(); });
  sync();
})();
