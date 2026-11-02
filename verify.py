#!/usr/bin/env python3
"""
verify.py -- independent verification of the numbers the app shows.

It re-cleans the RAW csv with its own short pandas code (it does NOT import prep/prepare_data.py), recomputes a few
quantities with pandas / numpy, and compares them with what the browser app's own logic (app/js/core.js, run through
node) returns.  Writes tests/verification_report.md and app/verification.js (shown inside the app).

Run from the project root:   python3 tests/verify.py
"""
import json
import math
import pathlib
import subprocess
import sys

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
CLI = ROOT / "tests" / "core_cli.js"
results = []          # (id, kind, description, expected, actual, ok)


def node(req):
    out = subprocess.run(["node", str(CLI)], input=json.dumps(req), capture_output=True, text=True, cwd=ROOT)
    if out.returncode != 0:
        raise RuntimeError(out.stderr)
    return json.loads(out.stdout)


def check(cid, kind, desc, expected, actual, tol=1e-6):
    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        ok = abs(expected - actual) <= tol * max(1.0, abs(expected))
    else:
        ok = expected == actual
    results.append({"id": cid, "kind": kind, "desc": desc, "expected": expected, "actual": actual, "ok": bool(ok)})
    print(f"[{'PASS' if ok else 'FAIL'}] {cid} {desc}: expected={expected!r} actual={actual!r}")


# ---------------------------------------------------------------- independent cleaning of the raw file
raw = pd.read_csv(ROOT / "data" / "raw" / "ford.csv")
df = raw.copy()
for c in ["model", "transmission", "fuelType"]:
    df[c] = df[c].str.strip()
df = df.drop_duplicates()
df = df[(df.year <= 2020) & (df.engineSize > 0) & df.fuelType.isin(["Petrol", "Diesel"])]
cnt = df.model.value_counts()
df = df[df.model.isin(cnt[cnt >= 30].index)].copy()
df["age"] = 2020 - df.year

check("C0", "setup", "rows after independent cleaning == rows in the app", len(df), node({"cmd": "rows"}))

# ---------------------------------------------------------------- NUMERICAL EXAMPLE 1: a median
sel = df[(df.model == "Fiesta") & (df.fuelType == "Petrol") & (df.transmission == "Manual") & (df.age == 3)]
pd_median, pd_n = float(sel.price.median()), int(len(sel))
js = [r for r in node({"cmd": "median_by_age", "opts": {"models": ["Fiesta"], "fuel": "Petrol", "trans": "Manual"}})
      if r["age"] == 3][0]
check("N1a", "numerical", "median price, Fiesta/Petrol/Manual, age 3 (year 2017)  [pandas vs app]", pd_median, js["median"])
check("N1b", "numerical", "number of cars in that bin  [pandas vs app]", pd_n, js["n"])

# ---------------------------------------------------------------- NUMERICAL EXAMPLE 2: a prediction by hand
coefs = json.loads((ROOT / "data" / "processed" / "model_coefs.json").read_text())
full = coefs["models"][6]["coefs"]
car = {"model": "Focus", "fuelType": "Diesel", "transmission": "Automatic", "age": 2, "mileage": 12000,
       "engineSize": 1.5, "mpg": 58.9, "tax": 145}
ln = (full["intercept"] + full["age"] * 2 + full["m10"] * 1.2 + full["engineSize"] * 1.5 + full["mpg"] * 58.9 +
      full["tax"] * 145 + full["transmission=Automatic"] + full["fuelType=Diesel"] + full["model=Focus"])
by_hand = math.exp(ln)
print(f"      by hand: ln(price) = {ln:.5f}  ->  price = exp({ln:.5f}) = £{by_hand:,.2f}")
check("N2", "numerical", "predicted price, 2-yr-old Focus 1.5 diesel automatic, 12,000 mi  [hand sum vs app]",
      round(by_hand, 4), round(node({"cmd": "predict", "step": 6, "car": car}), 4), tol=1e-9)

# ---------------------------------------------------------------- NUMERICAL EXAMPLE 3: every row, every step
clean = df.sort_values(["model", "year", "price"]).reset_index(drop=True)      # same ordering as the app data
# the app orders rows by prep (sorted by model, year, price) -- row order only matters for the comparison below
js_pred = np.array(node({"cmd": "pred_all", "step": 6}))
levels_ok = len(js_pred) == len(clean)
check("N3a", "numerical", "prediction vector length == cleaned rows", len(clean), len(js_pred))


def np_predict(frame, co):
    ln_ = np.full(len(frame), co["intercept"])
    ln_ += co.get("age", 0) * frame.age + co.get("m10", 0) * frame.mileage / 1e4 + co.get("engineSize", 0) * frame.engineSize
    ln_ += co.get("mpg", 0) * frame.mpg + co.get("tax", 0) * frame.tax
    for k, v in co.items():
        if "=" in k:
            f, lv = k.split("=", 1)
            ln_ += v * (frame[f] == lv).to_numpy()
    return np.exp(ln_)


