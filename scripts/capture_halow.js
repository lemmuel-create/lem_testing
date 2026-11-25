#!/usr/bin/env node
/*
 * Capture HaLow golden cases from the legacy pages in headless Chromium (Playwright).
 *
 * Reference page: legacy/rf-lab/tools/bandwidth/index.html (manifest status `live`).
 * Cross-check page: legacy/halow_bandwidth_tool.html (older v1), same inputs, results recorded for comparison only.
 *
 * Each case loads a fresh page, drives the page controls the way a user would (preset, sliders, RBW, n dB,
 * limits, paste-a-trace), then records:
 *   - `display`: the text and pass/fail class of every result card, exactly as the page shows it;
 *   - `raw`:     full-precision values from the RF.math calls the page made (live page only). An init script
 *                wraps RF.math with pass-through recorders; return values are not changed;
 *   - `trace`:   for simulated cases, the RF.math.simulateSignal options and the SHA-256 of the trace
 *                (Float64 little-endian, f then a); the exact trace is in traces.json under that hash, because
 *                the Python simulator matches the JS only to the last bit of sin/pow. For pasted cases, the text.
 * The three bandwidth-page RF.test.add cases skipped in tests/golden/core/skipped.json are re-run here
 * against the page's own assertion, and the run aborts if any fails.
 *
 * Usage:  node scripts/capture_halow.js        (writes tests/golden/halow/{bandwidth,v1,traces}.json)
 * Needs:  npm install && npx playwright install chromium   in legacy/rf-lab
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const LEGACY = path.join(ROOT, 'legacy', 'rf-lab');
const { chromium } = require(path.join(LEGACY, 'node_modules', 'playwright'));
const OUT = path.join(ROOT, 'tests', 'golden', 'halow');
const PAGES = {
  bandwidth: 'legacy/rf-lab/tools/bandwidth/index.html',
  v1: 'legacy/halow_bandwidth_tool.html'
};
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const SOURCES = Object.fromEntries(
  [PAGES.bandwidth, PAGES.v1, 'legacy/rf-lab/shared/rfmath.js', 'legacy/rf-lab/shared/limits.js'].map((p) => [p, sha(p)])
);

/* ---------------- RF.math recorder (init script, live page only) ---------------- */
// rfmath.js does `root.RF = root.RF || {}; root.RF.math = api;`. A setter on RF.math wraps the measurement
// functions so each call's arguments and return value are kept. measure() always calls nDbBandwidth first,
// so that call starts a new record and stale values from an earlier update() cannot leak into a case.
const RECORDER = () => {
  const toArr = (v) => (ArrayBuffer.isView(v) ? Array.from(v) : v);
  const cap = (window.__cap = { sim: null, m: {} });
  const RFo = {};
  let math;
  Object.defineProperty(RFo, 'math', {
    configurable: true, enumerable: true, get: () => math,
    set(api) {
      const w = { ...api };
      w.simulateSignal = (o) => { const t = api.simulateSignal(o); cap.sim = { opts: { ...o }, f: Array.from(t.f), a: Array.from(t.a) }; return t; };
      w.nDbBandwidth = (f, a, n) => { const r = api.nDbBandwidth(f, a, n); cap.m = { f: toArr(f), a: toArr(a), nDbBandwidth: { n, ...r } }; return r; };
      w.obw = (f, a, frac) => { const r = api.obw(f, a, frac); cap.m.obw = { frac, ...r }; return r; };
      w.scaleToBw = (d, rbw, ref) => { const r = api.scaleToBw(d, rbw, ref); cap.m.scaleToBw = { dbm: d, rbwHz: rbw, refHz: ref, result: r }; return r; };
      w.channelPower = (f, a, rbw, lo, hi) => { const r = api.channelPower(f, a, rbw, lo, hi); cap.m.channelPower = { rbwHz: rbw, result: r }; return r; };
      w.bandEdge = (f, a, lo, hi) => { const r = api.bandEdge(f, a, lo, hi); cap.m.bandEdge = { loMHz: lo, hiMHz: hi, ...r }; return r; };
      math = w;
    }
  });
  window.RF = RFo;
};

