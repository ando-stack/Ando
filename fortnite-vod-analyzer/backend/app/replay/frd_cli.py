"""Adapter for FortniteReplayDecompressor via the FrdExport CLI (replay-tools/FrdExport).

Runs out-of-process (the CLI bundles OozSharp, GPL-3.0 derived Oodle
decompression), with a timeout, and only reads the replay file.
Adds what the native event reader cannot: player names, replay owner,
teams, per-player positions and storm circles.
"""
from __future__ import annotations

import json
import os
import statistics
import subprocess

from ..config import get_settings
from .base import (
    InvalidReplayError,
    ReplayAdapter,
    ReplayError,
    ReplayParseResult,
    ReplayPlayer,
    ReplayPositionSample,
    ReplaySafeZone,
    ReplayVersionInfo,
)
from .native import NativeEventsAdapter


class FrdCliAdapter(ReplayAdapter):
    name = "frd-cli"
    version = "FortniteReplayReader 3.x"
    capabilities = ("players", "names", "owner", "teams", "positions", "storm_circles", "killfeed")

    def is_available(self) -> tuple[bool, str]:
        path = get_settings().frd_cli
        if not path:
            return False, "FRD_CLI no configurado (posiciones y nombres no disponibles)."
        if not os.path.isfile(path) or not os.access(path, os.X_OK):
            return False, f"FRD_CLI no encontrado o no ejecutable: {path}"
        return True, "FortniteReplayDecompressor (FrdExport)"

    def probe(self, path: str) -> ReplayVersionInfo:
        return NativeEventsAdapter().probe(path)

    def run(self, path: str) -> dict:
        s = get_settings()
        try:
            proc = subprocess.run([s.frd_cli, path, "--max-samples-per-player", "20000"], capture_output=True, timeout=s.frd_timeout, check=False)
        except subprocess.TimeoutExpired:
            raise ReplayError("El parser FRD superó el tiempo máximo.")
        if proc.returncode != 0:
            msg = proc.stderr.decode(errors="replace")[-500:]
            raise InvalidReplayError("FortniteReplayDecompressor no pudo interpretar la replay.", detail=msg)
        return json.loads(proc.stdout)

    def parse(self, path: str) -> ReplayParseResult:
        # Events from the native reader (verified), enrichment from FRD.
        base = NativeEventsAdapter().parse(path)
        return self.enrich(base, self.run(path))

    @staticmethod
    def world_offset(doc: dict, base: ReplayParseResult) -> float | None:
        """Seconds to add to world time to get replay time, from kill-feed
        entries matched against timestamped elimination events."""
        elim_times: dict[tuple[str, bool], list[float]] = {}
        for e in base.eliminations:
            if e.eliminated_id:
                elim_times.setdefault((e.eliminated_id, e.knocked), []).append(e.time_ms / 1000)
        diffs = []
        for k in doc.get("killfeed", []):
            tw = k.get("t_world")
            name = k.get("player_name")
            if not tw or not name:
                continue
            cands = elim_times.get((name, bool(k.get("is_downed"))))
            if cands:
                diffs.append(min(cands, key=lambda t: abs(t - tw)) - tw)
        if len(diffs) < 3:
            return None
        med = statistics.median(diffs)
        close = [d for d in diffs if abs(d - med) < 3]
        return round(statistics.median(close), 3) if len(close) >= 3 else None

    def enrich(self, base: ReplayParseResult, doc: dict) -> ReplayParseResult:
        base.adapter = "native-events+frd-cli"
        base.adapter_version = f"{base.adapter_version} / FRD {doc.get('reader_version')}"
        players = []
        owner = None
        for p in doc.get("players", []):
            pid = p.get("player_id") or (f"bot-{p.get('id')}" if p.get("is_bot") else None)
            if not pid:
                continue
            players.append(ReplayPlayer(id=pid, name=p.get("name"), is_bot=p.get("is_bot"), team_index=p.get("team_index"),
                                        placement=p.get("placement"), kills=p.get("kills"), platform=p.get("platform"),
                                        is_replay_owner=bool(p.get("is_replay_owner"))))
            if p.get("is_replay_owner"):
                owner = pid
        base.players = players
        if owner:
            base.owner_id = owner
        offset = self.world_offset(doc, base)
        positions = []
        if offset is not None:
            for p in doc.get("players", []):
                pid = p.get("player_id")
                if not pid:
                    continue
                last_t = -1e9
                for loc in p.get("locations", []):
                    tw = loc.get("t_world")
                    if not tw:
                        continue
                    t_ms = int((tw + offset) * 1000)
                    if t_ms - last_t < 1000 or t_ms < 0:  # ≤1 sample per second
                        continue
                    last_t = t_ms
                    positions.append(ReplayPositionSample(pid, t_ms, loc["x"], loc["y"], loc["z"]))
            zones = []
            for z in doc.get("safe_zones", []):
                if z.get("next_x") is None or not z.get("next_radius"):
                    continue
                t0 = z.get("start_shrink_world")
                zones.append(ReplaySafeZone(time_ms=int((t0 + offset) * 1000) if t0 else None, x=z["next_x"], y=z["next_y"], radius=z["next_radius"],
                                            next_x=None, next_y=None, next_radius=None))
            base.safe_zones = zones
            base.unavailable = [u for u in base.unavailable if u not in ("positions", "movement", "storm_circles", "player_names")]
        else:
            base.warnings.append("No se pudo sincronizar el tiempo del mundo con el de la replay: posiciones y zonas omitidas para no dar datos desalineados.")
            base.unavailable = [u for u in base.unavailable if u != "player_names"]
        base.positions = positions
        if positions:
            base.warnings.append(f"Posiciones muestreadas a ≤1/s ({len(positions)} muestras).")
        elif offset is not None:
            base.warnings.append("La replay no contiene movimiento replicado utilizable para esta versión.")
            base.unavailable.append("positions")
        return base