if levels_ok:
    py_pred = np_predict(clean, full)
    # rows with identical (model, year, price) can appear in either order, but predictions of ties differ only if the
    # other features differ -- so compare the sorted vectors instead of the raw order
    diff = float(np.max(np.abs(np.sort(py_pred) - np.sort(js_pred))))
    check("N3b", "numerical", "max |numpy - app| over all 17,715 predictions (£)", 0.0, round(diff, 6), tol=1e-3)

# ---------------------------------------------------------------- NUMERICAL EXAMPLE 4: headline test metric
test_m = node({"cmd": "metrics", "step": 6, "opts": {"test": 1}})
check("N4", "numerical", "test-split RMSE (£) of the full model  [prep script vs app]",
      round(coefs["models"][6]["metrics"]["test"]["rmse"], 3), round(test_m["rmse"], 3), tol=1e-6)

# ---------------------------------------------------------------- BOUNDARY CASES
check("B1", "boundary", "filter matching nothing (fuel = Electric) returns 0 rows, no crash",
      0, node({"cmd": "filter_count", "opts": {"fuel": "Electric"}}))
check("B2", "boundary", "empty-selection medianByAge returns an empty list",
      [], node({"cmd": "median_by_age", "opts": {"fuel": "Electric"}}))
check("B3", "boundary", "metrics on zero rows are null (not NaN/Infinity)",
      None, node({"cmd": "metrics", "step": 6, "opts": {"fuel": "Electric"}})["rmse"])
thin = [r for r in node({"cmd": "median_by_age", "opts": {"models": ["Mustang"]}, "minN": 15}) if r["thin"]]
exp_thin = int((df[df.model == "Mustang"].groupby("age").size() < 15).sum())
check("B4", "boundary", "bins with fewer than 15 cars are flagged 'thin' (Mustang, all ages)", exp_thin, len(thin))
sim = node({"cmd": "similar", "car": {"model": "Mustang", "fuelType": "Diesel", "age": 15, "mileage": 150000, "engineSize": 5.0}})
check("B5", "boundary", "no comparable cars (15-yr-old diesel Mustang): n = 0, so the app says 'extrapolation'", 0, sim["n"])
iv = node({"cmd": "interval", "step": 6, "car": car})
check("B6", "boundary", "prediction interval is ordered: low < estimate < high", True, iv["lo"] < iv["mid"] < iv["hi"])
zero = node({"cmd": "predict", "step": 6, "car": dict(car, age=0, mileage=0)})
check("B7", "boundary", "age = 0 and mileage = 0 (slider minimum) gives a finite positive price", True,
      isinstance(zero, float) and zero > 0 and math.isfinite(zero))
age0 = df[(df.model == "Fiesta") & (df.age == 0)]
check("B8", "boundary", "age 0 (model-year 2020) exists but is small: Fiesta count  [pandas]", int(len(age0)),
      [r for r in node({"cmd": "median_by_age", "opts": {"models": ["Fiesta"]}}) if r["age"] == 0][0]["n"])

# ---------------------------------------------------------------- write reports
passed = sum(r["ok"] for r in results)
lines = ["# Verification report", "",
         f"{passed} of {len(results)} checks passed. Generated by `tests/verify.py` (independent pandas/numpy code vs the "
         "app's own `core.js`, run through node).", "",
         "| id | type | check | expected | app / actual | result |", "|---|---|---|---|---|---|"]
for r in results:
    lines.append(f"| {r['id']} | {r['kind']} | {r['desc']} | {r['expected']} | {r['actual']} | {'PASS' if r['ok'] else 'FAIL'} |")
lines += ["", "## Worked numerical example (check N2)", "",
          "Car: 2-year-old Ford Focus, 1.5 L diesel, automatic, 12,000 miles, 58.9 mpg, £145 tax.", "",
          "`ln(price) = b0 + b_age*2 + b_m10*1.2 + b_eng*1.5 + b_mpg*58.9 + b_tax*145 + b_automatic + b_diesel + b_focus`", "",
          f"= {ln:.5f}  ->  price = exp({ln:.5f}) = **£{by_hand:,.2f}**"]
(ROOT / "tests" / "verification_report.md").write_text("\n".join(lines) + "\n")
payload = {"passed": passed, "total": len(results), "results": results,
           "workedExample": {"car": car, "ln": ln, "price": by_hand}}
(ROOT / "app" / "verification.js").write_text("window.VERIFY = " + json.dumps(payload, separators=(",", ":")) + ";\n")
print(f"\n{passed}/{len(results)} checks passed")
sys.exit(0 if passed == len(results) else 1)
