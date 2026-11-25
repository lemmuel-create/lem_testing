"""Wi-Fi HaLow / 902–928 MHz DTS checks (§15.247).

Port of legacy/rf-lab/tools/bandwidth (status `live`); trace measurements are checked against the
golden cases in tests/golden/halow/. The conducted-power and §15.215(c) checks are intentional
additions with no legacy equivalent (docs/MIGRATION_PLAN.md, "Intentional differences").
"""

from __future__ import annotations

from numpy.typing import ArrayLike

from rfcomp.core.measure import n_db_bandwidth
from rfcomp.core.result import Check
from rfcomp.limits import Limits, load

SECTION = "ism900"
POWER_LABEL = (
    "Channel power (integrated, pre-compliance estimate; KDB 558074 methods for certification)"
)


def _dts(limits: Limits | None) -> tuple[dict, str]:
    lim = limits or load()
    sec = lim.fcc[SECTION]
    return sec["dts"], sec["cite"]


def _cfr(limits: Limits | None, *paras: str) -> str:
    """'47 CFR §a, §b' using the title prefix of the section cite ('47 CFR §15.247')."""
    _, cite = _dts(limits)
    title = cite.split("§")[0].strip()
    return f"{title} {', '.join(paras)}".strip()


def conducted_power_limit_dbm(antenna_gain_dbi: float, limits: Limits | None = None) -> float:
    """Maximum conducted power (§15.247(b)(3)), reduced dB-for-dB above 6 dBi (§15.247(b)(4))."""
    dts, _ = _dts(limits)
    excess = max(0.0, antenna_gain_dbi - dts["antennaGainRefDbi"])
    return dts["maxConductedDbm"] - excess * dts["gainReductionDbPerDb"]


def conducted_power_check(
    channel_power_dbm: float, antenna_gain_dbi: float, limits: Limits | None = None
) -> Check:
    """Integrated channel power from the trace vs the conducted-power limit; pass when <= limit."""
    dts, _ = _dts(limits)
    cites = [dts["citePower"]]
    if antenna_gain_dbi > dts["antennaGainRefDbi"]:
        cites.append(dts["citeGain"])
    return Check.at_most(
        label=POWER_LABEL,
        value=channel_power_dbm,
        limit=conducted_power_limit_dbm(antenna_gain_dbi, limits),
        cite=_cfr(limits, *cites),
        unit="dBm",
    )


BW_CONTAINMENT_LABEL = "20 dB bandwidth within 902–928 MHz (§15.215(c))"


def bw_containment_check(f: ArrayLike, a: ArrayLike, limits: Limits | None = None) -> Check:
    """§15.215(c): the 20 dB bandwidth must lie in the band. Pass when M1 >= lo and M2 <= hi.

    Always uses the n from halow.yaml (20 dB), whatever n the bandwidth check is run at. `value` is
    the containment margin in kHz: min(M1 − lo, hi − M2); negative when a marker is outside.
    """
    lim = limits or load()
    rule = lim.bw_containment
    lo, hi = lim.bw_containment_band()
    bw = n_db_bandwidth(f, a, rule.nDb)
    margin_khz = min(bw.f_l - lo, hi - bw.f_r) * 1e3
    return Check(
        label=BW_CONTAINMENT_LABEL,
        value=margin_khz,
        limit=0.0,
        margin=margin_khz,
        passed=bw.f_l >= lo and bw.f_r <= hi,
        cite=_cfr(lim, rule.cite),
        unit="kHz",
        sense="min",
        review=rule.review,
        detail={
            "m1MHz": bw.f_l,
            "m2MHz": bw.f_r,
            "nDb": rule.nDb,
            "loMHz": lo,
            "hiMHz": hi,
            "clipped": bw.clipped,
        },
    )
