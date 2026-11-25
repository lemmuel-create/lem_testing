#!/usr/bin/env node
/*
 * Capture golden reference values from the legacy RF Lab shared libraries.
 *
 * Loads legacy/rf-lab/shared/{rfmath,limits,coloc}.js in a Node vm context (coloc.js binds to `window`, so the
 * context aliases window to its own global), then records inputs and outputs for:
 *   - every RF.test.add known-answer case in the tool pages that only calls the shared libraries, and
 *   - extra cases for every RF.math function, including pass/fail boundary cases against RF.limits values.
 * Cases that need the browser, the DOM, page state or page-local helpers are listed in skipped.json, not faked.
 *
 * Usage:  node scripts/capture_golden.js        (writes tests/golden/core/*.json)
 *
 * JSON encoding: typed arrays become plain arrays; non-finite numbers become the strings "Infinity", "-Infinity"
 * and "NaN"; undefined becomes null. Functions passed to RF.math.worstMargin are described by `limit`/`convert`
 * descriptors (see LIMIT_DESCRIPTORS below and the `descriptors` block in rfmath.json).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const LEGACY = path.join(ROOT, 'legacy', 'rf-lab');
const OUT = path.join(ROOT, 'tests', 'golden', 'core');
const SHARED = ['rfmath.js', 'limits.js', 'coloc.js'];

/* ---------------- load the shared libraries ---------------- */
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
const sources = {};
for (const file of SHARED) {
  const p = path.join(LEGACY, 'shared', file);
  const code = fs.readFileSync(p, 'utf8');
  sources[`legacy/rf-lab/shared/${file}`] = crypto.createHash('sha256').update(code).digest('hex');
  vm.runInContext(code, sandbox, { filename: p });
}
const RF = sandbox.RF;
const M = RF.math;
const L = RF.limits;
const C = RF.coloc;
const F = L.fcc;

/* ---------------- JSON encoding ---------------- */
const isTyped = (v) => ArrayBuffer.isView(v) && !(v instanceof DataView);
function enc(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (v === undefined) return null;
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
  if (isTyped(v)) return Array.from(v, enc);
  if (Array.isArray(v)) return v.map(enc);
  const o = {};
  for (const k of Object.keys(v)) { const e = enc(v[k]); if (e !== undefined) o[k] = e; }
  return o;
}
/** Pretty-print with 2-space indent, but keep arrays of plain numbers on one line so traces stay compact. */
const isNumLike = (x) => typeof x === 'number' || x === 'Infinity' || x === '-Infinity' || x === 'NaN';
function pretty(v, ind = '') {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  const next = ind + '  ';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    if (v.every(isNumLike)) return JSON.stringify(v);
    return '[\n' + v.map((x) => next + pretty(x, next)).join(',\n') + '\n' + ind + ']';
  }
  const keys = Object.keys(v);
  if (!keys.length) return '{}';
  return '{\n' + keys.map((k) => `${next}${JSON.stringify(k)}: ${pretty(v[k], next)}`).join(',\n') + '\n' + ind + '}';
}
const write = (name, obj) => fs.writeFileSync(path.join(OUT, name), pretty(enc(obj)) + '\n');

/* ---------------- case recording ---------------- */
const meta = (lib, extra = {}) => ({
  generator: 'scripts/capture_golden.js',
  library: lib,
  limitsVersion: L.version,
  sources,
  encoding: 'Typed arrays as lists; non-finite numbers as "Infinity" / "-Infinity" / "NaN"; undefined as null.',
  ...extra
});
const book = { rfmath: [], limits: [], coloc: [], formulas: [] };
const ids = new Set();

/**
 * Record one case. `call` runs the function; `args` is what gets written (JSON-safe). If `check` is given
 * ({expected, tol} or {ok: fn}) the legacy page's own assertion is re-applied and the run aborts on failure.
 */
function rec(lib, fn, id, args, call, opts = {}) {
  if (ids.has(id)) throw new Error(`duplicate case id ${id}`);
  ids.add(id);
  let result, error = null;
  try { result = call(); } catch (e) { error = String(e.message || e); }
  const c = { id, fn, source: opts.source || 'extra', args };
  if (opts.page) c.page = opts.page;
  if (opts.name) c.name = opts.name;
  if (opts.note) c.note = opts.note;
  if (opts.boundary) c.boundary = opts.boundary;
  if (error !== null) c.error = error; else c.result = result;
  if (opts.check) {
    const ok = opts.check.ok ? opts.check.ok(result) : Math.abs(result - opts.check.expected) <= opts.check.tol;
    c.legacyCheck = opts.check.ok ? { ok } : { expected: opts.check.expected, tol: opts.check.tol, ok };
    if (!ok) throw new Error(`legacy known-answer failed in Node: ${id} -> ${JSON.stringify(enc(result))}`);
  }
  if (opts.expectError && error === null) throw new Error(`expected an error for ${id}`);
  if (!opts.expectError && error !== null) throw new Error(`unexpected error in ${id}: ${error}`);
  book[lib].push(c);
  return result;
}
const KA = (page, name) => ({ source: 'known-answer', page, name });

