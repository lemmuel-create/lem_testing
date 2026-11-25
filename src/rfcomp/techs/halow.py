"""Wi-Fi HaLow / 902–928 MHz DTS checks (§15.247).

Port of legacy/rf-lab/tools/bandwidth (status `live`); trace measurements are checked against the
golden cases in tests/golden/halow/. The conducted-power and §15.215(c) checks are intentional
additions with no legacy equivalent (docs/MIGRATION_PLAN.md, "Intentional differences").
"""

from __future__ import annotations

from typing import Literal

from numpy.typing import ArrayLike
from pydantic import BaseModel, ConfigDict

from rfcomp.core.measure import NdbBandwidth, band_edge, channel_power, n_db_bandwidth, obw
from rfcomp.core.result import Check, Result
from rfcomp.core.trace import Trace
from rfcomp.core.units import scale_to_bw
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
        detail={"key": "power", "antennaGainDbi": antenna_gain_dbi},
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
            "key": "bw_containment",
            "m1MHz": bw.f_l,
            "m2MHz": bw.f_r,
            "nDb": rule.nDb,
            "loMHz": lo,
            "hiMHz": hi,
            "clipped": bw.clipped,
        },
    )


# --- full evaluation (port of the bandwidth page's measure() + update()) -------------------------
OBW_LABEL = "99% occupied bandwidth (reported, no FCC limit)"
OBW_CITE = "ISED RSS-Gen (reported only)"
OBW_FRAC = 0.99
PSD_REF_HZ = 3000


class HalowConfig(BaseModel):
    """Analysis settings. Limits are not configurable here; they come from halow.yaml."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    antenna_gain_dbi: float  # required: the product's antenna (e.g. up to 12.5 dBi)
    ndb: Literal[6, 20, 26] = 6  # extra n-dB width to report; the DTS check is always 6 dB
    band_edge_method: Literal["peak", "average"] = "peak"
    rbw_hz: float | None = None  # overrides trace.rbw


def evaluate(trace: Trace, cfg: HalowConfig, limits: Limits | None = None) -> Result:
    """Run every HaLow check on an analyzer trace (MHz, dBm per RBW).

    Same measurements and comparisons as legacy/rf-lab/tools/bandwidth, at full precision:
      - 6 dB bandwidth >= min6dBBwKHz (always 6 dB, per §15.247(a)(2); the page applied the
        minimum to whichever n was selected),
      - the selected n-dB bandwidth when n != 6 (informational),
      - 99% OBW (informational),
      - channel power vs the conducted-power limit (intentional addition),
      - peak PSD = peak scaled from RBW to 3 kHz, <= psdDbmPer3kHz,
      - band edge: worst side dBc >= peak (20) or average (30) method requirement; not evaluated
        when the trace does not extend past 902 or 928 MHz,
      - §15.215(c) 20 dB bandwidth containment (intentional addition).
    """
    lim = limits or load()
    dts, _ = _dts(lim)
    band = lim.fcc[SECTION]["band"]
    lo, hi = band["loMHz"], band["hiMHz"]
    rbw = cfg.rbw_hz if cfg.rbw_hz is not None else trace.rbw
    if not rbw:
        raise ValueError("trace RBW is required (set trace.rbw or cfg.rbw_hz)")
    f, a = trace.f, trace.a

    def bw_detail(key: str, m: NdbBandwidth) -> dict[str, float | bool | str | None]:
        return {
            "key": key,
            "m1MHz": m.f_l,
            "m2MHz": m.f_r,
            "nDb": m.n,
            "peakDbm": m.pk,
            "peakMHz": float(f[m.pi]),
            "clipped": m.clipped,
        }

    clipped_note = "Widen the span: the trace does not fall n dB at the edge."
    dts_n = lim.dts_bandwidth.nDb
    bw = n_db_bandwidth(f, a, dts_n)
    bw_check = Check.at_least(
        label=f"{dts_n:g} dB bandwidth",
        value=bw.bw_hz,
        limit=dts["min6dBBwKHz"] * 1e3,
        cite=_cfr(lim, dts["cite6dB"]),
        unit="Hz",
        note=clipped_note if bw.clipped else None,
        detail=bw_detail("bandwidth", bw),
    )
    extra: list[Check] = []
    if cfg.ndb != dts_n:
        nb = n_db_bandwidth(f, a, cfg.ndb)
        extra.append(
            Check.info(
                f"{cfg.ndb} dB bandwidth (reported)",
                nb.bw_hz,
                "Reported only",
                "Hz",
                note=clipped_note if nb.clipped else None,
                detail=bw_detail("ndb", nb),
            )
        )

    ob = obw(f, a, OBW_FRAC)
    obw_check = Check.info(
        OBW_LABEL,
        ob.bw_hz,
        OBW_CITE,
        "Hz",
        detail={"key": "obw", "oLMHz": ob.o_l, "oRMHz": ob.o_r, "frac": OBW_FRAC},
    )

    power = conducted_power_check(channel_power(f, a, rbw), cfg.antenna_gain_dbi, lim)

    psd = scale_to_bw(bw.pk, rbw, PSD_REF_HZ)
    psd_check = Check.at_most(
        label="Peak PSD (scaled to 3 kHz)",
        value=psd,
        limit=dts["psdDbmPer3kHz"],
        cite=_cfr(lim, dts["citePsd"]),
        unit="dBm/3kHz",
        detail={"key": "psd", "peakDbm": bw.pk, "rbwHz": rbw},
    )

    req = dts["bandEdgeDbc"]["peakMethod" if cfg.band_edge_method == "peak" else "averageMethod"]
    be_label = f"Band edge ({lo:g} / {hi:g} MHz, {cfg.band_edge_method} method)"
    be_cite = _cfr(lim, dts["citeBandEdge"])
    if f[0] < lo or f[-1] > hi:
        be = band_edge(f, a, lo, hi)
        sides = [v for v in (be.lo, be.hi) if v is not None]
        be_check = Check.at_least(
            label=be_label,
            value=min(sides),
            limit=req,
            cite=be_cite,
            unit="dBc",
            detail={
                "key": "band_edge",
                "loDbc": be.lo,
                "hiDbc": be.hi,
                "method": cfg.band_edge_method,
            },
        )
    else:
        be_check = Check.info(
            be_label,
            None,
            be_cite,
            "dBc",
            note=f"Not evaluated: trace does not cross {lo:g} or {hi:g} MHz.",
            detail={
                "key": "band_edge",
                "loDbc": None,
                "hiDbc": None,
                "method": cfg.band_edge_method,
            },
        )

    containment = bw_containment_check(f, a, lim)
    return Result(
        tech="halow",
        checks=[bw_check, *extra, obw_check, power, psd_check, be_check, containment],
    )
