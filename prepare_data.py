#!/usr/bin/env python3
"""
prepare_data.py  --  raw ford.csv  ->  clean data, model coefficients, app/data.js

Run from the project root:
    python3 prep/prepare_data.py

Inputs : data/raw/ford.csv                      (Kaggle: adhurimquku/ford-car-price-prediction)
Outputs: data/processed/ford_clean.csv          cleaned rows (+ derived columns)
         data/processed/cleaning_report.json    row counts after every cleaning step
         data/processed/model_coefs.json        nested regression models (fit on the training split)
         data/processed/median_price_by_model_age.csv   aggregation used by view 1 (for cross-checking)
         app/data.js                            everything the browser app needs (columnar arrays)

Every transformation is written out explicitly so it can be explained in the live presentation.
"""
import json
import pathlib
import sys

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "ford.csv"
OUT = ROOT / "data" / "processed"
APP = ROOT / "app"

REFERENCE_YEAR = 2020      # newest model year in the data; age = 2020 - year  (listing date is not documented)
MIN_MODEL_ROWS = 30        # models with fewer rows are dropped (too few to estimate anything)
TEST_FRACTION = 0.20       # random hold-out used for honest evaluation
SEED = 42

BASELINE = {"transmission": "Manual", "fuelType": "Petrol", "model": "Fiesta"}   # most common level of each