/* ---------------- helpers for trace inputs ---------------- */
const lin = (start, stop, n) => Array.from({ length: n }, (_, i) => start + (stop - start) * i / (n - 1));
const f64 = (arr) => Float64Array.from(arr);
/** Rectangle: `inDbm` within |f − fc| ≤ halfMHz, `outDbm` elsewhere. */
function rect(start, stop, n, fc, halfMHz, inDbm = 0, outDbm = -60) {
  const f = lin(start, stop, n);
  return { f, a: f.map((x) => (Math.abs(x - fc) <= halfMHz ? inDbm : outDbm)) };
}
/** Simulated analyzer trace (RF.math.simulateSignal) as plain arrays, for realistic inputs. */
function sim(o) { const s = M.simulateSignal(o); return { f: Array.from(s.f), a: Array.from(s.a) }; }

/* ---------------- worstMargin descriptors (functions can't be serialized) ---------------- */
// limit:   {type:'const', value} | {type:'interp', points, from:'edgeDistance', loMHz, hiMHz} (outside [lo,hi] only)
//          | {type:'outside', loMHz, hiMHz, value} (value outside [lo,hi], null inside)
// convert: {type:'identity'} | {type:'scaleToBw', rbwHz, refHz} | {type:'offset', db}
function limitFn(d) {
  if (d.type === 'const') return () => d.value;
  if (d.type === 'outside') return (f) => (f < d.loMHz || f > d.hiMHz ? d.value : null);
  if (d.type === 'interp') return (f) => (f < d.loMHz ? M.interp(d.points, d.loMHz - f) : f > d.hiMHz ? M.interp(d.points, f - d.hiMHz) : null);
  throw new Error('unknown limit descriptor ' + d.type);
}
function convertFn(d) {
  if (!d || d.type === 'identity') return (v) => v;
  if (d.type === 'scaleToBw') return (v) => M.scaleToBw(v, d.rbwHz, d.refHz);
  if (d.type === 'offset') return (v) => v + d.db;
  throw new Error('unknown convert descriptor ' + d.type);
}
const LIMIT_DESCRIPTORS = {
  limit: {
    const: 'limit(f) = value everywhere',
    outside: 'limit(f) = value when f < loMHz or f > hiMHz, else null (not checked)',
    interp: 'limit(f) = interp(points, distance outside [loMHz, hiMHz]); null inside'
  },
  convert: {
    identity: 'level = a',
    scaleToBw: 'level = scaleToBw(a, rbwHz, refHz)',
    offset: 'level = a + db'
  }
};

/* =====================================================================================================
 * 1. Known-answer cases from the tool pages (shared-library calls only)
 * ===================================================================================================== */
rec('rfmath', 'scaleToBw', 'ka.template.scaleToBw_20dBm_100k', [20, 100e3], () => M.scaleToBw(20, 100e3),
  { ...KA('_template', 'scaleToBw: 20 dBm in 100 kHz = 4.77 dBm/3 kHz'), check: { expected: 4.77, tol: 0.01 } });
rec('rfmath', 'avgPsd', 'ka.bandwidth.avgPsd_30dBm_500k', [30, 500e3], () => M.avgPsd(30, 500e3),
  { ...KA('bandwidth', 'avgPsd: 30 dBm over 500 kHz = 7.78 dBm/3kHz'), check: { expected: 7.78, tol: 0.01 } });
{
  const N = 2001, f = new Float64Array(N), a = new Float64Array(N);
  for (let i = 0; i < N; i++) { f[i] = 914 + 2 * i / (N - 1); a[i] = Math.abs(f[i] - 915) <= 0.5 ? 0 : -60; }
  rec('rfmath', 'nDbBandwidth', 'ka.bandwidth.nDb_ideal_1MHz_rect', [Array.from(f), Array.from(a), 6], () => M.nDbBandwidth(f, a, 6),
    { ...KA('bandwidth', 'nDbBandwidth: ideal 1.000 MHz rectangle'), check: { ok: (r) => Math.abs(r.bwHz / 1e3 - 1000) <= 2 } });
}
{
  let s = ''; for (let i = 0; i < 20; i++) s += `${915e6 + i * 1e3},${-20 + i * 0}\n`;
  rec('rfmath', 'parseTrace', 'ka.bandwidth.parseTrace_auto_Hz', [s], () => M.parseTrace(s),
    { ...KA('bandwidth', 'parseTrace auto-detects Hz'), check: { ok: (r) => Math.abs(r.f[0] - 915) <= 1e-9 } });
}
rec('rfmath', 'fieldDbuvToEirp', 'ka.wifi-24.restricted_54dBuV_3m',
  [F.generalLimits15209.above960MHz.avgDbuvPerM, F.generalLimits15209.distanceM],
  () => M.fieldDbuvToEirp(F.generalLimits15209.above960MHz.avgDbuvPerM, F.generalLimits15209.distanceM),
  { ...KA('wifi-24', '54 dBµV/m at 3 m = −41.2 dBm EIRP'), check: { expected: -41.23, tol: 0.05 },
    note: 'Page constant RESTRICT_EIRP = M.fieldDbuvToEirp(G.above960MHz.avgDbuvPerM, G.distanceM).' });
rec('rfmath', 'interp', 'ka.wifi-unii.unii3_mask_50MHz', [F.unii.subbands['U-NII-3'].oob.points, 50],
  () => M.interp(F.unii.subbands['U-NII-3'].oob.points, 50),
  { ...KA('wifi-unii', 'U-NII-3 mask at 50 MHz from edge = −8.5 dBm/MHz'), check: { expected: -8.5, tol: 0.01 } });
rec('limits', 'channelCenterMHz', 'ka.wifi-unii.ch36', [36], () => F.unii.channelCenterMHz(36),
  { ...KA('wifi-unii', 'Channel 36 center = 5180 MHz'), check: { expected: 5180, tol: 0 } });
