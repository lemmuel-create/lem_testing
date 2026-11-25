"""Golden tests: the Python port must reproduce the legacy RF Lab JS (tests/golden/core/*.json).

Tolerances, per value:
  * legacy known-answer cases also re-apply the page's own check (expected ± tol);
  * against the captured legacy output: dB values 0.01 dB, frequencies 1 kHz (0.001 MHz / 1000 Hz),
    everything else 1e-6 relative. Strings, booleans, None and integers indices must match exactly.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from rfcomp.coloc import im, mpe, radios
from rfcomp.coloc.radios import Radio
from rfcomp.core import measure, trace, units
from rfcomp.limits import load as load_limits

GOLDEN = Path(__file__).parent / "golden" / "core"
FILES = ("rfmath", "coloc", "limits", "formulas")

DB_TOL, MHZ_TOL, HZ_TOL, REL_TOL = 0.01, 0.001, 1000.0, 1e-6


# --- loading --------------------------------------------------------------------------------------
def _dec(v: Any) -> Any:
    """Undo the golden encoding of non-finite numbers."""
    if v in ("Infinity", "-Infinity", "NaN"):
        return float(v.replace("Infinity", "inf"))
    if isinstance(v, list):
        return [_dec(x) for x in v]
    if isinstance(v, dict):
        return {k: _dec(x) for k, x in v.items()}
    return v


def _cases() -> list[Any]:
    out = []
    for name in FILES:
        for c in json.loads((GOLDEN / f"{name}.json").read_text(encoding="utf-8"))["cases"]:
            out.append(pytest.param(name, c, id=c["id"]))
    return out


# --- units for tolerance --------------------------------------------------------------------------
DB_FNS = {
    "mwToDbm", "sumDbm", "scaleToBw", "avgPsd", "eirp", "eirpToErp", "erpToEirp", "eirpToFieldDbuv",
    "fieldDbuvToEirp", "fspl", "channelPower", "interp", "expr",
}  # fmt: skip
MHZ_FNS = {"combo", "txRange", "channelCenterMHz"}
DB_KEYS = {"pk", "th", "n", "margin", "level", "max", "a"}
MHZ_KEYS = {
    "fL",
    "fR",
    "oL",
    "oR",
    "at",
    "f",
    "rng",
    "tx",
    "rx",
    "restricted",
    "fc",
    "bw",
    "bws",
    "lo",
    "hi",
}
HZ_KEYS = {"bwHz", "rbw"}
FN_KEY_UNITS = {("bandEdge", "lo"): "dB", ("bandEdge", "hi"): "dB", ("worstMargin", "limit"): "dB"}


def _unit(fn: str, key: str | None) -> str:
    if key is None:
        return "dB" if fn in DB_FNS else "MHz" if fn in MHZ_FNS else "rel"
    if (fn, key) in FN_KEY_UNITS:
        return FN_KEY_UNITS[(fn, key)]
    return (
        "dB" if key in DB_KEYS else "MHz" if key in MHZ_KEYS else "Hz" if key in HZ_KEYS else "rel"
    )


def _close(exp: float, got: float, unit: str) -> bool:
    if math.isnan(exp) or math.isinf(exp):
        return (math.isnan(exp) and math.isnan(got)) or exp == got
    tol = {"dB": DB_TOL, "MHz": MHZ_TOL, "Hz": HZ_TOL}.get(unit)
    if tol is not None:
        return abs(got - exp) <= tol
    return abs(got - exp) <= REL_TOL * max(abs(exp), abs(got)) or abs(got - exp) <= 1e-12


def assert_matches(
    exp: Any, got: Any, fn: str, key: str | None = None, path: str = "result"
) -> None:
    if isinstance(exp, bool) or exp is None or isinstance(exp, str):
        assert got == exp, f"{path}: expected {exp!r}, got {got!r}"
    elif isinstance(exp, (int, float)):
        assert isinstance(got, (int, float)) and not isinstance(got, bool), (
            f"{path}: expected number, got {got!r}"
        )
        if key in ("pi", "i", "order", "sev", "srcs"):
            assert got == exp, f"{path}: expected {exp}, got {got}"
        else:
            unit = _unit(fn, key)
            assert _close(float(exp), float(got), unit), (
                f"{path}: expected {exp!r}, got {got!r} ({unit})"
            )
    elif isinstance(exp, list):
        assert isinstance(got, (list, tuple)), f"{path}: expected list, got {type(got).__name__}"
        assert len(got) == len(exp), f"{path}: length {len(got)} != {len(exp)}"
        for i, (e, g) in enumerate(zip(exp, got, strict=True)):
            assert_matches(e, g, fn, key, f"{path}[{i}]")
    elif isinstance(exp, dict):
        assert isinstance(got, dict), f"{path}: expected object, got {type(got).__name__}"
        assert set(got) == set(exp), f"{path}: keys {sorted(got)} != {sorted(exp)}"
        for k in exp:
            assert_matches(exp[k], got[k], fn, k, f"{path}.{k}")
    else:  # pragma: no cover
        raise TypeError(f"{path}: unsupported golden value {exp!r}")


# --- adapters: Python results → legacy JSON shape -------------------------------------------------
def _ndb(r: measure.NdbBandwidth) -> dict[str, Any]:
    return {
        "fL": r.f_l,
        "fR": r.f_r,
        "bwHz": r.bw_hz,
        "pk": r.pk,
        "pi": r.pi,
        "th": r.th,
        "n": r.n,
        "clipped": r.clipped,
    }


def _tech(t: radios.Tech) -> dict[str, Any]:
    d = t.model_dump()
    out = {k: v for k, v in d.items() if v is not None or k in ("part", "tx")}
    if not out["licensed"]:
        del out["licensed"]
    return out


def _radio_out(r: Radio) -> dict[str, Any]:
    d = r.model_dump()
    if d.get("sar") is None:
        d.pop("sar", None)
    return d


def _product(p: im.Product) -> dict[str, Any]:
    d: dict[str, Any] = {
        "label": p.label, "order": p.order, "kind": p.kind,
        "rng": list(p.rng), "srcs": list(p.srcs),
        "restricted": [list(b) for b in p.restricted],
        "rx": [{"lo": h.lo, "hi": h.hi, "n": h.n, "i": h.i} for h in p.rx],
        "licensed": p.licensed, "sev": p.sev,
    }  # fmt: skip
    if p.clipped is not None:
        d["clipped"] = p.clipped
    return d


def _exposure(e: mpe.Exposure) -> dict[str, Any]:
    rows = []
    for r in e.rows:
        d: dict[str, Any] = {
            "i": r.i,
            "name": r.name,
            "f": r.f,
            "condMw": r.cond_mw,
            "eirpMw": r.eirp_mw,
            "erpMw": r.erp_mw,
        }
        if r.basis == "MPE":
            d.update(s=r.s, limit=r.limit, ratio=r.ratio)
        elif r.basis == "Measured SAR":
            d.update(sar=r.sar, limit=r.limit, ratio=r.ratio)
        else:
            d.update(pAvail=r.p_avail, pth=r.pth, limit=r.limit, ratio=r.ratio)
        d["basis"] = r.basis
        rows.append(d)
    return {"rows": rows, "sum": e.sum}


def _limit_fn(d: dict[str, Any]) -> Callable[[float], float | None]:
    if d["type"] == "const":
        return lambda _f: d["value"]
    if d["type"] == "outside":
        return lambda f: d["value"] if f < d["loMHz"] or f > d["hiMHz"] else None
    if d["type"] == "interp":
        return lambda f: (
            measure.interp(d["points"], d["loMHz"] - f)
            if f < d["loMHz"]
            else measure.interp(d["points"], f - d["hiMHz"])
            if f > d["hiMHz"]
            else None
        )
    raise ValueError(d)


def _convert_fn(d: dict[str, Any]) -> Callable[[float, float], float]:
    if d["type"] == "identity":
        return lambda v, _f: v
    if d["type"] == "scaleToBw":
        return lambda v, _f: units.scale_to_bw(v, d["rbwHz"], d["refHz"])
    if d["type"] == "offset":
        return lambda v, _f: v + d["db"]
    raise ValueError(d)


def _opt(obj: Any, fn: Callable[[Any], Any]) -> Any:
    return None if obj is None else fn(obj)


def _radios(lst: list[dict[str, Any]]) -> list[Radio]:
    return [Radio(**r) for r in lst]


L = load_limits()

RFMATH: dict[str, Callable[..., Any]] = {
    "dbmToMw": units.dbm_to_mw,
    "mwToDbm": units.mw_to_dbm,
    "sumDbm": units.sum_dbm,
    "scaleToBw": units.scale_to_bw,
    "avgPsd": units.avg_psd,
    "eirp": units.eirp,
    "eirpToErp": units.eirp_to_erp,
    "erpToEirp": units.erp_to_eirp,
    "eirpToFieldDbuv": units.eirp_to_field_dbuv,
    "fieldDbuvToEirp": units.field_dbuv_to_eirp,
    "fspl": units.fspl,
    "fmtHz": units.fmt_hz,
    "fmtDb": units.fmt_db,
    "interp": measure.interp,
    "channelPower": measure.channel_power,
    "peak": lambda a: (lambda p: {"pk": p.pk, "pi": p.pi})(measure.peak(a)),
    "nDbBandwidth": lambda *a: _ndb(measure.n_db_bandwidth(*a)),
    "obw": lambda *a: (
        lambda r: {"oL": r.o_l, "oR": r.o_r, "bwHz": r.bw_hz, "totalMwMHz": r.total_mw_mhz}
    )(measure.obw(*a)),
    "bandEdge": lambda *a: (lambda r: {"lo": r.lo, "hi": r.hi, "pk": r.pk})(measure.band_edge(*a)),
    "maxInRange": lambda *a: _opt(measure.max_in_range(*a), lambda r: {"max": r.max, "at": r.at}),
    "worstMargin": lambda f, a, d: _opt(
        measure.worst_margin(f, a, _limit_fn(d["limit"]), _convert_fn(d["convert"])),
        lambda m: {"margin": m.margin, "at": m.at, "level": m.level, "limit": m.limit},
    ),
    "parseTrace": lambda *a: (lambda t: {"f": list(t.f), "a": list(t.a)})(trace.parse_trace(*a)),
    "simulateSignal": lambda o: (lambda t: {"f": list(t.f), "a": list(t.a), "rbw": t.rbw})(
        trace.simulate_signal(o)
    ),
    "rng": lambda seed, n: (lambda r: [r() for _ in range(n)])(trace.rng(seed)),
}

COLOC: dict[str, Callable[..., Any]] = {
    "TECH": lambda: {k: _tech(t) for k, t in radios.techs().items()},
    "newRadio": lambda tech, over: _radio_out(radios.new_radio(tech, **over)),
    "isLicensed": lambda r: radios.is_licensed(Radio.model_construct(**r)),
    "radioName": lambda rs, i: radios.radio_name(_radios(rs), _radios(rs)[i], i),
    "txRange": lambda r: _opt(radios.tx_range(Radio(**r)), list),
    "combo": lambda *a: list(im.combo(*a)),
    "overlap": im.overlap,
    "products": lambda rs, opts: [_product(p) for p in im.products(_radios(rs), **opts)],
    "mpeLimit": mpe.mpe_limit,
    "powerDensity": mpe.power_density,
    "sarExemptionMw": mpe.sar_exemption_mw,
    "exposure": lambda rs, d, mode: _exposure(mpe.exposure(_radios(rs), d, mode)),
    "mpeMinDistance": lambda rs: mpe.mpe_min_distance(_radios(rs)),
}

LIMITS: dict[str, Callable[..., Any]] = {
    "channelCenterMHz": L.unii_channel_center_mhz,
    "mpe": L.rf_exposure_mpe,
}

FORMULAS: dict[str, Callable[[], float]] = {
    "ka.cbrs-mask.eud_20MHz_total_eirp": lambda: L.cbrs_total_eirp_dbm(
        L.fcc["cbrs"]["classes"]["eud"]["eirpDbmPer10MHz"], 20
    ),
    "ka.lte-mask.mask_minus13_0p2W": lambda: 23 - L.lte_mask_attenuation_db(0.2),
    "ka.lte-mask.mask_minus13_2W": lambda: 33 - L.lte_mask_attenuation_db(2),
}


def _run(lib: str, case: dict[str, Any]) -> Any:
    args = _dec(case["args"])
    if lib == "formulas":
        return FORMULAS[case["id"]]()
    if lib == "coloc" and case["id"] == "ka.coloc-mpe.duty50_halves_ratio":
        one = mpe.exposure(_radios(args[0]["one"]), args[1], args[2])
        half = mpe.exposure(_radios(args[0]["half"]), args[1], args[2])
        return {"one": _exposure(one), "half": _exposure(half), "ratio": half.sum / one.sum}
    table = {"rfmath": RFMATH, "coloc": COLOC, "limits": LIMITS}[lib]
    return table[case["fn"]](*args)


@pytest.mark.parametrize(("lib", "case"), _cases())
def test_golden(lib: str, case: dict[str, Any]) -> None:
    if "error" in case:
        with pytest.raises(ValueError) as ei:
            _run(lib, case)
        assert str(ei.value) == case["error"]
        return
    got = _run(lib, case)
    assert_matches(_dec(case["result"]), got, case["fn"])
    check = case.get("legacyCheck")
    if check and "tol" in check:
        value = got if not isinstance(got, dict) else None
        assert value is not None and abs(value - check["expected"]) <= check["tol"], (
            f"legacy check: {value} vs {check['expected']} ± {check['tol']}"
        )


def test_every_legacy_function_has_golden_cases() -> None:
    """Each RF.math / RF.coloc function listed in the golden files has at least one case."""
    for name in ("rfmath", "coloc"):
        data = json.loads((GOLDEN / f"{name}.json").read_text(encoding="utf-8"))
        covered = {c["fn"] for c in data["cases"]}
        missing = set(data["functions"]) - covered
        assert not missing, f"{name}: no golden cases for {sorted(missing)}"
