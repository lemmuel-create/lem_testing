"""`rfcomp analyze` on the example traces (golden 6 dB boundary pair)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from rfcomp.cli import app

EX = Path(__file__).parents[1] / "examples" / "halow"
PASS = EX / "halow_bw6_500p5khz_pass.csv"
FAIL = EX / "halow_bw6_499p5khz_fail.csv"
runner = CliRunner()


@pytest.fixture(autouse=True)
def _run_in_tmp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """analyze writes results/ in the working directory; keep it out of the repo."""
    monkeypatch.chdir(tmp_path)


def run(*args: str):
    return runner.invoke(app, ["analyze", *args])


def test_pass_exits_0_and_prints_table() -> None:
    r = run(str(PASS), "--tech", "halow", "--antenna-gain", "6", "--rbw", "100")
    assert r.exit_code == 0, r.output
    assert "Overall: PASS" in r.output
    assert "500.500 kHz" in r.output and "47 CFR §15.247(a)(2)" in r.output
    assert "-15.23 dBm/3kHz" in r.output  # 0.01 dB display
    assert "Pre-compliance reference, not legal advice." in r.output


def test_fail_exits_1() -> None:
    r = run(str(FAIL), "--tech", "halow", "--antenna-gain", "6", "--rbw", "100")
    assert r.exit_code == 1
    assert "Overall: FAIL" in r.output
    assert "-0.500 kHz" in r.output


def test_json_output() -> None:
    r = run(str(FAIL), "--tech", "halow", "--antenna-gain", "12.5", "--rbw", "100", "--json")
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
    r = run(str(PASS), "--tech", "halow", "--rbw", "100")
    assert r.exit_code == 2


def test_bad_ndb_and_bad_trace_exit_2(tmp_path: Path) -> None:
    args = ("--tech", "halow", "--antenna-gain", "6", "--rbw", "100")
    assert run(str(PASS), *args, "--ndb", "10").exit_code == 2
    bad = tmp_path / "short.csv"
    bad.write_text("915,-10\n" * 5)
    r = run(str(bad), *args)
    assert r.exit_code == 2
    assert "Need at least 10 data rows" in r.output


def _with_header(tmp_path: Path, header: str) -> Path:
    p = tmp_path / "keysight.csv"
    p.write_text(header + PASS.read_text())
    return p


def test_rbw_required_without_file_header() -> None:
    r = run(str(PASS), "--tech", "halow", "--antenna-gain", "6")
    assert r.exit_code == 2
    assert "does not state an RBW; pass --rbw" in r.output


def test_rbw_from_file_header(tmp_path: Path) -> None:
    p = _with_header(tmp_path, "RBW,30000\n")
    r = run(str(p), "--tech", "halow", "--antenna-gain", "6")
    assert r.exit_code == 0, r.output
    assert "RBW 30 kHz (from file)" in r.output
    d = json.loads(run(str(p), "--tech", "halow", "--antenna-gain", "6", "--json").output)
    assert d["settings"]["rbwKHz"] == 30 and d["settings"]["rbwSource"] == "file"


def test_rbw_file_and_option_agree(tmp_path: Path) -> None:
    p = _with_header(tmp_path, "Resolution Bandwidth,30000,Hz\n")
    r = run(str(p), "--tech", "halow", "--antenna-gain", "6", "--rbw", "30")
    assert r.exit_code == 0
    assert "RBW 30 kHz (from file)" in r.output


def test_rbw_file_and_option_disagree(tmp_path: Path) -> None:
    p = _with_header(tmp_path, "RBW,30000\n")
    r = run(str(p), "--tech", "halow", "--antenna-gain", "6", "--rbw", "100")
    assert r.exit_code == 2
    assert "RBW mismatch: the file states 30 kHz but --rbw is 100 kHz" in r.output


def test_bw_containment_row_shows_markers_and_clearance() -> None:
    r = run(str(PASS), "--tech", "halow", "--antenna-gain", "6", "--rbw", "100")
    row = next(line for line in r.output.splitlines() if line.startswith("20 dB BW in band"))
    assert "M1 914.726 / M2 915.274 MHz" in row
    assert "902.000–928.000 MHz" in row
    assert "12726.417 kHz" in row and "PASS" in row


def test_clipped_trace_shows_na_and_notes(tmp_path: Path) -> None:
    p = tmp_path / "narrow_span.csv"
    p.write_text(
        "".join(
            f"{914.8 + i * 0.004:.3f},{-3 * abs(914.8 + i * 0.004 - 915):.4f}\n" for i in range(101)
        )
    )
    r = run(str(p), "--tech", "halow", "--antenna-gain", "6", "--rbw", "100")
    row = next(line for line in r.output.splitlines() if line.startswith("20 dB BW in band"))
    assert "N/A" in row
    assert "Widen the span: 20 dB points not found" in r.output
    assert "Span may not contain the full signal; channel power may read low" in r.output