rec('rfmath', 'eirpToErp', 'ka.lte-mask.eirpToErp_24', [24], () => M.eirpToErp(24),
  { ...KA('lte-mask', 'ERP = EIRP − 2.15 (24 dBm EIRP → 21.85)'), check: { expected: 21.85, tol: 0.001 } });
rec('coloc', 'combo', 'ka.coloc-im.combo_2wifi_minus_halow', [2, [2427, 2447], -1, [914.5, 915.5]], () => C.combo(2, [2427, 2447], -1, [914.5, 915.5]),
  { ...KA('coloc-im', '2·[2427, 2447] − [914.5, 915.5] = [3938.5, 3979.5]'), check: { ok: (r) => Math.abs(r[0] - 3938.5) < 1e-9 && Math.abs(r[1] - 3979.5) < 1e-9 } });
rec('coloc', 'combo', 'ka.coloc-im.combo_fold_positive', [1, [914.5, 915.5], -1, [2427, 2447]], () => C.combo(1, [914.5, 915.5], -1, [2427, 2447]),
  { ...KA('coloc-im', 'Difference folds to positive frequency'), check: { ok: (r) => Math.abs(r[0] - 1511.5) < 1e-9 && Math.abs(r[1] - 1532.5) < 1e-9 } });
rec('coloc', 'mpeLimit', 'ka.coloc-mpe.mpeLimit_915', [915], () => C.mpeLimit(915),
  { ...KA('coloc-mpe', 'MPE limit at 915 MHz = 0.61 mW/cm²'), check: { expected: 0.61, tol: 0.001 } });
rec('coloc', 'powerDensity', 'ka.coloc-mpe.pd_26dBm_20cm', [M.dbmToMw(26), 20], () => C.powerDensity(M.dbmToMw(26), 20),
  { ...KA('coloc-mpe', 'Power density 398 mW EIRP at 20 cm = 0.0792 mW/cm²'), check: { expected: 0.0792, tol: 0.0005 }, note: 'eirpMw = dbmToMw(26)' });
rec('coloc', 'sarExemptionMw', 'ka.coloc-mpe.pth_2450_20cm', [2450, 20], () => C.sarExemptionMw(2450, 20),
  { ...KA('coloc-mpe', 'P_th = ERP₂₀cm at 20 and 40 cm (2450 MHz → 3060 mW)'), check: { expected: 3060, tol: 1e-6 } });
rec('coloc', 'sarExemptionMw', 'ka.coloc-mpe.pth_2450_40cm', [2450, 40], () => C.sarExemptionMw(2450, 40),
  { ...KA('coloc-mpe', 'P_th = ERP₂₀cm at 20 and 40 cm (2450 MHz → 3060 mW)'), check: { expected: 3060, tol: 1e-6 } });
rec('coloc', 'sarExemptionMw', 'ka.coloc-mpe.pth_2450_0p5cm', [2450, 0.5], () => C.sarExemptionMw(2450, 0.5),
  { ...KA('coloc-mpe', 'P_th at 2450 MHz, 0.5 cm ≈ 2.7 mW'), check: { expected: 2.73, tol: 0.1 } });
{
  const one = [C.newRadio('wifi24')], half = [C.newRadio('wifi24', { duty: 50 })];
  rec('coloc', 'exposure', 'ka.coloc-mpe.duty50_halves_ratio', [{ one, half }, 20, 'mobile'],
    () => ({ one: C.exposure(one, 20, 'mobile'), half: C.exposure(half, 20, 'mobile'), ratio: C.exposure(half, 20, 'mobile').sum / C.exposure(one, 20, 'mobile').sum }),
    { ...KA('coloc-mpe', 'Duty cycle 50% halves a ratio'), check: { ok: (r) => Math.abs(r.ratio - 0.5) <= 1e-9 },
      note: 'radios = [newRadio("wifi24")] vs [newRadio("wifi24", {duty: 50})]; result.ratio = half.sum / one.sum' });
}
// Inline-formula known answers (no library function involved)
rec('formulas', 'expr', 'ka.cbrs-mask.eud_20MHz_total_eirp', { expr: '23 + 10*log10(2)' }, () => 23 + 10 * Math.log10(2),
  { ...KA('cbrs-mask', 'EUD 20 MHz total EIRP limit = 26.01 dBm'), check: { expected: 26.01, tol: 0.01 } });
rec('formulas', 'expr', 'ka.lte-mask.mask_minus13_0p2W', { expr: '23 - (43 + 10*log10(0.2))' }, () => 23 - (43 + 10 * Math.log10(0.2)),
  { ...KA('lte-mask', '43 + 10·log10(P) gives −13 dBm at 0.2 W and 2 W'), check: { expected: -13, tol: 0.02 } });
rec('formulas', 'expr', 'ka.lte-mask.mask_minus13_2W', { expr: '33 - (43 + 10*log10(2))' }, () => 33 - (43 + 10 * Math.log10(2)),
  { ...KA('lte-mask', '43 + 10·log10(P) gives −13 dBm at 0.2 W and 2 W'), check: { expected: -13, tol: 0.02 } });

/* =====================================================================================================
 * 2. Extra cases for every RF.math function (boundary cases cite the RF.limits value they sit on)
 * ===================================================================================================== */
const DTS = F.ism900.dts;
const X = (fn, id, args, call, opts) => rec('rfmath', fn, `x.${fn}.${id}`, enc(args), call, opts);