/* ---------------- page driving ---------------- */
const DEFAULTS = { preset: 0, fc: 915, pwr: 30, rip: 2, steep: 8, rbwSim: 100000, nf: -70, ndb: 6, beLim: 20, resweeps: 0 };
const CARDS = ['bwLabel', 'mBw', 'mBwN', 'mRes', 'mResN', 'mObw', 'mPsd', 'mPsdN', 'mPow', 'mBe', 'mBeN', 'csvErr'];

async function setControls(page, ctl) {
  await page.evaluate((ctl) => {
    for (const [k, v] of Object.entries(ctl)) {
      const el = document.getElementById(k);
      if (!el) throw new Error('no control #' + k);
      el.value = String(v);
      el.dispatchEvent(new Event('change'));
    }
  }, ctl);
}

const TRACES = {};
async function runCase(browser, pageKey, c) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (pageKey === 'bandwidth') await page.addInitScript(RECORDER);
  await page.goto('file://' + path.join(ROOT, PAGES[pageKey]));
  await page.waitForTimeout(150);

  const settings = {};
  if (c.mode === 'sim') {
    const s = { ...DEFAULTS, ...c.sim };
    const { resweeps, ...ctl } = s;
    // limits first so they apply to the final update
    if (c.limits) await setControls(page, c.limits);
    await setControls(page, ctl);
    for (let i = 0; i < resweeps; i++) await page.click('#resweep');
    Object.assign(settings, s);
  } else {
    await page.click('#tabCsv');
    if (c.limits) await setControls(page, c.limits);
    const p = { units: 'auto', rbwCsv: 100, offset: 0, ndb: 6, beLim: 20, ...c.paste };
    const { text, ...ctl } = p;
    await setControls(page, ctl);
    await page.fill('#paste', text);
    await page.click('#loadPaste');
    Object.assign(settings, ctl);
  }
  settings.minbw = +(await page.inputValue('#minbw'));
  settings.psdLim = +(await page.inputValue('#psdLim'));
  settings.beLim = +(await page.inputValue('#beLim'));
  settings.ndb = +(await page.inputValue('#ndb'));

  const display = await page.evaluate((ids) => Object.fromEntries(ids.map((k) => {
    const el = document.getElementById(k);
    const cls = el.classList.contains('pass') ? 'pass' : el.classList.contains('fail') ? 'fail' : null;
    return [k, cls ? { text: el.textContent, cls } : el.textContent];
  })), CARDS);

  const out = { display };
  if (pageKey === 'bandwidth') {
    const cap = await page.evaluate(() => window.__cap);
    if (c.mode === 'sim') {
      const f = Float64Array.from(cap.sim.f), a = Float64Array.from(cap.sim.a);
      out.trace = {
        simulateSignal: cap.sim.opts,
        points: f.length,
        sha256: crypto.createHash('sha256').update(Buffer.from(f.buffer)).update(Buffer.from(a.buffer)).digest('hex')
      };
      TRACES[out.trace.sha256] = { f: cap.sim.f, a: cap.sim.a, rbwHz: cap.sim.opts.rbwHz };
    } else out.trace = { text: c.paste.text };
    if (display.csvErr) out.raw = null;
    else {
      const { f, a, ...m } = cap.m;
      out.raw = m;
    }
  } else {
    out.raw = await page.evaluate(() => {
      const r = window.__bwtool.measure();
      if (!r) return null;
      const { be, ...rest } = r;
      return { ...rest, be };
    });
  }
  if (errors.length) throw new Error(`${pageKey}/${c.id}: JS errors: ${errors.join(' | ')}`);
  await page.close();
  return { settings, ...out };
}

