"""Trace parsing and simulation, ported from legacy/rf-lab/shared/rfmath.js.

`parse_trace` follows the JS tokeniser and `Number()` rules; `rng` and `simulate_signal`
reproduce the legacy xorshift32 stream bit for bit so simulated traces match the HTML tools.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from rfcomp.core.units import dbm_to_mw, mw_to_dbm

MIN_ROWS = 10
PARSE_ERROR = "Need at least 10 data rows with two numeric columns (frequency, dBm)."


@dataclass(frozen=True)
class Trace:
    """Analyzer trace: frequency in MHz, amplitude in dBm (per RBW)."""

    f: np.ndarray
    a: np.ndarray
    rbw: float | None = field(default=None)


# --- JS Number() for a single token ---------------------------------------------------------------
_JS_DEC = re.compile(r"[+-]?(?:Infinity|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)")
_JS_RADIX = re.compile(r"0([xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)")
_RADIX = {"x": 16, "o": 8, "b": 2}
# ECMAScript WhiteSpace + LineTerminator (what Number() trims)
_JS_WS = (
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009"
    "\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)


def js_number(s: str) -> float:
    """JavaScript `Number(string)`: trims, '' → 0, decimal/Infinity/0x/0o/0b, otherwise NaN."""
    t = s.strip(_JS_WS)
    if t == "":
        return 0.0
    if _JS_DEC.fullmatch(t):
        return float(t.replace("Infinity", "inf"))
    m = _JS_RADIX.fullmatch(t)
    if m:
        return float(int(m.group(1)[1:], _RADIX[m.group(1)[0].lower()]))
    return math.nan


_SPLIT = re.compile(r"[,;\t ]+")
_LINES = re.compile(r"\r?\n")


def parse_trace(text: str, units: str | float = "auto", offset_db: float = 0) -> Trace:
    """Parse analyzer export text. First two finite numbers per line = frequency, amplitude.

    units: 'auto' or a multiplier to Hz (1, 1e3, 1e6, 1e9). Returns MHz and dBm.
    """
    rows: list[tuple[float, float]] = []
    for line in _LINES.split(str(text)):
        nums = [
            n
            for n in (js_number(tok) for tok in _SPLIT.split(line) if tok != "")
            if math.isfinite(n)
        ]
        if len(nums) >= 2:
            rows.append((nums[0], nums[1]))
    if len(rows) < MIN_ROWS:
        raise ValueError(PARSE_ERROR)
    rows.sort(key=lambda r: r[0])
    if units == "auto":
        mx = rows[-1][0]
        to_mhz = 1e-6 if mx > 1e7 else 1e-3 if mx > 1e4 else 1 if mx > 100 else 1e3
    else:
        to_mhz = js_number(units) / 1e6 if isinstance(units, str) else float(units) / 1e6
    f = np.array([r[0] * to_mhz for r in rows], dtype=np.float64)
    a = np.array([r[1] + offset_db for r in rows], dtype=np.float64)
    return Trace(f=f, a=a)


# --- seeded PRNG ----------------------------------------------------------------------------------
def _i32(v: int) -> int:
    v &= 0xFFFFFFFF
    return v - 0x100000000 if v >= 0x80000000 else v


def _to_uint32(seed: float) -> int:
    """JS `seed >>> 0` (ToUint32)."""
    if not math.isfinite(seed):
        return 0
    return int(math.trunc(seed)) % 0x100000000


def rng(seed: float) -> Callable[[], float]:
    """xorshift32 with the exact JS int32/uint32 coercions of the legacy `rng`."""
    x = _to_uint32(seed) or 1

    def draw() -> float:
        nonlocal x
        x = _i32(x ^ _i32(x << 13)) & 0xFFFFFFFF
        xi = _i32(x)
        x = _i32(xi ^ (xi >> 17))
        x = _i32(x ^ _i32(x << 5)) & 0xFFFFFFFF
        return x / 4294967296

    return draw


def _js_pow(x: float, y: float) -> float:
    """Math.pow: overflow gives inf instead of raising."""
    try:
        return math.pow(x, y)
    except OverflowError:
        return math.inf


def _js_round(x: float) -> int:
    """Math.round: halves round toward +inf."""
    return math.floor(x + 0.5)


def _js_or(v: Any, default: Any) -> Any:
    """JS `v || default` for numbers/None."""
    return v if v else default


def _js_nullish(v: Any, default: Any) -> Any:
    """JS `v ?? default`."""
    return default if v is None else v


def simulate_signal(o: dict[str, Any]) -> Trace:
    """Simulate an analyzer trace of a band-limited signal.

    Same options and random-draw order as the legacy tool. o: fcMHz, occMHz, spanMHz or
    startMHz + stopMHz, powerDbm, order, rippleDb, rbwHz, noiseDbm, seed, points, shoulderDbc,
    shoulderWidth, shoulderOrder.
    """
    n = _js_or(o.get("points"), 2401)
    r = rng(_js_or(o.get("seed"), 1))
    fc, occ = o["fcMHz"], o["occMHz"]
    span_mhz = o.get("spanMHz")
    f_start = _js_nullish(o.get("startMHz"), None)
    if f_start is None:
        f_start = fc - span_mhz / 2
    f_stop = _js_nullish(o.get("stopMHz"), None)
    if f_stop is None:
        f_stop = fc + span_mhz / 2
    span = f_stop - f_start
    df = span / (n - 1) * 1e6
    ph = [r() * 6.283 for _ in range(5)]
    fr = [3.1, 5.7, 9.3, 13.9, 21.1]
    ripple = o.get("rippleDb")
    shoulder = o.get("shoulderDbc")
    order = o["order"]

    f = np.empty(n, dtype=np.float64)
    dens = np.empty(n, dtype=np.float64)
    tot = 0.0
    for i in range(n):
        fm = f_start + span * i / (n - 1)
        f[i] = fm
        x = (fm - fc) / (occ / 2)
        lin = 1 / (1 + _js_pow(abs(x), 2 * order))
        if ripple is not None and ripple > 0:
            s = 0.0
            for k in range(5):
                s += math.sin(fr[k] * x + ph[k])
            lin *= math.pow(10, (ripple / 2) * (s / 3.2) / 10)
        if shoulder is not None:
            sw = _js_or(o.get("shoulderWidth"), 3)
            lin += math.pow(10, shoulder / 10) / (
                1 + _js_pow(abs(x) / sw, 2 * _js_or(o.get("shoulderOrder"), 2))
            )
        dens[i] = lin
        tot += lin * df

    p_mw = dbm_to_mw(o["powerDbm"])
    for i in range(n):
        dens[i] = dens[i] / tot * p_mw
    rbw = o["rbwHz"]
    half = max(0, _js_round(rbw / df / 2))
    pre = np.zeros(n + 1, dtype=np.float64)
    for i in range(n):
        pre[i + 1] = pre[i] + dens[i] * df
    a = np.empty(n, dtype=np.float64)
    nlin = dbm_to_mw(_js_nullish(o.get("noiseDbm"), -70))
    for i in range(n):
        lo, hi = max(0, i - half), min(n, i + half + 1)
        pw = (pre[hi] - pre[lo]) * (rbw / ((hi - lo) * df or rbw))
        j = r() - 0.5
        a[i] = mw_to_dbm(pw + nlin * math.pow(10, (r() - 0.5) * 0.6)) + j * (
            1 if pw < nlin * 20 else 0.25
        )
    return Trace(f=f, a=a, rbw=rbw)