// dbmToMw / mwToDbm
for (const [id, v] of [['0dBm', 0], ['30dBm', 30], ['minus30dBm', -30], ['8dBm', DTS.psdDbmPer3kHz], ['minus13dBm', -13]]) X('dbmToMw', id, [v], () => M.dbmToMw(v));
for (const [id, v] of [['1mW', 1], ['1000mW', 1000], ['0p001mW', 0.001], ['zero', 0], ['398mW', 398.1071705534972]]) X('mwToDbm', id, [v], () => M.mwToDbm(v));

// sumDbm
for (const [id, v] of [['two_equal', [0, 0]], ['three_mixed', [10, 7, -3]], ['single', [-20]], ['empty', []], ['ten_minus10', Array(10).fill(-10)]]) X('sumDbm', id, [v], () => M.sumDbm(v));

// scaleToBw
X('scaleToBw', 'rbw_eq_ref', [5, 3000], () => M.scaleToBw(5, 3000));
X('scaleToBw', '1MHz_to_3k', [0, 1e6], () => M.scaleToBw(0, 1e6));
X('scaleToBw', '100k_to_1MHz', [-20, 100e3, 1e6], () => M.scaleToBw(-20, 100e3, 1e6));
X('scaleToBw', '1k_up_to_3k', [0, 1000], () => M.scaleToBw(0, 1000));

// avgPsd (boundaries vs §15.247(e) 8 dBm/3 kHz)
{
  const bwAtLimit = 3000 * Math.pow(10, (DTS.maxConductedDbm - DTS.psdDbmPer3kHz) / 10); // 30 dBm spread to exactly 8 dBm/3 kHz
  X('avgPsd', 'boundary_at_8dBm', [DTS.maxConductedDbm, bwAtLimit], () => M.avgPsd(DTS.maxConductedDbm, bwAtLimit),
    { boundary: { limit: DTS.psdDbmPer3kHz, cite: DTS.citePsd, expect: 'pass (margin 0)' } });
  X('avgPsd', 'boundary_just_over', [DTS.maxConductedDbm, bwAtLimit * 0.99], () => M.avgPsd(DTS.maxConductedDbm, bwAtLimit * 0.99),
    { boundary: { limit: DTS.psdDbmPer3kHz, cite: DTS.citePsd, expect: 'fail (> 8 dBm/3 kHz)' } });
  X('avgPsd', 'boundary_just_under', [DTS.maxConductedDbm, bwAtLimit * 1.01], () => M.avgPsd(DTS.maxConductedDbm, bwAtLimit * 1.01),
    { boundary: { limit: DTS.psdDbmPer3kHz, cite: DTS.citePsd, expect: 'pass' } });
  X('avgPsd', 'ref_1MHz', [20, 20e6, 1e6], () => M.avgPsd(20, 20e6, 1e6));
}

// eirp / eirpToErp / erpToEirp (antenna gain reference 6 dBi)
X('eirp', 'no_loss', [24, 2], () => M.eirp(24, 2));
X('eirp', 'with_loss', [24, 2, 0.5], () => M.eirp(24, 2, 0.5));
X('eirp', 'boundary_gain_ref_36dBm', [DTS.maxConductedDbm, DTS.antennaGainRefDbi], () => M.eirp(DTS.maxConductedDbm, DTS.antennaGainRefDbi),
  { boundary: { limit: 36, cite: DTS.citeGain, expect: 'at limit: 30 dBm + 6 dBi = 36 dBm EIRP' } });
X('eirp', 'negative_gain', [10, -3, 1], () => M.eirp(10, -3, 1));
for (const [id, v] of [['0', 0], ['36', 36], ['minus13', -13], ['b13_limit_eirp', F.lte.bands.B13.limitDbm + F.lte.erpOffsetDb]]) X('eirpToErp', id, [v], () => M.eirpToErp(v));
for (const [id, v] of [['0', 0], ['b5_limit', F.lte.bands.B5.limitDbm], ['b12_limit', F.lte.bands.B12.limitDbm], ['minus2p15', -2.15]]) X('erpToEirp', id, [v], () => M.erpToEirp(v));

// eirpToFieldDbuv / fieldDbuvToEirp (§15.209 at 3 m)
{
  const G = F.generalLimits15209;
  X('eirpToFieldDbuv', 'boundary_avg_limit', [M.fieldDbuvToEirp(G.above960MHz.avgDbuvPerM, G.distanceM), G.distanceM],
    () => M.eirpToFieldDbuv(M.fieldDbuvToEirp(G.above960MHz.avgDbuvPerM, G.distanceM), G.distanceM),
    { boundary: { limit: G.above960MHz.avgDbuvPerM, cite: G.cite, expect: 'round-trips to the 54 dBµV/m limit' } });
  X('eirpToFieldDbuv', '0dBm_3m', [0, 3], () => M.eirpToFieldDbuv(0, 3));
  X('eirpToFieldDbuv', '0dBm_10m', [0, 10], () => M.eirpToFieldDbuv(0, 10));
  X('eirpToFieldDbuv', '0dBm_1m', [0, 1], () => M.eirpToFieldDbuv(0, 1));
  X('fieldDbuvToEirp', 'peak_74_3m', [G.above960MHz.peakDbuvPerM, G.distanceM], () => M.fieldDbuvToEirp(G.above960MHz.peakDbuvPerM, G.distanceM),
    { boundary: { limit: G.above960MHz.peakDbuvPerM, cite: G.cite, expect: 'peak limit as EIRP (≈ −21.2 dBm)' } });
  X('fieldDbuvToEirp', '54_10m', [54, 10], () => M.fieldDbuvToEirp(54, 10));
  X('fieldDbuvToEirp', '104p77_1m', [104.77, 1], () => M.fieldDbuvToEirp(104.77, 1));
}

