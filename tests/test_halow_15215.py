"""§15.215(c) 20 dB bandwidth containment: an intentional addition, not in the legacy page.

Uses the edge20-* golden cases: the page's own 20 dB markers (M1/M2) on pasted and simulated traces.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from rfcomp.core.trace import parse_trace
from rfcomp.techs.halow import bw_containment_check

GOLDEN = Path(__file__).parent / "golden" / "halow"
CASES = {c["id"]: c for c in json.loads((GOLDEN / "bandwidth.json").read_text())["cases"]}
TRACES = json.loads((GOLDEN / "traces.json").read_text())

EXPECTED = {
    "edge20-m1-902p001-inside": True,
    "edge20-m2-927p999-inside": True,
    "edge20-m1-901p999-outside": False,
    "edge20-m2-928p001-outside": False,
    "edge20-sim-halow1-fc902p5": False,
    "edge20-sim-halow1-fc927p5": False,
    "edge20-sim-halow2-fc903": False,
    "edge20-sim-halow2-fc927": False,
}


def _trace(case: dict) -> tuple[np.ndarray, np.ndarray]:
    if case["mode"] == "sim":
        t = TRACES[case["trace"]["sha256"]]
        return np.array(t["f"]), np.array(t["a"])
    s = case["settings"]
    t = parse_trace(case["trace"]["text"], s["units"], s["offset"])
    return t.f, t.a


def test_every_edge20_case_is_covered() -> None:
    assert {k for k in CASES if k.startswith("edge20-")} == set(EXPECTED)


@pytest.mark.parametrize("case_id", sorted(EXPECTED))
def test_containment(case_id: str) -> None:
    case = CASES[case_id]
    c = bw_containment_check(*_trace(case))
    assert c.passed is EXPECTED[case_id]
    # markers agree with the 20 dB markers the legacy page reported
    page = case["raw"]["nDbBandwidth"]
    assert page["n"] == 20
    assert c.detail["m1MHz"] == pytest.approx(page["fL"], abs=1e-3)
    assert c.detail["m2MHz"] == pytest.approx(page["fR"], abs=1e-3)
    assert (c.margin >= 0) is c.passed
    assert c.cite == "47 CFR §15.215(c)"
    assert c.review is True


def test_markers_exactly_on_band_edges_pass() -> None:
    f = np.arange(901_500, 903_501) / 1000  # 1 kHz grid
    # flat top 902.020–902.980, 1 dB/kHz skirts: 20 dB points at exactly 902.000 and 903.000
    d = np.maximum(np.abs(f * 1000 - 902_500) - 480, 0)
    a = -np.minimum(d, 60)
    c = bw_containment_check(f, a)
    assert c.detail["m1MHz"] == 902.0
    assert c.passed and c.margin == 0.0


def test_uses_20_db_whatever_the_bandwidth_n() -> None:
    case = CASES["edge20-m1-901p999-outside"]
    c = bw_containment_check(*_trace(case))
    assert c.detail["nDb"] == 20


def _flat_wide(n_db_fall: float) -> tuple[np.ndarray, np.ndarray]:
    """Flat 0 dBm top over 914.6–915.4 MHz; skirts fall only `n_db_fall` dB by the span edges."""
    f = np.arange(914_000, 916_001) / 1000
    d = np.maximum(np.abs(f - 915) - 0.4, 0) / 0.6  # 0 at the top edge, 1 at the span edge
    return f, -n_db_fall * d


def test_clipped_20db_is_not_evaluated_never_pass() -> None:
    f, a = _flat_wide(10)  # falls 10 dB: 20 dB points are not in the span
    c = bw_containment_check(f, a)
    assert c.passed is None
    assert c.value is None and c.margin is None
    assert c.note == "Widen the span: 20 dB points not found"
    assert c.detail["clipped"] is True


def test_unclipped_20db_is_evaluated() -> None:
    f, a = _flat_wide(30)
    c = bw_containment_check(f, a)
    assert c.passed is True and c.note is None


@pytest.mark.parametrize("case_id", ["sim-halow1-steep1", "csv-clipped-widen-span"])
def test_golden_traces_that_never_fall_20db_are_na(case_id: str) -> None:
    c = bw_containment_check(*_trace(CASES[case_id]))
    assert c.passed is None
    assert c.note == "Widen the span: 20 dB points not found"