/* ---------------- synthetic pasted traces ---------------- */
const fmt = (x) => (Number.isInteger(x) ? String(x) : String(+x.toFixed(9)));
const csv = (pts, sep = ',') => pts.map(([f, a]) => `${fmt(f)}${sep}${fmt(a)}`).join('\n') + '\n';
const grid = (start, stop, n) => Array.from({ length: n }, (_, i) => start + (stop - start) * i / (n - 1));
/** Flat top at `top` dBm, linear skirts falling `depth` dB over `skirt` MHz, floor elsewhere. */
function trapezoid({ start, stop, n, fc, flatMHz, skirtMHz, top = 0, floor = -60 }) {
  return grid(start, stop, n).map((f) => {
    const d = Math.abs(f - fc) - flatMHz / 2;
    const a = d <= 0 ? top : d >= skirtMHz ? floor : top + (floor - top) * d / skirtMHz;
    return [f, a];
  });
}
// 6 dB points of a trapezoid with top 0, floor −60 and skirt s sit at flat/2 + s·6/60 from centre, so the
// 6 dB BW is flat + s/5. With a 1 kHz grid and 0.1 MHz skirts every crossing lands between samples on a
// straight segment, so the interpolated width is exact to float precision.
const bw6 = (bwKHz) => trapezoid({ start: 914, stop: 916, n: 2001, fc: 915, flatMHz: bwKHz / 1e3 - 0.02, skirtMHz: 0.1 });

/* Band-edge traces: in-band signal at 0 dBm, a spur below 902 MHz at −dbc. */
function bandEdgeTrace(dbc) {
  return grid(901, 903, 201).map((f) => [f, f > 902.2 && f < 902.8 ? 0 : Math.abs(f - 901.5) < 0.005 ? -dbc : -60]);
}
/* PSD boundary: flat signal whose peak, scaled from 100 kHz RBW to 3 kHz, sits ±0.005 dB from 8 dBm. */
const PSD_PEAK = 8 + 10 * Math.log10(100000 / 3000); // 23.2288 dBm in 100 kHz
const psdTrace = (delta) => trapezoid({ start: 914, stop: 916, n: 201, fc: 915, flatMHz: 1, skirtMHz: 0.1, top: +(PSD_PEAK + delta).toFixed(4), floor: -40 });

/*
 * Integer-kHz grid written as fixed 3-decimal MHz text, so a row at 902.000 or 928.000 parses to exactly 902 or 928
 * (units auto-detect to MHz, multiplier 1) and band-edge tests can pin the strict `f < lo` / `f > hi` rule.
 * `level(kHz)` returns the amplitude; amplitudes are written with String() so exact values survive parsing.
 */
const rowsK = (startK, stopK, stepK, level) => {
  let s = '';
  for (let k = startK; k <= stopK; k += stepK) s += `${(k / 1000).toFixed(3)},${String(level(k))}\n`;
  return s;
};
const inK = (k, loK, hiK) => k >= loK && k <= hiK;
/* OBW: flat 0 dBm over 914.500–915.500 MHz on a 1 kHz grid, floor −200 dBm (≈ zero power). With trapezoidal
 * integration of linear power the edge ramps add 0.0005 mW·MHz each side, so T = 1.001, the 0.5 % cut is
 * 0.005005, oL = 914.5 + 0.004505 and the 99 % OBW is exactly 1 − 2·0.004505 = 0.99099 MHz. */
const OBW_RECT = 990990;
const obwRect = (offsetTop = 0) => rowsK(914000, 916000, 1, (k) => (inK(k, 914500, 915500) ? offsetTop : -200));
/* Flat signal at an exact peak for the PSD scaling to 3 kHz. */
const psdFlat = (top) => rowsK(914000, 916000, 10, (k) => (inK(k, 914500, 915500) ? top : -40));
/* Band edge: 0 dBm carrier at `carrier` (kHz range), plus point spurs {kHz: dBm}; floor −60 dBm. */
const edgeTrace = (startK, stopK, carrier, spurs = {}) =>
  rowsK(startK, stopK, 10, (k) => (k in spurs ? spurs[k] : inK(k, carrier[0], carrier[1]) ? 0 : -60));
/* n-dB trapezoid on a 1 kHz grid: flat 0 dBm over `flatK` kHz centred on `fcK`, skirts falling 1 dB per kHz to a
 * −60 dBm floor. The (peak − n) crossing then sits exactly on the sample n kHz outside the flat top, so
 * M1 = fc − flat/2 − n and M2 = fc + flat/2 + n (kHz) with no interpolation error. */
const ndbTrap = (startK, stopK, fcK, flatK) => rowsK(startK, stopK, 1, (k) => {
  const d = Math.abs(k - fcK) - flatK / 2;
  return d <= 0 ? 0 : d >= 60 ? -60 : -d;
});
const near = (x, y, tol = 1e-9) => Math.abs(x - y) <= tol;

