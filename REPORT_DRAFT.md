# Report draft (edit in your own words; add name(s), links, screenshots from report/screenshots/)

**Abstract.** We built six linked interactive views on 17,715 used-Ford listings to ask what drives a used car's price and where a simple model stops being trustworthy. Age lowers the modelled price ~11% per year, mileage ~5% per 10,000 miles at fixed age, and eight features together explain R2 = 0.88 on held-out cars, with a median error of ~8%.

**Introduction.** Question: how fast does a used Ford lose value, and how much is age vs mileage vs the car itself? Audience: buyers and sellers, and classmates new to regression. Objectives: (1) show depreciation, (2) separate age from mileage, (3) let users build a car, (4) judge the model honestly on unseen cars.

**Related work.** Cite your own sources here (course material, a depreciation article, the Kaggle dataset page, D3). Explain how this differs from The LLM Story (different domain, a regression story with held-out evaluation, not a model-internals story).

**Methodology and workflow.** Data: Kaggle ford.csv (9 variables). Cleaning: 17,966 -> 17,715 rows (see cleaning_report.json). Model: OLS on ln(price), 80/20 split, seed 42, seven nested models. Storyboard: Views 1 (question), 2-5 (mechanism), 6 (evidence), table in README. Construction: prep/prepare_data.py writes app/data.js; core.js holds all logic; each view is one file.

**Timeline and evaluation.** Checks: tests/verification_report.md (15/15). Worked example N2: 2-year-old 1.5 L diesel automatic Focus, 12,000 mi -> GBP 15,258.88, matches hand calculation. Boundary cases B1-B8 (empty filter, thin bins, age 0 / mileage 0, no comparable cars). Add dated feedback you actually received and the revisions you made.

**Contingency and collaboration.** Everything runs offline from local files; keep a screenshot set and a second laptop. State each teammate's role.

**Conclusion.** Age dominates; mileage adds little once age is known (they correlate 0.72); engine size gives the biggest further gain; remaining error ~8% reflects condition, trim and negotiation we cannot see. Limits are listed on the page.

**References.** Kaggle dataset (adhurimquku); D3 (Bostock et al.); pandas, NumPy; add your own.

**AI disclosure.** Claude (Anthropic) wrote the code and drafts; results were verified with the independent script tests/verify.py. Add what you personally checked.

**Link to add:** working visualization, source repo, launch instructions (README.md).
