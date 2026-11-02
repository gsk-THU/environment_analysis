# MicroWatch-LDIR

**微塑料监测数据智能分析平台 · Offline LDIR Microplastic Data Analysis and Quality Control**

A fully offline single-page web application that turns LDIR (Laser Direct Infrared) microplastic
detection results into traceable, filterable, comparable and assessable environmental monitoring
data — built as a course project prototype for four sampling sites (Site1–Site4).

🔗 **Live demo (GitHub Pages):** https://gsk-thu.github.io/microwatch-ldir/

## Features 功能

| # | Page 页面 | What it does 功能 |
|---|-----------|-------------------|
| 01 | **Data Import** | Upload one or two LDIR `.xlsx` exports; auto-detects the *Particles* sheet, normalises site names (`Site 3` → `Site3`), checks field completeness, adjusts material classification, and sets analysis parameters. Dynamic KPI cards on the home page. |
| 02 | **Site Analysis** | Per-site particle counts, polymer composition, size distribution, HQI distribution and morphology charts; filterable particle-level detail table (see exactly why each record is excluded). ★ **Concentration Calculator**: enter the sample volume (L/mL, auto-converted), and the platform reads the filtered particle count and computes particles/L — per polymer and per size class — with blank/recovery correction when provided. |
| 03 | **Site Comparison** | Grouped target counts, stacked polymer composition, unified size histogram, full indicator table. One-click **Common Size Range ≥ 20 μm** for fair comparison. ★ **Concentration Comparison**: per-site volume inputs → concentration bar chart, pairwise ratios `R_ij = C_i/C_j`, and auto-generated comparison sentences. |
| 04 | **Quality Assessment** | Local rule engine **R1–R6** (low HQI, threshold sensitivity, size outliers, review-category materials, missing volume, differing detection ranges), HQI threshold sensitivity sweep (0.65–0.85), retention analysis, completeness indicators and template-generated site assessments. |
| 05 | **Report Center** | Printable analysis report preview; exports: **Summary CSV**, **Records CSV** (with inclusion status, exclusion reason, QC flags), **standalone HTML report** (charts embedded as PNG), and **Print / Save as PDF** via the browser. |

## Core formulas 核心公式

- Target particle count: `N_MP = Σ I_i`, where `I_i = 1` for valid target-polymer records with `HQI ≥ t`
  (screening count and quality-filtered count are always reported separately)
- Raw concentration: `C_raw = N_MP / V` (or `N_MP / (V·f)` with an analysed fraction `f`)
- Blank & recovery correction: `C_corrected = max(0, N_s/f_s − N̄_b/f_b) / (V·R)`
- Concentration ratio: `R_ij = C_i / C_j`

The platform never invents results: without a volume it reports no particles/L; without blank data
it does not claim blank correction; without a recovery rate it does not claim recovery correction.
No pollution grades (light/moderate/heavy) are assigned — there is no unified classification
standard applicable to these data, so only quantitative comparison is reported.

## Material classification 材料归类

- **Target synthetic polymers:** PA, PTFE, PVC, PP, PET, PE, HDPE, PU, EVA, PMMA, Polyacetal,
  Polysulfone, Polyvinyl alcohol, Polyacrylamide
- **Pending manual review:** Rubber, Silicone, Acrylates, Alkyd Varnish, Polyether, Cellulose Acetate
- **Non-target materials:** Natural Polyamide, Cellulosic, Chitin, Silica, …

`Natural Polyamide` is a natural material and is **never** merged with `PA`.
Contested materials can be re-classified in the UI (Data Import → Material classification) without
touching the raw records.

## Fully offline 完全离线运行

- No backend, no APIs, no API keys, no CDN, no external fonts or icons.
- Third-party libraries are bundled locally in `vendor/`:
  [SheetJS](https://sheetjs.com/) (`xlsx.full.min.js`) for Excel parsing and
  [Chart.js](https://www.chartjs.org/) (`chart.umd.min.js`) for visualisation.
- All parsing, calculation, quality control and report generation run in the browser.
  **No data ever leaves your computer.**

## Demo data 演示数据

The original course Excel exports are not redistributed here. **Load demo data** (Data Import page)
generates the same pipeline from deterministic simulated records that reproduce the reference
statistics of the design brief — e.g. 96/138/498/664 total particles, 7/34/311/340 target polymers,
5/14/23/27 after HQI ≥ 0.75, 5/14/17/24 with the common ≥ 20 μm range. The demo dataset is clearly
labelled as simulated and is **not** real measurement data. Upload your own `.xlsx` (columns:
`Site, Id, Diameter, Length, Width, Area, Identification, Quality, Is Valid`) to analyse real data.

To regenerate the demo dataset: `python3 tools/gen_demo_data.py`

## Run locally 本地运行

```bash
# any static file server works, e.g.:
python3 -m http.server 8000
# then open http://localhost:8000/
```

Opening `index.html` directly from disk (double-click) also works — everything is plain
HTML/CSS/JS with bundled libraries.

## Project structure

```
MicroWatch-LDIR/
├── index.html
├── css/style.css
├── js/
│   ├── app.js               # SPA routing, state, page rendering
│   ├── excel-reader.js      # SheetJS wrapper, site-name normalisation
│   ├── site-analysis.js     # statistics, filtering, histograms
│   ├── concentration.js     # C_raw / C_corrected / R_ij, unit conversion
│   ├── quality-control.js   # rule engine R1–R6 + narrative templates
│   ├── charts.js            # Chart.js configs & renderers
│   ├── report-export.js     # CSV / HTML report / print
│   └── demo-data.js         # simulated demo dataset (generated)
├── config/
│   ├── polymer-categories.js
│   └── analysis-rules.js
├── vendor/                  # bundled third-party libraries (offline)
├── assets/logo.svg
└── tools/gen_demo_data.py   # demo dataset generator + verifier
```

## Notes & limitations 说明

- Particle counts are **candidate LDIR identifications** filtered by the stated rules — not
  manually confirmed microplastics. Screening counts and quality-filtered counts must not be mixed.
- The quality module is **rule-based decision support** (inspired by expert-system thinking); it is
  not a machine-learning model, so no precision/recall/F1 metrics are applicable.
- Site comparability requires identical sampling/processing protocols; if sampled volumes differ,
  compare concentrations rather than raw counts.
