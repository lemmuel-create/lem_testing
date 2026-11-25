"""Harmonics and intermodulation products (legacy RF.coloc combo, overlap, products).

Each product is flagged against §15.205 restricted bands and the host's receive bands
(including GNSS); Part 15 products are cut at the §15.33 search limit. Band data comes from
rfcomp.limits.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field, replace

from rfcomp.coloc.radios import Radio, is_licensed, radio_name, techs, tx_range
from rfcomp.limits import load as load_limits

Range = tuple[float, float]

#: (a, b, order) for a·f1 + b·f2; 5th order terms are optional.
IM_TERMS: tuple[tuple[int, int, int], ...] = (
    (1, 1, 2),
    (1, -1, 2),
    (2, -1, 3),
    (-1, 2, 3),
    (2, 1, 3),
    (1, 2, 3),
)
IM5_TERMS: tuple[tuple[int, int, int], ...] = ((3, -2, 5), (-2, 3, 5))


@dataclass(frozen=True)
class RxHit:
    lo: float
    hi: float
    n: str
    i: int


@dataclass(frozen=True)
class Product:
    label: str
    order: int
    kind: str
    rng: Range
    srcs: tuple[int, ...]
    restricted: tuple[Range, ...] = ()
    rx: tuple[RxHit, ...] = ()
    licensed: bool = False
    sev: int = 0  # 2 restricted, 1 receiver, 0 clear
    clipped: bool | None = field(default=None)


def combo(a: float, r1: Sequence[float], b: float = 0, r2: Sequence[float] | None = None) -> Range:
    """Range of a·f1 + b·f2 over f1 ∈ r1, f2 ∈ r2 (r2 optional), folded to positive frequency."""

    def pick(c: float, r: Sequence[float], want_lo: bool) -> float:
        return c * r[0] if (c >= 0) == want_lo else c * r[1]

    lo = pick(a, r1, True) + (pick(b, r2, True) if r2 is not None else 0)
    hi = pick(a, r1, False) + (pick(b, r2, False) if r2 is not None else 0)
    if hi < 0:
        lo, hi = -hi, -lo
    elif lo < 0:
        lo, hi = 0, max(-lo, hi)
    return (lo, hi)


def overlap(p: Sequence[float], b: Sequence[float]) -> bool:
    return p[0] <= b[1] and p[1] >= b[0]


def _term(c: int, name: str) -> str:
    return ("" if abs(c) == 1 else f"{abs(c)}·") + f"f({name})"


def products(radios: list[Radio], hmax: int | None = None, im5: bool = False) -> list[Product]:
    """Harmonics (2..hmax) and 2nd/3rd (+ optional 5th) order IM products of all TX radios."""
    fcc = load_limits().fcc
    if hmax is None:
        hmax = fcc["measurementRange"]["harmonics"]
    names = [radio_name(radios, r, i) for i, r in enumerate(radios)]
    tx = [(i, rng) for i, r in enumerate(radios) if (rng := tx_range(r)) is not None]

    raw: list[Product] = []
    for i, rng in tx:
        for n in range(2, hmax + 1):
            raw.append(Product(f"{n}·f({names[i]})", n, "Harmonic", combo(n, rng), (i,)))
    terms = IM_TERMS + (IM5_TERMS if im5 else ())
    for x in range(len(tx)):
        for y in range(x + 1, len(tx)):
            (ia, ra), (ib, rb) = tx[x], tx[y]
            for a, b, order in terms:
                if a > 0:
                    sign = "+" if b > 0 else "−"
                    label = f"{_term(a, names[ia])} {sign} {_term(b, names[ib])}"
                else:
                    label = f"{_term(b, names[ib])} − {_term(a, names[ia])}"
                kind = (
                    "2nd-order IM"
                    if order == 2
                    else "3rd-order IM"
                    if order == 3
                    else "5th-order IM"
                )
                raw.append(Product(label, order, kind, combo(a, ra, b, rb), (ia, ib)))

    rx_bands = [
        RxHit(lo, hi, n, i) for i, r in enumerate(radios) for (lo, hi, n) in techs()[r.tech].rx
    ]
    restricted_bands: list[Range] = [(b[0], b[1]) for b in fcc["restrictedBands15205"]["mhz"]]
    cap = fcc["measurementRange"]["part15MaxMHz"]

    flagged: list[Product] = []
    for p in raw:
        restricted = tuple(b for b in restricted_bands if overlap(p.rng, b))
        hits = [
            b
            for b in rx_bands
            if overlap(p.rng, (b.lo, b.hi))
            and not (len(p.srcs) == 1 and p.srcs[0] == b.i and p.kind != "Harmonic")
        ]
        rx: list[RxHit] = []
        for b in hits:
            if all(c.n != b.n for c in rx):
                rx.append(b)
        sev = 2 if restricted else 1 if rx else 0
        lic = any(is_licensed(radios[i]) for i in p.srcs)
        flagged.append(replace(p, restricted=restricted, rx=tuple(rx), licensed=lic, sev=sev))

    flagged.sort(key=lambda p: (-p.sev, p.order, p.rng[0]))

    def licensed_only(p: Product) -> bool:
        return all(is_licensed(radios[i]) for i in p.srcs)

    out: list[Product] = []
    for p in flagged:
        if not (p.rng[1] >= 30 and (licensed_only(p) or p.rng[0] <= cap)):
            continue
        out.append(
            p
            if licensed_only(p) or p.rng[1] <= cap
            else replace(p, rng=(p.rng[0], cap), clipped=True)
        )
    return out
