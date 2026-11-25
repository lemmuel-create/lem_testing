"""Check and result models shared by every tech module.

Every check carries the measured value, the limit, the margin, a pass/fail and the CFR cite.
Comparisons use full precision, as the legacy tools do. Rounding is a display concern: reports and
the dashboard show at least 0.01 dB.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class Check(BaseModel):
    """One limit comparison. `margin` > 0 means headroom; < 0 means the limit is exceeded."""

    model_config = ConfigDict(frozen=True)

    label: str
    value: float
    limit: float
    margin: float
    passed: bool
    cite: str
    unit: str
    sense: Literal["max", "min"]

    @classmethod
    def at_most(cls, label: str, value: float, limit: float, cite: str, unit: str) -> Check:
        """Pass when value <= limit (e.g. power, PSD)."""
        return cls(
            label=label,
            value=value,
            limit=limit,
            margin=limit - value,
            passed=value <= limit,
            cite=cite,
            unit=unit,
            sense="max",
        )

    @classmethod
    def at_least(cls, label: str, value: float, limit: float, cite: str, unit: str) -> Check:
        """Pass when value >= limit (e.g. 6 dB bandwidth, band-edge dBc)."""
        return cls(
            label=label,
            value=value,
            limit=limit,
            margin=value - limit,
            passed=value >= limit,
            cite=cite,
            unit=unit,
            sense="min",
        )
