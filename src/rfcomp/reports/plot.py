"""Analyzer-style PNG of a HaLow run: trace, band, markers, limit lines and a results box.

Every limit drawn comes from the Result (check limits and details), which in turn come from
limits/*.yaml; nothing regulatory is hard-coded here.
"""

from __future__ import annotations

import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from rfcomp.core.result import Check, Result  # noqa: E402
from rfcomp.reports.console import DISCLAIMER, fmt, margin_unit, status  # noqa: E402

WIDTH_PX, HEIGHT_PX, DPI = 1600, 900, 150
COLORS = {
    "trace": "#2a78d6",
    "band": "#1b8a3a",
    "limit": "#c93434",
    "marker6": "#d98a00",
    "marker20": "#7b4bc4",
    "obw": "#8a8984",
    "psd": "#c93434",
    "PASS": "#1b8a3a",
    "FAIL": "#c93434",
    "INFO": "#55544f",
    "N/A": "#8a8984",
}


def _margin_text(c: Check) -> str:
    return fmt(c.margin, margin_unit(c.unit)) if c.margin is not None else "—"


def plot_run(
    path: Path,
    f: np.ndarray,
    a: np.ndarray,
    result: Result,
    *,
    title: str,
    footer: str,
) -> Path:
    """Write the run plot to `path` (PNG, 1600×900 at 150 dpi)."""
    bw = result.check("bandwidth")
    obw = result.check("obw")
    psd = result.check("psd")
    be = result.check("band_edge")
    bc = result.check("bw_containment")
    pk = float(bw.detail["peakDbm"])  # type: ignore[arg-type]
    lo, hi = float(be.detail["loMHz"]), float(be.detail["hiMHz"])  # type: ignore[arg-type]
    f0, f1 = float(f[0]), float(f[-1])

    fig = plt.figure(figsize=(WIDTH_PX / DPI, HEIGHT_PX / DPI), dpi=DPI)
    ax = fig.add_axes((0.065, 0.13, 0.62, 0.76))
    box = fig.add_axes((0.71, 0.13, 0.28, 0.76))
    box.axis("off")

    # band and its edges
    ax.axvspan(max(lo, f0), min(hi, f1), color=COLORS["band"], alpha=0.06, lw=0, zorder=0)
    for edge in (lo, hi):
        if f0 <= edge <= f1:
            ax.axvline(edge, color=COLORS["band"], ls="--", lw=1)
            ax.annotate(
                f"{edge:g} MHz",
                (edge, 1),
                xycoords=("data", "axes fraction"),
                xytext=(3, -12),
                textcoords="offset points",
                fontsize=7,
                color=COLORS["band"],
            )

    # 99% OBW
    o_l, o_r = float(obw.detail["oLMHz"]), float(obw.detail["oRMHz"])  # type: ignore[arg-type]
    ax.axvspan(
        o_l,
        o_r,
        color=COLORS["obw"],
        alpha=0.10,
        lw=0,
        zorder=0.5,
        label=f"99% OBW {fmt(obw.value, obw.unit)}",
    )
    for x in (o_l, o_r):
        ax.axvline(x, color=COLORS["obw"], ls=(0, (1, 2)), lw=0.8, zorder=0.6)

    # trace
    ax.plot(f, a, color=COLORS["trace"], lw=1, label="Trace (offset applied)", zorder=2)

    # band-edge limit (outside the band only)
    req = float(be.detail["requiredDbc"])  # type: ignore[arg-type]
    be_level = pk - req
    drew_be = False
    for x0, x1 in ((f0, min(lo, f1)), (max(hi, f0), f1)):
        if x1 > x0:
            ax.hlines(
                be_level,
                x0,
                x1,
                color=COLORS["limit"],
                lw=1.4,
                label=None if drew_be else f"Band-edge limit: peak − {req:g} dBc",
            )
            drew_be = True

    # PSD limit at the trace RBW
    rbw = float(psd.detail["rbwHz"])  # type: ignore[arg-type]
    ref = float(psd.detail["refHz"])  # type: ignore[arg-type]
    psd_level = float(psd.limit) + 10 * math.log10(rbw / ref)  # type: ignore[arg-type]
    ax.axhline(
        psd_level,
        color=COLORS["psd"],
        ls=":",
        lw=1.2,
        label=f"PSD limit at RBW {rbw / 1e3:g} kHz: {psd_level:.2f} dBm",
    )

    # 6 dB markers
    n6 = float(bw.detail["nDb"])  # type: ignore[arg-type]
    m1, m2 = float(bw.detail["m1MHz"]), float(bw.detail["m2MHz"])  # type: ignore[arg-type]
    th6 = pk - n6
    ax.plot(
        [m1, m2], [th6, th6], "v", color=COLORS["marker6"], ms=7, zorder=3, label=f"{n6:g} dB M1/M2"
    )
    ax.annotate(
        "",
        (m1, th6 - 4),
        (m2, th6 - 4),
        arrowprops={"arrowstyle": "<->", "color": COLORS["marker6"], "lw": 1},
    )
    ax.annotate(
        f"{n6:g} dB BW {fmt(bw.value, bw.unit)} vs {fmt(bw.limit, bw.unit)} ({status(bw)})",
        ((m1 + m2) / 2, th6 - 4),
        xytext=(0, -12),
        textcoords="offset points",
        ha="center",
        fontsize=8,
        color=COLORS[status(bw)],
    )

    # 20 dB markers (only when found inside the span)
    if not bc.detail.get("clipped"):
        n20 = float(bc.detail["nDb"])  # type: ignore[arg-type]
        b1, b2 = float(bc.detail["m1MHz"]), float(bc.detail["m2MHz"])  # type: ignore[arg-type]
        ax.plot(
            [b1, b2],
            [pk - n20, pk - n20],
            "^",
            color=COLORS["marker20"],
            ms=7,
            zorder=3,
            label=f"{n20:g} dB M1/M2 ({b1:.3f} / {b2:.3f} MHz)",
        )

    top = math.ceil((max(pk, psd_level) + 8) / 10) * 10
    bottom = max(math.floor((float(np.min(a)) - 5) / 10) * 10, top - 110)
    ax.set_ylim(bottom, top)
    ax.set_xlim(f0, f1)
    ax.set_xlabel("Frequency (MHz)")
    ax.set_ylabel(f"Amplitude (dBm in {rbw / 1e3:g} kHz RBW)")
    ax.grid(True, color="#e3e2dc", lw=0.6)
    ax.legend(loc="upper right", fontsize=6.5, framealpha=0.9)

    # results box
    rows = [
        (c.label + (" †" if c.review else ""), _margin_text(c), status(c)) for c in result.checks
    ]
    box.text(0, 1, "Check", fontsize=8, weight="bold", va="top")
    box.text(0.80, 1, "Margin", fontsize=8, weight="bold", va="top", ha="right")
    box.text(0.84, 1, "Result", fontsize=8, weight="bold", va="top")
    for i, (label, margin, st) in enumerate(rows):
        y = 0.93 - i * 0.07
        box.text(0, y, label, fontsize=7.5, va="top")
        box.text(0.80, y, margin, fontsize=7.5, va="top", ha="right")
        box.text(0.84, y, st, fontsize=7.5, va="top", weight="bold", color=COLORS[st])
    y = 0.93 - len(rows) * 0.07 - 0.03
    box.text(
        0,
        y,
        f"Overall: {result.verdict}",
        fontsize=11,
        weight="bold",
        va="top",
        color=COLORS[result.verdict],
    )
    notes = [f"• {c.label}: {c.note}" for c in result.checks if c.note]
    if any(c.review for c in result.checks):
        notes.append("† limit pending RF review")
    if notes:
        box.text(0, y - 0.08, "\n".join(notes), fontsize=6.3, va="top", wrap=True, color="#55544f")

    fig.suptitle(
        f"{title} — {result.verdict}",
        fontsize=12,
        weight="bold",
        color=COLORS[result.verdict],
        x=0.065,
        ha="left",
        y=0.965,
    )
    fig.text(0.065, 0.045, footer, fontsize=6.5, color="#55544f")
    fig.text(0.065, 0.02, DISCLAIMER, fontsize=6.5, color="#8a8984")
    fig.savefig(path, dpi=DPI)
    plt.close(fig)
    return path
