"""Pure-Python reader for the *event* layer of Fortnite `.replay` files.

Format reference: Unreal Engine LocalFileNetworkReplayStreaming + the MIT
licensed FortniteReplayDecompressor (Shiqan et al.).  This adapter is a clean
re-implementation of the documented container format and reads:

* Replay info (magic, file version, length, changelist, timestamp, flags).
* Header chunk (network/engine versions, Fortnite branch => season).
* Event chunks, which are AES-256-ECB encrypted but *not* Oodle compressed:
  - ``playerElim``           eliminations / knocks with exact timestamps
  - ``AthenaMatchStats``     the recording player's end-of-match stats
  - ``AthenaMatchTeamStats`` placement and lobby size

It deliberately does NOT read ``ReplayData`` chunks (network packets).  Those
are Oodle-compressed and need a full network-property parser, which is what
the optional FRD CLI adapter provides (player positions, storm circles...).
"""
from __future__ import annotations

import datetime as dt
import struct
from typing import BinaryIO

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from .base import (
    InvalidReplayError,
    LiveReplayError,
    ReplayAdapter,
    ReplayElimination,
    ReplayError,
    ReplayMatchStats,
    ReplayParseResult,
    ReplayTeamStats,
    ReplayVersionInfo,
    UnsupportedReplayVersionError,
)

FILE_MAGIC = 0x1CA2E27F
NETWORK_MAGIC = 0x2CF5A13D

# ReplayVersionHistory
HISTORY_COMPRESSION = 2
HISTORY_RECORDED_TIMESTAMP = 3
HISTORY_ENCRYPTION = 6
HISTORY_CUSTOM_VERSIONS = 7
REPLAY_VERSION_LATEST_KNOWN = 7

# NetworkVersionHistory
NV_EXTRA_VERSION = 5
NV_MULTIPLE_LEVELS = 6
NV_HEADER_FLAGS = 9
NV_SAVE_FULL_ENGINE_VERSION = 11
NV_HEADER_GUID = 12
NV_SAVE_PACKAGE_VERSION_UE = 17
NV_RECORDING_METADATA = 18
NV_USE_CUSTOM_VERSION = 19
NETWORK_VERSION_LATEST_KNOWN = 19

CHUNK_HEADER, CHUNK_REPLAYDATA, CHUNK_CHECKPOINT, CHUNK_EVENT = 0, 1, 2, 3

PLAYER_TYPES = {0x03: "bot", 0x10: "named_bot", 0x11: "player"}

MAX_STRING = 1 << 20


class _Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def remaining(self) -> int:
        return len(self.data) - self.pos

    def take(self, n: int) -> bytes:
        if n < 0 or self.pos + n > len(self.data):
            raise InvalidReplayError(
                "El archivo está truncado o tiene una estructura inesperada.",
                detail=f"read {n} bytes at {self.pos} of {len(self.data)}",
            )
        b = self.data[self.pos : self.pos + n]
        self.pos += n
        return b

    def skip(self, n: int) -> None:
        self.take(n)

    def u8(self) -> int:
        return self.take(1)[0]

    def u16(self) -> int:
        return struct.unpack("<H", self.take(2))[0]

    def i32(self) -> int:
        return struct.unpack("<i", self.take(4))[0]

    def u32(self) -> int:
        return struct.unpack("<I", self.take(4))[0]

    def i64(self) -> int:
        return struct.unpack("<q", self.take(8))[0]

    def f32(self) -> float:
        return struct.unpack("<f", self.take(4))[0]

    def fstring(self) -> str:
        length = self.i32()
        if length == 0:
            return ""
        if abs(length) > MAX_STRING:
            raise InvalidReplayError("Cadena con longitud imposible en la replay.", detail=str(length))
        if length < 0:
            raw = self.take(-2 * length)
            return raw.decode("utf-16-le", errors="replace").rstrip("\x00").strip()
        raw = self.take(length)
        return raw.rstrip(b"\x00").decode("utf-8", errors="replace").strip()

    def hex(self, n: int) -> str:
        return self.take(n).hex().upper()

    def vec(self) -> tuple[float, float, float]:
        return (self.f32(), self.f32(), self.f32())


