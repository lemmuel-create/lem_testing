"""Command-line interface for rfcomp."""

from __future__ import annotations

import json
import math
from enum import StrEnum
from pathlib import Path
from typing import Annotated, NoReturn

import typer

from rfcomp import __version__
from rfcomp.core.trace import parse_rbw_hz, parse_trace
from rfcomp.reports.console import as_json, table
from rfcomp.techs import halow

app = typer.Typer(help="RF compliance analysis toolkit.", no_args_is_help=True)


class Tech(StrEnum):
    halow = "halow"


class Method(StrEnum):
    peak = "peak"
    average = "average"


def _fail(msg: str) -> NoReturn:
    """Report bad input on stderr and exit 2."""
    typer.echo(f"Error: {msg}", err=True)
    raise typer.Exit(2)


@app.callback()
def main() -> None:
    """RF compliance analysis toolkit."""


@app.command()
def version() -> None:
    """Print the rfcomp version."""
    typer.echo(__version__)


@app.command()
def analyze(
    trace: Annotated[
        Path,
        typer.Argument(
            help="Analyzer trace export (frequency, dBm per RBW).",
            exists=True,
            dir_okay=False,
            readable=True,
        ),
    ],
    tech: Annotated[Tech, typer.Option(help="Technology to evaluate.")],
    antenna_gain: Annotated[
        float, typer.Option("--antenna-gain", help="Antenna gain of the product, dBi (required).")
    ],
    center: Annotated[
        float | None, typer.Option(help="Nominal channel centre, MHz (reported, not a limit).")
    ] = None,
    ndb: Annotated[
        int,
        typer.Option(help="Extra n-dB bandwidth to report: 6, 20 or 26. The DTS check is 6 dB."),
    ] = 6,
    method: Annotated[
        Method, typer.Option(help="Band-edge method: peak or average.")
    ] = Method.peak,
    rbw: Annotated[
        float | None,
        typer.Option(
            help="RBW the trace was taken with, kHz. Required unless the file header states it; "
            "must agree with the file when both are given."
        ),
    ] = None,
    offset: Annotated[
        float, typer.Option(help="Reference offset added to the trace (cable/attenuator), dB.")
    ] = 0.0,
    units: Annotated[
        str, typer.Option(help="Frequency units: auto, or a multiplier to Hz (1, 1e3, 1e6, 1e9).")
    ] = "auto",
    json_out: Annotated[bool, typer.Option("--json", help="Print the result as JSON.")] = False,
) -> None:
    """Analyze a trace. Exit code 0 = PASS, 1 = FAIL, 2 = bad input."""
    if ndb not in (6, 20, 26):
        raise typer.BadParameter("must be 6, 20 or 26", param_hint="--ndb")
    text = trace.read_text(encoding="utf-8", errors="replace")
    try:
        t = parse_trace(text, units, offset)
        file_rbw_hz = parse_rbw_hz(text)
    except ValueError as e:
        _fail(f"{trace}: {e}")
    if file_rbw_hz is None and rbw is None:
        _fail(f"{trace}: the file does not state an RBW; pass --rbw <kHz>.")
    if (
        file_rbw_hz is not None
        and rbw is not None
        and not math.isclose(file_rbw_hz, rbw * 1e3, rel_tol=1e-9)
    ):
        _fail(
            f"{trace}: RBW mismatch: the file states {file_rbw_hz / 1e3:g} kHz "
            f"but --rbw is {rbw:g} kHz."
        )
    rbw_hz = file_rbw_hz if file_rbw_hz is not None else float(rbw or 0) * 1e3
    rbw_source = "file" if file_rbw_hz is not None else "--rbw"
    cfg = halow.HalowConfig(
        antenna_gain_dbi=antenna_gain,
        ndb=ndb,
        band_edge_method=method.value,
        rbw_hz=rbw_hz,
    )
    result = halow.evaluate(t, cfg)

    bw = result.check("bandwidth").detail
    measured_c = (float(bw["m1MHz"]) + float(bw["m2MHz"])) / 2
    settings = {
        "trace": str(trace),
        "points": int(len(t.f)),
        "spanMHz": [float(t.f[0]), float(t.f[-1])],
        "rbwKHz": rbw_hz / 1e3,
        "rbwSource": rbw_source,
        "offsetDb": offset,
        "antennaGainDbi": antenna_gain,
        "ndb": ndb,
        "bandEdgeMethod": method.value,
        "centerMHz": center,
        "measuredCenterMHz": measured_c,
    }
    if json_out:
        typer.echo(
            json.dumps(as_json(result, {"settings": settings}), indent=2, ensure_ascii=False)
        )
    else:
        header = [
            f"rfcomp {__version__} · {tech.value} · {trace.name}",
            f"{len(t.f)} points, {t.f[0]:.4f}–{t.f[-1]:.4f} MHz, "
            f"RBW {rbw_hz / 1e3:g} kHz (from {rbw_source}), offset {offset:g} dB, "
            f"antenna {antenna_gain:g} dBi, band edge {method.value} method",
        ]
        c_line = f"Measured 6 dB centre {measured_c:.4f} MHz"
        if center is not None:
            c_line += f" ({(measured_c - center) * 1e3:+.1f} kHz from --center {center:g} MHz)"
        header += [c_line, ""]
        typer.echo(table(result, header))
    raise typer.Exit(0 if result.passed else 1)


if __name__ == "__main__":
    app()
