"""halow.evaluate vs the legacy bandwidth page: every case in tests/golden/halow/bandwidth.json.

Simulated cases use the exact JS trace from traces.json; pasted cases are re-parsed from the pasted
text with the page's units, offset and RBW. Values must match the page within 0.01 dB / 1 kHz, and
every pass/fail the page shows must match the corresponding check exactly.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from rfcomp.core.result import Result
from rfcomp.core.trace import Trace, parse_trace
from rfcomp.limits import load
from rfcomp.techs.halow import HalowConfig, evaluate

GOLDEN = Path(__file__).parent / "golden" / "halow"
DATA = json.loads((GOLDEN / "bandwidth.json").read_text(encoding="utf-8"))
CASES = DATA["cases"]
TRACES = json.loads((GOLDEN / "traces.json").read_text(encoding="utf-8"))

DB = 0.01  # dB
KHZ_HZ = 1e3  # 1 kHz, in Hz
KHZ_MHZ = 1e-3  # 1 kHz, in MHz

DTS = load().fcc["ism900"]["dts"]

# Cases where rfcomp deliberately gives a different verdict from the page, with the reason.
# Each entry is asserted to still differ, so the list cannot go stale.
KNOWN_DIFFERENCES = {
    "psd-sim-halow1-limit-6": (
        "psd",
        "The page's PSD limit field was set to 6 dBm. rfcomp takes limits only from halow.yaml "
        "(8 dBm), so 6.40 dBm/3 kHz passes.",
    ),
}
# For n != 6 the page compared the selected n-dB width with the 500 kHz minimum. rfcomp always
# applies the minimum to the 6 dB width (§15.247(a)(2)) and reports the n-dB width for information,
# so the page's "Result vs minimum" is not compared for those cases; their n-dB values still are.
# Power is not on the page; run golden cases at the reference gain (no §15.247(b)(4) reduction).
GAIN_DBI = DTS["antennaGainRefDbi"]


def _trace(case: dict) -> Trace:
    if case["mode"] == "sim":
        t = TRACES[case["trace"]["sha256"]]
        return Trace(f=np.array(t["f"]), a=np.array(t["a"]), rbw=t["rbwHz"])
    s = case["settings"]
    t = parse_trace(case["trace"]["text"], s["units"], s["offset"] or 0)
    # page: (+rbwCsv || 100) * 1e3
    return Trace(f=t.f, a=t.a, rbw=(s["rbwCsv"] or 100) * 1e3)


def _cfg(case: dict) -> HalowConfig:
    s = case["settings"]
    method = {
        DTS["bandEdgeDbc"]["peakMethod"]: "peak",
        DTS["bandEdgeDbc"]["averageMethod"]: "average",
    }
    return HalowConfig(antenna_gain_dbi=GAIN_DBI, ndb=s["ndb"], band_edge_method=method[s["beLim"]])


def _page_verdict(display: dict, card: str) -> bool | None:
    v = display[card]
    if isinstance(v, str):  # "n/a" (band edge not evaluated)
        return None
    return v["cls"] == "pass"


def _run(case: dict) -> Result:
    return evaluate(_trace(case), _cfg(case))


def test_case_count() -> None:
    assert len(CASES) == 67
    assert len({c["id"] for c in CASES}) == 67


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_matches_page(case: dict) -> None:
    if case.get("display", {}).get("csvErr"):
        with pytest.raises(ValueError) as e:
            _trace(case)
        assert str(e.value) == case["display"]["csvErr"]
        return

    raw, display = case["raw"], case["display"]
    r = _run(case)
    bw, ob, pw, psd, be = (r.check(k) for k in ("bandwidth", "obw", "power", "psd", "band_edge"))

    # --- values -----------------------------------------------------------------------------
    n = raw["nDbBandwidth"]
    six = n["n"] == bw.detail["nDb"]  # the page ran at 6 dB
    nb = bw if six else r.check("ndb")
    assert nb.detail["nDb"] == n["n"]
    assert nb.value == pytest.approx(n["bwHz"], abs=KHZ_HZ)
    assert nb.detail["m1MHz"] == pytest.approx(n["fL"], abs=KHZ_MHZ)
    assert nb.detail["m2MHz"] == pytest.approx(n["fR"], abs=KHZ_MHZ)
    assert nb.detail["peakDbm"] == pytest.approx(n["pk"], abs=DB)
    assert nb.detail["clipped"] is n["clipped"]
    if not six:
        assert nb.passed is None

    o = raw["obw"]
    assert ob.value == pytest.approx(o["bwHz"], abs=KHZ_HZ)
    assert ob.detail["oLMHz"] == pytest.approx(o["oL"], abs=KHZ_MHZ)
    assert ob.detail["oRMHz"] == pytest.approx(o["oR"], abs=KHZ_MHZ)
    assert ob.passed is None

    assert pw.value == pytest.approx(raw["channelPower"]["result"], abs=DB)
    assert psd.value == pytest.approx(raw["scaleToBw"]["result"], abs=DB)

    if "bandEdge" in raw:
        for side, key in (("lo", "loDbc"), ("hi", "hiDbc")):
            exp = raw["bandEdge"][side]
            got = be.detail[key]
            assert (got is None) == (exp is None)
            if exp is not None:
                assert got == pytest.approx(exp, abs=DB)
    else:
        assert be.value is None and be.passed is None

    # --- verdicts (exact) -------------------------------------------------------------------
    s = case["settings"]
    verdicts = {
        **({"bandwidth": (bw.passed, _page_verdict(display, "mRes"))} if six else {}),
        "psd": (psd.passed, _page_verdict(display, "mPsd")),
        "band_edge": (be.passed, _page_verdict(display, "mBe")),
    }
    diff = KNOWN_DIFFERENCES.get(case["id"])
    for key, (ours, page) in verdicts.items():
        if diff and diff[0] == key:
            assert ours is not page, f"{case['id']}: expected a documented difference in {key}"
        else:
            assert ours is page, f"{case['id']}: {key} rfcomp={ours} page={page}"

    # page limits equal halow.yaml, except where a known difference changes a page field
    if not diff:
        assert s["minbw"] == DTS["min6dBBwKHz"]
        assert s["psdLim"] == DTS["psdDbmPer3kHz"]


def test_case8_lora_passes_6db_but_fails_psd_overall_fail() -> None:
    case = CASES[7]
    assert case["id"] == "sim-lora500-marginal"
    r = _run(case)
    assert r.check("bandwidth").passed is True
    assert r.check("psd").passed is False
    assert r.passed is False and r.verdict == "FAIL"


def test_every_check_carries_value_limit_margin_verdict_cite() -> None:
    r = _run(CASES[0])
    for c in r.evaluated:
        assert c.value is not None and c.limit is not None and c.margin is not None
        assert isinstance(c.passed, bool) and c.cite.startswith("47 CFR §")
    assert [c.detail["key"] for c in r.checks] == [
        "bandwidth",
        "obw",
        "power",
        "psd",
        "band_edge",
        "bw_containment",
    ]


def test_ndb_other_than_6_is_reported_and_6db_still_checked() -> None:
    case = next(c for c in CASES if c["id"] == "ndb20-trapezoid-known-answer")
    r = _run(case)
    keys = [c.detail["key"] for c in r.checks]
    assert keys[:2] == ["bandwidth", "ndb"]
    assert r.check("bandwidth").detail["nDb"] == 6
    assert r.check("bandwidth").value == pytest.approx(512e3, abs=1e-3)  # 500 + 2·6 kHz
    assert r.check("ndb").value == pytest.approx(540e3, abs=1e-3)  # 500 + 2·20 kHz


def test_known_differences_are_documented() -> None:
    plan = (Path(__file__).parents[1] / "docs" / "MIGRATION_PLAN.md").read_text(encoding="utf-8")
    for case_id in KNOWN_DIFFERENCES:
        assert case_id in plan


def test_6db_minimum_ignores_wider_ndb_width() -> None:
    """Hand-computed: 6 dB width 492 kHz fails 500 kHz even though the 20 dB width is 520 kHz.

    The legacy page, set to 20 dB, would show Pass. Flat top 480 kHz, 1 dB/kHz skirts on a 1 kHz
    grid, so the n-dB width is exactly 480 + 2n kHz.
    """
    k = np.arange(914_000, 916_001)
    a = -np.minimum(np.maximum(np.abs(k - 915_000) - 240, 0), 60).astype(float)
    r = evaluate(Trace(f=k / 1000, a=a, rbw=100e3), HalowConfig(antenna_gain_dbi=GAIN_DBI, ndb=20))
    assert r.check("bandwidth").value == pytest.approx(492e3, abs=1e-3)
    assert r.check("bandwidth").passed is False
    assert r.check("ndb").value == pytest.approx(520e3, abs=1e-3)
    assert r.verdict == "FAIL"
