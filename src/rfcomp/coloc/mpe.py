"""RF exposure for simultaneous transmission.

Legacy RF.coloc mpeLimit, powerDensity, sarExemptionMw, exposure and mpeMinDistance. General
population / uncontrolled limits; all constants come from rfcomp.limits.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from rfcomp.coloc.radios import Radio, radio_name, tx_range
from rfcomp.core.units import DIPOLE_GAIN_DBI, dbm_to_mw
from rfcomp.limits import load as load_limits

Mode = Literal["mobile", "portable"]


def mpe_limit(f_mhz: float) -> float:
    """MPE power-density limit, mW/cm² (§1.1310 Table 1(B))."""
    return load_limits().mpe_table(f_mhz)


def power_density(eirp_mw: float, r_cm: float) -> float:
    """Far-field power density, mW/cm², from EIRP (mW) at distance r (cm)."""
    return eirp_mw / (4 * math.pi * r_cm * r_cm)


def sar_exemption_mw(f_mhz: float, d_cm: float) -> float | None:
    """SAR test-exemption threshold P_th (mW) per §1.1307(b)(3)(i)(B).

    None outside the formula's range.
    """
    p = load_limits().sar_exemption
    f = f_mhz / 1000
    if f < p.fMinGHz or f > p.fMaxGHz or d_cm < p.dMinCm or d_cm > p.dMaxCm:
        return None
    erp20 = p.erp20LowMwPerGHz * f if f < p.splitGHz else p.erp20HighMw
    if d_cm > p.refDistanceCm:
        return erp20
    x = -math.log10(p.xConst / (erp20 * math.sqrt(f)))
    return erp20 * math.pow(d_cm / p.refDistanceCm, x)


@dataclass(frozen=True)
class ExposureRow:
    i: int
    name: str
    f: float
    cond_mw: float
    eirp_mw: float
    erp_mw: float
    limit: float | None
    ratio: float
    basis: str
    s: float | None = None  # mobile: power density, mW/cm²
    sar: float | None = None  # measured SAR, W/kg
    p_avail: float | None = None  # portable: max(conducted, ERP), mW
    pth: float | None = None  # portable: exemption threshold, mW


@dataclass(frozen=True)
class Exposure:
    rows: list[ExposureRow]
    sum: float


def exposure(radios: list[Radio], d_cm: float, mode: Mode) -> Exposure:
    """Per-radio exposure ratios at separation d_cm and their sum (sum ≤ 1 → compliant / exempt).

    Uses the lowest frequency of each radio's range and time-averaged power (duty %).
    mobile: power density vs MPE. portable: max(conducted, ERP) vs P_th, or measured SAR vs
    the SAR limit when given.
    """
    sar_limit = load_limits().fcc["rfExposure"]["sarWPerKg"]
    rows: list[ExposureRow] = []
    for i, r in enumerate(radios):
        rng = tx_range(r)
        if rng is None:
            continue
        f = rng[0]
        duty = max(0.0, min(100.0, 100.0 if r.duty is None else r.duty)) / 100
        assert r.pwr is not None and r.gain is not None
        cond = dbm_to_mw(r.pwr) * duty
        eirp = dbm_to_mw(r.pwr + r.gain) * duty
        erp = dbm_to_mw(r.pwr + r.gain - DIPOLE_GAIN_DBI) * duty
        common = dict(
            i=i, name=radio_name(radios, r, i), f=f, cond_mw=cond, eirp_mw=eirp, erp_mw=erp
        )
        if mode == "mobile":
            s = power_density(eirp, d_cm)
            lim = mpe_limit(f)
            rows.append(ExposureRow(**common, s=s, limit=lim, ratio=s / lim, basis="MPE"))
        elif r.sar is not None and r.sar > 0:
            rows.append(
                ExposureRow(
                    **common,
                    sar=r.sar,
                    limit=sar_limit,
                    ratio=r.sar / sar_limit,
                    basis="Measured SAR",
                )
            )
        else:
            p_avail = max(cond, erp)
            pth = sar_exemption_mw(f, d_cm)
            ratio = p_avail / pth if pth else math.inf
            rows.append(
                ExposureRow(
                    **common,
                    p_avail=p_avail,
                    pth=pth,
                    limit=pth,
                    ratio=ratio,
                    basis="SAR exemption",
                )
            )
    total = 0.0
    for row in rows:
        total = total + row.ratio
    return Exposure(rows, total)


def mpe_min_distance(radios: list[Radio]) -> float:
    """Separation (cm) where the mobile MPE sum of ratios reaches 1 (ratios scale as 1/r²)."""
    return math.sqrt(exposure(radios, 1, "mobile").sum)
