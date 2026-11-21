"""Database schema. Works on PostgreSQL (Supabase) and SQLite (local dev).

Every row that belongs to a coach carries ``owner_id`` and every query in the
API filters by it, so one coach can never read another coach's players.
"""
from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

JSONType = JSON().with_variant(JSONB(), "postgresql")


def _uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _ts(**kw):
    return mapped_column(DateTime(timezone=True), **kw)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String(120))
    password_hash: Mapped[str | None] = mapped_column(String(255))
    external_id: Mapped[str | None] = mapped_column(String(64), unique=True)  # Supabase auth uid
    created_at: Mapped[dt.datetime] = _ts(default=utcnow)


class Player(Base):
    __tablename__ = "players"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    epic_id: Mapped[str | None] = mapped_column(String(120))
    platform: Mapped[str | None] = mapped_column(String(40))
    region: Mapped[str | None] = mapped_column(String(40))
    game_mode: Mapped[str | None] = mapped_column(String(60))
    competitive_level: Mapped[str | None] = mapped_column(String(60))
    coach_notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = _ts(default=utcnow)
    updated_at: Mapped[dt.datetime] = _ts(default=utcnow, onupdate=utcnow)


class PlayerGoal(Base):
    __tablename__ = "player_goals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    player_id: Mapped[str] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|achieved|dropped
    source_analysis_id: Mapped[str | None] = mapped_column(String(36))
    due_date: Mapped[dt.date | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = _ts(default=utcnow)
    completed_at: Mapped[dt.datetime | None] = _ts(nullable=True)


class Match(Base):
    __tablename__ = "matches"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    player_id: Mapped[str] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    source_type: Mapped[str] = mapped_column(String(10))  # video|replay
    status: Mapped[str] = mapped_column(String(20), default="draft")
    # draft -> uploaded -> queued -> processing -> completed | failed | incompatible
    game_mode: Mapped[str | None] = mapped_column(String(60))
    played_at: Mapped[dt.datetime | None] = _ts(nullable=True)
    notes: Mapped[str | None] = mapped_column(Text)
    # Which in-game player the coach wants analysed (replay: id from the parser).
    target_player_ref: Mapped[str | None] = mapped_column(String(120))
    # Seconds into the attached video at which replay time 0 happens.
    replay_video_offset: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[dt.datetime] = _ts(default=utcnow)
    updated_at: Mapped[dt.datetime] = _ts(default=utcnow, onupdate=utcnow)

    player: Mapped[Player] = relationship(lazy="joined")


class MediaFile(Base):
    __tablename__ = "media_files"
    __table_args__ = (
        UniqueConstraint("owner_id", "sha256", "kind", name="uq_media_owner_hash_kind"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # video|replay|proxy
    storage_key: Mapped[str] = mapped_column(String(500))
    original_name: Mapped[str] = mapped_column(String(300))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    mime: Mapped[str | None] = mapped_column(String(100))
    duration_s: Mapped[float | None] = mapped_column(Float)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    fps: Mapped[float | None] = mapped_column(Float)
    video_codec: Mapped[str | None] = mapped_column(String(40))
    audio_codec: Mapped[str | None] = mapped_column(String(40))
    has_audio: Mapped[bool | None] = mapped_column(Boolean)
    meta: Mapped[dict] = mapped_column(JSONType, default=dict)
    created_at: Mapped[dt.datetime] = _ts(default=utcnow)


class Upload(Base):
    __tablename__ = "uploads"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    filename: Mapped[str] = mapped_column(String(300))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    chunk_bytes: Mapped[int] = mapped_column(Integer)
    received_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open|complete|failed|aborted
    error: Mapped[str | None] = mapped_column(Text)
    media_id: Mapped[str | None] = mapped_column(String(36))
    created_at: Mapped[dt.datetime] = _ts(default=utcnow)
    updated_at: Mapped[dt.datetime] = _ts(default=utcnow, onupdate=utcnow)


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_status_created", "status", "created_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(30))  # analyze_video|analyze_replay
    status: Mapped[str] = mapped_column(String(20), default="queued")
    # queued|running|completed|failed|cancelled
    stage: Mapped[str | None] = mapped_column(String(60))
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(String(60))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    params: Mapped[dict] = mapped_column(JSONType, default=dict)
    log: Mapped[list] = mapped_column(JSONType, default=list)
    locked_by: Mapped[str | None] = mapped_column(String(120))
    heartbeat_at: Mapped[dt.datetime | None] = _ts(nullable=True)
    created_at: Mapped[dt.datetime] = _ts(default=utcnow)
    started_at: Mapped[dt.datetime | None] = _ts(nullable=True)
    finished_at: Mapped[dt.datetime | None] = _ts(nullable=True)


class Analysis(Base):
    __tablename__ = "analyses"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[str | None] = mapped_column(String(36))
    source_type: Mapped[str] = mapped_column(String(10))
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    model: Mapped[str | None] = mapped_column(String(80))
    pipeline_version: Mapped[str] = mapped_column(String(20))
    coverage: Mapped[dict] = mapped_column(JSONType, default=dict)
    timeline: Mapped[list] = mapped_column(JSONType, default=list)
    stats: Mapped[dict] = mapped_column(JSONType, default=dict)
    scores: Mapped[dict] = mapped_column(JSONType, default=dict)
    report: Mapped[dict] = mapped_column(JSONType, default=dict)
    replay_data: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    usage: Mapped[dict] = mapped_column(JSONType, default=dict)
    created_at: Mapped[dt.datetime] = _ts(default=utcnow)


class Frame(Base):
    __tablename__ = "frames"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(16))  # e.g. F0042, used as evidence id
    t: Mapped[float] = mapped_column(Float)
    segment_index: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(30))  # baseline|audio_peak|motion_peak|scene_cut
    storage_key: Mapped[str] = mapped_column(String(500))


