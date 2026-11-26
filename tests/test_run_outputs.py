"""Run folders and runs_log.csv written by `rfcomp analyze`."""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from rfcomp import __version__
from rfcomp.cli import app
from rfcomp.limits import load
from rfcomp.reports.run_outputs import CHECKS_COLUMNS, LOG_COLUMNS

EX = Path(__file__).parents[1] / "examples" / "halow"
PASS = EX / "halow_bw6_500p5khz_pass.csv"
FAIL = EX / "halow_bw6_499p5khz_fail.csv"
EDGE_FAIL = EX / "halow_sim_1mhz_902p5_24dbm_fail.csv"  # RBW in the file header
runner = CliRunner()


def analyze(out: Path, trace: Path, *extra: str):
    args = ["analyze", str(trace), "--tech", "halow", "--antenna-gain", "6", "--out", str(out)]
    if trace != EDGE_FAIL:
        args += ["--rbw", "100"]
    return runner.invoke(app, [*args, *extra])


def rows(path: Path) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def header(path: Path) -> list[str]:
    with open(path, newline="", encoding="utf-8") as fh:
        return next(csv.reader(fh))


def run_dirs(out: Path) -> list[Path]:
    return sorted(p for p in out.iterdir() if p.is_dir())


def test_run_folder_files_and_columns(tmp_path: Path) -> None:
    r = analyze(
        tmp_path,
        PASS,
        "--operator",
        "alex",
        "--dut",
        "DUT-7",
        "--notes",
        "bench 2",
        "--center",
        "915",
    )
    assert r.exit_code == 0, r.output
    (d,) = run_dirs(tmp_path)
    assert d.name.endswith("_halow_halow_bw6_500p5khz_pass")
    assert f"Results: {d}" in r.output
    assert {p.name for p in d.iterdir()} == {"plot.png", "checks.csv", "run.json", "trace_used.csv"}

    assert header(d / "checks.csv") == CHECKS_COLUMNS
    checks = rows(d / "checks.csv")
    assert [c["check"] for c in checks][0] == "6 dB bandwidth"
    assert all(c["run_id"] == d.name for c in checks)

    assert header(d / "trace_used.csv") == ["freq_MHz", "amp_dBm"]
    assert len(rows(d / "trace_used.csv")) == 2001

    doc = json.loads((d / "run.json").read_text(encoding="utf-8"))
    assert doc["verdict"] == "PASS" and doc["run"]["run_id"] == d.name
    assert len(doc["checks"]) == len(checks)

    assert header(tmp_path / "runs_log.csv") == LOG_COLUMNS
    (log,) = rows(tmp_path / "runs_log.csv")
    assert log["run_id"] == d.name
    assert (log["operator"], log["dut"], log["notes"], log["center_MHz"]) == (
        "alex",
        "DUT-7",
        "bench 2",
        "915.0",
    )
    assert log["verdict"] == "PASS" and log["n_fail"] == "0"
    assert log["rbw_source"] == "flag" and log["rbw_kHz"] == "100.0"
    assert log["points"] == "2001"
    assert (log["span_start_MHz"], log["span_stop_MHz"]) == ("914.0", "916.0")
    assert log["rfcomp_version"] == __version__
    assert log["limits_version"] == load().version
    assert log["git_commit"]  # short hash or "unknown"


def test_input_sha256_matches_file(tmp_path: Path) -> None:
    analyze(tmp_path, PASS)
    (log,) = rows(tmp_path / "runs_log.csv")
    assert log["input_sha256"] == hashlib.sha256(PASS.read_bytes()).hexdigest()


def test_runs_log_appends_one_row_per_run(tmp_path: Path) -> None:
    analyze(tmp_path, PASS)
    analyze(tmp_path, FAIL)
    log = rows(tmp_path / "runs_log.csv")
    assert len(log) == 2
    assert [r["verdict"] for r in log] == ["PASS", "FAIL"]
    text = (tmp_path / "runs_log.csv").read_text(encoding="utf-8")
    assert text.count("run_id,timestamp_local") == 1  # header written once


def test_same_minute_same_file_gets_unique_folder(tmp_path: Path) -> None:
    analyze(tmp_path, PASS, "--out-dir-name", "bench")
    analyze(tmp_path, PASS, "--out-dir-name", "bench")
    assert [d.name for d in run_dirs(tmp_path)] == ["bench", "bench_2"]
    assert [r["run_id"] for r in rows(tmp_path / "runs_log.csv")] == ["bench", "bench_2"]


def test_plot_exists_and_is_non_empty(tmp_path: Path) -> None:
    analyze(tmp_path, EDGE_FAIL)
    (d,) = run_dirs(tmp_path)
    png = (d / "plot.png").read_bytes()
    assert len(png) > 10_000 and png[:8] == b"\x89PNG\r\n\x1a\n"
    # 1600 x 900 (IHDR width/height)
    assert int.from_bytes(png[16:20], "big") == 1600
    assert int.from_bytes(png[20:24], "big") == 900


def test_no_plot(tmp_path: Path) -> None:
    analyze(tmp_path, PASS, "--no-plot")
    (d,) = run_dirs(tmp_path)
    assert not (d / "plot.png").exists()
    assert (d / "checks.csv").exists()


def test_fail_run_checks_csv_shows_failing_check(tmp_path: Path) -> None:
    r = analyze(tmp_path, FAIL)
    assert r.exit_code == 1
    (d,) = run_dirs(tmp_path)
    failed = [c for c in rows(d / "checks.csv") if c["result"] == "FAIL"]
    assert [c["check"] for c in failed] == ["6 dB bandwidth"]
    assert failed[0]["value"].startswith("499499.99")
    assert failed[0]["limit"] == "500000.0"
    assert float(failed[0]["margin"]) < 0
    assert failed[0]["cite"] == "47 CFR §15.247(a)(2)"
    (log,) = rows(tmp_path / "runs_log.csv")
    assert log["verdict"] == "FAIL" and log["n_fail"] == "1"


def test_edge_fail_run_uses_file_rbw_and_logs_two_failures(tmp_path: Path) -> None:
    r = analyze(tmp_path, EDGE_FAIL)
    assert r.exit_code == 1
    (d,) = run_dirs(tmp_path)
    failed = {c["check"] for c in rows(d / "checks.csv") if c["result"] == "FAIL"}
    assert failed == {"Band edge (peak)", "20 dB BW in band"}
    (log,) = rows(tmp_path / "runs_log.csv")
    assert log["rbw_source"] == "file" and log["n_fail"] == "2"


def test_trace_used_has_offset_applied(tmp_path: Path) -> None:
    analyze(tmp_path, PASS, "--offset", "10")
    (d,) = run_dirs(tmp_path)
    used = rows(d / "trace_used.csv")
    src = PASS.read_text().splitlines()
    f0, a0 = (float(x) for x in src[0].split(","))
    assert float(used[0]["freq_MHz"]) == f0
    assert float(used[0]["amp_dBm"]) == a0 + 10


@pytest.mark.parametrize("bad", ["../escape", "a/b", " "])
def test_out_dir_name_must_be_plain(tmp_path: Path, bad: str) -> None:
    assert analyze(tmp_path, PASS, "--out-dir-name", bad).exit_code == 2
