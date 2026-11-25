/* RF Lab math library. Pure functions, no DOM. Works in the browser (window.RF.math) and Node (require). */
(function (root) {
  'use strict';
  const LOG10 = Math.log10;

  const dbmToMw = (dbm) => Math.pow(10, dbm / 10);
  const mwToDbm = (mw) => 10 * LOG10(mw);
  /** Power-sum a list of dBm values (incoherent). */
  const sumDbm = (list) => mwToDbm(list.reduce((s, d) => s + dbmToMw(d), 0));
  /** Scale a level measured in rbwHz to a reference bandwidth (default 3 kHz). */
  const scaleToBw = (dbm, rbwHz, refHz = 3000) => dbm - 10 * LOG10(rbwHz / refHz);
  /** Average PSD of a flat signal of total power spread over bwHz, per refHz. */
  const avgPsd = (totalDbm, bwHz, refHz = 3000) => totalDbm - 10 * LOG10(bwHz / refHz);
  /** EIRP from conducted power, antenna gain and losses. */
  const eirp = (condDbm, gainDbi, lossDb = 0) => condDbm + gainDbi - lossDb;
  /** Field strength (dBuV/m) from EIRP (dBm) at distance d (m), far-field free space. */
  const eirpToFieldDbuv = (eirpDbm, dM) => eirpDbm + 104.77 - 20 * LOG10(dM);
  const fieldDbuvToEirp = (eDbuv, dM) => eDbuv - 104.77 + 20 * LOG10(dM);
  /** Free-space path loss in dB (fMHz, dKm). */
  const fspl = (fMHz, dKm) => 20 * LOG10(dKm) + 20 * LOG10(fMHz) + 32.44;

  function peak(a) { let pk = -Infinity, pi = 0; for (let i = 0; i < a.length; i++) if (a[i] > pk) { pk = a[i]; pi = i; } return { pk, pi }; }

  /**
   * n-dB bandwidth: outermost crossings of (peak - n) on each side of the peak, linearly interpolated.
   * f in MHz, a in dBm. Returns {fL, fR, bwHz, pk, pi, th, clipped}.
   */
  function nDbBandwidth(f, a, n = 6) {
    const N = f.length, { pk, pi } = peak(a), th = pk - n;
    let i1 = 0; while (i1 < pi && a[i1] < th) i1++;
    let i2 = N - 1; while (i2 > pi && a[i2] < th) i2--;
    const ip = (ia, ib) => { const d = a[ib] - a[ia]; return Math.abs(d) < 1e-12 ? f[ib] : f[ia] + (th - a[ia]) / d * (f[ib] - f[ia]); };
    const fL = i1 > 0 ? ip(i1 - 1, i1) : f[0];
    const fR = i2 < N - 1 ? ip(i2 + 1, i2) : f[N - 1];
    const clipped = (i1 === 0 && a[0] >= th) || (i2 === N - 1 && a[N - 1] >= th);
    return { fL, fR, bwHz: (fR - fL) * 1e6, pk, pi, th, n, clipped };
  }

  /** Occupied bandwidth containing `frac` of integrated trace power. */
  function obw(f, a, frac = 0.99) {
    const N = f.length, cum = [0];
    for (let i = 1; i < N; i++) cum.push(cum[i - 1] + (dbmToMw(a[i]) + dbmToMw(a[i - 1])) / 2 * (f[i] - f[i - 1]));
    const T = cum[N - 1], cut = (1 - frac) / 2;
    const at = (q) => { for (let i = 1; i < N; i++) if (cum[i] >= q) { const r = (q - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return f[i - 1] + r * (f[i] - f[i - 1]); } return f[N - 1]; };
    const oL = at(cut * T), oR = at((1 - cut) * T);
    return { oL, oR, bwHz: (oR - oL) * 1e6, totalMwMHz: T };
  }

  /** Channel power (dBm) from a trace in dBm/RBW: integrate and divide by RBW (ENBW ~ RBW). */
  function channelPower(f, a, rbwHz, fLo = -Infinity, fHi = Infinity) {
    let s = 0;
    for (let i = 1; i < f.length; i++) {
      const fm = (f[i] + f[i - 1]) / 2; if (fm < fLo || fm > fHi) continue;
      s += (dbmToMw(a[i]) + dbmToMw(a[i - 1])) / 2 * (f[i] - f[i - 1]) * 1e6;
    }
    return mwToDbm(s / rbwHz);
  }

  /** Band-edge: max level outside [lo, hi] MHz relative to peak (dBc). Null where trace doesn't extend. */
  function bandEdge(f, a, lo, hi) {
    const { pk } = peak(a); let mb = -Infinity, ma = -Infinity;
    for (let i = 0; i < f.length; i++) { if (f[i] < lo) mb = Math.max(mb, a[i]); else if (f[i] > hi) ma = Math.max(ma, a[i]); }
    return { lo: mb === -Infinity ? null : pk - mb, hi: ma === -Infinity ? null : pk - ma, pk };
  }

  /**
   * Parse analyzer export text. First two numbers per line = freq, amplitude.
   * units: 'auto' | multiplier to Hz (1, 1e3, 1e6, 1e9). Returns {f (MHz), a (dBm)}.
   */
  function parseTrace(text, units = 'auto', offsetDb = 0) {
    const rows = [];
    for (const line of String(text).split(/\r?\n/)) {
      const nums = line.split(/[,;\t ]+/).filter((s) => s !== '').map(Number).filter(Number.isFinite);
      if (nums.length >= 2) rows.push([nums[0], nums[1]]);
    }
    if (rows.length < 10) throw new Error('Need at least 10 data rows with two numeric columns (frequency, dBm).');
    rows.sort((p, q) => p[0] - q[0]);
    let toMHz;
    if (units === 'auto') { const mx = rows[rows.length - 1][0]; toMHz = mx > 1e7 ? 1e-6 : mx > 1e4 ? 1e-3 : mx > 100 ? 1 : 1e3; }
    else toMHz = Number(units) / 1e6;
    const f = new Float64Array(rows.length), a = new Float64Array(rows.length);
    rows.forEach((r, i) => { f[i] = r[0] * toMHz; a[i] = r[1] + offsetDb; });
    return { f, a };
  }

  /** Seeded PRNG (xorshift32) for repeatable simulations. */
  function rng(seed) { let x = (seed >>> 0) || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

  /**
   * Simulate an analyzer trace of a band-limited signal.
   * opts: {fcMHz, occMHz, spanMHz | startMHz+stopMHz, powerDbm, order, rippleDb, rbwHz, noiseDbm, seed, points,
   *        shoulderDbc, shoulderWidth, shoulderOrder}  (shoulder = PA spectral regrowth relative to in-band density)
   */
  function simulateSignal(o) {
    const N = o.points || 2401, r = rng(o.seed || 1);
    const fStart = o.startMHz ?? o.fcMHz - o.spanMHz / 2, span = (o.stopMHz ?? o.fcMHz + o.spanMHz / 2) - fStart, df = span / (N - 1) * 1e6;
    const ph = [0, 1, 2, 3, 4].map(() => r() * 6.283), fr = [3.1, 5.7, 9.3, 13.9, 21.1];
    const f = new Float64Array(N), dens = new Float64Array(N); let tot = 0;
    for (let i = 0; i < N; i++) {
      const fm = fStart + span * i / (N - 1); f[i] = fm;
      const x = (fm - o.fcMHz) / (o.occMHz / 2);
      let lin = 1 / (1 + Math.pow(Math.abs(x), 2 * o.order));
      if (o.rippleDb > 0) { let s = 0; for (let k = 0; k < 5; k++) s += Math.sin(fr[k] * x + ph[k]); lin *= Math.pow(10, (o.rippleDb / 2) * (s / 3.2) / 10); }
      // optional spectral-regrowth shoulder (PA nonlinearity): a wider, lower skirt relative to the in-band level
      if (o.shoulderDbc !== undefined && o.shoulderDbc !== null) { const sw = o.shoulderWidth || 3; lin += Math.pow(10, o.shoulderDbc / 10) / (1 + Math.pow(Math.abs(x) / sw, 2 * (o.shoulderOrder || 2))); }
      dens[i] = lin; tot += lin * df;
    }
    const Pmw = dbmToMw(o.powerDbm); for (let i = 0; i < N; i++) dens[i] = dens[i] / tot * Pmw;
    const half = Math.max(0, Math.round(o.rbwHz / df / 2)), pre = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) pre[i + 1] = pre[i] + dens[i] * df;
    const a = new Float64Array(N), nlin = dbmToMw(o.noiseDbm ?? -70);
    for (let i = 0; i < N; i++) {
      const lo = Math.max(0, i - half), hi = Math.min(N, i + half + 1);
      const pw = (pre[hi] - pre[lo]) * (o.rbwHz / ((hi - lo) * df || o.rbwHz));
      const j = (r() - 0.5);
      a[i] = mwToDbm(pw + nlin * Math.pow(10, (r() - 0.5) * 0.6)) + j * (pw < nlin * 20 ? 1 : 0.25);
    }
    return { f, a, rbw: o.rbwHz };
  }

  /** ERP/EIRP conversion: ERP is referenced to a half-wave dipole (2.15 dBi). */
  const eirpToErp = (eirpDbm) => eirpDbm - 2.15;
  const erpToEirp = (erpDbm) => erpDbm + 2.15;

  /** Max trace level (and its frequency) within [lo, hi] MHz. Returns null if the trace has no points there. */
  function maxInRange(f, a, lo, hi) {
    let m = -Infinity, at = null;
    for (let i = 0; i < f.length; i++) if (f[i] >= lo && f[i] <= hi && a[i] > m) { m = a[i]; at = f[i]; }
    return at === null ? null : { max: m, at };
  }

  /** Piecewise-linear interpolation over [[x, y], ...] sorted by x (clamped at the ends). */
  function interp(points, x) {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) if (x <= points[i][0]) { const [x0, y0] = points[i - 1], [x1, y1] = points[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
    return points[points.length - 1][1];
  }

  /**
   * Worst margin of a trace against a limit line. limitFn(fMHz) returns the limit in the same units as the
   * converted trace level, or null where no limit applies. convert(level, fMHz) maps trace dBm/RBW to the limit's units.
   * Returns {margin, at, level, limit} (margin = limit − level; negative = fail) or null if nothing was checked.
   */
  function worstMargin(f, a, limitFn, convert = (v) => v) {
    let w = null;
    for (let i = 0; i < f.length; i++) {
      const lim = limitFn(f[i]); if (lim === null || lim === undefined) continue;
      const lv = convert(a[i], f[i]), m = lim - lv;
      if (!w || m < w.margin) w = { margin: m, at: f[i], level: lv, limit: lim };
    }
    return w;
  }

  function fmtHz(h) { h = Math.abs(h); return h >= 1e6 ? (h / 1e6).toFixed(3) + ' MHz' : h >= 1e3 ? (h / 1e3).toFixed(h >= 1e5 ? 0 : 1) + ' kHz' : h.toFixed(0) + ' Hz'; }
  const fmtDb = (v, d = 2, unit = 'dB') => (Number.isFinite(v) ? v.toFixed(d) : '–') + ' ' + unit;

  const api = { dbmToMw, mwToDbm, sumDbm, scaleToBw, avgPsd, eirp, eirpToErp, erpToEirp, maxInRange, interp, worstMargin, eirpToFieldDbuv, fieldDbuvToEirp, fspl, peak, nDbBandwidth, obw, channelPower, bandEdge, parseTrace, rng, simulateSignal, fmtHz, fmtDb };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RF = root.RF || {}; root.RF.math = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
