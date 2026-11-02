# How fast does a used Ford lose its value?  (Dynamic Scientific Story, midterm)

Six linked, interactive views built on 17,715 cleaned used-Ford listings
([Kaggle: adhurimquku/ford-car-price-prediction](https://www.kaggle.com/datasets/adhurimquku/ford-car-price-prediction)).

## Launch (no server, no internet needed)
1. Open `app/index.html` in a modern browser (Chrome, Edge, Firefox, Safari). D3 v7 is bundled in `app/vendor/`.
2. For the live presentation: press **Play** in View 1, then work top to bottom. **Reset everything** (filter bar) restores every view.

## Rebuild from the raw data
```
python3 prep/prepare_data.py     # data/raw/ford.csv -> data/processed/* and app/data.js   (needs pandas, numpy)
python3 tests/verify.py          # independent pandas/numpy checks vs the app's own JS (needs Node)  -> tests/verification_report.md
```

## The story and the six views
| # | View | Purpose | Interaction |
|---|------|---------|-------------|
| 1 | Depreciation curve | Question: how much value does a car lose per year? | play/pause, step, scrub age; price vs % of year-1 price |
| 2 | 3D scatter (age x mileage x price) | Mechanism: age and mileage travel together | rotate/zoom, colour by, camera presets, fitted surface, click a car |
| 3 | Price distributions | Are groups really priced differently? | compare models / fuel / gearbox; hover |
| 4 | Build-a-car what-if | What does each feature add or remove? | 8 controls, "random real car", effect bars, 80% band |
| 5 | Age and mileage sweeps | Cost of one more year / 10,000 miles | follows the car from View 4 |
| 6 | Model steps + held-out evidence | Does each feature help, and where does it fail? | play steps, held-out vs all cars |

Shared controls (top bar) filter every view: up to 3 models, fuel, gearbox, age range. Colours follow the model in every view.

## Files
- `prep/prepare_data.py` cleaning, aggregation, regression fits, writes `app/data.js`
- `app/js/core.js` all data/model logic (no DOM), shared by the app and the tests
- `app/js/v1..v6_*.js` one file per view; `ui.js` shared state; `main.js` filter bar, text sections
- `tests/verify.py`, `tests/verification_report.md` 15 checks (numerical + boundary), all passing
- `data/processed/cleaning_report.json` rows after each cleaning step
- `report/screenshots/` one screenshot per view; `docs/REPORT_DRAFT.md` starting text for the PDF

## Data notes and limits
Prices are asking prices; the file states no currency or date (shown as GBP, age = 2020 - model year). Cleaning removed 251 rows
(154 duplicates, 1 impossible year 2060, 51 zero-litre engines, 24 hybrid/electric/other, 21 rare-model rows). Full limitations are on the page.

## AI assistance
Code was written with Claude (Anthropic) and checked by `tests/verify.py`; the author is responsible for understanding and presenting it.
