"""rfcomp.techs: one module per technology, each exposing `evaluate(trace, cfg) -> Result`."""

from __future__ import annotations

from collections.abc import Callable

from rfcomp.core.result import Result
from rfcomp.techs import halow

REGISTRY: dict[str, Callable[..., Result]] = {
    "halow": halow.evaluate,
}

__all__ = ["REGISTRY", "halow"]