// fspl
for (const [id, fm, d] of [['915MHz_1km', 915, 1], ['2437MHz_0p1km', 2437, 0.1], ['5500MHz_10km', 5500, 10], ['1MHz_1km', 1, 1]]) X('fspl', id, [fm, d], () => M.fspl(fm, d));

// peak
for (const [id, v] of [['simple', [-10, -3, -7]], ['tie_first_wins', [1, 5, 5, 2]], ['all_equal', [-20, -20, -20]], ['last', [-50, -40, -30]], ['empty', []]]) X('peak', id, [v], () => M.peak(v));

// nDbBandwidth (boundaries vs §15.247(a)(2) 500 kHz minimum)
{
  const minHz = DTS.min6dBBwKHz * 1e3;
  const r500 = rect(914, 916, 2001, 915, 0.25), r499 = rect(914, 916, 2001, 915, 0.2495);
  X('nDbBandwidth', 'boundary_500kHz_rect', [r500.f, r500.a, 6], () => M.nDbBandwidth(f64(r500.f), f64(r500.a), 6),
    { boundary: { limit: minHz, cite: DTS.cite6dB, expect: 'pass (≥ 500 kHz, interpolated edges)' } });
  X('nDbBandwidth', 'boundary_499kHz_rect', [r499.f, r499.a, 6], () => M.nDbBandwidth(f64(r499.f), f64(r499.a), 6),
    { boundary: { limit: minHz, cite: DTS.cite6dB, expect: 'fail (< 500 kHz)' } });
  const clip = rect(914.8, 915.2, 401, 915, 0.5);
  X('nDbBandwidth', 'clipped_span', [clip.f, clip.a, 6], () => M.nDbBandwidth(f64(clip.f), f64(clip.a), 6), { note: 'signal wider than span: clipped=true' });
  const tri = { f: lin(914, 916, 201) }; tri.a = tri.f.map((x) => -20 * Math.abs(x - 915));
  X('nDbBandwidth', 'triangle_20dB', [tri.f, tri.a, 20], () => M.nDbBandwidth(f64(tri.f), f64(tri.a), 20));
  const s = sim({ fcMHz: 915, occMHz: 1, spanMHz: 3, powerDbm: 30, order: 6, rippleDb: 1, rbwHz: 100e3, noiseDbm: -70, seed: 7, points: 401 });
  X('nDbBandwidth', 'sim_halow_1MHz', [s.f, s.a, 6], () => M.nDbBandwidth(f64(s.f), f64(s.a), 6));
}

// obw
{
  const r = rect(914, 916, 2001, 915, 0.5);
  X('obw', 'rect_1MHz_99', [r.f, r.a], () => M.obw(f64(r.f), f64(r.a)));
  X('obw', 'rect_1MHz_50', [r.f, r.a, 0.5], () => M.obw(f64(r.f), f64(r.a), 0.5));
  const s = sim({ fcMHz: 2437, occMHz: 18, spanMHz: 40, powerDbm: 20, order: 8, rippleDb: 1.5, rbwHz: 300e3, noiseDbm: -60, seed: 3, points: 401 });
  X('obw', 'sim_wifi_20MHz', [s.f, s.a], () => M.obw(f64(s.f), f64(s.a)));
  const flat = { f: lin(0, 1, 11), a: Array(11).fill(-10) };
  X('obw', 'flat_full_span', [flat.f, flat.a, 0.99], () => M.obw(f64(flat.f), f64(flat.a), 0.99));
}

// channelPower (boundary vs §15.247(b)(3) 30 dBm)
{
  // 0 dBm/100 kHz flat over 1 MHz -> 10 dBm total; +20 dB -> 30 dBm (limit)
  const r = rect(914, 916, 2001, 915, 0.5, 0, -100);
  X('channelPower', 'rect_10dBm', [r.f, r.a, 100e3], () => M.channelPower(f64(r.f), f64(r.a), 100e3));
  const r30 = rect(914, 916, 2001, 915, 0.5, 20, -100);
  X('channelPower', 'boundary_30dBm', [r30.f, r30.a, 100e3], () => M.channelPower(f64(r30.f), f64(r30.a), 100e3),
    { boundary: { limit: DTS.maxConductedDbm, cite: DTS.citePower, expect: '≈ 30 dBm (at limit)' } });
  X('channelPower', 'window_half', [r.f, r.a, 100e3, 914.5, 915], () => M.channelPower(f64(r.f), f64(r.a), 100e3, 914.5, 915));
  X('channelPower', 'window_empty', [r.f, r.a, 100e3, 920, 921], () => M.channelPower(f64(r.f), f64(r.a), 100e3, 920, 921), { note: 'no points in window: -Infinity' });
  const s = sim({ fcMHz: 915, occMHz: 1, spanMHz: 3, powerDbm: 30, order: 6, rippleDb: 1, rbwHz: 100e3, noiseDbm: -70, seed: 7, points: 401 });
  X('channelPower', 'sim_halow_30dBm', [s.f, s.a, 100e3], () => M.channelPower(f64(s.f), f64(s.a), 100e3));
}

