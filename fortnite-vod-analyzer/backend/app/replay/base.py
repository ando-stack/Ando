"""Common contract for every Fortnite replay adapter.

A replay adapter turns a `.replay` file (Unreal Engine network demo) into
structured, *verifiable* data.  Adapters must never fill gaps with guesses:
every field that could not be read is left as ``None`` and listed in
``ReplayParseResult.unavailable`` so the UI and the analyzers can say so.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from typing import Any


class ReplayError(Exception):
    """Base class for replay problems that must be shown to the user."""

    code = "replay_error"

    def __init__(self, message: str, *, detail: str | None = None):
        super().__init__(message)
        self.message = message
        self.detail = detail


class InvalidReplayError(ReplayError):
    code = "invalid_replay"


class UnsupportedReplayVersionError(ReplayError):
    code = "unsupported_version"


class LiveReplayError(ReplayError):
    code = "replay_incomplete"


@dataclass
class ReplayVersionInfo:
    file_version: int
    network_version: int | None = None
    engine_network_version: int | None = None
    changelist: int | None = None
    major: int | None = None
    minor: int | None = None
    patch: int | None = None
    branch: str | None = None
    platform: str | None = None

    @property
    def season_label(self) -> str | None:
        # Branch looks like "++Fortnite+Release-30.10"
        if self.branch and "Release-" in self.branch:
            return self.branch.split("Release-")[-1]
        return None


@dataclass
class ReplayElimination:
    time_ms: int
    eliminated_id: str | None
    eliminated_type: str | None  # player | bot | named_bot | unknown
    eliminator_id: str | None
    eliminator_type: str | None
    knocked: bool
    gun_type: int | None
    eliminated_location: tuple[float, float, float] | None = None
    eliminator_location: tuple[float, float, float] | None = None


@dataclass
class ReplayMatchStats:
    time_ms: int
    accuracy: float
    assists: int
    eliminations: int
    weapon_damage: int
    other_damage: int
    revives: int
    damage_taken: int
    damage_to_structures: int
    materials_gathered: int
    materials_used: int
    total_traveled: int  # in Unreal units as stored by the game (cm-ish); shown raw


@dataclass
class ReplayTeamStats:
    time_ms: int
    placement: int
    total_players: int


@dataclass
class ReplayPlayer:
    id: str
    name: str | None = None
    is_bot: bool | None = None
    team_index: int | None = None
    placement: int | None = None
    kills: int | None = None
    platform: str | None = None
    is_replay_owner: bool = False


@dataclass
class ReplayPositionSample:
    player_id: str
    time_ms: int
    x: float
    y: float
    z: float


@dataclass
class ReplaySafeZone:
    time_ms: int | None
    x: float
    y: float
    radius: float
    next_x: float | None = None
    next_y: float | None = None
    next_radius: float | None = None


@dataclass
class ReplayParseResult:
    adapter: str
    adapter_version: str
    version: ReplayVersionInfo
    length_ms: int
    friendly_name: str | None
    recorded_at: str | None
    is_compressed: bool
    is_encrypted: bool
    eliminations: list[ReplayElimination] = field(default_factory=list)
    match_stats: ReplayMatchStats | None = None
    team_stats: ReplayTeamStats | None = None
    players: list[ReplayPlayer] = field(default_factory=list)
    positions: list[ReplayPositionSample] = field(default_factory=list)
    safe_zones: list[ReplaySafeZone] = field(default_factory=list)
    owner_id: str | None = None
    unknown_events: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    unavailable: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["version"]["season_label"] = self.version.season_label
        return d


class ReplayAdapter(ABC):
    """Interface implemented by every replay parser integration."""

    name: str = "abstract"
    version: str = "0"
    #: What this adapter is able to extract when the replay is compatible.
    capabilities: tuple[str, ...] = ()

    @abstractmethod
    def is_available(self) -> tuple[bool, str]:
        """Return (available, reason). Unavailable adapters are skipped."""

    @abstractmethod
    def probe(self, path: str) -> ReplayVersionInfo:
        """Validate the file and detect its version without a full parse."""

    @abstractmethod
    def parse(self, path: str) -> ReplayParseResult:
        """Full parse. Raises ReplayError on incompatibility."""
