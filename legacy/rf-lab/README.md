# RF Lab

Offline, browser-based training tools for FCC regulatory measurements, organized into five tracks:

- **Wi-Fi HaLow:** 902–928 MHz, §15.247
- **Wi-Fi:** 2.4 GHz under §15.247, and 5 GHz U-NII under §15.407
- **LTE:** device and module side, Parts 22, 24 and 27
- **CBRS:** 3550–3700 MHz under Part 96
- **Co-location:** several radios in one product (harmonics, intermodulation, simultaneous-transmission testing)

The hub (`index.html`) lists every tool by track and learning level. Each tool page has a concept summary, a simulator or calculator, real-trace analysis (where it applies), method notes, and the relevant FCC regulations. Checkup exercises are written for every tool but hidden for now; set `showExercises: true` in `manifest.js` to show them. The questions and answers are kept in the "RF Lab checkup questions and answer key" doc. Nothing needs installing to *use* it, and it works with no internet connection.

```
rf-lab/
├── index.html              hub: track switcher, levels, search, per-browser progress
├── manifest.js             catalog: tracks, levels, and every tool's id, track, status, version, owner, refs, regulations
├── shared/
│   ├── theme.css           layout and light/dark styling
│   ├── rfmath.js           RF.math: dB math, n-dB BW, OBW, PSD scaling, channel power, ERP/EIRP, masks, trace parser, simulator
│   ├── limits.js           RF.limits: ALL regulatory numbers (HaLow, 2.4 GHz, U-NII, LTE bands), with citations
│   ├── rfplot.js           RF.plot: analyzer-style canvas plot, overlays, limit segments/masks, PNG export
│   ├── rflab.js            RF.page / RF.ex / RF.progress / RF.test: header, regulations table, exercises, progress, tests
│   └── coloc.js            RF.coloc: radio presets, intermod products, RF exposure math (co-location tools)
├── tools/
│   ├── _template/          copy this to start a new tool
│   ├── bandwidth/          HaLow 6 dB bandwidth (live)
│   ├── wifi-24/            Wi-Fi 2.4 GHz bandwidth and band edges (in RF review)
│   ├── wifi-unii/          Wi-Fi 5 GHz U-NII power and PSD (in RF review)
│   ├── lte-mask/           LTE device power and emission mask (in RF review)
│   ├── cbrs-mask/          CBRS power and emission mask (in RF review)
│   ├── coloc-im/           Co-location intermod and spurious planner (in RF review)
│   ├── coloc-mpe/          Simultaneous-transmission RF exposure (in RF review)
│   └── coloc-plan/         Co-location test plan builder (in RF review)
├── scripts/build_standalone.js   builds dist/<id>.html single-file copies
├── dist/                   single-file copies of every live and in-review tool
├── tests/run_tests.js      headless test runner
├── CHANGELOG.md
└── package.json
```

## Tool status

| Status | Meaning | Shown on hub |
|---|---|---|
| `planned` | Idea in the catalog, no page yet | Greyed out |
| `review` | Built and tested; limits and wording await RF engineer sign-off. The page shows an "In RF review" banner. | Clickable, orange tag |
| `live` | Reviewed and approved | Clickable, green tag |
| `template` | The starter page | Hidden |

## Sharing a single tool

`npm run build` (or `node scripts/build_standalone.js`) writes `dist/<id>.html` for every live and in-review tool. Each one is a single HTML file with all shared code inlined, so you can email it or open it on any machine. Rebuild after every change. The `dist/` files are generated, so don't edit them by hand.

## Hosting on the Mac mini

**Shared folder:** put `rf-lab/` in a shared folder and open `index.html`.

**Office network URL:**

```bash
cd ~/rf-lab && python3 -m http.server 8080      # then open http://<mac-mini>.local:8080/
```

To keep the server running across reboots, use a LaunchAgent with `ProgramArguments` set to `/usr/bin/python3 -m http.server 8080 --directory /Users/<you>/rf-lab`, plus `RunAtLoad` and `KeepAlive`. Set the Mac mini to auto-login and never sleep. You can link straight to a track with `index.html#wifi` or `index.html#lte`.

## Adding a tool

1. `cp -R tools/_template tools/<id>`. Add a `manifest.js` entry with the same `id`, plus `track` (`halow`, `wifi`, `lte`, or `common` for every track), `level`, `status: 'planned'`, `version`, `owner`, `refs`, `regulations` (`{cite, req, use}`) and `guidance`.
2. Replace every `TODO` in the copy. Keep all six sections.
3. **Read limits only from `RF.limits`.** If a number you need isn't there, add it to `shared/limits.js` with a `cite`.
4. Write 3–5 exercises (`RF.ex.mount`), mixing three types:
   - `state`: the user configures the tool, then presses Check
   - `number`: a calculation answer
   - `choice`: a concept question

   Make sure every `state` exercise can actually be completed within the controls' ranges.
5. Add known-answer tests (`RF.test.add`), including at least one pass/fail boundary case.
6. `npm test` must pass. `npm run test:screens` saves light and dark screenshots to review.
7. Set `status: 'review'`, run `npm run build`, and send the page for RF review. Once it's approved, set `status: 'live'`, bump `labVersion`, and add a CHANGELOG entry.

Tool pages load shared files with plain `<script src>` tags, not ES modules. That way pages also work when opened directly from disk.

## Updating regulatory limits

Edit `shared/limits.js` only. Every value there was checked against the CFR text on 2026-11-23, and each section lists the rule pages it was checked against in `sources`. When a rule changes:

1. Update the value, its `cite`, `sources`, `verified` and `version`.
2. Run `npm test` and `npm run build`.
3. Record the change in `CHANGELOG.md`.

Never add a limit from memory. Read it from the rule text first.

## Tests

```bash
npm install && npx playwright install chromium   # once
npm test                                          # hub + every live, review and template page
```

## Progress tracking

Exercise completion is stored in each user's browser (localStorage), so clearing the browser resets it. If managers need a team view later, add a small backend on the Mac mini. Only `RF.progress` would need changing.

*Training reference, not legal advice. Confirm against current eCFR text and FCC KDB procedures before certification decisions.*