// bandEdge (boundary vs §15.247(d) 20 dBc)
{
  const dbc = DTS.bandEdgeDbc.peakMethod;
  const mk = (outLevel) => { const f = lin(900, 930, 301); return { f, a: f.map((x) => (x >= 914 && x <= 916 ? 0 : x < 902 || x > 928 ? outLevel : -50)) }; };
  const at = mk(-dbc), over = mk(-dbc + 0.01);
  X('bandEdge', 'boundary_exact_20dBc', [at.f, at.a, 902, 928], () => M.bandEdge(f64(at.f), f64(at.a), 902, 928),
    { boundary: { limit: dbc, cite: DTS.citeBandEdge, expect: 'pass (exactly 20 dBc)' } });
  X('bandEdge', 'boundary_19p99dBc', [over.f, over.a, 902, 928], () => M.bandEdge(f64(over.f), f64(over.a), 902, 928),
    { boundary: { limit: dbc, cite: DTS.citeBandEdge, expect: 'fail (< 20 dBc)' } });
  const inband = { f: lin(905, 925, 101) }; inband.a = inband.f.map(() => -30);
  X('bandEdge', 'no_out_of_band_points', [inband.f, inband.a, 902, 928], () => M.bandEdge(f64(inband.f), f64(inband.a), 902, 928), { note: 'lo and hi are null' });
  const lowOnly = { f: lin(895, 920, 101) }; lowOnly.a = lowOnly.f.map((x) => (x < 902 ? -40 : -5));
  X('bandEdge', 'low_side_only', [lowOnly.f, lowOnly.a, 902, 928], () => M.bandEdge(f64(lowOnly.f), f64(lowOnly.a), 902, 928));
}

// maxInRange
{
  const f = [1, 2, 3, 4, 5], a = [-5, -1, -3, 0, -9];
  X('maxInRange', 'inclusive_edges', [f, a, 2, 4], () => M.maxInRange(f64(f), f64(a), 2, 4));
  X('maxInRange', 'single_point', [f, a, 3, 3], () => M.maxInRange(f64(f), f64(a), 3, 3));
  X('maxInRange', 'no_points', [f, a, 5.5, 9], () => M.maxInRange(f64(f), f64(a), 5.5, 9));
  X('maxInRange', 'whole', [f, a, -Infinity, Infinity], () => M.maxInRange(f64(f), f64(a), -Infinity, Infinity));
}

// interp (U-NII-3 out-of-band mask points)
{
  const P = F.unii.subbands['U-NII-3'].oob.points, cite = F.unii.subbands['U-NII-3'].oob.cite;
  for (const [id, x] of [['clamp_below', -1], ['at_0', 0], ['at_5', 5], ['between_5_25', 15], ['at_75', 75], ['beyond', 500]]) {
    X('interp', `unii3_${id}`, [P, x], () => M.interp(P, x), { note: `mask ${cite}` });
  }
}

// worstMargin
{
  const f = lin(900, 930, 31), a = f.map((x) => (x >= 914 && x <= 916 ? 0 : -40));
  const run = (lim, cv) => () => M.worstMargin(f64(f), f64(a), limitFn(lim), convertFn(cv));
  const W = (id, lim, cv, opts) => X('worstMargin', id, [f, a, { limit: lim, convert: cv || { type: 'identity' } }], run(lim, cv), opts);
  W('const_pass', { type: 'const', value: 10 });
  W('boundary_margin_zero', { type: 'const', value: 0 }, null, { boundary: { limit: 0, expect: 'margin exactly 0 (pass)' } });
  W('boundary_margin_negative', { type: 'const', value: -0.01 }, null, { boundary: { limit: -0.01, expect: 'margin −0.01 (fail)' } });
  W('outside_only', { type: 'outside', loMHz: 902, hiMHz: 928, value: -30 });
  W('none_checked', { type: 'outside', loMHz: 800, hiMHz: 1000, value: -30 }, null, { note: 'no limit applies anywhere: null' });
  W('scaled_rbw', { type: 'const', value: DTS.psdDbmPer3kHz }, { type: 'scaleToBw', rbwHz: 100e3, refHz: 3000 },
    { boundary: { limit: DTS.psdDbmPer3kHz, cite: DTS.citePsd, expect: '0 dBm/100 kHz -> -15.23 dBm/3 kHz: pass' } });
}

// parseTrace
{
  const rows = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join('\n');
  const hz10 = rows(10, (i) => `${915e6 + i * 1e5},${-30 - i}`);
  X('parseTrace', 'boundary_10_rows_ok', [hz10], () => M.parseTrace(hz10), { boundary: { limit: 10, expect: 'parses (minimum rows)' } });
  const hz9 = rows(9, (i) => `${915e6 + i * 1e5},${-30 - i}`);
  X('parseTrace', 'boundary_9_rows_error', [hz9], () => M.parseTrace(hz9), { boundary: { limit: 10, expect: 'throws' }, expectError: true });
  const khz = rows(12, (i) => `${2437000 + i * 100}\t${-40 + i}`);
  X('parseTrace', 'auto_kHz_tab', [khz], () => M.parseTrace(khz));
  const mhzHdr = 'Frequency [MHz];Level [dBm]\n' + rows(12, (i) => `${(5180 - i).toFixed(1)};${-50 + i * 0.5};extra`);
  X('parseTrace', 'auto_MHz_header_unsorted_semicolon', [mhzHdr], () => M.parseTrace(mhzHdr), { note: 'header skipped, rows sorted ascending, extra column ignored' });
  const ghz = rows(12, (i) => `${(2.4 + i * 0.001).toFixed(3)} ${-60}`);
  X('parseTrace', 'auto_GHz_space', [ghz], () => M.parseTrace(ghz));
  const edge = rows(12, (i) => `${1e7 - (11 - i) * 1000},-20`);
  X('parseTrace', 'boundary_auto_1e7_is_kHz', [edge], () => M.parseTrace(edge), { boundary: { limit: 1e7, expect: 'max exactly 1e7 is not > 1e7, so kHz scaling' } });
  X('parseTrace', 'explicit_units_offset', [khz, 1e3, 10.5], () => M.parseTrace(khz, 1e3, 10.5));
}

