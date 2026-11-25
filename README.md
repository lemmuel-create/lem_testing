# rfcomp

FCC pre-compliance analysis for the RF team: upload an analyzer trace, pick a technology, get pass/fail with margins and CFR cites. Phase 2 covers **Wi-Fi HaLow (902–928 MHz, §15.247)**; Wi-Fi, LTE, CBRS, GNSS and colocation follow (see `docs/MIGRATION_PLAN.md`).

> **Pre-compliance reference, not legal advice. Confirm against current eCFR and FCC KDB procedures.**

## HaLow analysis

### Install

Requires [uv](https://docs.astral.sh/uv/) and Python 3.12 (uv installs it if needed).

```console
git clone https://github.com/lemmuel-create/lem_testing.git
cd lem_testing
uv sync
uv run rfcomp --help
```

### Usage

```console
uv run rfcomp analyze <trace.csv> --tech halow --antenna-gain <dBi> \
    [--center MHz] [--ndb 6|20|26] [--method peak|average] [--rbw kHz] [--offset dB] [--units auto|1|1e3|1e6|1e9] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<trace.csv>` | Analyzer export: frequency and amplitude (dBm per RBW) per line. Header lines and extra columns are ignored; at least 10 data rows. | required |
| `--antenna-gain` | Antenna gain of the product under test, dBi. Sets the conducted-power limit. | required |
| `--center` | Nominal channel centre, MHz. Reported next to the measured 6 dB centre; not a limit. | — |
| `--ndb` | Extra n-dB bandwidth to report (20 or 26). The DTS check is always 6 dB. | 6 |
| `--method` | Band-edge method: `peak` (20 dBc) or `average` (30 dBc). | peak |
| `--rbw` | RBW the trace was taken with, kHz. Used for PSD scaling and channel power. | 100 |
| `--offset` | Reference offset added to every point (cable / attenuator loss), dB. | 0 |
| `--units` | Frequency units of the file: `auto` or a multiplier to Hz. | auto |
| `--json` | Print the full result as JSON instead of the table. | off |

Exit code: **0** = PASS, **1** = FAIL, **2** = bad input (unreadable trace, invalid option, missing `--antenna-gain`).

### Sample output

```console
$ uv run rfcomp analyze examples/halow/halow_bw6_499p5khz_fail.csv --tech halow --center 915 --antenna-gain 6
rfcomp 0.1.0 · halow · halow_bw6_499p5khz_fail.csv
2001 points, 914.0000–916.0000 MHz, RBW 100 kHz, offset 0 dB, antenna 6 dBi, band edge peak method
Measured 6 dB centre 915.0000 MHz (+0.0 kHz from --center 915 MHz)

Check                                                                                                Value          Limit          Margin  Result  Cite
-----------------------------------------------------------------------------------------  ---------------  -------------  --------------  ------  ----------------------------
6 dB bandwidth                                                                                 499.500 kHz    500.000 kHz      -0.500 kHz  FAIL    47 CFR §15.247(a)(2)
99% occupied bandwidth (reported, no FCC limit)                                                495.126 kHz              —               —  INFO    ISED RSS-Gen (reported only)
Channel power (integrated, pre-compliance estimate; KDB 558074 methods for certification)         6.94 dBm      30.00 dBm       23.06 dBm  PASS    47 CFR §15.247(b)(3)
Peak PSD (scaled to 3 kHz)                                                                 -15.23 dBm/3kHz  8.00 dBm/3kHz  23.23 dBm/3kHz  PASS    47 CFR §15.247(e)
Band edge (902 / 928 MHz, peak method)                                                                   —              —               —  N/A     47 CFR §15.247(d)
20 dB bandwidth within 902–928 MHz (§15.215(c)) [RF review]                                  12726.917 kHz      0.000 kHz   12726.917 kHz  PASS    47 CFR §15.215(c)

Notes:
  Band edge (902 / 928 MHz, peak method): Not evaluated: trace does not cross 902 or 928 MHz.

Overall: FAIL

Pre-compliance reference, not legal advice. Confirm against current eCFR and FCC KDB procedures.
$ echo $?
1
```

More examples, including JSON output, are in [`examples/README.md`](examples/README.md).

Values are compared at full precision; the table rounds dB values to 0.01 dB and bandwidths to 1 Hz. `[RF review]` marks a check whose limit is flagged `review: true` in `src/rfcomp/limits/halow.yaml` and still needs RF engineer sign-off.

### What each check means

All limits come from `src/rfcomp/limits/halow.yaml`; each has a cite there.

| Check | Rule | Limit | Cite |
|---|---|---|---|
| 6 dB bandwidth | Distance between the outermost points 6 dB below the peak (linear interpolation) must be at least the DTS minimum. Measure with RBW 100 kHz (KDB 558074). | ≥ 500 kHz | 47 CFR §15.247(a)(2) |
| n-dB bandwidth (`--ndb 20/26`) | The 20 or 26 dB width, reported for information. | none | — |
| 99% occupied bandwidth | Width containing 99% of the integrated trace power. Reported only. | none (ISED RSS-Gen) | — |
| Channel power | Trace power integrated across the span and divided by the RBW: a pre-compliance estimate of conducted power. Certification uses KDB 558074 methods. | 30 dBm, minus (gain − 6) dB above 6 dBi | 47 CFR §15.247(b)(3), (b)(4) |
| Peak PSD | Highest trace point scaled from the RBW to 3 kHz: P − 10·log10(RBW / 3 kHz). Valid for an average (RMS) detector and a signal wider than the RBW. | ≤ 8 dBm / 3 kHz | 47 CFR §15.247(e) |
| Band edge | Highest level outside 902–928 MHz, in dB below the in-band peak, on the worse side. Not evaluated (N/A) when the trace does not extend past 902 or 928 MHz. A sample exactly on 902.000 or 928.000 MHz counts as in-band. | ≥ 20 dBc (peak method) or ≥ 30 dBc (average method) | 47 CFR §15.247(d) |
| 20 dB bandwidth containment | The 20 dB bandwidth (always measured, whatever `--ndb` is) must lie inside the band: M1 ≥ 902.000 and M2 ≤ 928.000 MHz. Shown as margin in kHz to the nearer edge. | margin ≥ 0 | 47 CFR §15.215(c) |

The overall verdict is FAIL if any evaluated check fails. Informational rows (INFO) and band edge N/A do not count.

### Intentional differences from the legacy tool

Results match the legacy RF Lab bandwidth page (`legacy/rf-lab/tools/bandwidth/`) on all 67 golden cases, except where rfcomp deliberately differs:

| Difference | Legacy page |
|---|---|
| **Conducted-power check** added (30 dBm, reduced above 6 dBi). `--antenna-gain` is required. | Reports channel power with no limit and has no antenna-gain input. |
| **§15.215(c) 20 dB containment check** added (pending RF review). | Shows 20 dB markers with no verdict. |
| The 500 kHz minimum is checked on the **6 dB width only**; other n-dB widths are informational. | Compares whichever n-dB width is selected against 500 kHz. |
| **Limits come only from `halow.yaml`**; no per-run override. | Limit fields are editable on the page. |
| **Display precision ≥ 0.01 dB**, so a failing margin is never rounded to the limit. | Band edge shown to 0.1 dB (19.99 dBc reads "20.0 dBc" next to Fail). |

Details and the tests for each are in `docs/MIGRATION_PLAN.md` ("Intentional differences from the legacy tools").

### Known limits

- Golden cases are synthetic traces and legacy simulations; no real bench traces have been run through the tool yet.
- The conducted-power and §15.215(c) checks have no legacy equivalent and are pending RF review.
- Channel power is an integrated estimate, not a certification measurement.

## Development

```console
uv run pytest
uv run ruff check .
```

The legacy HTML tools in `legacy/` are the reference implementation and are not edited. Golden values are re-captured with `node scripts/capture_golden.js` and `node scripts/capture_halow.js` (Playwright, from `legacy/rf-lab`).

> Pre-compliance reference, not legal advice. Confirm against current eCFR and FCC KDB procedures.
