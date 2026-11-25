"""Conducted-power check: an intentional addition, not in the legacy page. Hand-computed cases."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from rfcomp.techs.halow import (
    POWER_LABEL,
    HalowConfig,
    conducted_power_check,
    conducted_power_limit_dbm,
)


def test_30p00_dbm_passes_at_6_dbi() -> None:
    c = conducted_power_check(30.00, 6.0)
    assert c.limit == 30.0
    assert c.passed
    assert c.margin == 0.0
    assert c.cite == "47 CFR §15.247(b)(3)"


def test_30p01_dbm_fails_at_6_dbi() -> None:
    c = conducted_power_check(30.01, 6.0)
    assert not c.passed
    assert c.margin == pytest.approx(-0.01, abs=1e-12)


def test_limit_is_28_dbm_at_8_dbi() -> None:
    assert conducted_power_limit_dbm(8.0) == 28.0
    c = conducted_power_check(28.0, 8.0)
    assert c.limit == 28.0 and c.passed
    assert not conducted_power_check(28.01, 8.0).passed
    assert c.cite == "47 CFR §15.247(b)(3), §15.247(b)(4)"


@pytest.mark.parametrize("gain", [0.0, 2.15, 6.0])
def test_no_reduction_at_or_below_6_dbi(gain: float) -> None:
    assert conducted_power_limit_dbm(gain) == 30.0


def test_check_carries_all_five_fields_and_label() -> None:
    c = conducted_power_check(27.5, 3.0)
    assert (c.value, c.limit, c.margin, c.passed) == (27.5, 30.0, 2.5, True)
    assert c.cite and c.unit == "dBm"
    assert c.label == POWER_LABEL


def test_12p5_dbi_antenna_limit_is_23p5_dbm() -> None:
    # 30 − (12.5 − 6) = 23.5 dBm
    assert conducted_power_limit_dbm(12.5) == 23.5
    assert conducted_power_check(23.50, 12.5).passed
    c = conducted_power_check(23.51, 12.5)
    assert not c.passed
    assert c.margin == pytest.approx(-0.01, abs=1e-12)
    assert c.cite == "47 CFR §15.247(b)(3), §15.247(b)(4)"


def test_antenna_gain_is_required() -> None:
    with pytest.raises(ValidationError, match="antenna_gain_dbi"):
        HalowConfig()  # type: ignore[call-arg]
    assert HalowConfig(antenna_gain_dbi=12.5).antenna_gain_dbi == 12.5
