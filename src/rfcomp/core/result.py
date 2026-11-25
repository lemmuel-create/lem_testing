"""Check and result models shared by every tech module.

Every check carries the measured value, the limit, the margin, a pass/fail and the CFR cite.
Comparisons use full precision, as the legacy tools do. Rounding is a display concern: reports and
the dashboard show at least 0.01 dB.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Check(BaseModel):
    """One limit comparison. `margin` > 0 means headroom; < 0 means the limit is exceeded.

    Informational measurements (no limit) and checks that could not be evaluated (e.g. the trace
    does not reach a band edge) have `passed = None` and do not count towards the verdict.
    """

    model_config = ConfigDict(frozen=True)

    label: str
    value: float | None
    limit: float | None
    margin: float | None
    passed: bool | None
    cite: str
    unit: str
    sense: Literal["max", "min", "info"]
    note: str | None = None
    review: bool = False  # the limit is flagged `review: true` (RF sign-off pending)
    detail: dict[str, float | bool | str | None] = Field(default_factory=dict)

    @classmethod
    def at_most(
        cls, label: str, value: float, limit: float, cite: str, unit: str, **extra: Any
    ) -> Check:
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
            **extra,
        )

    @classmethod
    def at_least(
        cls, label: str, value: float, limit: float, cite: str, unit: str, **extra: Any
    ) -> Check:
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
            **extra,
        )

    @classmethod
    def info(cls, label: str, value: float | None, cite: str, unit: str, **extra: Any) -> Check:
        """A reported measurement with no limit, or a check that could not be evaluated."""
        return cls(
            label=label,
            value=value,
            limit=None,
            margin=None,
            passed=None,
            cite=cite,
            unit=unit,
            sense="info",
            **extra,
        )


class Result(BaseModel):
    """All checks for one trace. FAIL if any evaluated check fails; info checks do not count."""

    model_config = ConfigDict(frozen=True)

    tech: str
    checks: list[Check]

    @property
    def evaluated(self) -> list[Check]:
        return [c for c in self.checks if c.passed is not None]

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.evaluated)

    @property
    def verdict(self) -> Literal["PASS", "FAIL"]:
        return "PASS" if self.passed else "FAIL"

    def check(self, key: str) -> Check:
        """The check whose `detail['key']` equals `key`."""
        for c in self.checks:
            if c.detail.get("key") == key:
                return c
        raise KeyError(key)