// rng
for (const seed of [1, 0, 42, 2 ** 32 + 5, -1]) {
  X('rng', `seed_${String(seed).replace('-', 'minus')}`, [seed, 8], () => { const r = M.rng(seed); return Array.from({ length: 8 }, () => r()); },
    { note: 'result = first 8 draws of rng(seed)' });
}

// simulateSignal
{
  const cases = [
    ['halow_1MHz', { fcMHz: 915, occMHz: 1, spanMHz: 3, powerDbm: 30, order: 6, rippleDb: 1, rbwHz: 100e3, noiseDbm: -70, seed: 7, points: 201 }],
    ['wifi_shoulder', { fcMHz: 2437, occMHz: 18, spanMHz: 60, powerDbm: 20, order: 8, rippleDb: 1.5, rbwHz: 1e6, noiseDbm: -60, seed: 3, points: 201, shoulderDbc: -35, shoulderWidth: 3, shoulderOrder: 2 }],
    ['start_stop_no_ripple', { fcMHz: 3610, occMHz: 18, startMHz: 3580, stopMHz: 3640, powerDbm: 23, order: 10, rippleDb: 0, rbwHz: 1e6, noiseDbm: -65, seed: 11, points: 151 }],
    ['default_seed_noise', { fcMHz: 782, occMHz: 9, spanMHz: 30, powerDbm: 23, order: 8, rippleDb: 0.5, rbwHz: 100e3, points: 101 }]
  ];
  for (const [id, o] of cases) X('simulateSignal', id, [o], () => M.simulateSignal(o));
}

// fmtHz / fmtDb
for (const [id, v] of [['sub_kHz', 999.4], ['1kHz', 1000], ['99p95kHz', 99950], ['100kHz', 1e5], ['1MHz', 1e6], ['negative', -1.5e6], ['500kHz', 500e3]]) X('fmtHz', id, [v], () => M.fmtHz(v));
X('fmtDb', 'default', [-3.14159], () => M.fmtDb(-3.14159));
X('fmtDb', 'digits_unit', [7.777, 1, 'dBm'], () => M.fmtDb(7.777, 1, 'dBm'));
X('fmtDb', 'nan', [NaN], () => M.fmtDb(NaN));
X('fmtDb', 'infinity', [Infinity, 2, 'dBc'], () => M.fmtDb(Infinity, 2, 'dBc'));
X('fmtDb', 'round_half', [1.005, 2], () => M.fmtDb(1.005, 2));

/* =====================================================================================================
 * 3. Cases that need the browser, DOM, page state or page-local helpers: listed, not captured
 * ===================================================================================================== */
