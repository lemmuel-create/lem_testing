# Migration plan: HTML tools → rfcomp

Repo: `lemmuel-create/lem_testing`. PRs target the `randd` branch.

Goal: the RF team can upload an analyzer trace (or batch of traces), pick technology and channel, and get FCC pass/fail with margins, plots, run history and a downloadable report — from a dashboard or a CLI script.

## Phases (one PR each)

| # | Deliverable | Done when |
|---|---|---|
| 0 | Restore the flattened legacy tree into `legacy/rf-lab/` (git mv), then scaffold: `uv` project, ruff, pytest, CI; add CLAUDE.md | CI green on empty test suite |
| 1 | `core/` port of `rfmath.js` + trace parsers; `limits/*.yaml` from `limits.js` | Golden tests match legacy JS on shared math |
| 2 | `techs/halow.py` (live tool, reference for the pattern) | HaLow golden + boundary tests pass |
| 3 | `wifi24`, `unii`, `lte` modules | Each matches legacy; `review` status preserved |
| 4 | `cbrs` module (from `cbrs-mask`) | Same |
| 5 | `coloc/` from `shared/coloc.js`: `im` (intermod/desense incl. GNSS protection), `mpe` (simultaneous-TX sum-of-ratios), `plan` (pairing matrix) | Matches the three legacy coloc tools |
| 6 | `cli.py` + `reports/` (HTML/PDF) | `rfcomp analyze` produces a report for each tech |
| 7 | FastAPI + dashboard: upload, run, results table, Plotly trace with limit overlays, history, report download | RF engineer completes a run end-to-end |
| 8 | Docker deploy on office host; README for the team | Team URL live |

## Legacy → module map

| Legacy | Status | Module |
|---|---|---|
| shared/rfmath.js, limits.js | — | core/, limits/*.yaml |
| shared/coloc.js | — | coloc/ |
| tools/bandwidth | live | techs/halow.py |
| tools/wifi-24 | review | techs/wifi24.py |
| tools/wifi-unii | review | techs/unii.py |
| tools/lte-mask | review | techs/lte.py |
| tools/cbrs-mask | review | techs/cbrs.py |
| tools/coloc-im / coloc-mpe / coloc-plan | review | coloc/im.py, mpe.py, plan.py |

GNSS has no standalone legacy tool; its limits live in limits.js and are applied in coloc-im (and LTE Band 13). A dedicated `techs/gnss.py` is a new build, not a port.

## Review
Adham reviews every PR and signs off each tool's `review → live` status and every limit flagged `review: true`. Seven of the eight legacy tools are still in review, so his sign-off of the golden tests and limits is needed before each module goes live.

## Golden-test approach
For each legacy tool, export 3–5 sample traces and the numbers the HTML page displays (bandwidth, OBW, PSD, band-edge margin, verdict) into `tests/golden/<tech>/*.json`. Python must reproduce them within tolerance. This is the proof the port is correct before RF sign-off.

## Open items
- Analyzer export formats in use (Keysight CSV, R&S .dat, Anritsu?) — collect one sample of each.
- Auth for the dashboard (office LAN only vs. SSO).
