"""Adapter selection with graceful degradation.

Order: FRD CLI (richest) -> native events reader. If the richer adapter fails
(e.g. a brand-new Fortnite version changed the network format) we fall back to
the event reader and record a warning; if every adapter fails the replay is
marked incompatible with an explanation — no statistics are invented.
"""
from __future__ import annotations

from .base import ReplayError, ReplayParseResult
from .frd_cli import FrdCliAdapter
from .native import NativeEventsAdapter

ADAPTERS = [FrdCliAdapter(), NativeEventsAdapter()]


def adapters_status() -> list[dict]:
    out = []
    for a in ADAPTERS:
        ok, why = a.is_available()
        out.append({"name": a.name, "available": ok, "detail": why, "capabilities": list(a.capabilities)})
    return out


def parse_replay(path: str) -> ReplayParseResult:
    native = NativeEventsAdapter()
    base = native.parse(path)  # raises ReplayError when the container itself is incompatible
    frd = ADAPTERS[0]
    ok, why = frd.is_available()
    if ok:
        try:
            return frd.enrich(base, frd.run(path))  # type: ignore[attr-defined]
        except ReplayError as e:
            base.warnings.append(f"Adaptador FRD falló ({e.message}); se usan solo los eventos.")
        except Exception as e:  # noqa: BLE001 - external tool output
            base.warnings.append(f"Adaptador FRD devolvió datos no válidos ({type(e).__name__}); se usan solo los eventos.")
    else:
        base.warnings.append(why)
    return base
