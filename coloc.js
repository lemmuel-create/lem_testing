/*
 * RF Lab co-location library (RF.coloc): radio presets, harmonic/intermod products, and RF exposure math shared by
 * the intermod planner, the simultaneous-transmission RF exposure tool and the test plan builder.
 * Load after rfmath.js and limits.js. All regulatory numbers come from RF.limits.
 */
(function (root) {
  'use strict';
  const RF = root.RF, F = RF.limits.fcc, M = RF.math;

  /* ---------------- radio presets ---------------- */
  // pwr/gain/duty are typical starting values for a module, not limits.
  const TECH = {
    halow: { label: 'Wi-Fi HaLow', part: '15', rule: '§15.247', tx: [F.ism900.band.loMHz, F.ism900.band.hiMHz], rx: [[F.ism900.band.loMHz, F.ism900.band.hiMHz, 'HaLow']], bws: [1, 2, 4, 8], fc: 915, bw: 1, pwr: 24, gain: 2, duty: 100 },
    wifi24: { label: 'Wi-Fi 2.4 GHz', part: '15', rule: '§15.247', tx: [F.wifi24.band.loMHz, F.wifi24.band.hiMHz], rx: [[F.wifi24.band.loMHz, F.wifi24.band.hiMHz, 'Wi-Fi 2.4 GHz']], bws: [20, 40], fc: 2437, bw: 20, pwr: 20, gain: 3, duty: 100 },
    wifi5: { label: 'Wi-Fi 5 GHz', part: '15', rule: '§15.407', tx: [5150, 5850], rx: [[5150, 5850, 'Wi-Fi 5 GHz']], bws: [20, 40, 80], fc: 5500, bw: 20, pwr: 18, gain: 4, duty: 100 },
    cbrs: { label: 'CBRS (B48)', part: '96', rule: 'Part 96', tx: [F.cbrs.band.loMHz, F.cbrs.band.hiMHz], rx: [[F.cbrs.band.loMHz, F.cbrs.band.hiMHz, 'CBRS']], bws: [10, 20], fc: 3625, bw: 20, pwr: 23, gain: 3, duty: 100, licensed: true },
    gnss: { label: 'GNSS receiver', part: null, tx: null, rx: Object.entries(F.gnss.bands).map(([k, [lo, hi]]) => [lo, hi, 'GNSS ' + k]), bws: [], fc: 1575.42, bw: 0 }
  };
  Object.entries(F.lte.bands).forEach(([k, b]) => {
    TECH['lte' + k] = { label: `LTE ${k} (${b.name})`, part: b.part.split(' ')[0], rule: `Part ${b.part}`, tx: [b.ulLoMHz, b.ulHiMHz], rx: [[b.dlLoMHz, b.dlHiMHz, `LTE ${k} downlink`]],
      bws: b.bwsMHz.filter((w) => w >= 5), fc: (b.ulLoMHz + b.ulHiMHz) / 2, bw: Math.min(10, Math.max(...b.bwsMHz)), pwr: 23, gain: 2, duty: 100, licensed: true, lteBand: k };
  });
  const isLicensed = (r) => !!(TECH[r.tech] && TECH[r.tech].licensed);

  /** A new radio row with the preset's defaults. */
  const newRadio = (tech, over = {}) => { const T = TECH[tech]; return Object.assign({ tech, on: !!T.tx, fc: T.fc, bw: T.bw, whole: false, pwr: T.pwr, gain: T.gain, duty: T.duty }, over); };
  const radioName = (radios, r, i) => `${TECH[r.tech].label}${radios.filter((x) => x.tech === r.tech).length > 1 ? ' #' + (i + 1) : ''}`;

  /** Occupied transmit range [lo, hi] MHz (channel or whole band), or null if not transmitting. */
  function txRange(r) {
    const T = TECH[r.tech]; if (!T.tx || !r.on) return null;
    return r.whole ? [T.tx[0], T.tx[1]] : [r.fc - r.bw / 2, r.fc + r.bw / 2];
  }

  /** Range of a·f1 + b·f2 over f1 ∈ r1, f2 ∈ r2 (r2 optional), folded to positive frequency. */
  function combo(a, r1, b, r2) {
    const pick = (c, r, wantLo) => (c >= 0) === wantLo ? c * r[0] : c * r[1];
    let lo = pick(a, r1, true) + (r2 ? pick(b, r2, true) : 0), hi = pick(a, r1, false) + (r2 ? pick(b, r2, false) : 0);
    if (hi < 0) [lo, hi] = [-hi, -lo]; else if (lo < 0) [lo, hi] = [0, Math.max(-lo, hi)];
    return [lo, hi];
  }
  const overlap = (p, b) => p[0] <= b[1] && p[1] >= b[0];

  /**
   * Harmonics (2..hmax) and 2nd/3rd (+ optional 5th) order intermod products of all transmitting radios, each flagged
   * against §15.205 restricted bands and host receive bands. Part 15 products are cut at the §15.33 search limit.
   * Returns [{label, order, kind, rng, srcs, restricted, rx, sev (2 restricted, 1 receiver, 0 clear), licensed, clipped}].
   */
  function products(radios, { hmax = F.measurementRange.harmonics, im5 = false } = {}) {
    const list = [], name = (r, i) => radioName(radios, r, i);
    const tx = radios.map((r, i) => ({ r, i, rng: txRange(r) })).filter((x) => x.rng);
    tx.forEach(({ r, i, rng }) => { for (let n = 2; n <= hmax; n++) list.push({ label: `${n}·f(${name(r, i)})`, order: n, kind: 'Harmonic', rng: combo(n, rng), srcs: [i] }); });
    const terms = [[1, 1, 2], [1, -1, 2], [2, -1, 3], [-1, 2, 3], [2, 1, 3], [1, 2, 3], ...(im5 ? [[3, -2, 5], [-2, 3, 5]] : [])];
    const term = (c, n) => `${Math.abs(c) === 1 ? '' : Math.abs(c) + '·'}f(${n})`;
    for (let x = 0; x < tx.length; x++) for (let y = x + 1; y < tx.length; y++) {
      const A = tx[x], B = tx[y];
      terms.forEach(([a, b, ord]) => {
        const lbl = a > 0 ? `${term(a, name(A.r, A.i))} ${b > 0 ? '+' : '−'} ${term(b, name(B.r, B.i))}` : `${term(b, name(B.r, B.i))} − ${term(a, name(A.r, A.i))}`;
        list.push({ label: lbl, order: ord, kind: ord === 2 ? '2nd-order IM' : ord === 3 ? '3rd-order IM' : '5th-order IM', rng: combo(a, A.rng, b, B.rng), srcs: [A.i, B.i] });
      });
    }
    const rxBands = []; radios.forEach((r, i) => TECH[r.tech].rx.forEach(([lo, hi, n]) => rxBands.push({ lo, hi, n, i })));
    const restricted = F.restrictedBands15205.mhz, cap = F.measurementRange.part15MaxMHz;
    list.forEach((p) => {
      p.restricted = restricted.filter((b) => overlap(p.rng, b));
      p.rx = rxBands.filter((b) => overlap(p.rng, [b.lo, b.hi]) && !(p.srcs.length === 1 && p.srcs[0] === b.i && p.kind !== 'Harmonic'))
        .filter((b, k, arr) => arr.findIndex((c) => c.n === b.n) === k);
      p.licensed = p.srcs.some((i) => isLicensed(radios[i]));
      p.sev = p.restricted.length ? 2 : p.rx.length ? 1 : 0;
    });
    list.sort((a, b) => b.sev - a.sev || a.order - b.order || a.rng[0] - b.rng[0]);
    const licensedOnly = (p) => p.srcs.every((i) => isLicensed(radios[i]));
    return list.filter((p) => p.rng[1] >= 30 && (licensedOnly(p) || p.rng[0] <= cap))
      .map((p) => (licensedOnly(p) || p.rng[1] <= cap ? p : { ...p, rng: [p.rng[0], cap], clipped: true }));
  }

  /* ---------------- RF exposure (general population / uncontrolled) ---------------- */
  /** MPE power-density limit, mW/cm² (§1.1310 Table 1(B)). */
  function mpeLimit(fMHz) {
    if (fMHz < 30) return 180 / (fMHz * fMHz);
    if (fMHz < 300) return 0.2;
    if (fMHz < 1500) return fMHz / 1500;
    return 1.0;
  }
  /** Far-field power density, mW/cm², from EIRP (mW) at distance r (cm). */
  const powerDensity = (eirpMw, rCm) => eirpMw / (4 * Math.PI * rCm * rCm);

  /**
   * SAR test-exemption threshold P_th (mW) per §1.1307(b)(3)(i)(B), for 300 MHz–6 GHz and 0.5–40 cm separation.
   * ERP_20cm = 2040·f (0.3–1.5 GHz) or 3060 (1.5–6 GHz); x = −log10(60 / (ERP_20cm·√f)), f in GHz.
   * Returns null outside the formula's range.
   */
  function sarExemptionMw(fMHz, dCm) {
    const f = fMHz / 1000; if (f < 0.3 || f > 6 || dCm < 0.5 || dCm > 40) return null;
    const erp20 = f < 1.5 ? 2040 * f : 3060;
    if (dCm > 20) return erp20;
    const x = -Math.log10(60 / (erp20 * Math.sqrt(f)));
    return erp20 * Math.pow(dCm / 20, x);
  }

  /**
   * Per-radio exposure terms at separation dCm for the transmitting radios.
   * Uses the lowest frequency of each radio's range (lowest limits) and time-averaged power (duty %).
   * mobile: power density vs MPE.  portable: max(conducted, ERP) vs P_th (or measured SAR vs 1.6 W/kg if given).
   */
  function exposure(radios, dCm, mode) {
    const lim = F.rfExposure;
    const rows = radios.map((r, i) => {
      const rng = txRange(r); if (!rng) return null;
      const f = rng[0], duty = Math.max(0, Math.min(100, r.duty ?? 100)) / 100;
      const condMw = M.dbmToMw(r.pwr) * duty, eirpMw = M.dbmToMw(r.pwr + r.gain) * duty, erpMw = M.dbmToMw(r.pwr + r.gain - 2.15) * duty;
      const row = { i, name: radioName(radios, r, i), f, condMw, eirpMw, erpMw };
      if (mode === 'mobile') { row.s = powerDensity(eirpMw, dCm); row.limit = mpeLimit(f); row.ratio = row.s / row.limit; row.basis = 'MPE'; }
      else if (r.sar > 0) { row.sar = r.sar; row.limit = lim.sarWPerKg; row.ratio = r.sar / lim.sarWPerKg; row.basis = 'Measured SAR'; }
      else { row.pAvail = Math.max(condMw, erpMw); row.pth = sarExemptionMw(f, dCm); row.limit = row.pth; row.ratio = row.pth ? row.pAvail / row.pth : Infinity; row.basis = 'SAR exemption'; }
      return row;
    }).filter(Boolean);
    return { rows, sum: rows.reduce((s, x) => s + x.ratio, 0) };
  }

  /** Smallest separation (cm) where the mobile MPE sum of ratios reaches 1 (closed form: ratios scale as 1/r²). */
  function mpeMinDistance(radios) {
    const s = exposure(radios, 1, 'mobile').sum; // sum at 1 cm; sum(r) = s / r²
    return Math.sqrt(s);
  }

  root.RF.coloc = { TECH, isLicensed, newRadio, radioName, txRange, combo, overlap, products, mpeLimit, powerDensity, sarExemptionMw, exposure, mpeMinDistance };
})(window);
