/*
 * main.js -- page wiring: filter bar, reset, theme toggle, and the text sections at the end of the page
 * (insights, limitations, method). Every number in the insights is computed from the data and the fitted models,
 * so the text cannot drift away from what the views show.
 */
(function () {
  'use strict';
  const { core, fmt } = UI;
  const F = window.FORD;
  const $ = (id) => document.getElementById(id);

  /** Tiny DOM builder. Text always goes in through textContent. */
  function h(tag, attrs, kids) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => (k === 'class' ? (el.className = v) : el.setAttribute(k, v)));
    [].concat(kids == null ? [] : kids).forEach((k) => el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k));
    return el;
  }
  function table(head, rows) {
    const t = h('table', { class: 'tbl' });
    t.appendChild(h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, String(x))))));
    t.appendChild(h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, String(c)))))));
    return h('div', { class: 'tbl-scroll' }, t);
  }

  // ---------------------------------------------------------------- filter bar
  const chips = $('model-chips'), add = $('model-add');
  const allModels = F.levels.model;

  function renderModels() {
    chips.textContent = '';
    State.s.models.forEach((m) => {
      const b = h('button', { class: 'chip', type: 'button', 'aria-label': 'Remove ' + m + ' from the comparison' }, [
        h('i', { style: 'background:' + State.modelColor(m) }), m + ' ×']);
      b.onclick = () => State.toggleModel(m);
      chips.appendChild(b);
    });
    add.textContent = '';
    const full = State.s.models.length >= UI.MAX_MODELS;
    add.appendChild(h('option', { value: '' }, full ? 'Remove one to add another' : 'Add a model…'));
    allModels.filter((m) => !State.s.models.includes(m)).forEach((m) => add.appendChild(h('option', { value: m }, m)));
    add.disabled = full;
    add.value = '';
  }
  function syncFilters() {
    $('f-fuel').value = State.s.fuel || '';
    $('f-trans').value = State.s.trans || '';
    $('f-age-min').value = State.s.ageMin;
    $('f-age-max').value = State.s.ageMax;
    const n = State.idx().length;
    $('match-count').textContent = fmt.n(n) + ' of ' + fmt.n(core.N) + ' cars match' + (n === 0 ? ' – widen the filters' : '');
  }
  add.onchange = () => { if (add.value) State.toggleModel(add.value); };
  $('f-fuel').onchange = (e) => State.set({ fuel: e.target.value || null });
  $('f-trans').onchange = (e) => State.set({ trans: e.target.value || null });
  function ageInput() {
    let lo = Math.round(+$('f-age-min').value), hi = Math.round(+$('f-age-max').value);
    lo = UI.clamp(isFinite(lo) ? lo : 0, 0, 12); hi = UI.clamp(isFinite(hi) ? hi : 12, 0, 12);
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    State.set({ ageMin: lo, ageMax: hi });
    syncFilters();
  }
  $('f-age-min').onchange = ageInput; $('f-age-max').onchange = ageInput;

  State.on(['models'], renderModels);
  State.on(['models', 'fuel', 'trans', 'age'], syncFilters);

  $('reset-all').onclick = () => {
    State.resetFilters();
    ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'].forEach((v) => window[v] && window[v].reset && window[v].reset());
    renderModels(); syncFilters();
  };

  // ---------------------------------------------------------------- theme
  const root = document.documentElement, tb = $('theme-btn');
  const isDark = () => root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  function themeLabel() { tb.textContent = isDark() ? 'Light theme' : 'Dark theme'; }
  tb.onclick = () => { root.dataset.theme = isDark() ? 'light' : 'dark'; themeLabel(); State.themeChanged(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { themeLabel(); State.themeChanged(); });
  themeLabel();

  // ---------------------------------------------------------------- numbers used in the text
  const C = F.cols, N = core.N;
  function corr(a, b) {
    let ma = 0, mb = 0; for (let i = 0; i < N; i++) { ma += a[i]; mb += b[i]; } ma /= N; mb /= N;
    let sa = 0, sb = 0, sab = 0;
    for (let i = 0; i < N; i++) { const x = a[i] - ma, y = b[i] - mb; sa += x * x; sb += y * y; sab += x * y; }
    return sab / Math.sqrt(sa * sb);
  }
  const rAgeMiles = corr(C.age, C.mileage);
  const co = F.models[6].coefs, step = (i) => F.models[i].metrics.test;
  const perYear = 1 - Math.exp(co.age), per10k = 1 - Math.exp(co.m10);
  const diesel = Math.exp(co['fuelType=Diesel']) - 1, auto = Math.exp(co['transmission=Automatic']) - 1;
  const eng01 = Math.exp(0.5 * co.engineSize) - 1;                // +0.5 L engine
  const hold = core.metrics(6, core.filter({})), heldOut = step(6);

  // biggest single drop in test RMSE among the steps AFTER age and mileage (steps 3..6)
  let best = 3;
  for (let i = 4; i < F.models.length; i++) if (step(i - 1).rmse - step(i).rmse > step(best - 1).rmse - step(best).rmse) best = i;
  const gain = (i) => step(i - 1).rmse - step(i).rmse;

  // ---------------------------------------------------------------- insights
  const insights = [
    ['Age is the biggest single lever',
      `With everything else held fixed, each extra year of age lowers the model's price by about ${(perYear * 100).toFixed(0)}%. ` +
      `Adding age alone cuts the typical error on held-out cars from ${fmt.gbp(step(0).rmse)} to ${fmt.gbp(step(1).rmse)} (View 6, steps 0→1).`],
    ['Mileage matters, but less than it looks',
      `Age and mileage move together (correlation ${rAgeMiles.toFixed(2)}), so most of what mileage seems to explain is already explained by age: ` +
      `adding mileage only trims the error from ${fmt.gbp(step(1).rmse)} to ${fmt.gbp(step(2).rmse)}. ` +
      `Holding age fixed, 10,000 extra miles cost about ${(per10k * 100).toFixed(1)}% (View 5).`],
    ['Which car it is matters, not just how old it is',
      `After age and mileage, the biggest single improvement comes from "${F.models[best].label}", which removes ${fmt.gbp(gain(best))} of typical error. ` +
      `All eight features together reach ${fmt.gbp(heldOut.rmse)} typical error and R² = ${heldOut.r2_price.toFixed(2)} on cars the model never saw.`],
    ['Small premiums, large uncertainty',
      `At the same age, mileage and model, a diesel is priced about ${Math.abs(diesel * 100).toFixed(0)}% ${diesel < 0 ? 'below' : 'above'} a petrol, ` +
      `an automatic about ${(auto * 100).toFixed(0)}% above a manual, and +0.5 L of engine about ${(eng01 * 100).toFixed(0)}% more. ` +
      `A typical prediction is still off by about ${(hold.medAPE * 100).toFixed(0)}% (median), so these are tendencies, not guarantees.`],
  ];
  const insEl = $('insights');
  insights.forEach(([t, p]) => insEl.appendChild(h('div', { class: 'insight' }, [h('h4', {}, t), h('p', {}, p)])));

  // ---------------------------------------------------------------- limitations
  const limits = [
    'These are asking prices from one snapshot, not sale prices. Dealers negotiate, so real transaction prices are lower and more scattered.',
    'We compare different cars of different ages at one moment. We never watch the same car age, so "each year costs X%" mixes real depreciation with differences between model-year cohorts (older cars were also built and equipped differently).',
    'The file does not state a currency or listing date. Prices are shown in £ and age is counted from 2020 (the newest model year); if the listings were scraped in a different year, every age shifts by a constant but the shapes stay the same.',
    'Age, mileage, engine size, fuel economy and road tax are tangled together (for example, newer cars often have lower tax bands). The coefficients are associations, not the effect of changing one thing on a given car. Mpg and tax add almost nothing once other features are in.',
    `The model is a straight-line fit of ln(price). It is a deliberate, transparent simplification; it misses curvature at the oldest ages, and View 6 shows where it is worst. The 80% band is the range where 80% of training errors fell, not a guarantee for one car.`,
    'The 80/20 split is random, not by time, and hybrids, electrics and five rare models were removed (see cleaning steps). The results say nothing about those cars, and thin groups (fewer than 15 cars) are not drawn as medians.',
    'Where "similar cars" in View 4 reports zero real matches, the estimate is an extrapolation and should not be trusted.',
  ];
  const limEl = $('limits');
  limits.forEach((t) => limEl.appendChild(h('li', {}, t)));

  // ---------------------------------------------------------------- method
  const M = $('method');
  const sec = (title, body, open) => M.appendChild(h('details', open ? { open: '' } : {}, [h('summary', {}, title)].concat(body)));
  const r = F.meta.ranges;
  sec('1. Source and variables', [
    h('p', {}, ['Source: ', h('a', { href: F.meta.url }, 'Kaggle – Ford Car Price Prediction (ford.csv)'), '. 17,966 raw rows, 9 columns.']),
    table(['Variable', 'Meaning', 'Unit', 'Range in cleaned data'], [
      ['model', 'Ford model name (18 kept)', 'category', '18 models'],
      ['year', 'Model (registration) year', 'year', '2010–2020 mostly'],
      ['age (derived)', '2020 minus year', 'years', `${r.age.min}–${r.age.max} (median ${r.age.median})`],
      ['price', 'Asking price', '£ (assumed)', `${fmt.gbp(r.price.min)}–${fmt.gbp(r.price.max)}`],
      ['mileage', 'Distance driven', 'miles', `${fmt.n(r.mileage.min)}–${fmt.n(r.mileage.max)}`],
      ['engineSize', 'Engine capacity', 'litres', `${r.engineSize.min}–${r.engineSize.max}`],
      ['mpg', 'Advertised fuel economy', 'miles per gallon', `${r.mpg.min}–${r.mpg.max}`],
      ['tax', 'Annual road tax', '£', `${r.tax.min}–${r.tax.max}`],
      ['fuelType, transmission', 'Petrol/Diesel; Manual/Automatic/Semi-Auto', 'category', '–'],
    ]),
  ]);
  sec('2. Cleaning: what was removed, and why', [
    table(['Step', 'Rows left', 'Removed', 'Reason'], F.meta.cleaning.map((c) => [c.step, fmt.n(c.rows_after), fmt.n(c.rows_removed), c.why])),
    h('p', {}, 'No value was filled in or guessed: a row with an impossible value is dropped, never repaired. The file has no empty cells. Medians (not means) are used for typical prices because a few very expensive cars would drag a mean upward; a group needs at least 15 cars before a median is drawn.'),
  ]);
  const rawS = F.sample.raw, cleanS = F.sample.clean;
  sec('3. Sample records, before and after cleaning', [
    h('p', {}, 'First rows of the raw file (note the leading space in model names):'),
    table(Object.keys(rawS[0]), rawS.slice(0, 5).map((o) => Object.values(o).map((v) => JSON.stringify(v).replace(/^"|"$/g, '␣').replace(/\\"/g, '"')))),
    h('p', {}, 'The same kind of rows after cleaning, with derived columns:'),
    table(Object.keys(cleanS[0]), cleanS.slice(0, 5).map((o) => Object.values(o))),
  ]);
  sec('4. The model and its equations', [
    h('p', {}, 'ln(price) = b0 + b_age·age + b_mileage·(miles/10,000) + b_engine·litres + b_mpg·mpg + b_tax·tax + gearbox + fuel + model'),
    h('p', {}, 'Fit by ordinary least squares on a random 80% training split (seed ' + F.meta.seed + '). Seven nested versions add one group of features at a time. Reference category: Fiesta, petrol, manual. A coefficient b changes the price by a factor exp(b·Δx), so effects multiply and their order does not matter.'),
    table(['Step', 'Added', 'Held-out RMSE (£)', 'Held-out R²', 'Held-out MAE (£)'], F.models.map((m, i) => [i, m.label, fmt.n(m.metrics.test.rmse), m.metrics.test.r2_price.toFixed(3), fmt.n(m.metrics.test.mae)])),
  ]);
  sec('5. Verification (run by tests/verify.py: independent pandas/NumPy vs this app’s own code)', [
    h('p', {}, `${VERIFY.passed} of ${VERIFY.total} checks passed.`),
    table(['ID', 'Type', 'Check', 'Expected', 'App', 'Result'], VERIFY.results.map((c) => [c.id, c.kind, c.desc, JSON.stringify(c.expected), JSON.stringify(c.actual), c.ok ? 'PASS' : 'FAIL'])),
  ]);
  sec('6. Reproduce it', [
    h('p', {}, 'From the project folder: python3 prep/prepare_data.py (rebuilds data/processed/* and app/data.js), then python3 tests/verify.py (needs Node), then open app/index.html in any modern browser. No server or internet connection is needed: D3 is bundled in app/vendor.'),
  ]);

  // ---------------------------------------------------------------- start
  renderModels();
  syncFilters();
})();
