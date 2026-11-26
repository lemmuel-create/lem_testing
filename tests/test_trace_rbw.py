"""RBW from analyzer export headers."""

from __future__ import annotations

import pytest

from rfcomp.core.trace import parse_rbw_hz


@pytest.mark.parametrize(
    ("text", "hz"),
    [
        ("RBW,30000\n915,-10", 30e3),  # Keysight
        ("Resolution Bandwidth,30000,Hz\n", 30e3),
        ('"RBW","30000"\n', 30e3),
        ("RBW;30000;Hz;\n", 30e3),  # R&S
        ("Res BW (kHz): 30\n", 30e3),
        ("RBW: 100 kHz\n", 100e3),
        ("Res BW,1e5\n", 100e3),
        ("rbw = 1 MHz\n", 1e6),
        ("VBW,300000\n915,-10\n", None),
        ("915,-10\n916,-12\n", None),
        ("RBW,30000\nRBW,30000\n", 30e3),
    ],
)
def test_parse_rbw(text: str, hz: float | None) -> None:
    assert parse_rbw_hz(text) == hz


def test_conflicting_rbw_lines_raise() -> None:
    with pytest.raises(ValueError, match="more than one RBW"):
        parse_rbw_hz("RBW,30000\nRBW,100000\n")