NUMERIC = ["age", "m10", "engineSize", "mpg", "tax"]
# Nested feature sets (each step adds features to the previous one)
STEPS = [
    ("M0", "Baseline: one typical price", []),
    ("M1", "+ age", ["age"]),
    ("M2", "+ mileage", ["age", "m10"]),
    ("M3", "+ engine size", ["age", "m10", "engineSize"]),
    ("M4", "+ running costs (mpg, tax)", ["age", "m10", "engineSize", "mpg", "tax"]),
    ("M5", "+ gearbox & fuel", ["age", "m10", "engineSize", "mpg", "tax", "transmission", "fuelType"]),
    ("M6", "+ model (Fiesta, Focus, ...)", ["age", "m10", "engineSize", "mpg", "tax", "transmission", "fuelType", "model"]),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    raw = pd.read_csv(RAW)
    log = []   # the cleaning funnel

    def step(name: str, df: pd.DataFrame, why: str) -> None:
        log.append({"step": name, "rows_after": int(len(df)), "why": why})

    step("Raw file", raw, "ford.csv as downloaded: 17,966 rows x 9 columns, no empty cells")

    # ---- 1. text columns: model names have a leading space in the raw file (e.g. ' Mustang') -----------
    df = raw.copy()
    for c in ["model", "transmission", "fuelType"]:
        df[c] = df[c].astype(str).str.strip()

    # ---- 2. exact duplicate rows (same car listed twice; mileage makes a coincidence very unlikely) -----
    df = df.drop_duplicates()
    step("Drop exact duplicates", df, "all 9 columns identical -> almost certainly the same listing twice")

    # ---- 3. impossible model year -------------------------------------------------------------------------
    df = df[df["year"] <= REFERENCE_YEAR]
    step("Drop year > 2020", df, "one row has year 2060 (typo); the true year cannot be recovered")

    # ---- 4. engineSize == 0 is a missing value in disguise ------------------------------------------------
    df = df[df["engineSize"] > 0]
    step("Drop engineSize = 0", df, "a car cannot have a 0.0 L engine: treated as missing and dropped (no imputation)")

    # ---- 5. hybrids / electric / other fuel -------------------------------------------------------------
    df = df[df["fuelType"].isin(["Petrol", "Diesel"])]
    step("Keep Petrol and Diesel only", df, "Hybrid/Electric/Other have <=22 rows each and 'mpg' is not comparable "
                                           "(mpg up to 201.8)")

    # ---- 6. rare models ------------------------------------------------------------------------------------
    counts = df["model"].value_counts()
    keep_models = counts[counts >= MIN_MODEL_ROWS].index
    df = df[df["model"].isin(keep_models)].copy()
    step(f"Drop models with < {MIN_MODEL_ROWS} rows", df, "too few rows to estimate a price pattern: "
                                                            + ", ".join(sorted(counts[counts < MIN_MODEL_ROWS].index)))

    # NOTE: tax == 0 is NOT missing: low-emission cars legitimately pay 0 road tax, so those rows are kept.

    # ---- 7. derived columns --------------------------------------------------------------------------------
    df["age"] = REFERENCE_YEAR - df["year"]
    df["m10"] = df["mileage"] / 10_000.0          # mileage in units of 10,000 miles (keeps coefficients readable)
    df["ln_price"] = np.log(df["price"])
    df = df.sort_values(["model", "year", "price"]).reset_index(drop=True)

    # ---- 8. reproducible train / test split ---------------------------------------------------------------
    rng = np.random.default_rng(SEED)
    df["is_test"] = (rng.random(len(df)) < TEST_FRACTION).astype(int)
    train = df["is_test"] == 0

    df.to_csv(OUT / "ford_clean.csv", index=False)

    # ---- 9. level dictionaries (baseline level first) ---------------------------------------------------
    def levels(col: str):
        lv = sorted(df[col].unique(), key=lambda s: (s != BASELINE.get(col, s), -int((df[col] == s).sum())))
        return lv

    lv_model, lv_fuel, lv_trans = levels("model"), levels("fuelType"), levels("transmission")

    # ---- 10. nested regressions on ln(price), fit on the training split only -----------------------------
    def design(frame: pd.DataFrame, feats):
        names, cols = ["intercept"], [np.ones(len(frame))]
        for f in feats:
            if f in NUMERIC:
                names.append(f)
                cols.append(frame[f].to_numpy(float))
            else:
                for lv in levels(f)[1:]:                      # baseline level is dropped
                    names.append(f"{f}={lv}")
                    cols.append((frame[f] == lv).to_numpy(float))
        return names, np.column_stack(cols)

    def r2(y, p):
        return float(1 - ((y - p) ** 2).sum() / ((y - y.mean()) ** 2).sum())

    price = df["price"].to_numpy(float)
    ln_price = df["ln_price"].to_numpy(float)
    models_out = []
    for sid, label, feats in STEPS:
        names, X = design(df, feats)
        beta, *_ = np.linalg.lstsq(X[train], ln_price[train], rcond=None)
        lnp_hat = X @ beta
        p_hat = np.exp(lnp_hat)
        entry = {"id": sid, "label": label, "features": feats,
                 "coefs": {n: float(b) for n, b in zip(names, beta)}, "metrics": {}}
        for split, mask in [("train", train.to_numpy()), ("test", ~train.to_numpy())]:
            entry["metrics"][split] = {
                "n": int(mask.sum()),
                "rmse": float(np.sqrt(((price[mask] - p_hat[mask]) ** 2).mean())),
                "mae": float(np.abs(price[mask] - p_hat[mask]).mean()),
                "r2_price": r2(price[mask], p_hat[mask]),
                "r2_log": r2(ln_price[mask], lnp_hat[mask]),
            }
        models_out.append(entry)
        if sid == "M6":
            resid = (ln_price - lnp_hat)[train.to_numpy()]
            q10, q90 = np.quantile(resid, [0.10, 0.90])
    (OUT / "model_coefs.json").write_text(json.dumps(
        {"target": "ln(price)", "baseline": BASELINE, "models": models_out,
         "residual_q10_q90_ln_train": [float(q10), float(q90)]}, indent=2))

    # ---- 11. aggregation used by view 1: median price by model and age -----------------------------------
    agg = (df.groupby(["model", "age"])["price"]
             .agg(n="size", median_price="median", q25=lambda s: s.quantile(.25), q75=lambda s: s.quantile(.75))
             .reset_index())
    agg.to_csv(OUT / "median_price_by_model_age.csv", index=False)

    # ---- 12. cleaning report -------------------------------------------------------------------------------
    prev = None
    for row in log:
        row["rows_removed"] = 0 if prev is None else prev - row["rows_after"]
        prev = row["rows_after"]
    (OUT / "cleaning_report.json").write_text(json.dumps(log, indent=2))

    # ---- 13. app/data.js (columnar arrays + dictionaries) ------------------------------------------------
    idx = lambda col, lv: df[col].map({v: i for i, v in enumerate(lv)}).astype(int).tolist()
    num_ranges = {c: {"min": float(df[c].min()), "p01": float(df[c].quantile(.01)),
                      "median": float(df[c].median()), "p99": float(df[c].quantile(.99)),
                      "max": float(df[c].max())} for c in ["age", "mileage", "engineSize", "mpg", "tax", "price"]}
    sample_raw = raw.head(5).to_dict("records")
    sample_clean = df[["model", "year", "price", "transmission", "mileage", "fuelType", "tax", "mpg",
                       "engineSize", "age", "m10", "is_test"]].sample(5, random_state=SEED).round(4).to_dict("records")
    payload = {
        "meta": {"source": "Kaggle - adhurimquku/ford-car-price-prediction (ford.csv)",
                 "url": "https://www.kaggle.com/datasets/adhurimquku/ford-car-price-prediction",
                 "referenceYear": REFERENCE_YEAR, "seed": SEED, "testFraction": TEST_FRACTION,
                 "minModelRows": MIN_MODEL_ROWS, "baseline": BASELINE, "rows": int(len(df)),
                 "cleaning": log, "ranges": num_ranges},
        "levels": {"model": lv_model, "fuel": lv_fuel, "trans": lv_trans},
        "cols": {
            "mi": idx("model", lv_model), "fu": idx("fuelType", lv_fuel), "tr": idx("transmission", lv_trans),
            "age": df["age"].tolist(), "price": df["price"].tolist(), "mileage": df["mileage"].tolist(),
            "tax": df["tax"].tolist(), "mpg": df["mpg"].round(1).tolist(), "eng": df["engineSize"].round(1).tolist(),
            "test": df["is_test"].tolist(),
        },
        "models": models_out,
        "resid": {"q10": float(q10), "q90": float(q90)},
        "sample": {"raw": sample_raw, "clean": sample_clean},
    }
    (APP / "data.js").write_text("window.FORD = " + json.dumps(payload, separators=(",", ":")) + ";\n")

    # ---- console summary -----------------------------------------------------------------------------------
    print(f"{'step':34s}{'rows':>8s}{'removed':>9s}")
    for r in log:
        print(f"{r['step']:34s}{r['rows_after']:>8,d}{r['rows_removed']:>9,d}")
    print(f"\ntrain rows: {int(train.sum()):,}   test rows: {int((~train).sum()):,}")
    for m in models_out:
        t = m["metrics"]["test"]
        print(f"{m['id']}  {m['label']:34s} test R2(price)={t['r2_price']:.3f}  RMSE=£{t['rmse']:,.0f}")
    print(f"\nwrote {APP / 'data.js'} ({(APP / 'data.js').stat().st_size / 1024:,.0f} KB)")


if __name__ == "__main__":
    sys.exit(main())
