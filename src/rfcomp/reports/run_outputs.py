"""Per-run output folder and the shared runs log.

Each `rfcomp analyze` run writes `<out>/<run_id>/` with plot.png, checks.csv, run.json and
trace_used.csv, and appends one row to `<out>/runs_log.csv`.
"""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np

from rfcomp.core.result import Result
from rfcomp.reports.console import as_json, status

CHECKS_COLUMNS = [
    "run_id",
    "check",
    "value",
    "unit",
    "limit",
    "margin",
    "result",
    "cite",
    "review",
    "note",
]
LOG_COLUMNS = [
    "run_id",
    "timestamp_local",
    "timestamp_utc",
    "operator",
    "dut",
    "center_MHz",
    "notes",
    "tech",
    "input_file",
    "input_sha256",
    "points",
    "span_start_MHz",
    "span_stop_MHz",
    "rbw_kHz",
    "rbw_source",
    "offset_dB",
    "antenna_gain_dBi",
    "method",
    "verdict",
    "n_fail",
    "rfcomp_version",
    "git_commit",
    "limits_version",
]
LOG_NAME = "runs_log.csv"


@dataclass(frozen=True)
class RunMeta:
    run_id: str
    timestamp_local: str
    timestamp_utc: str
    operator: str
    dut: str
    center_MHz: float | None
    notes: str
    tech: str
    input_file: str
    input_sha256: str
    points: int
    span_start_MHz: float
    span_stop_MHz: float
    rbw_kHz: float
    rbw_source: str  # "flag" | "file"
    offset_dB: float
    antenna_gain_dBi: float
    method: str
    verdict: str
    n_fail: int
    rfcomp_version: str
    git_commit: str
    limits_version: str


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def git_commit() -> str:
    """Short commit of the rfcomp source tree, or 'unknown' (not a checkout, git missing...)."""
    try:
        out = subprocess.run(
            ["git", "-C", str(Path(__file__).resolve().parent), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        )
        return out.stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def default_run_name(now: dt.datetime, tech: str, input_file: Path) -> str:
    return f"{now:%Y-%m-%d_%H%M}_{tech}_{input_file.stem}"


def unique_dir(out: Path, name: str) -> Path:
    """`out/name`, or `out/name_2`, `_3`... if a run already used that folder."""
    d, i = out / name, 2
    while d.exists():
        d, i = out / f"{name}_{i}", i + 1
    return d


def _num(v: float | None) -> str:
    return "" if v is None else repr(float(v))


def write_checks_csv(path: Path, run_id: str, result: Result) -> None:
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(CHECKS_COLUMNS)
        for c in result.checks:
            w.writerow(
                [
                    run_id,
                    c.label,
                    _num(c.value),
                    c.unit,
                    _num(c.limit),
                    _num(c.margin),
                    status(c),
                    c.cite,
                    str(c.review).lower(),
                    c.note or "",
                ]
            )


def write_trace_csv(path: Path, f: np.ndarray, a: np.ndarray) -> None:
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["freq_MHz", "amp_dBm"])
        for x, y in zip(f.tolist(), a.tolist(), strict=True):
            w.writerow([repr(x), repr(y)])


def append_log(out: Path, meta: RunMeta) -> Path:
    path = out / LOG_NAME
    new = not path.exists() or path.stat().st_size == 0
    row = asdict(meta)
    row["center_MHz"] = "" if meta.center_MHz is None else meta.center_MHz
    with open(path, "a", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=LOG_COLUMNS)
        if new:
            w.writeheader()
        w.writerow(row)
    return path


def write_run(
    run_dir: Path,
    meta: RunMeta,
    result: Result,
    f: np.ndarray,
    a: np.ndarray,
    settings: dict[str, Any],
    *,
    plot: bool = True,
) -> Path:
    """Write the run folder and append to the runs log in its parent. Returns the folder."""
    run_dir.mkdir(parents=True, exist_ok=False)
    write_checks_csv(run_dir / "checks.csv", meta.run_id, result)
    write_trace_csv(run_dir / "trace_used.csv", f, a)
    doc = as_json(result, {"run": asdict(meta), "settings": settings})
    (run_dir / "run.json").write_text(
        json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    if plot:
        from rfcomp.reports.plot import plot_run  # matplotlib only when plotting

        plot_run(
            run_dir / "plot.png",
            f,
            a,
            result,
            title=f"{meta.tech.upper()} · {Path(meta.input_file).name}"
            + (f" · {meta.dut}" if meta.dut else ""),
            footer=f"run_id {meta.run_id} · {meta.timestamp_local} · rfcomp {meta.rfcomp_version}"
            f" ({meta.git_commit}) · limits {meta.limits_version} · input {meta.input_file}",
        )
    append_log(run_dir.parent, meta)
    return run_dir
