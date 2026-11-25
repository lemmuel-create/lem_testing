"""Regulatory limits: the only place rfcomp keeps regulatory numbers.

Each `*.yaml` file in this package holds:
  meta       title, cite, verified date, review flag (RF sign-off pending while true)
  root       (common.yaml only) limits version and verification source
  sections   limit data, key for key identical to the legacy RF.limits.fcc sections
  functions  parameters for limit formulas (legacy JS functions, and constants that were
             inline in tool code)

`load()` validates every file and returns a `Limits` object; `Limits.as_legacy()` rebuilds
the RF.limits structure.
"""

from __future__ import annotations

import datetime as dt
import math
from functools import cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

LIMITS_DIR = Path(__file__).parent
TECH_FILES = ("common", "halow", "wifi24", "unii", "lte", "cbrs", "gnss")


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class LimitsMeta(_Model):
    title: str
    cite: str = Field(min_length=1)
    verified: dt.date
    verifiedAgainst: str
    review: bool
    reviewNote: str


class LimitsRoot(_Model):
    version: str
    verified: str
    verifiedAgainst: str


class Segment(_Model):
    """One piece of a piecewise limit curve, used when f < belowMHz (always if belowMHz unset)."""

    kind: Literal["const", "linear", "inverseSquare"]
    belowMHz: float | None = None
    value: float | None = None  # const
    divisorMHz: float | None = None  # linear: f / divisorMHz
    k: float | None = None  # inverseSquare: k / f²

    def evaluate(self, f_mhz: float) -> float:
        if self.kind == "const":
            assert self.value is not None
            return self.value
        if self.kind == "linear":
            assert self.divisorMHz is not None
            return f_mhz / self.divisorMHz
        assert self.k is not None
        return self.k / (f_mhz * f_mhz)


class PiecewiseCurve(_Model):
    cite: str
    note: str
    segments: list[Segment]

    @field_validator("segments")
    @classmethod
    def _last_is_open(cls, v: list[Segment]) -> list[Segment]:
        if not v or v[-1].belowMHz is not None or any(s.belowMHz is None for s in v[:-1]):
            raise ValueError(
                "segments need ascending belowMHz bounds and a final open-ended segment"
            )
        return v

    def __call__(self, f_mhz: float) -> float:
        for seg in self.segments:
            if seg.belowMHz is None or f_mhz < seg.belowMHz:
                return seg.evaluate(f_mhz)
        raise AssertionError("unreachable")


class SarExemption(_Model):
    cite: str
    note: str
    fMinGHz: float
    fMaxGHz: float
    dMinCm: float
    dMaxCm: float
    splitGHz: float
    erp20LowMwPerGHz: float
    erp20HighMw: float
    xConst: float
    refDistanceCm: float


class ChannelPlan(_Model):
    cite: str
    note: str
    baseMHz: float
    stepMHz: float


class MaskAttenuation(_Model):
    cite: str
    note: str
    baseDb: float
    perDecadeDb: float


class TotalEirp(_Model):
    cite: str
    note: str
    perMHz: float


class BwContainment(_Model):
    """Occupied-bandwidth containment (e.g. §15.215(c)): the n-dB bandwidth must lie in a band."""

    cite: str
    note: str
    nDb: float
    bandRef: str  # "<section>.<key>" of a {loMHz, hiMHz} block in sections
    review: bool
    reviewNote: str


class LimitsFile(_Model):
    meta: LimitsMeta
    root: LimitsRoot | None = None
    sections: dict[str, dict[str, Any]]
    functions: dict[str, dict[str, Any]] = Field(default_factory=dict)


class Limits(_Model):
    """All limit files, validated. Sections are kept as the legacy nested dicts (camelCase keys)."""

    files: dict[str, LimitsFile]
    mpe: PiecewiseCurve
    mpe_table: PiecewiseCurve
    sar_exemption: SarExemption
    unii_channel_center: ChannelPlan
    lte_mask_attenuation: MaskAttenuation
    cbrs_total_eirp: TotalEirp
    bw_containment: BwContainment

    @property
    def version(self) -> str:
        root = self.files["common"].root
        assert root is not None
        return root.version

    @property
    def fcc(self) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for f in self.files.values():
            out.update(f.sections)
        return out

    def section_meta(self, section: str) -> LimitsMeta:
        for f in self.files.values():
            if section in f.sections:
                return f.meta
        raise KeyError(section)

    def as_legacy(self) -> dict[str, Any]:
        """The RF.limits object from legacy limits.js (without its two functions)."""
        root = self.files["common"].root
        assert root is not None
        return {**root.model_dump(), "fcc": self.fcc}

    # --- formulas (legacy RF.limits functions and inline tool formulas) ---------------------------
    def unii_channel_center_mhz(self, ch: float) -> float:
        p = self.unii_channel_center
        return p.baseMHz + p.stepMHz * ch

    def rf_exposure_mpe(self, f_mhz: float) -> float:
        """RF.limits.fcc.rfExposure.mpe (mW/cm²)."""
        return self.mpe(f_mhz)

    def lte_mask_attenuation_db(self, p_w: float) -> float:
        """Required attenuation below transmitter power P (W): 43 + 10·log10(P) dB."""
        p = self.lte_mask_attenuation
        return p.baseDb + p.perDecadeDb * math.log10(p_w)

    def cbrs_total_eirp_dbm(self, eirp_dbm_per_10mhz: float, bw_mhz: float) -> float:
        """Total EIRP allowed for a bw_mhz channel given a per-10 MHz EIRP limit."""
        return eirp_dbm_per_10mhz + 10 * math.log10(bw_mhz / self.cbrs_total_eirp.perMHz)

    def bw_containment_band(self) -> tuple[float, float]:
        """(loMHz, hiMHz) of the band the bw-containment rule references."""
        section, key = self.bw_containment.bandRef.split(".")
        band = self.fcc[section][key]
        return band["loMHz"], band["hiMHz"]


def _read(name: str) -> LimitsFile:
    with open(LIMITS_DIR / f"{name}.yaml", encoding="utf-8") as fh:
        return LimitsFile.model_validate(yaml.safe_load(fh))


@cache
def load() -> Limits:
    """Load and validate every limits file (cached)."""
    files = {name: _read(name) for name in TECH_FILES}
    seen: dict[str, str] = {}
    for name, f in files.items():
        for sec in f.sections:
            if sec in seen:
                raise ValueError(
                    f"section {sec!r} defined in both {seen[sec]}.yaml and {name}.yaml"
                )
            seen[sec] = name
    if files["common"].root is None:
        raise ValueError("common.yaml must define root (version, verified, verifiedAgainst)")
    fn = {k: v for f in files.values() for k, v in f.functions.items()}
    return Limits(
        files=files,
        mpe=PiecewiseCurve.model_validate(fn["mpe"]),
        mpe_table=PiecewiseCurve.model_validate(fn["mpeTable"]),
        sar_exemption=SarExemption.model_validate(fn["sarExemption"]),
        unii_channel_center=ChannelPlan.model_validate(fn["channelCenter"]),
        lte_mask_attenuation=MaskAttenuation.model_validate(fn["maskAttenuation"]),
        cbrs_total_eirp=TotalEirp.model_validate(fn["totalEirp"]),
        bw_containment=BwContainment.model_validate(fn["bwContainment"]),
    )


__all__ = ["Limits", "LimitsFile", "LimitsMeta", "load"]
