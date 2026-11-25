# rfcomp: RF compliance analysis toolkit

Repo: `lemmuel-create/lem_testing`. The integration branch is `randd`; phase PRs merge into it, and nothing goes to `main` until Adham approves the final `randd → main` PR.

The RF team's FCC pre-compliance analysis tool. It covers five technologies plus colocation:

- **HaLow:** §15.247, 902–928 MHz
- **Wi-Fi:** 2.4 GHz under §15.247, and 5 GHz U-NII under §15.407
- **LTE:** Parts 22, 24 and 27
- **CBRS:** Part 96
- **GNSS:** protection limits
- **Colocation:** simultaneous transmission and MPE

The legacy single-file HTML tools in `legacy/` are the **reference implementation**. Python results must match them. Note that it is analysis only: no instrument control.

## Stack
- Python 3.12, managed with `uv`. Use numpy and pydantic v2. Lint and format with ruff, and test with pytest.
- The API is FastAPI. Run history is stored in SQLite through SQLModel.
- The dashboard is server-rendered (FastAPI + Jinja2 + HTMX) with Plotly.js for analyzer-style plots. There is no SPA build step.
- `docker-compose.yml` is for the office host (Mac mini).

## Layout
```
src/rfcomp/
  core/        units.py, trace.py (CSV + analyzer export parsers), measure.py (n-dB BW, 99% OBW,
               channel power, PSD, band edge, mask compare), result.py (Check/Result models)
  limits/      one YAML per tech; every number has cite, verified date, review flag
  techs/       halow.py, wifi24.py, unii.py, lte.py, cbrs.py: each exposes
               `evaluate(trace, cfg) -> Result` and registers itself in techs/__init__.py
  coloc/       im.py (intermod/desense incl. GNSS), mpe.py (simultaneous-TX sum-of-ratios), plan.py
  reports/     HTML/PDF report (Jinja2 → WeasyPrint)
  api/         FastAPI app: upload trace, run analysis, list/get runs, download report
  web/         Jinja templates + static for the dashboard
  cli.py       `rfcomp analyze <trace> --tech halow --channel 915 [--report out.pdf]`
tests/
  golden/      trace fixtures + expected results exported from the legacy HTML tools
legacy/        original HTML tools (read-only reference; do not edit)
```

## Rules
- **Regulatory numbers live only in `src/rfcomp/limits/*.yaml`.** Each needs a `cite`. Never hard-code a limit in tech or dashboard code.
- Every check returns a value, the limit, the margin, a pass/fail, and the CFR cite. The dashboard and reports show all five.
- Keep the tool-status workflow from the legacy manifest (`planned → review → live`). Tools in `review` show an "In RF review" banner. Limits flagged `review: true` need RF engineer sign-off.
- For each tech module:
  1. Port the math from `legacy/`.
  2. Add golden tests that match the legacy output within 0.01 dB / 1 kHz.
  3. Add at least one pass/fail boundary case.
- Commands: `uv run pytest`, `uv run ruff check .`, `uv run rfcomp --help`, and `uv run uvicorn rfcomp.api:app --reload`.
- Work on feature branches off `randd`, one phase (or tech module) per PR, each targeting `randd`. CI (GitHub Actions) runs ruff and pytest.
- **Phase PRs into `randd` are self-merged once CI is green.** No reviewer is requested. Use a merge commit (`gh pr merge <n> --merge --delete-branch`), not a squash, so renames keep their history.
- **Reviewer: Adham, once, on the final `randd → main` PR.** Assign it to him. Its body carries a checklist of:
  - every tool to move `review → live`,
  - every limit flagged `review: true`,
  - every open issue.
  He approves the merge to `main`, each `review → live` status change, and clearing each `review: true` flag. He needs collaborator access to `lemmuel-create/lem_testing` to be assigned.
- Footer on every report: *Pre-compliance reference, not legal advice. Confirm against current eCFR and FCC KDB procedures.*
