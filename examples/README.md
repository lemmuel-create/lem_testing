# Examples

Run these from the repository root after `uv sync`. Exit code: 0 = PASS, 1 = FAIL, 2 = bad input.

## HaLow (`examples/halow/`)

| File | What it is |
|---|---|
| `halow/halow_bw6_500p5khz_pass.csv` | Golden case `csv-bw6-500p5-pass`: 0 dBm flat top, 6 dB bandwidth 500.5 kHz (just above the 500 kHz minimum). |
| `halow/halow_bw6_499p5khz_fail.csv` | Golden case `csv-bw6-499p5-fail`: the same shape at 499.5 kHz (just below). |

Both are synthetic traces captured from the legacy RF Lab bandwidth page (`tests/golden/halow/bandwidth.json`), in MHz and dBm per 100 kHz RBW, not bench measurements.

### Passing trace (6 dB bandwidth 500.5 kHz)

```console
$ uv run rfcomp analyze examples/halow/halow_bw6_500p5khz_pass.csv --tech halow --center 915 --antenna-gain 6
rfcomp 0.1.0 · halow · halow_bw6_500p5khz_pass.csv
2001 points, 914.0000–916.0000 MHz, RBW 100 kHz, offset 0 dB, antenna 6 dBi, band edge peak method
Measured 6 dB centre 915.0000 MHz (+0.0 kHz from --center 915 MHz)

Check                                                                                                Value          Limit          Margin  Result  Cite
-----------------------------------------------------------------------------------------  ---------------  -------------  --------------  ------  ----------------------------
6 dB bandwidth                                                                                 500.500 kHz    500.000 kHz       0.500 kHz  PASS    47 CFR §15.247(a)(2)
99% occupied bandwidth (reported, no FCC limit)                                                496.067 kHz              —               —  INFO    ISED RSS-Gen (reported only)
Channel power (integrated, pre-compliance estimate; KDB 558074 methods for certification)         6.95 dBm      30.00 dBm       23.05 dBm  PASS    47 CFR §15.247(b)(3)
Peak PSD (scaled to 3 kHz)                                                                 -15.23 dBm/3kHz  8.00 dBm/3kHz  23.23 dBm/3kHz  PASS    47 CFR §15.247(e)
Band edge (902 / 928 MHz, peak method)                                                                   —              —               —  N/A     47 CFR §15.247(d)
20 dB bandwidth within 902–928 MHz (§15.215(c)) [RF review]                                  12726.417 kHz      0.000 kHz   12726.417 kHz  PASS    47 CFR §15.215(c)

Notes:
  Band edge (902 / 928 MHz, peak method): Not evaluated: trace does not cross 902 or 928 MHz.

Overall: PASS

Pre-compliance reference, not legal advice. Confirm against current eCFR and FCC KDB procedures.
$ echo $?
0
```

### Failing trace (6 dB bandwidth 499.5 kHz)

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

### JSON output, 12.5 dBi antenna

With a 12.5 dBi antenna the conducted-power limit drops to 30 − (12.5 − 6) = 23.5 dBm (§15.247(b)(4)). Full JSON:

```console
$ uv run rfcomp analyze examples/halow/halow_bw6_499p5khz_fail.csv --tech halow --antenna-gain 12.5 --json
{
  "settings": {
    "trace": "examples/halow/halow_bw6_499p5khz_fail.csv",
    "points": 2001,
    "spanMHz": [
      914.0,
      916.0
    ],
    "rbwKHz": 100.0,
    "offsetDb": 0.0,
    "antennaGainDbi": 12.5,
    "ndb": 6,
    "bandEdgeMethod": "peak",
    "centerMHz": null,
    "measuredCenterMHz": 915.0
  },
  "tech": "halow",
  "verdict": "FAIL",
  "checks": [
    {
      "label": "6 dB bandwidth",
      "value": 499499.99999989814,
      "limit": 500000.0,
      "margin": -500.0000001018634,
      "passed": false,
      "cite": "47 CFR §15.247(a)(2)",
      "unit": "Hz",
      "sense": "min",
      "note": null,
      "review": false,
      "detail": {
        "key": "bandwidth",
        "m1MHz": 914.75025,
        "m2MHz": 915.24975,
        "nDb": 6.0,
        "peakDbm": 0.0,
        "peakMHz": 914.761,
        "clipped": false
      },
      "status": "FAIL"
    },
    {
      "label": "99% occupied bandwidth (reported, no FCC limit)",
      "value": 495126.2687744702,
      "limit": null,
      "margin": null,
      "passed": null,
      "cite": "ISED RSS-Gen (reported only)",
      "unit": "Hz",
      "sense": "info",
      "note": null,
      "review": false,
      "detail": {
        "key": "obw",
        "oLMHz": 914.7524368656128,
        "oRMHz": 915.2475631343873,
        "frac": 0.99
      },
      "status": "INFO"
    },
    {
      "label": "Channel power (integrated, pre-compliance estimate; KDB 558074 methods for certification)",
      "value": 6.937046295192122,
      "limit": 23.5,
      "margin": 16.562953704807878,
      "passed": true,
      "cite": "47 CFR §15.247(b)(3), §15.247(b)(4)",
      "unit": "dBm",
      "sense": "max",
      "note": null,
      "review": false,
      "detail": {
        "key": "power",
        "antennaGainDbi": 12.5
      },
      "status": "PASS"
    },
    {
      "label": "Peak PSD (scaled to 3 kHz)",
      "value": -15.228787452803376,
      "limit": 8.0,
      "margin": 23.228787452803374,
      "passed": true,
      "cite": "47 CFR §15.247(e)",
      "unit": "dBm/3kHz",
      "sense": "max",
      "note": null,
      "review": false,
      "detail": {
        "key": "psd",
        "peakDbm": 0.0,
        "rbwHz": 100000.0
      },
      "status": "PASS"
    },
    {
      "label": "Band edge (902 / 928 MHz, peak method)",
      "value": null,
      "limit": null,
      "margin": null,
      "passed": null,
      "cite": "47 CFR §15.247(d)",
      "unit": "dBc",
      "sense": "info",
      "note": "Not evaluated: trace does not cross 902 or 928 MHz.",
      "review": false,
      "detail": {
        "key": "band_edge",
        "loDbc": null,
        "hiDbc": null,
        "method": "peak"
      },
      "status": "N/A"
    },
    {
      "label": "20 dB bandwidth within 902–928 MHz (§15.215(c))",
      "value": 12726.916666666624,
      "limit": 0.0,
      "margin": 12726.916666666624,
      "passed": true,
      "cite": "47 CFR §15.215(c)",
      "unit": "kHz",
      "sense": "min",
      "note": null,
      "review": true,
      "detail": {
        "key": "bw_containment",
        "m1MHz": 914.7269166666666,
        "m2MHz": 915.2730833333334,
        "nDb": 20.0,
        "loMHz": 902.0,
        "hiMHz": 928.0,
        "clipped": false
      },
      "status": "PASS"
    }
  ],
  "disclaimer": "Pre-compliance reference, not legal advice. Confirm against current eCFR and FCC KDB procedures."
}
$ echo $?
1
```
