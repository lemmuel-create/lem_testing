# Changelog

## 0.4.1 — 2026-11-23
- limits.js 2026.11.5: every value checked against the CFR text (Cornell LII mirror of eCFR); each section now lists its `sources`. `review` flags removed from limits.
- Corrections found in the check:
  - LTE measurement bandwidth: Band 5 uses a 100 kHz reference bandwidth (§22.917(b)); Bands 12/13/71 use 100 kHz with ≥ 30 kHz allowed in the first 100 kHz (§27.53(c)(5), (g)). PCS/AWS unchanged (1 MHz, 1% EBW in the first 1 MHz).
  - Band 13: added the 65 + 10·log10(P) dB (−35 dBm in 6.25 kHz) limit for mobiles in 763–775 and 793–805 MHz (§27.53(c)(4), (c)(6)), and the −80 dBW discrete GNSS limit (§27.53(f)).
  - CBRS: Category A/B PSD limits 20/37 dBm/MHz; EUD near zone is 0 to B MHz (its channel bandwidth), not 10 MHz; EUD ACLR ≥ 30 dB; added −25 dBm/MHz below 3540 / above 3710 MHz; PAPR (13 dB) applies to CBSDs only (§96.41).
  - U-NII DFS: channel closing transmission time 200 ms (not 260 ms); −62 dBm threshold requires EIRP < 200 mW and PSD < 10 dBm/MHz (§15.407(h)(2)); U-NII-1 fixed point-to-point exception up to 23 dBi (§15.407(a)(1)(iii)).
  - Band 5 power cite corrected to §22.913(a)(5).
- Confirmed unchanged: §15.205 list, §15.209, §15.35(b), §15.33(a), §15.247, §15.249, §15.407 power/PSD/mask, §24.232, §24.238, §27.50, §27.53(h), §2.1057, §1.1310, §1.1307(b)(3) P_th formula.
- LTE tool v1.1.0 (band-specific mask bandwidths, Band 13 public-safety limit; exercise now uses Band 13), CBRS tool v1.1.0 (PSD, EUD near zone and ACLR), U-NII tool v1.1.0 (DFS details).

## 0.4.0 — 2026-11-23
- New shared library `shared/coloc.js` (RF.coloc): radio presets, harmonic/intermod products, MPE and SAR-exemption math. The intermod planner now uses it.
- New co-location tools (in RF review):
  - Simultaneous-transmission RF exposure: MPE sum of ratios (mobile), §1.1307(b)(3) SAR test-exemption sum (portable), measured-SAR sum, duty cycle, minimum separation, sum-vs-distance chart.
  - Co-location test plan builder: certification path per radio (module grant / Class II / full), test matrix (Part 15B, AC conducted, integration spot checks, per-technology test sets, simultaneous-transmission radiated spurious from the intermod math, RF exposure, labeling), CSV/text/print export.

## 0.3.1 — 2026-11-23
- Intermod planner v1.1.0: harmonics up to the 10th (default 10), matching the §15.33(a) / §2.1057(a) search range. Part 15 products are cut at 40 GHz; LTE/CBRS-only products continue to the 10th harmonic. Chart now spans 100 MHz–40 GHz.
- limits.js 2026.11.4: §15.205 bands above 24 GHz (31.2–31.8, 36.43–36.5 GHz, everything above 38.6 GHz) and a `measurementRange` entry.

## 0.3.0 — 2026-11-23
- Checkup questions hidden on tool pages (`showExercises: false` in manifest.js). They stay registered in code and are published in the "RF Lab checkup questions and answer key" doc.
- New tracks: CBRS and Co-location.
- New tools (in RF review):
  - CBRS power and emission mask (Part 96): EUD / Category A / Category B EIRP per 10 MHz, the −13/−25/−40 dBm/MHz mask, PAPR, SAS notes.
  - Intermod and spurious planner: harmonics and 2nd/3rd/5th-order IM of up to any number of co-located radios (HaLow, Wi-Fi 2.4/5, LTE bands, CBRS, GNSS receiver), flagged against §15.205 restricted bands and host receivers, with CSV test-matrix export.
- Planned: CBSD/SAS grants, simultaneous-transmission RF exposure, co-location test plan builder, coexistence/desense.
- limits.js 2026.11.3: `cbrs`, `gnss`, LTE downlink bands, and the full §15.205 list from 30 MHz to 24 GHz.
- Test runner checks registered exercises instead of rendered ones.

## 0.2.0 — 2026-11-23
- Three technology tracks: Wi-Fi HaLow, Wi-Fi and LTE. The hub has a track switcher (deep-link with `#halow`, `#wifi`, `#lte`); `common` tools appear in every track.
- New `review` status: built and tested, awaiting RF sign-off. Pages show an "In RF review" banner.
- New tools (in RF review):
  - Wi-Fi 2.4 GHz bandwidth and band edges (§15.247, §15.205/15.209): 802.11b/20 MHz/40 MHz modes, channels 1–13, the 2400 MHz relative edge and the 2390/2483.5 MHz restricted bands in EIRP.
  - Wi-Fi 5 GHz U-NII power and PSD (§15.407): sub-band and device class limits, 26 dB EBW power formula, antenna-gain reduction, out-of-band limits (−27 dBm/MHz, U-NII-3 mask, restricted bands), DFS and TPC.
  - LTE device power and emission mask (Parts 22H/24E/27): Bands 2, 4, 5, 12, 13, 66, 71; ERP/EIRP limits; −13 dBm mask with 1% EBW near the block edge; PAPR.
- limits.js 2026.11.2: adds `wifi24`, `unii` and `lte` sections (flagged `review: true`).
- rfmath: spectral-regrowth shoulder in the simulator, fixed start/stop spans, ERP/EIRP conversion, `maxInRange`, `interp`, `worstMargin`. rfplot: `segments` overlay for limit lines and masks.
- `scripts/build_standalone.js` builds single-file copies of every live and review tool into `dist/`.
- HaLow 6 dB bandwidth tool renamed "HaLow 6 dB bandwidth" (no functional change).

## 0.1.1 — 2026-11-23
- Tool pages now end with a "Relevant FCC regulations" section, driven by `regulations` and `guidance` in each manifest entry, with links to eCFR.
- 6 dB bandwidth tool v2.1.0: lists 12 relevant rules (§15.247(a)–(e), §15.215(c), §15.205, §15.209, §15.35, §15.31, §2.1049) plus KDB 558074, ANSI C63.10 and ISED references.
- Test runner checks that every live tool lists its regulations.

## 0.1.0 — 2026-11-22
- RF Lab scaffold: hub, shared library (theme, rfmath, rfplot, rflab, limits), manifest, test runner, tool template.
- 6 dB bandwidth tool v2.0.0: rebuilt on shared library; adds concept section, 4 exercises, known-answer tests; limits read from `limits.js`.
- Limits 2026.11.1 (verified 2026-11-22): §15.247 DTS/FHSS, §15.209 >960 MHz, §15.205 subset, RF exposure MPE.