/* ---------------- cases ---------------- */
const P = { halow1: 0, halow2: 1, halow4: 2, halow8: 3, halow16: 4, fsk200: 5, lora500: 6 };
const CASES = [
  // RF.test.add cases from the bandwidth page (skipped in core golden because they drive the page)
  { id: 'sim-halow1-default', mode: 'sim', sim: { preset: P.halow1 }, knownAnswer: 'Simulated HaLow 1 MHz passes with 850–920 kHz',
    check: (r) => r.raw.nDbBandwidth.bwHz > 850e3 && r.raw.nDbBandwidth.bwHz < 920e3 },
  { id: 'sim-fsk200-fails', mode: 'sim', sim: { preset: P.fsk200 }, knownAnswer: 'Simulated narrowband FSK fails 500 kHz',
    check: (r) => r.raw.nDbBandwidth.bwHz < 500e3 },
  { id: 'sim-halow1-chpower', mode: 'sim', sim: { preset: P.halow1 }, knownAnswer: 'Channel power recovers the set 30 dBm',
    check: (r) => Math.abs(r.raw.channelPower.result - 30) <= 0.2 },
  // presets
  { id: 'sim-halow2', mode: 'sim', sim: { preset: P.halow2 } },
  { id: 'sim-halow4', mode: 'sim', sim: { preset: P.halow4 } },
  { id: 'sim-halow8', mode: 'sim', sim: { preset: P.halow8 } },
  { id: 'sim-halow16-crosses-both-edges', mode: 'sim', sim: { preset: P.halow16 }, note: 'span 898.2–931.8 MHz: band edge evaluated at 902 and 928' },
  { id: 'sim-lora500-marginal', mode: 'sim', sim: { preset: P.lora500 } },
  // settings that change the answer
  { id: 'sim-fsk200-rbw300k', mode: 'sim', sim: { preset: P.fsk200, rbwSim: 300000 }, note: 'RBW inflation exercise' },
  { id: 'sim-halow1-rbw3k', mode: 'sim', sim: { preset: P.halow1, rbwSim: 3000 } },
  { id: 'sim-halow1-ripple10-psd-fail', mode: 'sim', sim: { preset: P.halow1, rip: 10 }, note: 'ripple pushes PSD over 8 dBm/3 kHz' },
  { id: 'sim-halow1-24dbm', mode: 'sim', sim: { preset: P.halow1, pwr: 24 } },
  { id: 'sim-halow1-ndb20', mode: 'sim', sim: { preset: P.halow1, ndb: 20 } },
  { id: 'sim-halow1-fc902p5-lower-edge', mode: 'sim', sim: { preset: P.halow1, fc: 902.5 }, note: 'crosses 902 MHz only' },
  { id: 'sim-halow4-fc926-upper-edge', mode: 'sim', sim: { preset: P.halow4, fc: 926 }, note: 'crosses 928 MHz only' },
  { id: 'sim-halow16-avg-method-30dbc', mode: 'sim', sim: { preset: P.halow16, beLim: 30 } },
  { id: 'sim-halow1-resweep2', mode: 'sim', sim: { preset: P.halow1, resweeps: 2 }, note: 'seed 13 after two re-sweeps' },
  { id: 'sim-halow1-steep1', mode: 'sim', sim: { preset: P.halow1, steep: 1 }, note: 'slow roll-off: skirts reach the span edge' },
  // pasted traces
  { id: 'csv-rect-1mhz-hz-auto', mode: 'csv', paste: { text: csv(grid(914e6, 916e6, 401).map((f) => [f, Math.abs(f - 915e6) <= 0.5e6 ? 0 : -60])) }, note: 'Hz auto-detect' },
  { id: 'csv-rect-khz-offset', mode: 'csv', paste: { units: '1e3', offset: 10.5, rbwCsv: 30, text: csv(grid(914000, 916000, 401).map((f) => [f, Math.abs(f - 915000) <= 400 ? -12 : -70]), '\t') }, note: 'explicit kHz, +10.5 dB offset, 30 kHz RBW, tab separated' },
  { id: 'csv-header-and-extra-columns', mode: 'csv', paste: { text: 'Keysight N9020B\nFreq(MHz),Amp(dBm),Extra\n' + grid(914, 916, 101).map((f) => `${fmt(f)},${Math.abs(f - 915) <= 0.3 ? -5 : -65},1`).join('\n') + '\n' } },
  { id: 'csv-bw6-500p5-pass', mode: 'csv', paste: { text: csv(bw6(500.5)) }, boundary: '6 dB BW 500.5 kHz vs 500 kHz minimum' },
  { id: 'csv-bw6-500p0-pass', mode: 'csv', paste: { text: csv(bw6(500)) }, boundary: '6 dB BW exactly 500 kHz (>= passes)' },
  { id: 'csv-bw6-499p5-fail', mode: 'csv', paste: { text: csv(bw6(499.5)) }, boundary: '6 dB BW 499.5 kHz vs 500 kHz minimum' },
  { id: 'csv-psd-just-under', mode: 'csv', paste: { text: csv(psdTrace(-0.005)) }, boundary: 'PSD 7.995 dBm/3 kHz vs 8' },
  { id: 'csv-psd-just-over', mode: 'csv', paste: { text: csv(psdTrace(0.005)) }, boundary: 'PSD 8.005 dBm/3 kHz vs 8' },
  { id: 'csv-bandedge-20dbc-pass', mode: 'csv', paste: { text: csv(bandEdgeTrace(20)) }, boundary: 'band edge exactly 20 dBc (>= passes)' },
  { id: 'csv-bandedge-19p99dbc-fail', mode: 'csv', paste: { text: csv(bandEdgeTrace(19.99)) }, boundary: 'band edge 19.99 dBc vs 20' },
  { id: 'csv-bandedge-30dbc-avg-method-fail', mode: 'csv', paste: { beLim: 30, text: csv(bandEdgeTrace(25)) }, note: '25 dBc fails the 30 dB average-power method' },
  { id: 'csv-clipped-widen-span', mode: 'csv', paste: { text: csv(grid(914.8, 915.2, 101).map((f) => [f, -3 * Math.abs(f - 915)])) }, note: 'trace never falls 6 dB: "widen span!"' },
  // 99 % OBW
  { id: 'obw-rect-known-answer', mode: 'csv', paste: { text: obwRect() }, expect: `99% OBW = ${OBW_RECT} Hz (analytic)`,
    check: (r) => Math.abs(r.raw.obw.bwHz - OBW_RECT) < 1e-3 },
  { id: 'obw-rect-offset-invariant', mode: 'csv', paste: { offset: 20, text: obwRect() }, expect: 'a +20 dB reference offset leaves OBW unchanged',
    check: (r) => Math.abs(r.raw.obw.bwHz - OBW_RECT) < 1e-3 },
  { id: 'obw-asymmetric-two-level', mode: 'csv',
    paste: { text: rowsK(914000, 916000, 1, (k) => (inK(k, 914500, 915000) ? 0 : inK(k, 915001, 915500) ? -10 : -200)) },
    expect: 'lopsided: the upper cut sits ~10× further inside the 915.5 MHz edge than the lower cut does inside 914.5',
    check: (r) => (915.5 - r.raw.obw.oR) > 5 * (r.raw.obw.oL - 914.5) },
  { id: 'obw-two-tones-spans-gap', mode: 'csv',
    paste: { text: rowsK(914000, 916000, 1, (k) => (inK(k, 914590, 914610) || inK(k, 915390, 915410) ? 0 : -200)) },
    expect: 'equal tones at 914.6 and 915.4 MHz: OBW and 6 dB BW both span the gap (~0.82 MHz)',
    check: (r) => r.raw.obw.bwHz > 800e3 && r.raw.obw.bwHz < 840e3 && r.raw.nDbBandwidth.bwHz > 800e3 },
  { id: 'obw-sim-halow1-high-noise-floor', mode: 'sim', sim: { preset: P.halow1, nf: -10 },
    expect: 'a noise floor 30 dB under the in-band level widens OBW (~977 kHz vs 969 kHz) but leaves the 6 dB BW at ~885 kHz',
    check: (r) => r.raw.obw.bwHz > 975e3 && Math.abs(r.raw.nDbBandwidth.bwHz - 885.4e3) < 1e3 },
  // PSD (peak scaled from RBW to 3 kHz; pass when PSD <= limit)
  { id: 'psd-rbw30k-exactly-8-pass', mode: 'csv', paste: { rbwCsv: 30, text: psdFlat(18) }, boundary: '18 dBm in 30 kHz = exactly 8.000 dBm/3 kHz (<= passes)',
    check: (r) => r.raw.scaleToBw.result === 8 && r.display.mPsd.cls === 'pass' },
  { id: 'psd-rbw30k-8p01-fail', mode: 'csv', paste: { rbwCsv: 30, text: psdFlat(18.01) }, boundary: '18.01 dBm in 30 kHz = 8.01 dBm/3 kHz',
    check: (r) => r.display.mPsd.cls === 'fail' },
  { id: 'psd-rbw3k-exactly-8-pass', mode: 'csv', paste: { rbwCsv: 3, text: psdFlat(8) }, boundary: 'RBW 3 kHz: no scaling, 8.000 passes',
    check: (r) => r.raw.scaleToBw.result === 8 && r.display.mPsd.cls === 'pass' },
  { id: 'psd-rbw3k-8p01-fail', mode: 'csv', paste: { rbwCsv: 3, text: psdFlat(8.01) }, boundary: 'RBW 3 kHz: 8.01 fails',
    check: (r) => r.display.mPsd.cls === 'fail' },
  { id: 'psd-rbw100k-float-at-limit', mode: 'csv', paste: { text: psdFlat(PSD_PEAK) },
    boundary: `peak ${PSD_PEAK} dBm in 100 kHz scales to 7.999999999999998, not 8: passes; Python must reproduce the same rounding`,
    check: (r) => r.raw.scaleToBw.result < 8 && r.display.mPsd.cls === 'pass' },
  { id: 'psd-sim-halow1-31p5dbm-pass', mode: 'sim', sim: { preset: P.halow1, pwr: 31.5 }, check: (r) => r.display.mPsd.cls === 'pass' },
  { id: 'psd-sim-halow1-32dbm-fail', mode: 'sim', sim: { preset: P.halow1, pwr: 32 }, check: (r) => r.display.mPsd.cls === 'fail' },
  { id: 'psd-sim-halow1-limit-6', mode: 'sim', limits: { psdLim: 6 }, sim: { preset: P.halow1 }, note: 'PSD limit field set to 6 dBm: 6.40 now fails',
    check: (r) => r.display.mPsd.cls === 'fail' },
  // band edge (max level outside 902–928 MHz relative to the overall peak; pass when min dBc >= requirement)
  { id: 'be-upper-928-exactly-20-pass', mode: 'csv', paste: { text: edgeTrace(927000, 929000, [927200, 927800], { 928500: -20 }) }, boundary: '928 side exactly 20 dBc',
    check: (r) => r.raw.bandEdge.hi === 20 && r.raw.bandEdge.lo === null && r.display.mBe.cls === 'pass' },
  { id: 'be-upper-928-19p99-fail', mode: 'csv', paste: { text: edgeTrace(927000, 929000, [927200, 927800], { 928500: -19.99 }) }, boundary: '928 side 19.99 dBc',
    check: (r) => r.display.mBe.cls === 'fail' },
  { id: 'be-both-edges-lower-pass-upper-fail', mode: 'csv', paste: { text: edgeTrace(901000, 929000, [914000, 916000], { 901500: -25, 928500: -15 }) },
    expect: 'worst side decides: 902 = 25 dBc passes, 928 = 15 dBc fails → Fail',
    check: (r) => r.raw.bandEdge.lo === 25 && r.raw.bandEdge.hi === 15 && r.display.mBe.cls === 'fail' },
  { id: 'be-both-edges-pass', mode: 'csv', paste: { text: edgeTrace(901000, 929000, [914000, 916000], { 901500: -25, 928500: -22 }) },
    check: (r) => r.display.mBe.cls === 'pass' },
  { id: 'be-sample-at-902-is-in-band', mode: 'csv', paste: { text: edgeTrace(901000, 903000, [902200, 902800], { 902000: -5 }) },
    boundary: 'a −5 dBc sample exactly at 902.000 MHz is not counted (strict f < 902); outside max is the −60 floor',
    check: (r) => r.raw.bandEdge.lo === 60 && r.display.mBe.cls === 'pass' },
  { id: 'be-sample-at-928-is-in-band', mode: 'csv', paste: { text: edgeTrace(927000, 929000, [927200, 927800], { 928000: -5 }) },
    boundary: 'a −5 dBc sample exactly at 928.000 MHz is not counted (strict f > 928)',
    check: (r) => r.raw.bandEdge.hi === 60 && r.display.mBe.cls === 'pass' },
  { id: 'be-sample-just-below-902-counts', mode: 'csv', paste: { text: edgeTrace(901000, 903000, [902200, 902800], { 901990: -5 }) },
    boundary: 'the same −5 dBc sample at 901.990 MHz is counted → 5 dBc, Fail',
    check: (r) => r.raw.bandEdge.lo === 5 && r.display.mBe.cls === 'fail' },
  { id: 'be-far-spur-dominates', mode: 'csv', paste: { text: edgeTrace(899000, 903000, [902200, 902800], { 900000: -25, 901990: -45 }) },
    expect: 'a spur 2 MHz below the edge (−25 dBc) sets the result, not the −45 dBc skirt next to the edge',
    check: (r) => r.raw.bandEdge.lo === 25 },
  { id: 'be-peak-out-of-band', mode: 'csv', paste: { text: edgeTrace(901000, 903000, [901300, 901700], { 902500: -30 }) },
    expect: 'carrier at 901.5 MHz (outside the band): the out-of-band max is the peak itself → 0 dBc, Fail',
    check: (r) => r.raw.bandEdge.lo === 0 && r.display.mBe.cls === 'fail' },
  // n-dB bandwidth: 6 / 20 / 26 dB on the same trace (BW = flat + 2n kHz)
  { id: 'ndb6-trapezoid-known-answer', mode: 'csv', paste: { ndb: 6, text: ndbTrap(914000, 916000, 915000, 500) }, expect: '6 dB BW = 512 kHz, M1 914.744, M2 915.256',
    check: (r) => near(r.raw.nDbBandwidth.bwHz, 512e3, 1e-3) && near(r.raw.nDbBandwidth.fL, 914.744) },
  { id: 'ndb20-trapezoid-known-answer', mode: 'csv', paste: { ndb: 20, text: ndbTrap(914000, 916000, 915000, 500) }, expect: '20 dB BW = 540 kHz, M1 914.730, M2 915.270',
    check: (r) => near(r.raw.nDbBandwidth.bwHz, 540e3, 1e-3) && near(r.raw.nDbBandwidth.fR, 915.27) },
  { id: 'ndb26-trapezoid-known-answer', mode: 'csv', paste: { ndb: 26, text: ndbTrap(914000, 916000, 915000, 500) }, expect: '26 dB BW = 552 kHz, M1 914.724, M2 915.276',
    check: (r) => near(r.raw.nDbBandwidth.bwHz, 552e3, 1e-3) },
  { id: 'ndb26-sim-halow1', mode: 'sim', sim: { preset: P.halow1, ndb: 26 } },
  // edge channels: M1/M2 of the 20 dB bandwidth vs 902 / 928 MHz (§15.215(c) containment). The legacy page reports
  // M1/M2 but has no §15.215(c) verdict; these cases pin the marker values only.
  { id: 'edge20-m1-902p001-inside', mode: 'csv', paste: { ndb: 20, text: ndbTrap(901500, 903500, 902500, 958) },
    boundary: '20 dB M1 = 902.001 MHz (1 kHz inside 902)', check: (r) => near(r.raw.nDbBandwidth.fL, 902.001) },
  { id: 'edge20-m1-901p999-outside', mode: 'csv', paste: { ndb: 20, text: ndbTrap(901500, 903500, 902500, 962) },
    boundary: '20 dB M1 = 901.999 MHz (1 kHz outside 902)', check: (r) => near(r.raw.nDbBandwidth.fL, 901.999) },
  { id: 'edge20-m2-927p999-inside', mode: 'csv', paste: { ndb: 20, text: ndbTrap(926500, 928500, 927500, 958) },
    boundary: '20 dB M2 = 927.999 MHz (1 kHz inside 928)', check: (r) => near(r.raw.nDbBandwidth.fR, 927.999) },
  { id: 'edge20-m2-928p001-outside', mode: 'csv', paste: { ndb: 20, text: ndbTrap(926500, 928500, 927500, 962) },
    boundary: '20 dB M2 = 928.001 MHz (1 kHz outside 928)', check: (r) => near(r.raw.nDbBandwidth.fR, 928.001) },
  { id: 'edge20-sim-halow1-fc902p5', mode: 'sim', sim: { preset: P.halow1, fc: 902.5, ndb: 20 }, note: 'lowest 1 MHz channel, 20 dB markers' },
  { id: 'edge20-sim-halow1-fc927p5', mode: 'sim', sim: { preset: P.halow1, fc: 927.5, ndb: 20 }, note: 'highest 1 MHz channel, 20 dB markers' },
  { id: 'edge20-sim-halow2-fc903', mode: 'sim', sim: { preset: P.halow2, fc: 903, ndb: 20 }, note: 'lowest 2 MHz channel, 20 dB markers' },
  { id: 'edge20-sim-halow2-fc927', mode: 'sim', sim: { preset: P.halow2, fc: 927, ndb: 20 }, note: 'highest 2 MHz channel, 20 dB markers' },
  // band edge, 30 dBc average-power method
  { id: 'be-avg-method-exactly-30-pass', mode: 'csv', paste: { beLim: 30, text: csv(bandEdgeTrace(30)) }, boundary: '902 side exactly 30 dBc vs 30 (>= passes)',
    check: (r) => r.raw.bandEdge.lo === 30 && r.display.mBe.cls === 'pass' },
  { id: 'be-avg-method-29p99-fail', mode: 'csv', paste: { beLim: 30, text: csv(bandEdgeTrace(29.99)) }, boundary: '902 side 29.99 dBc vs 30',
    check: (r) => r.raw.bandEdge.lo === 29.99 && r.display.mBe.cls === 'fail' },
  { id: 'csv-too-few-rows', mode: 'csv', paste: { text: csv(grid(914, 916, 9).map((f) => [f, -10])) }, expectError: true }
];

