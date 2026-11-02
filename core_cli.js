#!/usr/bin/env node
/*
 * core_cli.js -- runs app/js/core.js on app/data.js from the command line, so tests/verify.py can compare the
 * browser app's own logic against an independent pandas/numpy computation.
 *
 *   echo '{"cmd":"filter_count","opts":{"fuel":"Petrol"}}' | node tests/core_cli.js
 */
const fs = require('fs');
const path = require('path');
global.window = global;
require(path.join(__dirname, '..', 'app', 'data.js'));
const Core = require(path.join(__dirname, '..', 'app', 'js', 'core.js'));
const core = Core.create(global.FORD);

const req = JSON.parse(fs.readFileSync(0, 'utf8'));
let out;
switch (req.cmd) {
  case 'rows': out = core.N; break;
  case 'filter_count': out = core.filter(req.opts).length; break;
  case 'median_by_age': out = core.medianByAge(core.filter(req.opts), req.minN || 1); break;
  case 'predict': out = core.predict(global.FORD.models[req.step].coefs, req.car); break;
  case 'interval': out = core.interval(global.FORD.models[req.step].coefs, req.car); break;
  case 'pred_all': out = Array.from(core.predAll(req.step)); break;
  case 'metrics': out = core.metrics(req.step, core.filter(req.opts)); break;
  case 'similar': out = core.similar(req.car); break;
  case 'curve': out = core.curve(global.FORD.models[req.step].coefs, req.car, req.varName, req.xs); break;
  default: throw new Error('unknown cmd ' + req.cmd);
}
// JSON has no NaN: encode as null so Python can tell "no data" from a number
process.stdout.write(JSON.stringify(out, (k, v) => (typeof v === 'number' && !isFinite(v) ? null : v)));
