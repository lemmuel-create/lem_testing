"""Wi-Fi HaLow / 902–928 MHz DTS checks (§15.247).

Port of legacy/rf-lab/tools/bandwidth (status `live`); trace measurements are checked against the
golden cases in tests/golden/halow/. The conducted-power check is an intentional addition: the
legacy page does not evaluate conducted power (docs/MIGRATION_PLAN.md, "Intentional differences").
"""

from __future__ import annotations

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


def conducted_power_limit_dbm(antenna_gain_dbi: float, limits: Limits | None = None) -> float:
    """Maximum conducted power (§15.247(b)(3)), reduced dB-for-dB above 6 dBi (§15.247(b)(4))."""
    dts, _ = _dts(limits)
    excess = max(0.0, antenna_gain_dbi - dts["antennaGainRefDbi"])
    return dts["maxConductedDbm"] - excess * dts["gainReductionDbPerDb"]


def conducted_power_check(
    channel_power_dbm: float, antenna_gain_dbi: float, limits: Limits | None = None
) -> Check:
    """Integrated channel power from the trace vs the conducted-power limit; pass when <= limit."""
    dts, cite = _dts(limits)
    part = cite.removesuffix("§15.247").strip()  # "47 CFR"
    cites = [dts["citePower"]]
    if antenna_gain_dbi > dts["antennaGainRefDbi"]:
        cites.append(dts["citeGain"])
    return Check.at_most(
        label=POWER_LABEL,
        value=channel_power_dbm,
        limit=conducted_power_limit_dbm(antenna_gain_dbi, limits),
        cite=f"{part} {', '.join(cites)}".strip(),
        unit="dBm",
    )
