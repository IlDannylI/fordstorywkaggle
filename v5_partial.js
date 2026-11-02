/*
 * View 5 -- partial effects. The car from View 4 is re-priced while ONE variable sweeps its range and everything else is held fixed:
 * left panel = age, right panel = mileage. Grey dots are real cars of the same model and fuel, so you can see where the line is
 * supported by data and where it extrapolates.
 */
(function () {
  'use strict';
  const { core, F, tokens, fmt, tip, watch, svg, clamp } = UI;
  const C = F.cols, co = F.models[6].coefs;
  const $ = (id) => document.getElementById(id);
  const ha = $('v5-a'), hb = $('v5-b');
  const cache = { key: '', pts: [] };
  const PANELS = [
    { id: 'a', host: ha, v: 'age', max: 12, step: 0.2, unit: (x) => `${x.toFixed(1)} yr`, tick: (d) => d, title: 'Age in years (model year 2020 = 0)', win: 0.5, delta: 1, per: 'year' },
    { id: 'b', host: hb, v: 'mileage', max: 120000, step: 2000, unit: (x) => fmt.n(x) + ' mi', tick: (d) => d / 1000 + 'k', title: 'Mileage (miles)', win: 5000, delta: 10000, per: '10,000 miles' },
  ];

  /** deterministic sample (max 500) of real cars with the same model and fuel as the current car */
  function context(car) {
    const key = car.model + '|' + car.fuelType;
    if (cache.key !== key) {
      const rows = core.filter({ models: [car.model], fuel: car.fuelType }), stride = Math.max(1, Math.ceil(rows.length / 500)), pts = [];
      for (let j = 0; j < rows.length; j += stride) pts.push(rows[j]);
      cache.key = key; cache.pts = pts; cache.all = rows;
    }
    return cache;
  }
  const jitter = (i) => ((i * 2654435761) % 1000) / 1000 - 0.5;      // fixed pseudo-random offset so integer ages do not stack

  function render() {
    const car = State.s.car, T = tokens(), ctx = context(car);
    const data = PANELS.map((p) => {
      const xs = d3.range(0, p.max + p.step / 2, p.step), cur = xs.map((x) => core.interval(co, Object.assign({}, car, { [p.v]: x })));
      return { p, xs, cur };
    });
    let ymax = 0;
    data.forEach((d) => d.cur.forEach((r) => { if (r.hi > ymax) ymax = r.hi; }));
    const sp = Array.from(ctx.pts, (i) => C.price[i]).sort((a, b) => a - b); if (sp.length) ymax = Math.max(ymax, sp[Math.floor(sp.length * 0.98)]);
    ymax = Math.min(60000, Math.ceil((ymax * 1.05) / 5000) * 5000);

    data.forEach(({ p, xs, cur }) => {
      const w = p.host.clientWidth; if (!w) return;
      const H = 300, m = { l: 52, r: 14, t: 12, b: 40 }, s = svg(p.host, w, H);
      s.attr('aria-label', `Estimated price of the chosen car as ${p.v} changes`);
      const x = d3.scaleLinear([0, p.max], [m.l, w - m.r]), y = d3.scaleLinear([0, ymax], [H - m.b, m.t]);
      s.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(w - m.l - m.r)).tickFormat(''));
      s.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6).tickFormat(p.tick)).call((g) => g.selectAll('text').attr('dy', '1.2em'));
      s.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8).tickFormat((d) => '£' + d / 1000 + 'k')).call((g) => g.select('.domain').remove());
      s.append('text').attr('class', 'axis-title').attr('x', m.l + (w - m.l - m.r) / 2).attr('y', H - 6).attr('text-anchor', 'middle').text(p.title);
      if (p.id === 'a') s.append('text').attr('class', 'axis-title').attr('transform', `translate(13,${(m.t + H - m.b) / 2}) rotate(-90)`).attr('text-anchor', 'middle').text('Price (£)');

      // real cars (context)
      const g = s.append('g').attr('fill', T.ink3).attr('opacity', 0.28);
      ctx.pts.forEach((i) => {
        const vx = p.v === 'age' ? C.age[i] + jitter(i) * 0.7 : C.mileage[i]; if (vx < 0 || vx > p.max || C.price[i] > ymax) return;
        g.append('circle').attr('cx', x(vx)).attr('cy', y(C.price[i])).attr('r', 2.2);
      });
      // band + line
      s.append('path').attr('d', d3.area().x((d, i) => x(xs[i])).y0((d) => y(d.lo)).y1((d) => y(d.hi)).curve(d3.curveMonotoneX)(cur)).attr('fill', T.s[0]).attr('opacity', 0.12);
      s.append('path').attr('d', d3.line().x((d, i) => x(xs[i])).y((d) => y(d.mid)).curve(d3.curveMonotoneX)(cur)).attr('fill', 'none').attr('stroke', T.s[0]).attr('stroke-width', 2).attr('stroke-linecap', 'round');
      // current car
      const at = clamp(car[p.v], 0, p.max), me = core.interval(co, car);
      s.append('line').attr('x1', x(at)).attr('x2', x(at)).attr('y1', y(0)).attr('y2', y(me.mid)).attr('stroke', T.ink3);
      s.append('circle').attr('cx', x(at)).attr('cy', y(me.mid)).attr('r', 5).attr('fill', T.s[0]).attr('stroke', T.surface).attr('stroke-width', 2);
      s.append('text').attr('class', 'ink').attr('x', x(at) + (at > p.max * 0.7 ? -10 : 10)).attr('y', y(me.mid) - 10).attr('text-anchor', at > p.max * 0.7 ? 'end' : 'start').text(fmt.gbp(me.mid));

      // slope sentence
      const a = Math.max(0, at - p.delta / 2), b = Math.min(p.max, at + p.delta / 2);
      const pa = core.predict(co, Object.assign({}, car, { [p.v]: a })), pb = core.predict(co, Object.assign({}, car, { [p.v]: b })), per = ((pb - pa) / (b - a)) * p.delta;
      $('v5-' + p.id + '-title').textContent = p.v === 'age' ? 'Price as the car ages' : 'Price as the mileage grows';
      $('v5-' + p.id + '-sub').textContent = `${car.model}, ${car.fuelType.toLowerCase()}, ${car.transmission.toLowerCase()}. Near this car, each extra ${p.per} changes the estimate by about ${(per < 0 ? '−' : '+') + fmt.gbp(Math.abs(per))} (${fmt.signedPct(per / me.mid)}).`;

      // crosshair
      const cross = s.append('line').attr('y1', m.t).attr('y2', H - m.b).attr('stroke', T.ink3).style('display', 'none');
      s.append('rect').attr('x', m.l).attr('y', m.t).attr('width', w - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
        .on('pointermove', (ev) => {
          const k = clamp(Math.round(x.invert(d3.pointer(ev)[0]) / p.step), 0, xs.length - 1), xv = xs[k], r = cur[k];
          cross.style('display', null).attr('x1', x(xv)).attr('x2', x(xv));
          const near = []; ctx.all.forEach((i) => { const v = p.v === 'age' ? C.age[i] : C.mileage[i]; if (Math.abs(v - xv) <= p.win) near.push(C.price[i]); });
          near.sort((a2, b2) => a2 - b2);
          tip.show(ev, `${p.v === 'age' ? 'Age' : 'Mileage'} ${p.unit(xv)}`, [
            { color: T.s[0], label: 'Model estimate', value: fmt.gbp(r.mid) }, { label: '80% band', value: `${fmt.gbp(r.lo)} to ${fmt.gbp(r.hi)}` },
            { label: `Real ${car.model} cars within ±${p.v === 'age' ? '0.5 yr' : '5,000 mi'}`, value: near.length ? `${near.length} · median ${fmt.gbp(Core.quantile(near, 0.5))}` : 'none' }]);
        })
        .on('pointerleave', () => { cross.style('display', 'none'); tip.hide(); });
    });
  }
  window.V5 = { reset() {} };
  State.on(['car', 'theme'], render);
  watch(ha, render); watch(hb, render);
})();