/* ---------------- run ---------------- */
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const book = { bandwidth: [], v1: [] };
  for (const c of CASES) {
    for (const key of ['bandwidth', 'v1']) {
      const r = await runCase(browser, key, c);
      const rec = { id: c.id, mode: c.mode };
      for (const k of ['knownAnswer', 'note', 'boundary', 'expect']) if (c[k]) rec[k] = c[k];
      if (c.expectError) {
        if (!r.display.csvErr) throw new Error(`${key}/${c.id}: expected a parse error`);
      } else if (r.display.csvErr) throw new Error(`${key}/${c.id}: unexpected parse error: ${r.display.csvErr}`);
      if (key === 'bandwidth' && c.check) {
        const ok = c.check(r);
        rec.legacyCheck = { ok };
        if (!ok) throw new Error(`case check failed on the legacy page: ${c.id}`);
      }
      book[key].push({ ...rec, ...r });
    }
  }
  await browser.close();

  const meta = (page, extra) => ({
    generator: 'scripts/capture_halow.js', page, sources: SOURCES, captured: 'Playwright, headless Chromium, file://', ...extra
  });
  const write = (name, obj) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2) + '\n');
  write('bandwidth.json', { meta: meta(PAGES.bandwidth, { status: 'live', defaults: DEFAULTS,
    traceHash: 'sha256 over Float64 little-endian bytes of f (MHz) then a (dBm)' }), cases: book.bandwidth });
  fs.writeFileSync(path.join(OUT, 'traces.json'), '{\n' + Object.keys(TRACES).sort().map((k) =>
    `  ${JSON.stringify(k)}: {"rbwHz": ${TRACES[k].rbwHz}, "f": ${JSON.stringify(TRACES[k].f)}, "a": ${JSON.stringify(TRACES[k].a)}}`).join(',\n') + '\n}\n');
  write('v1.json', { meta: meta(PAGES.v1, { status: 'superseded (cross-check only)' }), cases: book.v1 });
  console.log(`captured ${CASES.length} cases × 2 pages → ${path.relative(ROOT, OUT)}/`);
})().catch((e) => { console.error(e); process.exit(1); });
