"""`rfcomp analyze` on the example traces (golden 6 dB boundary pair)."""

from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from rfcomp.cli import app

EX = Path(__file__).parents[1] / "examples" / "halow"
PASS = EX / "halow_bw6_500p5khz_pass.csv"
FAIL = EX / "halow_bw6_499p5khz_fail.csv"
runner = CliRunner()


def run(*args: str):
    return runner.invoke(app, ["analyze", *args])


def test_pass_exits_0_and_prints_table() -> None:
    r = run(str(PASS), "--tech", "halow", "--antenna-gain", "6")
    assert r.exit_code == 0, r.output
    assert "Overall: PASS" in r.output
    assert "500.500 kHz" in r.output and "47 CFR §15.247(a)(2)" in r.output
    assert "-15.23 dBm/3kHz" in r.output  # 0.01 dB display
    assert "Pre-compliance reference, not legal advice." in r.output


def test_fail_exits_1() -> None:
    r = run(str(FAIL), "--tech", "halow", "--antenna-gain", "6")
    assert r.exit_code == 1
    assert "Overall: FAIL" in r.output
    assert "-0.500 kHz" in r.output


def test_json_output() -> None:
    r = run(str(FAIL), "--tech", "halow", "--antenna-gain", "12.5", "--json")
    assert r.exit_code == 1
    d = json.loads(r.output)
    assert d["verdict"] == "FAIL"
    power = next(c for c in d["checks"] if c["detail"].get("key") == "power")
    assert power["limit"] == 23.5
    assert {"value", "limit", "margin", "passed", "cite", "status"} <= power.keys()
    assert d["settings"]["antennaGainDbi"] == 12.5


def test_ndb_20_adds_reported_row_and_options_apply() -> None:
    r = run(
        str(PASS),
        "--tech",
        "halow",
        "--antenna-gain",
        "6",
        "--ndb",
        "20",
        "--method",
        "average",
        "--rbw",
        "30",
        "--offset",
        "3",
        "--center",
        "915",
        "--json",
    )
    d = json.loads(r.output)
    keys = [c["detail"]["key"] for c in d["checks"]]
    assert keys[:2] == ["bandwidth", "ndb"]
    psd = next(c for c in d["checks"] if c["detail"]["key"] == "psd")
    assert psd["detail"]["rbwHz"] == 30e3
    # +3 dB offset and 30 kHz RBW: peak 3 dBm − 10·log10(10) = −7 dBm/3 kHz
    assert abs(psd["value"] - (-7.0)) < 1e-9
    assert d["settings"]["bandEdgeMethod"] == "average"


def test_antenna_gain_required() -> None:
    r = run(str(PASS), "--tech", "halow")
    assert r.exit_code == 2


def test_bad_ndb_and_bad_trace_exit_2(tmp_path: Path) -> None:
    assert run(str(PASS), "--tech", "halow", "--antenna-gain", "6", "--ndb", "10").exit_code == 2
    bad = tmp_path / "short.csv"
    bad.write_text("915,-10\n" * 5)
    r = run(str(bad), "--tech", "halow", "--antenna-gain", "6")
    assert r.exit_code == 2
    assert "Need at least 10 data rows" in r.output
