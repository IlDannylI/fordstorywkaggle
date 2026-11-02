/*
 * core.js  --  pure data/model logic (no DOM).
 * Used by the browser app AND by tests/core_cli.js, so the numbers on screen are exactly the numbers that get verified.
 *
 * Model: ln(price) = b0 + b_age*age + b_m10*(mileage/10,000) + b_eng*engineSize + b_mpg*mpg + b_tax*tax
 *                    + gearbox effect + fuel effect + model effect          (coefficients come from prep/prepare_data.py)
 */
(function (root) {
  'use strict';

  // ---------- small statistics helpers ----------
  /** Quantile of an ascending-sorted array, linear interpolation (same as numpy / pandas default). */
  function quantile(sorted, q) {
    const n = sorted.length;
    if (!n) return NaN;
    const h = (n - 1) * q, lo = Math.floor(h), hi = Math.ceil(h);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
  }
  const sortedCopy = (a) => Float64Array.from(a).sort();

  function create(F) {
    const C = F.cols, L = F.levels, N = C.price.length;
    const modelIdx = new Map(L.model.map((m, i) => [m, i]));
    const fuelIdx = new Map(L.fuel.map((m, i) => [m, i]));
    const transIdx = new Map(L.trans.map((m, i) => [m, i]));
    const predCache = new Map();

    /** One row as a plain "car" object. mileage is in miles. */
    function carAt(i) {
      return {
        row: i, model: L.model[C.mi[i]], fuelType: L.fuel[C.fu[i]], transmission: L.trans[C.tr[i]],
        age: C.age[i], mileage: C.mileage[i], engineSize: C.eng[i], mpg: C.mpg[i], tax: C.tax[i],
        price: C.price[i], isTest: C.test[i] === 1,
      };
    }

    /**
     * Row indices that match the filter.
     * opts.models: null = all models, [] = none | opts.fuel / opts.trans: null = all, else a level name
     * opts.ageMin/ageMax: inclusive | opts.test: null = all rows, 1 = test split only, 0 = training split only
     */
    function filter(opts) {
      opts = opts || {};
      const mset = opts.models ? new Set(opts.models.map((m) => modelIdx.get(m))) : null;
      const fu = opts.fuel != null ? (fuelIdx.has(opts.fuel) ? fuelIdx.get(opts.fuel) : -99) : null;
      const tr = opts.trans != null ? (transIdx.has(opts.trans) ? transIdx.get(opts.trans) : -99) : null;
      const a0 = opts.ageMin != null ? opts.ageMin : -Infinity, a1 = opts.ageMax != null ? opts.ageMax : Infinity;
      const t = opts.test == null ? null : opts.test;
      const out = [];
      for (let i = 0; i < N; i++) {
        if (mset && !mset.has(C.mi[i])) continue;
        if (fu !== null && C.fu[i] !== fu) continue;
        if (tr !== null && C.tr[i] !== tr) continue;
        if (C.age[i] < a0 || C.age[i] > a1) continue;
        if (t !== null && C.test[i] !== t) continue;
        out.push(i);
      }
      return Int32Array.from(out);
    }

    // ---------- model ----------
    function predictLn(co, car) {
      let s = co.intercept;
      for (const k in co) {
        if (k === 'intercept') continue;
        const j = k.indexOf('=');
        if (j < 0) s += co[k] * (k === 'm10' ? car.mileage / 1e4 : car[k]);
        else if (car[k.slice(0, j)] === k.slice(j + 1)) s += co[k];
      }
      return s;
    }
    const predict = (co, car) => Math.exp(predictLn(co, car));
    /** 10th-90th percentile band from the training residuals of the full model (in ln space). */
    function interval(co, car) {
      const l = predictLn(co, car);
      return { lo: Math.exp(l + F.resid.q10), mid: Math.exp(l), hi: Math.exp(l + F.resid.q90) };
    }

    /** Predicted price for every row under model step k (0..6); cached. */
    function predAll(k) {
      if (predCache.has(k)) return predCache.get(k);
      const co = F.models[k].coefs;
      const addM = L.model.map((m) => co['model=' + m] || 0);
      const addF = L.fuel.map((m) => co['fuelType=' + m] || 0);
      const addT = L.trans.map((m) => co['transmission=' + m] || 0);
      const a = co.age || 0, m10 = co.m10 || 0, e = co.engineSize || 0, g = co.mpg || 0, t = co.tax || 0;
      const out = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        out[i] = Math.exp(co.intercept + a * C.age[i] + m10 * (C.mileage[i] / 1e4) + e * C.eng[i] + g * C.mpg[i] +
          t * C.tax[i] + addM[C.mi[i]] + addF[C.fu[i]] + addT[C.tr[i]]);
      }
      predCache.set(k, out);
      return out;
    }

    /** Error metrics of model step k over the rows in idx. */
    function metrics(k, idx) {
      const p = predAll(k), n = idx.length;
      if (!n) return { n: 0, rmse: NaN, mae: NaN, r2: NaN, medAPE: NaN };
      let se = 0, ae = 0, sy = 0;
      const ape = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        const i = idx[j], y = C.price[i], e = p[i] - y;
        se += e * e; ae += Math.abs(e); sy += y; ape[j] = Math.abs(e) / y;
      }
      const ybar = sy / n;
      let sst = 0;
      for (let j = 0; j < n; j++) { const d = C.price[idx[j]] - ybar; sst += d * d; }
      ape.sort();
      return { n, rmse: Math.sqrt(se / n), mae: ae / n, r2: 1 - se / sst, medAPE: quantile(ape, 0.5) };
    }

    // ---------- aggregations ----------
    /** Median/quartile price by age for the rows in idx. Bins with fewer than minN rows are flagged thin. */
    function medianByAge(idx, minN) {
      const by = new Map();
      for (let j = 0; j < idx.length; j++) {
        const i = idx[j];
        if (!by.has(C.age[i])) by.set(C.age[i], []);
        by.get(C.age[i]).push(C.price[i]);
      }
      return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([age, v]) => {
        const s = sortedCopy(v);
        return { age, n: s.length, median: quantile(s, 0.5), q25: quantile(s, 0.25), q75: quantile(s, 0.75), thin: s.length < (minN || 1) };
      });
    }
    /** Map model name -> medianByAge rows, for every model present in idx. */
    function medianByModelAge(idx, minN) {
      const groups = new Map();
      for (let j = 0; j < idx.length; j++) {
        const i = idx[j], m = C.mi[i];
        if (!groups.has(m)) groups.set(m, []);
        groups.get(m).push(i);
      }
      const out = new Map();
      groups.forEach((rows, m) => out.set(L.model[m], medianByAge(Int32Array.from(rows), minN)));
      return out;
    }

    /** Gaussian kernel density of prices of the rows in idx, evaluated at xs (bandwidth bw, in £). Returns density per £. */
    function kde(idx, xs, bw) {
      const out = new Float64Array(xs.length), n = idx.length;
      if (!n) return out;
      const norm = 1 / (n * bw * Math.sqrt(2 * Math.PI));
      for (let k = 0; k < xs.length; k++) {
        let s = 0;
        for (let j = 0; j < n; j++) { const z = (xs[k] - C.price[idx[j]]) / bw; if (z > -4 && z < 4) s += Math.exp(-0.5 * z * z); }
        out[k] = s * norm;
      }
      return out;
    }
    function priceSummary(idx) {
      const v = new Float64Array(idx.length);
      for (let j = 0; j < idx.length; j++) v[j] = C.price[idx[j]];
      v.sort();
      return { n: v.length, median: quantile(v, 0.5), q25: quantile(v, 0.25), q75: quantile(v, 0.75) };
    }

    // ---------- what-if helpers ----------
    function referenceCar() {
      const r = F.meta.ranges, b = F.meta.baseline;
      return { row: null, model: b.model, fuelType: b.fuelType, transmission: b.transmission, age: r.age.median,
        mileage: Math.round(r.mileage.median), engineSize: r.engineSize.median, mpg: r.mpg.median, tax: r.tax.median };
    }
    const catAdd = (co, f, lv) => co[f + '=' + lv] || 0;
    /** Multiplicative effect of each feature on price, relative to a reference car (order-independent). */
    function effects(co, car, ref) {
      const num = [['age', 'Age', 'yr'], ['mileage', 'Mileage', 'mi'], ['engineSize', 'Engine size', 'L'], ['mpg', 'Fuel economy', 'mpg'], ['tax', 'Road tax', '£']];
      const rows = [];
      for (const [k, label, unit] of num) {
        const key = k === 'mileage' ? 'm10' : k;
        const d = k === 'mileage' ? (car.mileage - ref.mileage) / 1e4 : car[k] - ref[k];
        rows.push({ key: k, label, unit, from: ref[k], to: car[k], factor: Math.exp((co[key] || 0) * d) });
      }
      for (const [f, label] of [['transmission', 'Gearbox'], ['fuelType', 'Fuel'], ['model', 'Model']]) {
        rows.push({ key: f, label, unit: '', from: ref[f], to: car[f], factor: Math.exp(catAdd(co, f, car[f]) - catAdd(co, f, ref[f])) });
      }
      return rows;
    }
    /** Real cars "like" this one: same model and fuel, within 1 year, 15,000 miles and 0.3 L. */
    function similar(car) {
      const v = [];
      for (let i = 0; i < N; i++) {
        if (L.model[C.mi[i]] !== car.model || L.fuel[C.fu[i]] !== car.fuelType) continue;
        if (Math.abs(C.age[i] - car.age) > 1 || Math.abs(C.mileage[i] - car.mileage) > 15000 || Math.abs(C.eng[i] - car.engineSize) > 0.31) continue;
        v.push(C.price[i]);
      }
      const s = sortedCopy(v);
      return { n: s.length, median: quantile(s, 0.5), q10: quantile(s, 0.1), q90: quantile(s, 0.9) };
    }
    /** Predicted price while one variable ('age' or 'mileage') sweeps through xs and everything else stays fixed. */
    function curve(co, car, varName, xs) {
      return xs.map((x) => predict(co, Object.assign({}, car, { [varName]: x })));
    }

    return { F, N, carAt, filter, predictLn, predict, interval, predAll, metrics, medianByAge, medianByModelAge, kde,
      priceSummary, referenceCar, effects, similar, curve, modelIdx, fuelIdx, transIdx };
  }

  const Core = { create, quantile, sortedCopy };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
