"""Command-line interface for rfcomp."""

from __future__ import annotations

import json
from enum import StrEnum
from pathlib import Path
from typing import Annotated

import typer

from rfcomp import __version__
from rfcomp.core.trace import parse_trace
from rfcomp.reports.console import as_json, table
from rfcomp.techs import halow

app = typer.Typer(help="RF compliance analysis toolkit.", no_args_is_help=True)


class Tech(StrEnum):
    halow = "halow"


class Method(StrEnum):
    peak = "peak"
    average = "average"


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
    rbw: Annotated[float, typer.Option(help="RBW the trace was taken with, kHz.")] = 100.0,
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
    try:
        t = parse_trace(trace.read_text(encoding="utf-8", errors="replace"), units, offset)
    except ValueError as e:
        typer.echo(f"Error: {trace}: {e}", err=True)
        raise typer.Exit(2) from e
    cfg = halow.HalowConfig(
        antenna_gain_dbi=antenna_gain,
        ndb=ndb,
        band_edge_method=method.value,
        rbw_hz=rbw * 1e3,
    )
    result = halow.evaluate(t, cfg)

    bw = result.check("bandwidth").detail
    measured_c = (float(bw["m1MHz"]) + float(bw["m2MHz"])) / 2
    settings = {
        "trace": str(trace),
        "points": int(len(t.f)),
        "spanMHz": [float(t.f[0]), float(t.f[-1])],
        "rbwKHz": rbw,
        "offsetDb": offset,
        "antennaGainDbi": antenna_gain,
        "ndb": ndb,
        "bandEdgeMethod": method.value,
        "centerMHz": center,
        "measuredCenterMHz": measured_c,
    }
    if json_out:
        typer.echo(json.dumps(as_json(result, {"settings": settings}), indent=2))
    else:
        header = [
            f"rfcomp {__version__} · {tech.value} · {trace.name}",
            f"{len(t.f)} points, {t.f[0]:.4f}–{t.f[-1]:.4f} MHz, RBW {rbw:g} kHz, "
            f"offset {offset:g} dB, antenna {antenna_gain:g} dBi, band edge {method.value} method",
        ]
        c_line = f"Measured 6 dB centre {measured_c:.4f} MHz"
        if center is not None:
            c_line += f" ({(measured_c - center) * 1e3:+.1f} kHz from --center {center:g} MHz)"
        header += [c_line, ""]
        typer.echo(table(result, header))
    raise typer.Exit(0 if result.passed else 1)


if __name__ == "__main__":
    app()
