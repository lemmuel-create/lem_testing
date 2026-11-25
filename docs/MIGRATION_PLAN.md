# Migration plan: HTML tools → rfcomp

Repo: `lemmuel-create/lem_testing`. Phase PRs target the `randd` branch and are merged once CI is green; a single final PR takes `randd` to `main`.

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
- **Phase PRs → `randd`:** merged by the author when CI (ruff + pytest) is green, with a merge commit. No reviewer is requested.
- **Final PR `randd → main`:** assigned to Adham, who reviews the whole port once. Its body is a checklist of:
  - [ ] each tool moving `review → live` (seven of the eight legacy tools are in `review`), with its golden-test evidence;
  - [ ] each limit flagged `review: true`, with its cite;
  - [ ] each open GitHub issue (e.g. #2, MPE limit below 300 MHz), resolved or explicitly deferred.
- Nothing reaches `main`, and no tool or limit goes live, without his approval.

## Golden-test approach
For each legacy tool, export 3–5 sample traces and the numbers the HTML page displays (bandwidth, OBW, PSD, band-edge margin, verdict) into `tests/golden/<tech>/*.json`. Python must reproduce them within tolerance. This is the proof the port is correct before RF sign-off.

## Precision
Checks compare at full floating-point precision, exactly as the legacy pages do (e.g. 19.99 dBc fails a 20 dBc requirement, and a PSD of 7.999999999999998 dBm/3 kHz passes 8). Reports and the dashboard display dB values to at least 0.01 dB, so a failing margin is never shown rounded to the limit.

## Intentional differences from the legacy tools
| Module | Difference | Legacy behaviour | Tested by |
|---|---|---|---|
| `techs/halow.py` | Adds a conducted-power check: integrated channel power vs 30 dBm (§15.247(b)(3)), reduced by (gain − 6) dB above 6 dBi (§15.247(b)(4)). Labelled "Channel power (integrated, pre-compliance estimate; KDB 558074 methods for certification)". | The bandwidth page reports channel power with no limit. | `tests/test_halow_power.py` (hand-computed; no legacy golden) |
| all | Display precision ≥ 0.01 dB. | Pages show band edge to 0.1 dB, so 19.99 dBc reads "20.0 dBc" next to a Fail. | report/dashboard tests |

## Open items
- Analyzer export formats in use (Keysight CSV, R&S .dat, Anritsu?) — collect one sample of each.
- Auth for the dashboard (office LAN only vs. SSO).
- §15.215(c) containment of the 20 dB bandwidth at edge channels: the legacy bandwidth page shows the 20 dB M1/M2 markers but gives no verdict, and `limits.js` has no §15.215 entry. Golden cases pin the markers (`edge20-*` in `tests/golden/halow/bandwidth.json`); a verdict needs a limits entry and RF sign-off.