const SKIP_REASONS = {
  dom: 'drives page controls ($(), set(), setMode(), update()) and reads page result state (res)',
  state: 'depends on page state (default radios / plan) built in the page script',
  local: 'calls a page-local helper not in the shared libraries'
};
const skipped = [
  ['bandwidth', 'Simulated HaLow 1 MHz passes with 850–920 kHz', 'dom'],
  ['bandwidth', 'Simulated narrowband FSK fails 500 kHz', 'dom'],
  ['bandwidth', 'Channel power recovers the set 30 dBm', 'dom'],
  ['wifi-24', 'Channel 6 center = 2437 MHz', 'local', 'centerOf()'],
  ['wifi-24', '20 MHz OFDM 6 dB BW 15–19 MHz, passes 500 kHz', 'dom'],
  ['wifi-24', 'Conducted power recovers 20 dBm', 'dom'],
  ['wifi-24', 'Restricted margin moves 1 dB per dB of power (ch 11)', 'dom'],
  ['wifi-24', 'Channel 6 at 20 dBm passes both restricted bands', 'dom'],
  ['wifi-24', 'Channel 13 at 20 dBm fails 2483.5 MHz', 'dom'],
  ['wifi-unii', 'U-NII-2A limit, B = 10 MHz → 21 dBm', 'local', 'powerLimit()'],
  ['wifi-unii', 'U-NII-2A limit, B = 22 MHz → 24 dBm (250 mW cap)', 'local', 'powerLimit()'],
  ['wifi-unii', 'U-NII-2C ch 100, 20 MHz, 18 dBm passes power, PSD and OOB', 'dom'],
  ['wifi-unii', 'Conducted power recovers 18 dBm', 'dom'],
  ['wifi-unii', '20 MHz 26 dB EBW between 18 and 23 MHz', 'dom'],
  ['wifi-unii', 'TPC flagged at 25 dBm + 3 dBi in U-NII-2C', 'dom'],
  ['lte-mask', 'B66 20 MHz mid, 23 dBm: conducted power 23 dBm', 'dom'],
  ['lte-mask', 'B66 20 MHz OBW ≈ 18 MHz', 'dom'],
  ['lte-mask', 'B66 default passes mask and EIRP', 'dom'],
  ['lte-mask', 'B5 uses ERP', 'dom'],
  ['lte-mask', 'B13 −20 dBc at 23 dBm fails the −35 dBm public-safety limit', 'dom'],
  ['lte-mask', 'Below 1 GHz bands use a 100 kHz reference bandwidth', 'dom'],
  ['lte-mask', 'Mask margin moves 1 dB per dB of power', 'dom'],
  ['cbrs-mask', 'CBSD mask: −13 within 10 MHz, −25 beyond, −25 below 3540, −40 below 3530', 'local', 'maskLimit()'],
  ['cbrs-mask', 'EUD 5 MHz channel: −13 only within 5 MHz (0 to B), −25 beyond', 'local', 'maskLimit()'],
  ['cbrs-mask', 'EUD 20 MHz, 20 dBm: conducted power recovers 20 dBm', 'dom'],
  ['cbrs-mask', 'EIRP per 10 MHz ≈ total − 3 dB for a 20 MHz channel', 'dom'],
  ['cbrs-mask', 'EUD 20 MHz at 20 dBm passes EIRP and mask', 'dom'],
  ['cbrs-mask', 'Cat A lowest channel at 30 dBm, −35 dBc fails the mask', 'dom'],
  ['coloc-im', 'Default: Wi-Fi − HaLow hits restricted 1435–1626.5', 'state'],
  ['coloc-im', 'B13 2nd harmonic hits GNSS L1 when a GNSS receiver is present', 'state'],
  ['coloc-im', 'HaLow 2nd harmonic 1829–1831 MHz is not in a restricted band', 'state'],
  ['coloc-im', '10th harmonic of HaLow 915 MHz (9145–9155) hits restricted 9000–9200', 'state'],
  ['coloc-im', 'Default harmonic setting is 10', 'dom'],
  ['coloc-im', 'Wi-Fi 5 GHz harmonics stop at 40 GHz', 'dom'],
  ['coloc-mpe', 'Mobile sum scales as 1/r² (20 cm → 40 cm = ÷4)', 'state'],
  ['coloc-mpe', 'Default radios: mobile at 20 cm compliant, portable at 5 cm not exempt', 'state'],
  ['coloc-plan', 'Default plan: all modules ride on grants (mobile, 20 cm)', 'state'],
  ['coloc-plan', 'Default plan lists a simultaneous-Tx radiated row for HaLow + Wi-Fi 2.4', 'state'],
  ['coloc-plan', 'Higher antenna gain → Class II', 'state'],
  ['coloc-plan', 'Portable use with mobile grants → SAR testing and Class II', 'dom'],
  ['coloc-plan', 'Own design → full certification row', 'state'],
  ['coloc-plan', 'Not mains powered → no AC conducted rows', 'dom']
].map(([page, name, why, helper]) => ({ page, name, reason: SKIP_REASONS[why] + (helper ? `: ${helper}` : '') }));

/* ---------------- write ---------------- */
fs.mkdirSync(OUT, { recursive: true });
const fnsOf = (o) => Object.keys(o).filter((k) => typeof o[k] === 'function');
write('rfmath.json', { meta: meta('legacy/rf-lab/shared/rfmath.js (RF.math)', { descriptors: LIMIT_DESCRIPTORS }), functions: fnsOf(M), cases: book.rfmath });
write('coloc.json', { meta: meta('legacy/rf-lab/shared/coloc.js (RF.coloc)'), functions: fnsOf(C), cases: book.coloc });
write('limits.json', { meta: meta('legacy/rf-lab/shared/limits.js (RF.limits)', { note: 'snapshot is RF.limits with functions omitted' }), functions: ['fcc.unii.channelCenterMHz', 'fcc.rfExposure.mpe'], snapshot: L, cases: book.limits });
write('formulas.json', { meta: meta('inline formulas in tool-page known-answer tests'), cases: book.formulas });
write('skipped.json', { meta: meta('tool-page RF.test.add cases not captured'), cases: skipped });

/* ---------------- summary ---------------- */
const count = (cases) => cases.reduce((m, c) => ((m[c.fn] = (m[c.fn] || 0) + 1), m), {});
const ka = Object.values(book).flat().filter((c) => c.source === 'known-answer').length;
console.log(`limits ${L.version}`);
const kaTests = new Set(Object.values(book).flat().filter((c) => c.source === 'known-answer').map((c) => `${c.page}|${c.name}`)).size;
console.log(`RF.test.add cases: ${kaTests + skipped.length} total, ${kaTests} captured (as ${ka} golden cases), ${skipped.length} skipped`);
for (const [lib, fns] of [['RF.math', fnsOf(M)], ['RF.limits', ['fcc.unii.channelCenterMHz', 'fcc.rfExposure.mpe']], ['RF.coloc', fnsOf(C)]]) {
  const key = lib === 'RF.math' ? 'rfmath' : lib === 'RF.limits' ? 'limits' : 'coloc';
  const n = count(book[key]);
  console.log(`\n${lib}`);
  for (const fn of fns) { const short = fn.split('.').pop(); console.log(`  ${short.padEnd(18)} ${n[short] || 0}`); }
}
console.log(`\nformulas            ${book.formulas.length}`);
console.log(`\nwrote ${fs.readdirSync(OUT).map((f) => 'tests/golden/core/' + f).join(', ')}`);
