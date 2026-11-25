"""Radio presets and radio rows for co-location analysis.

Legacy RF.coloc TECH, newRadio, radioName, txRange and isLicensed.
"""

from __future__ import annotations

from functools import cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict

from rfcomp.limits import Limits
from rfcomp.limits import load as load_limits

PRESETS_FILE = Path(__file__).with_name("presets.yaml")

RxBand = tuple[float, float, str]


class Tech(BaseModel):
    model_config = ConfigDict(frozen=True)

    label: str
    part: str | None
    rule: str | None = None
    tx: tuple[float, float] | None
    rx: list[RxBand]
    bws: list[float]
    fc: float
    bw: float
    pwr: float | None = None
    gain: float | None = None
    duty: float | None = None
    licensed: bool = False
    lteBand: str | None = None


class Radio(BaseModel):
    """One radio row. Field names follow the legacy tools; extra keys (impl, grantGain) are kept."""

    model_config = ConfigDict(extra="allow")

    tech: str
    on: bool
    fc: float
    bw: float
    whole: bool = False
    pwr: float | None = None
    gain: float | None = None
    duty: float | None = None
    sar: float | None = None


def _band_of(limits: Limits, section: str) -> tuple[float, float]:
    sec = limits.fcc[section]
    if "band" in sec:
        return (sec["band"]["loMHz"], sec["band"]["hiMHz"])
    subs = sec["subbands"].values()
    return (min(s["loMHz"] for s in subs), max(s["hiMHz"] for s in subs))


def build_techs(limits: Limits, presets: dict[str, Any]) -> dict[str, Tech]:
    techs: dict[str, Tech] = {}
    for key, p in presets["techs"].items():
        p = dict(p)
        if "band" in p:
            lo, hi = _band_of(limits, p.pop("band"))
            p["tx"] = (lo, hi)
            p["rx"] = [(lo, hi, p.pop("rxName"))]
        else:
            bands = limits.fcc[p.pop("receiveOnly")]["bands"]
            prefix = p.pop("rxPrefix")
            p["tx"] = None
            p["rx"] = [(lo, hi, prefix + k) for k, (lo, hi) in bands.items()]
        techs[key] = Tech(**p)
    lp = presets["lte"]
    for k, b in limits.fcc["lte"]["bands"].items():
        techs["lte" + k] = Tech(
            label=f"LTE {k} ({b['name']})",
            part=b["part"].split(" ")[0],
            rule=f"Part {b['part']}",
            tx=(b["ulLoMHz"], b["ulHiMHz"]),
            rx=[(b["dlLoMHz"], b["dlHiMHz"], f"LTE {k} downlink")],
            bws=[w for w in b["bwsMHz"] if w >= lp["minBwMHz"]],
            fc=(b["ulLoMHz"] + b["ulHiMHz"]) / 2,
            bw=min(lp["maxDefaultBwMHz"], max(b["bwsMHz"])),
            pwr=lp["pwr"],
            gain=lp["gain"],
            duty=lp["duty"],
            licensed=True,
            lteBand=k,
        )
    return techs


@cache
def techs() -> dict[str, Tech]:
    with open(PRESETS_FILE, encoding="utf-8") as fh:
        return build_techs(load_limits(), yaml.safe_load(fh))


def is_licensed(r: Radio) -> bool:
    t = techs().get(r.tech)
    return bool(t and t.licensed)


def new_radio(tech: str, **over: Any) -> Radio:
    """A new radio row with the preset's defaults."""
    t = techs()[tech]
    base: dict[str, Any] = {
        "tech": tech,
        "on": t.tx is not None,
        "fc": t.fc,
        "bw": t.bw,
        "whole": False,
        "pwr": t.pwr,
        "gain": t.gain,
        "duty": t.duty,
    }
    base.update(over)
    return Radio(**base)


def radio_name(radios: list[Radio], r: Radio, i: int) -> str:
    same = sum(1 for x in radios if x.tech == r.tech)
    return techs()[r.tech].label + (f" #{i + 1}" if same > 1 else "")


def tx_range(r: Radio) -> tuple[float, float] | None:
    """Occupied transmit range [lo, hi] MHz (channel or whole band), or None if not transmitting."""
    t = techs()[r.tech]
    if t.tx is None or not r.on:
        return None
    return (t.tx[0], t.tx[1]) if r.whole else (r.fc - r.bw / 2, r.fc + r.bw / 2)
