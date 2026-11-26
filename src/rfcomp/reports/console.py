"""Plain-text and JSON rendering of a Result (CLI output).

Display rounding only: dB values to 0.01 dB, bandwidths to 1 Hz (shown in kHz). Verdicts come from
the full-precision comparison in the tech module.
"""

from __future__ import annotations

from typing import Any

from rfcomp.core.result import Check, Result

DISCLAIMER = (
    "Pre-compliance reference, not legal advice. "
    "Confirm against current eCFR and FCC KDB procedures."
)


def fmt(v: float | None, unit: str) -> str:
    """Format a value for display: Hz as kHz (3 dp), dB-like units 2 dp, kHz 3 dp."""
    if v is None:
        return "—"
    if unit == "Hz":
        return f"{v / 1e3:.3f} kHz"
    if unit == "kHz":
        return f"{v:.3f} kHz"
    return f"{v:.2f} {unit}"


def margin_unit(unit: str) -> str:
    """A margin between two dBm (or dBc) levels is in dB."""
    return "dB" if unit.startswith(("dBm", "dBc")) else unit


def status(c: Check) -> str:
    if c.passed is None:
        return "INFO" if c.value is not None else "N/A"
    return "PASS" if c.passed else "FAIL"


def _label(c: Check) -> str:
    return c.label + (" [RF review]" if c.review else "")


def cells(c: Check) -> tuple[str, str, str]:
    """(value, limit, margin) display text for one check."""
    d = c.detail
    if d.get("key") == "bw_containment":
        # markers and band in MHz; margin is the clearance to the nearer band edge
        band = f"{float(d['loMHz']):.3f}–{float(d['hiMHz']):.3f} MHz"  # type: ignore[arg-type]
        if c.passed is None:
            return "—", band, "—"
        markers = f"M1 {float(d['m1MHz']):.3f} / M2 {float(d['m2MHz']):.3f} MHz"  # type: ignore[arg-type]
        return markers, band, fmt(c.margin, c.unit)
    return fmt(c.value, c.unit), fmt(c.limit, c.unit), fmt(c.margin, margin_unit(c.unit))


def table(result: Result, header: list[str] | None = None) -> str:
    rows = [("Check", "Value", "Limit", "Margin", "Result", "Cite")]
    for c in result.checks:
        rows.append((_label(c), *cells(c), status(c), c.cite))
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    right = {1, 2, 3}

    def line(r: tuple[str, ...]) -> str:
        cells = [r[i].rjust(w) if i in right else r[i].ljust(w) for i, w in enumerate(widths)]
        return "  ".join(cells).rstrip()

    out = list(header or [])
    out += [line(rows[0]), "  ".join("-" * w for w in widths)]
    out += [line(r) for r in rows[1:]]
    notes = [f"  {c.label}: {c.note}" for c in result.checks if c.note]
    if notes:
        out += ["", "Notes:", *notes]
    out += ["", f"Overall: {result.verdict}", "", DISCLAIMER]
    return "\n".join(out)


def as_json(result: Result, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        **(extra or {}),
        "tech": result.tech,
        "verdict": result.verdict,
        "checks": [{**c.model_dump(), "status": status(c)} for c in result.checks],
        "disclaimer": DISCLAIMER,
    }