class Finding(Base):
    __tablename__ = "findings"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    analysis_id: Mapped[str | None] = mapped_column(
        ForeignKey("analyses.id", ondelete="CASCADE"), index=True, nullable=True
    )
    origin: Mapped[str] = mapped_column(String(10), default="ai")  # ai|coach
    module: Mapped[str | None] = mapped_column(String(30))
    category: Mapped[str] = mapped_column(String(30))
    error_type: Mapped[str | None] = mapped_column(String(20))
    severity: Mapped[str] = mapped_column(String(10))  # low|medium|high|critical
    phase: Mapped[str | None] = mapped_column(String(10))  # early|mid|end
    t_start: Mapped[float] = mapped_column(Float)
    t_end: Mapped[float | None] = mapped_column(Float)
    title: Mapped[str] = mapped_column(String(200))
    what_happened: Mapped[str] = mapped_column(Text)
    why_error: Mapped[str | None] = mapped_column(Text)
    what_to_do: Mapped[str | None] = mapped_column(Text)
    how_to_avoid: Mapped[str | None] = mapped_column(Text)
    evidence: Mapped[list] = mapped_column(JSONType, default=list)
    confidence: Mapped[float | None] = mapped_column(Float)
    review_status: Mapped[str] = mapped_column(String(12), default="open")  # open|confirmed|dismissed
    created_at: Mapped[dt.datetime] = _ts(default=utcnow)


class CoachNote(Base):
    __tablename__ = "coach_notes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    t: Mapped[float | None] = mapped_column(Float)
    category: Mapped[str | None] = mapped_column(String(30))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = _ts(default=utcnow)
    updated_at: Mapped[dt.datetime] = _ts(default=utcnow, onupdate=utcnow)


class Activity(Base):
    __tablename__ = "activity"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    message: Mapped[str] = mapped_column(String(300))
    match_id: Mapped[str | None] = mapped_column(String(36))
    player_id: Mapped[str | None] = mapped_column(String(36))
    created_at: Mapped[dt.datetime] = _ts(default=utcnow, index=True)


def log_activity(db, owner_id: str, kind: str, message: str, *, match_id=None, player_id=None) -> None:
    db.add(Activity(owner_id=owner_id, kind=kind, message=message[:300], match_id=match_id, player_id=player_id))