def _filetime_to_iso(ticks: int) -> str | None:
    # .NET DateTime.FromBinary: low 62 bits are ticks (100ns) since 0001-01-01.
    ticks &= 0x3FFFFFFFFFFFFFFF
    try:
        return (dt.datetime(1, 1, 1) + dt.timedelta(microseconds=ticks // 10)).isoformat() + "Z"
    except OverflowError:
        return None


class NativeEventsAdapter(ReplayAdapter):
    name = "native-events"
    version = "1.0.0"
    capabilities = ("version", "length", "eliminations", "knocks", "match_stats", "placement")

    def is_available(self) -> tuple[bool, str]:
        return True, "Incluido (Python puro)"

    # ---------------------------------------------------------------- info
    def _read_info(self, r: _Reader) -> dict:
        if r.remaining() < 8 or r.u32() != FILE_MAGIC:
            raise InvalidReplayError(
                "No es una replay de Fortnite válida (firma de archivo incorrecta)."
            )
        file_version = r.u32()
        if file_version > REPLAY_VERSION_LATEST_KNOWN:
            raise UnsupportedReplayVersionError(
                f"Versión de contenedor de replay desconocida ({file_version}). "
                "Probablemente es de una versión de Fortnite más reciente que el parser.",
            )
        if file_version >= HISTORY_CUSTOM_VERSIONS:
            r.skip(r.i32() * 20)
        info = {
            "file_version": file_version,
            "length_ms": r.u32(),
            "network_version": r.u32(),
            "changelist": r.u32(),
            "friendly_name": r.fstring(),
            "is_live": r.u32() >= 1,
            "timestamp": None,
            "compressed": False,
            "encrypted": False,
            "key": b"",
        }
        if file_version >= HISTORY_RECORDED_TIMESTAMP:
            info["timestamp"] = _filetime_to_iso(r.i64())
        if file_version >= HISTORY_COMPRESSION:
            info["compressed"] = r.u32() >= 1
        if file_version >= HISTORY_ENCRYPTION:
            info["encrypted"] = r.u32() >= 1
            size = r.u32()
            if size > 1024:
                raise InvalidReplayError("Clave de cifrado con tamaño inválido.")
            info["key"] = r.take(size)
        if info["is_live"]:
            raise LiveReplayError(
                "La replay está marcada como 'en curso' (la partida no terminó de grabarse). "
                "Fortnite solo cierra el archivo al acabar la partida."
            )
        if info["encrypted"] and not info["key"]:
            raise InvalidReplayError("La replay está cifrada pero no incluye la clave.")
        return info

    def _read_header(self, r: _Reader) -> dict:
        if r.u32() != NETWORK_MAGIC:
            raise InvalidReplayError("Cabecera de red inválida.")
        h: dict = {"network_version": r.u32()}
        nv = h["network_version"]
        if nv <= NV_EXTRA_VERSION:
            raise UnsupportedReplayVersionError("Replay demasiado antigua (pre-2018).")
        if nv > NETWORK_VERSION_LATEST_KNOWN:
            raise UnsupportedReplayVersionError(
                f"Versión de red desconocida ({nv}); el formato ha cambiado en una versión reciente de Fortnite."
            )
        if nv >= NV_USE_CUSTOM_VERSION:
            r.skip(r.i32() * 20)
        r.u32()  # network checksum
        h["engine_network_version"] = r.u32()
        r.u32()  # game network protocol
        if nv >= NV_HEADER_GUID:
            r.skip(16)
        if nv >= NV_SAVE_FULL_ENGINE_VERSION:
            h["major"], h["minor"], h["patch"] = r.u16(), r.u16(), r.u16()
            h["changelist"] = r.u32()
            h["branch"] = r.fstring()
        else:
            h["changelist"] = r.u32()
        if nv >= NV_RECORDING_METADATA:
            r.skip(12)
        if nv <= NV_MULTIPLE_LEVELS:
            raise UnsupportedReplayVersionError("Formato de niveles antiguo no soportado.")
        for _ in range(r.u32()):
            r.fstring()
            r.u32()
        if nv >= NV_HEADER_FLAGS:
            r.u32()
        for _ in range(r.u32()):
            r.fstring()
        if nv >= NV_SAVE_PACKAGE_VERSION_UE:
            r.skip(16)
            h["platform"] = r.fstring()
            r.skip(2)
        return h

    # -------------------------------------------------------------- public
    def probe(self, path: str) -> ReplayVersionInfo:
        with open(path, "rb") as f:
            data = f.read()
        r = _Reader(data)
        info = self._read_info(r)
        header = None
        # The header is normally the first chunk.
        while r.remaining() >= 8:
            ctype, csize = r.u32(), r.i32()
            if csize <= 0 or csize > r.remaining():
                break
            start = r.pos
            if ctype == CHUNK_HEADER:
                header = self._read_header(_Reader(data[start : start + csize]))
                break
            r.pos = start + csize
        return self._version(info, header)

    def _version(self, info: dict, header: dict | None) -> ReplayVersionInfo:
        header = header or {}
        return ReplayVersionInfo(
            file_version=info["file_version"],
            network_version=header.get("network_version", info["network_version"]),
            engine_network_version=header.get("engine_network_version"),
            changelist=header.get("changelist", info["changelist"]),
            major=header.get("major"),
            minor=header.get("minor"),
            patch=header.get("patch"),
            branch=header.get("branch"),
            platform=header.get("platform"),
        )

    def _decrypt(self, payload: bytes, info: dict) -> bytes:
        if not info["encrypted"]:
            return payload
        if len(payload) % 16:
            raise InvalidReplayError("Bloque cifrado con tamaño no múltiplo de 16.")
        dec = Cipher(algorithms.AES(info["key"]), modes.ECB()).decryptor()
        out = dec.update(payload) + dec.finalize()
        pad = out[-1] if out else 0
        if 1 <= pad <= 16 and out.endswith(bytes([pad]) * pad):
            out = out[:-pad]
        else:
            raise InvalidReplayError("No se pudo descifrar un evento (clave o formato incompatible).")
        return out

    def parse(self, path: str) -> ReplayParseResult:
        with open(path, "rb") as f:
            data = f.read()
        r = _Reader(data)
        info = self._read_info(r)
        header: dict | None = None
        elims: list[ReplayElimination] = []
        stats = team = None
        unknown: dict[str, int] = {}
        warnings: list[str] = []
        failed_elims = 0
        chunk_count = 0

        while r.remaining() >= 8:
            ctype, csize = r.u32(), r.i32()
            start = r.pos
            if csize <= 0 or csize > r.remaining():
                warnings.append(f"Chunk con tamaño inválido en offset {start}; lectura detenida.")
                break
            chunk_count += 1
            chunk = _Reader(data[start : start + csize])
            if ctype == CHUNK_HEADER:
                header = self._read_header(chunk)
            elif ctype == CHUNK_EVENT:
                ev_id, group, meta = chunk.fstring(), chunk.fstring(), chunk.fstring()
                t0, _t1, size = chunk.u32(), chunk.u32(), chunk.i32()
                payload = self._decrypt(chunk.take(size), info)
                ev = _Reader(payload)
                try:
                    if group == "playerElim":
                        elims.append(self._elim(ev, t0, header or {}))
                    elif meta == "AthenaMatchStats":
                        stats = self._stats(ev, t0)
                    elif meta == "AthenaMatchTeamStats":
                        ev.u32()
                        team = ReplayTeamStats(time_ms=t0, placement=ev.u32(), total_players=ev.u32())
                    else:
                        key = meta or group or ev_id
                        unknown[key] = unknown.get(key, 0) + 1
                except ReplayError:
                    if group == "playerElim":
                        failed_elims += 1
                    else:
                        warnings.append(f"Evento '{meta or group}' con formato no reconocido.")
            r.pos = start + csize

        if header is None:
            raise InvalidReplayError("La replay no contiene cabecera de red.")
        if failed_elims:
            warnings.append(
                f"{failed_elims} eliminaciones no se pudieron interpretar (formato de evento de una versión no soportada)."
            )
        elims.sort(key=lambda e: e.time_ms)
        owner = self._guess_owner(elims, stats)
        return ReplayParseResult(
            adapter=self.name,
            adapter_version=self.version,
            version=self._version(info, header),
            length_ms=info["length_ms"],
            friendly_name=info["friendly_name"] or None,
            recorded_at=info["timestamp"],
            is_compressed=info["compressed"],
            is_encrypted=info["encrypted"],
            eliminations=elims,
            match_stats=stats,
            team_stats=team,
            owner_id=owner,
            unknown_events=unknown,
            warnings=warnings,
            unavailable=[
                "positions",
                "movement",
                "storm_circles",
                "builds",
                "inventory",
                "player_names",
            ],
        )

    def _guess_owner(self, elims: list[ReplayElimination], stats: ReplayMatchStats | None) -> str | None:
        # We cannot read the owner from events; only report it when the
        # recorder's elimination count uniquely matches one eliminator id.
        if not stats or stats.eliminations == 0:
            return None
        counts: dict[str, int] = {}
        for e in elims:
            if e.eliminator_id and e.eliminator_type == "player" and not e.knocked and e.eliminator_id != e.eliminated_id:
                counts[e.eliminator_id] = counts.get(e.eliminator_id, 0) + 1
        matches = [k for k, v in counts.items() if v == stats.eliminations]
        return matches[0] if len(matches) == 1 else None

    def _stats(self, ev: _Reader, t0: int) -> ReplayMatchStats:
        ev.u32()
        return ReplayMatchStats(
            time_ms=t0,
            accuracy=round(ev.f32(), 4),
            assists=ev.u32(),
            eliminations=ev.u32(),
            weapon_damage=ev.u32(),
            other_damage=ev.u32(),
            revives=ev.u32(),
            damage_taken=ev.u32(),
            damage_to_structures=ev.u32(),
            materials_gathered=ev.u32(),
            materials_used=ev.u32(),
            total_traveled=ev.u32(),
        )

    def _player(self, ev: _Reader, version: int) -> tuple[str | None, str | None]:
        if version < 6:
            return ev.fstring() or None, "player"
        ptype = ev.u8()
        kind = PLAYER_TYPES.get(ptype, "unknown")
        if ptype == 0x03:
            return None, "bot"
        if ptype == 0x10:
            return ev.fstring() or None, "named_bot"
        if ptype == 0x11:
            return ev.hex(ev.u8()), "player"
        return None, kind

    def _elim(self, ev: _Reader, t0: int, header: dict) -> ReplayElimination:
        version = ev.i32()
        victim_loc = killer_loc = None
        if version >= 3:
            ev.skip(1)
            if version >= 6:
                ev.skip(16)
                victim_loc = ev.vec()
                ev.skip(12)
            ev.skip(16)
            killer_loc = ev.vec()
            ev.skip(12)
        else:
            major, minor = header.get("major") or 0, header.get("minor") or 0
            if major <= 4 and minor < 2:
                ev.skip(8)
            elif major == 4 and minor <= 2:
                ev.skip(36)
        if (header.get("engine_network_version") or 0) >= 34:
            # UE5 large-world (double precision) transforms; FRD skips these.
            ev.skip(80)
            victim_loc = killer_loc = None
        victim, vtype = self._player(ev, version)
        killer, ktype = self._player(ev, version)
        gun = ev.u8()
        knocked = ev.u32() >= 1
        return ReplayElimination(
            time_ms=t0,
            eliminated_id=victim,
            eliminated_type=vtype,
            eliminator_id=killer,
            eliminator_type=ktype,
            knocked=knocked,
            gun_type=gun,
            eliminated_location=_clean_vec(victim_loc),
            eliminator_location=_clean_vec(killer_loc),
        )


def _clean_vec(v: tuple[float, float, float] | None) -> tuple[float, float, float] | None:
    if v is None:
        return None
    if any(x != x or abs(x) > 1e7 for x in v) or v == (0.0, 0.0, 0.0):
        return None
    return (round(v[0], 1), round(v[1], 1), round(v[2], 1))
