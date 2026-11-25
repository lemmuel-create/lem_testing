"""YAML limits must reproduce legacy RF.limits exactly; every file carries cite/verified/review."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

from rfcomp.limits import TECH_FILES, load

SNAPSHOT = Path(__file__).parent / "golden" / "core" / "limits.json"


def _diff(exp: Any, got: Any, path: str = "RF.limits") -> list[str]:
    """Strict structural diff: same keys, lengths, values and JSON types (int ≠ float ≠ bool)."""
    if type(exp) is not type(got):
        return [f"{path}: type {type(got).__name__} != {type(exp).__name__} ({got!r} vs {exp!r})"]
    if isinstance(exp, dict):
        out = [f"{path}.{k}: missing" for k in exp.keys() - got.keys()]
        out += [f"{path}.{k}: unexpected" for k in got.keys() - exp.keys()]
        for k in exp.keys() & got.keys():
            out += _diff(exp[k], got[k], f"{path}.{k}")
        return out
    if isinstance(exp, list):
        if len(exp) != len(got):
            return [f"{path}: length {len(got)} != {len(exp)}"]
        return [
            d
            for i, (e, g) in enumerate(zip(exp, got, strict=True))
            for d in _diff(e, g, f"{path}[{i}]")
        ]
    return [] if exp == got else [f"{path}: {got!r} != {exp!r}"]


def test_yaml_equals_legacy_snapshot() -> None:
    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))["snapshot"]
    assert _diff(snapshot, load().as_legacy()) == []


def test_version_matches_snapshot() -> None:
    meta = json.loads(SNAPSHOT.read_text(encoding="utf-8"))["meta"]
    assert load().version == meta["limitsVersion"]


def test_every_file_has_cite_verified_review() -> None:
    limits = load()
    assert set(limits.files) == set(TECH_FILES)
    for name, f in limits.files.items():
        assert f.meta.cite.strip(), name
        assert isinstance(f.meta.verified, dt.date), name
        assert isinstance(f.meta.review, bool), name
        assert f.sections, f"{name}.yaml has no sections"


def test_formula_parameters_have_cites() -> None:
    limits = load()
    for p in (
        limits.mpe,
        limits.mpe_table,
        limits.sar_exemption,
        limits.unii_channel_center,
        limits.lte_mask_attenuation,
        limits.cbrs_total_eirp,
        limits.bw_containment,
        limits.dts_bandwidth,
    ):
        assert p.cite.strip()


def test_bw_containment_references_ism900_band() -> None:
    limits = load()
    band = limits.fcc["ism900"]["band"]
    assert limits.bw_containment_band() == (band["loMHz"], band["hiMHz"])
    assert limits.bw_containment.review is True
