"""Trace measurements, ported from legacy/rf-lab/shared/rfmath.js.

Same algorithms as the legacy tools: outermost linear-interpolated n-dB crossings, trapezoidal
power integration in linear mW, and first-maximum peak selection. Frequencies are MHz, levels
dBm per RBW.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike

from rfcomp.core.units import dbm_to_mw, mw_to_dbm


def _arr(x: ArrayLike) -> np.ndarray:
    return np.asarray(x, dtype=np.float64)


@dataclass(frozen=True)
class Peak:
    pk: float
    pi: int


@dataclass(frozen=True)
class NdbBandwidth:
    f_l: float
    f_r: float
    bw_hz: float
    pk: float
    pi: int
    th: float
    n: float
    clipped: bool


@dataclass(frozen=True)
class Obw:
    o_l: float
    o_r: float
    bw_hz: float
    total_mw_mhz: float


@dataclass(frozen=True)
class BandEdge:
    lo: float | None  # dBc below peak of the worst point below `lo` MHz (None: no points there)
    hi: float | None
    pk: float


@dataclass(frozen=True)
class RangeMax:
    max: float
    at: float


@dataclass(frozen=True)
class Margin:
    margin: float  # limit − level; negative = fail
    at: float
    level: float
    limit: float


def peak(a: ArrayLike) -> Peak:
    """First index of the maximum (strict '>' scan; empty → -inf at 0)."""
    a = _arr(a)
    pk, pi = -math.inf, 0
    for i in range(len(a)):
        if a[i] > pk:
            pk, pi = float(a[i]), i
    return Peak(pk, pi)


def n_db_bandwidth(f: ArrayLike, a: ArrayLike, n: float = 6) -> NdbBandwidth:
    """n-dB bandwidth: outermost crossings of (peak − n) either side of the peak, interpolated."""
    f, a = _arr(f), _arr(a)
    size = len(f)
    p = peak(a)
    pk, pi = p.pk, p.pi
    th = pk - n
    i1 = 0
    while i1 < pi and a[i1] < th:
        i1 += 1
    i2 = size - 1
    while i2 > pi and a[i2] < th:
        i2 -= 1

    def ip(ia: int, ib: int) -> float:
        d = a[ib] - a[ia]
        return float(f[ib]) if abs(d) < 1e-12 else float(f[ia] + (th - a[ia]) / d * (f[ib] - f[ia]))

    f_l = ip(i1 - 1, i1) if i1 > 0 else float(f[0])
    f_r = ip(i2 + 1, i2) if i2 < size - 1 else float(f[size - 1])
    clipped = bool((i1 == 0 and a[0] >= th) or (i2 == size - 1 and a[size - 1] >= th))
    return NdbBandwidth(f_l, f_r, (f_r - f_l) * 1e6, pk, pi, th, n, clipped)


def obw(f: ArrayLike, a: ArrayLike, frac: float = 0.99) -> Obw:
    """Occupied bandwidth containing `frac` of the trapezoid-integrated trace power."""
    f, a = _arr(f), _arr(a)
    size = len(f)
    cum = [0.0]
    for i in range(1, size):
        cum.append(cum[i - 1] + (dbm_to_mw(a[i]) + dbm_to_mw(a[i - 1])) / 2 * (f[i] - f[i - 1]))
    total = cum[size - 1]
    cut = (1 - frac) / 2

    def at(q: float) -> float:
        for i in range(1, size):
            if cum[i] >= q:
                r = (q - cum[i - 1]) / ((cum[i] - cum[i - 1]) or 1)
                return float(f[i - 1] + r * (f[i] - f[i - 1]))
        return float(f[size - 1])

    o_l, o_r = at(cut * total), at((1 - cut) * total)
    return Obw(o_l, o_r, (o_r - o_l) * 1e6, float(total))


def channel_power(
    f: ArrayLike, a: ArrayLike, rbw_hz: float, f_lo: float = -math.inf, f_hi: float = math.inf
) -> float:
    """Channel power (dBm) from a trace in dBm/RBW.

    Integrates segments whose midpoint is in [f_lo, f_hi] and divides by the RBW.
    """
    f, a = _arr(f), _arr(a)
    s = 0.0
    for i in range(1, len(f)):
        fm = (f[i] + f[i - 1]) / 2
        if fm < f_lo or fm > f_hi:
            continue
        s += (dbm_to_mw(a[i]) + dbm_to_mw(a[i - 1])) / 2 * (f[i] - f[i - 1]) * 1e6
    return mw_to_dbm(s / rbw_hz)


def band_edge(f: ArrayLike, a: ArrayLike, lo: float, hi: float) -> BandEdge:
    """Max level outside [lo, hi] MHz as dB below the peak; None where the trace doesn't extend."""
    f, a = _arr(f), _arr(a)
    pk = peak(a).pk
    mb = ma = -math.inf
    for i in range(len(f)):
        if f[i] < lo:
            mb = max(mb, float(a[i]))
        elif f[i] > hi:
            ma = max(ma, float(a[i]))
    return BandEdge(None if mb == -math.inf else pk - mb, None if ma == -math.inf else pk - ma, pk)


def max_in_range(f: ArrayLike, a: ArrayLike, lo: float, hi: float) -> RangeMax | None:
    """Max trace level and its frequency within [lo, hi] MHz inclusive; None if no point."""
    f, a = _arr(f), _arr(a)
    m, at = -math.inf, None
    for i in range(len(f)):
        if lo <= f[i] <= hi and a[i] > m:
            m, at = float(a[i]), float(f[i])
    return None if at is None else RangeMax(m, at)


def interp(points: Sequence[Sequence[float]], x: float) -> float:
    """Piecewise-linear interpolation over [[x, y], ...] sorted by x, clamped at both ends."""
    if x <= points[0][0]:
        return points[0][1]
    for i in range(1, len(points)):
        if x <= points[i][0]:
            x0, y0 = points[i - 1]
            x1, y1 = points[i]
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return points[-1][1]


def worst_margin(
    f: ArrayLike,
    a: ArrayLike,
    limit_fn: Callable[[float], float | None],
    convert: Callable[[float, float], float] = lambda v, _f: v,
) -> Margin | None:
    """Worst (lowest) limit − level over the trace.

    limit_fn(f) returns the limit, or None where no limit applies. convert(level, f) maps the
    trace dBm/RBW into the limit's units. Returns None if nothing was checked.
    """
    f, a = _arr(f), _arr(a)
    w: Margin | None = None
    for i in range(len(f)):
        fi = float(f[i])
        lim = limit_fn(fi)
        if lim is None:
            continue
        lv = convert(float(a[i]), fi)
        m = lim - lv
        if w is None or m < w.margin:
            w = Margin(m, fi, lv, lim)
    return w
