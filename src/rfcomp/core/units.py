"""Unit conversions and formatting, ported from legacy/rf-lab/shared/rfmath.js.

Each function mirrors the legacy expression term for term so results match the JS reference.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal

import numpy as np

#: Half-wave dipole gain (dBi): ERP = EIRP − 2.15 dB. Physical constant, not a regulatory limit.
DIPOLE_GAIN_DBI = 2.15
#: Free-space E-field constant: E (dBµV/m) = EIRP (dBm) + 104.77 − 20·log10(d m).
FIELD_EIRP_CONST_DB = 104.77
#: Free-space path loss constant for f in MHz and d in km.
FSPL_CONST_DB = 32.44


def _log10(x: float) -> float:
    """log10 with JS semantics: 0 → -inf, negative → nan (no exceptions)."""
    with np.errstate(divide="ignore", invalid="ignore"):
        return float(np.log10(x))


def _pow10(x: float) -> float:
    with np.errstate(over="ignore"):
        return float(np.power(10.0, x))


def dbm_to_mw(dbm: float) -> float:
    return _pow10(dbm / 10)


def mw_to_dbm(mw: float) -> float:
    return 10 * _log10(mw)


def sum_dbm(levels: Iterable[float]) -> float:
    """Incoherent power sum of dBm values (empty → -inf)."""
    s = 0.0
    for d in levels:
        s = s + dbm_to_mw(d)
    return mw_to_dbm(s)


def scale_to_bw(dbm: float, rbw_hz: float, ref_hz: float = 3000) -> float:
    """Scale a level measured in rbw_hz to a reference bandwidth (default 3 kHz)."""
    return dbm - 10 * _log10(rbw_hz / ref_hz)


def avg_psd(total_dbm: float, bw_hz: float, ref_hz: float = 3000) -> float:
    """Average PSD of a flat signal of total power spread over bw_hz, per ref_hz."""
    return total_dbm - 10 * _log10(bw_hz / ref_hz)


def eirp(cond_dbm: float, gain_dbi: float, loss_db: float = 0) -> float:
    return cond_dbm + gain_dbi - loss_db


def eirp_to_erp(eirp_dbm: float) -> float:
    return eirp_dbm - DIPOLE_GAIN_DBI


def erp_to_eirp(erp_dbm: float) -> float:
    return erp_dbm + DIPOLE_GAIN_DBI


def eirp_to_field_dbuv(eirp_dbm: float, d_m: float) -> float:
    """Field strength (dBµV/m) from EIRP (dBm) at distance d (m), far-field free space."""
    return eirp_dbm + FIELD_EIRP_CONST_DB - 20 * _log10(d_m)


def field_dbuv_to_eirp(e_dbuv: float, d_m: float) -> float:
    return e_dbuv - FIELD_EIRP_CONST_DB + 20 * _log10(d_m)


def fspl(f_mhz: float, d_km: float) -> float:
    """Free-space path loss in dB (f in MHz, d in km)."""
    return 20 * _log10(d_km) + 20 * _log10(f_mhz) + FSPL_CONST_DB


def js_to_fixed(x: float, digits: int) -> str:
    """Number.prototype.toFixed: exact binary value, ties rounded away from zero, no '-0'."""
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    if abs(x) >= 1e21:
        return repr(x)  # JS falls back to Number#toString, e.g. "1e+21"
    if x == 0:
        x = 0.0  # (-0).toFixed() has no sign
    q = Decimal(x).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)
    s = f"{q:f}"
    if x > 0 and s.startswith("-"):
        s = s[1:]
    return s


def fmt_hz(h: float) -> str:
    h = abs(h)
    if h >= 1e6:
        return js_to_fixed(h / 1e6, 3) + " MHz"
    if h >= 1e3:
        return js_to_fixed(h / 1e3, 0 if h >= 1e5 else 1) + " kHz"
    return js_to_fixed(h, 0) + " Hz"


def fmt_db(v: float, d: int = 2, unit: str = "dB") -> str:
    return (js_to_fixed(v, d) if math.isfinite(v) else "–") + " " + unit
