/*
 * ui.js -- shared state, theme tokens, tooltip and small helpers used by every view.
 * Views never talk to each other directly: they read and write State, and State tells the others to redraw.
 */
(function (root) {
  'use strict';
  const F = root.FORD;
  const core = root.Core.create(F);

  // ---------- design tokens (read from CSS so light/dark stay in one place) ----------
  function tokens() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    return { surface: g('--surface'), ink: g('--ink'), ink2: g('--ink-2'), ink3: g('--ink-3'), grid: g('--grid'), axis: g('--axis'),
      s: [g('--s1'), g('--s2'), g('--s3')], pos: g('--pos'), neg: g('--neg'), mid: g('--mid'), rampLo: g('--ramp-lo'), rampHi: g('--ramp-hi') };
  }

  // ---------- formatting ----------
  const f0 = d3.format(',.0f');
  const fmt = {
    gbp: (x) => (x == null || !isFinite(x) ? '–' : '£' + f0(x)),
    k: (x) => '£' + d3.format('~s')(x).replace('G', 'B'),
    n: (x) => f0(x),
    pct: (x, d) => (x == null || !isFinite(x) ? '–' : d3.format('.' + (d == null ? 0 : d) + '%')(x)),
    signedPct: (x) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%',
    year: (age) => String(F.meta.referenceYear - age),
  };

  // ---------- tooltip (built with textContent: labels are treated as untrusted data) ----------
  const tipEl = () => document.getElementById('tip');
  const tip = {
    show(evt, head, rows) {
      const el = tipEl();
      el.textContent = '';
      if (head) { const h = document.createElement('div'); h.className = 'th'; h.textContent = head; el.appendChild(h); }
      (rows || []).forEach((r) => {
        const d = document.createElement('div'); d.className = 'tr';
        if (r.color) { const k = document.createElement('i'); k.style.borderColor = r.color; d.appendChild(k); }
        const l = document.createElement('span'); l.textContent = r.label; d.appendChild(l);
        if (r.value != null) { const v = document.createElement('b'); v.textContent = r.value; d.appendChild(v); }
        el.appendChild(d);
      });
      el.classList.add('on');
      const pad = 14, w = el.offsetWidth, h = el.offsetHeight;
      let x = evt.clientX + pad, y = evt.clientY + pad;
      if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
      if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
      el.style.left = Math.max(8, x) + 'px'; el.style.top = Math.max(8, y) + 'px';
    },
    hide() { tipEl().classList.remove('on'); },
  };

  // ---------- drawing helpers ----------
  /** Calls fn(width) now and whenever the element's width changes (debounced to one animation frame). */
  function watch(el, fn) {
    let raf = 0, last = -1;
    const run = () => { raf = 0; const w = Math.floor(el.clientWidth); if (w > 0 && w !== last) { last = w; fn(w); } };
    new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(run); }).observe(el);
    run();
    return () => { last = -1; run(); };
  }
  function svg(container, w, h) {
    const sel = d3.select(container);
    sel.selectAll('*').remove();
    return sel.append('svg').attr('width', w).attr('height', h).attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img');
  }
  function canvas(container, h) {
    let c = container.querySelector('canvas');
    if (!c) { c = document.createElement('canvas'); container.appendChild(c); }
    const dpr = window.devicePixelRatio || 1, w = container.clientWidth;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.style.width = w + 'px'; c.style.height = h + 'px';
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { c, ctx, w, h };
  }
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const nice = (x, step) => Math.ceil(x / step) * step;

  // ---------- global state ----------
  const MAX_MODELS = 3;
  const slotOf = new Map();                       // model name -> colour slot 1..3 (stays while the model stays selected)
  const defaults = () => ({ models: ['Fiesta', 'Focus', 'Kuga'], fuel: null, trans: null, ageMin: 0, ageMax: 12 });
  const S = Object.assign(defaults(), { car: core.referenceCar(), carRow: null });
  S.models.forEach((m, i) => slotOf.set(m, i + 1));

  const subs = [];
  let dirty = new Set(), queued = false;
  const idxCache = new Map();
  function flush() {
    queued = false;
    const keys = dirty; dirty = new Set();
    subs.forEach((s) => { if (s.keys.some((k) => keys.has(k))) s.fn([...keys]); });
  }
  function mark(keys) { keys.forEach((k) => dirty.add(k)); if (!queued) { queued = true; requestAnimationFrame(flush); } }

  const State = {
    s: S, core,
    on(keys, fn) { subs.push({ keys, fn }); },
    /** Change filters. patch may hold fuel, trans, ageMin, ageMax. */
    set(patch) {
      const keys = new Set();
      Object.keys(patch).forEach((k) => { if (S[k] !== patch[k]) { S[k] = patch[k]; keys.add(k === 'ageMin' || k === 'ageMax' ? 'age' : k); } });
      if (keys.size) mark([...keys]);
    },
    toggleModel(name) {
      const i = S.models.indexOf(name);
      if (i >= 0) { S.models = S.models.filter((m) => m !== name); slotOf.delete(name); }
      else {
        if (S.models.length >= MAX_MODELS) return false;
        let slot = 1; while ([...slotOf.values()].includes(slot)) slot++;
        slotOf.set(name, slot); S.models = [...S.models, name];
      }
      mark(['models']); return true;
    },
    slot: (name) => slotOf.get(name),
    modelColor: (name) => tokens().s[(slotOf.get(name) || 1) - 1],
    setCar(car, row) { S.car = Object.assign({}, car); S.carRow = row == null ? null : row; mark(['car']); },
    setCarFromRow(i) { const c = core.carAt(i); delete c.price; delete c.isTest; delete c.row; State.setCar(c, i); },
    resetFilters() {
      const d = defaults();
      slotOf.clear(); d.models.forEach((m, i) => slotOf.set(m, i + 1));
      Object.assign(S, d); S.car = core.referenceCar(); S.carRow = null;
      mark(['models', 'fuel', 'trans', 'age', 'car']);
    },
    /** Rows passing every filter (models picked, fuel, gearbox, age range). */
    idx() { return cached('all', { models: S.models.length ? S.models : null, fuel: S.fuel, trans: S.trans, ageMin: S.ageMin, ageMax: S.ageMax }); },
    /** Rows passing fuel and gearbox only (used where models or ages are shown side by side). */
    idxNoModel() { return cached('nm', { fuel: S.fuel, trans: S.trans }); },
    themeChanged() { mark(['theme']); },
  };
  function cached(tag, opts) {
    const key = tag + JSON.stringify(opts);
    if (!idxCache.has(key)) { if (idxCache.size > 40) idxCache.clear(); idxCache.set(key, core.filter(opts)); }
    return idxCache.get(key);
  }

  root.UI = { core, F, tokens, fmt, tip, watch, svg, canvas, reducedMotion, clamp, nice, MAX_MODELS };
  root.State = State;
})(window);
