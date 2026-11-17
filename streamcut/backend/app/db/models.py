"""Esquema de base de datos de STREAMCUT AI.

Convenciones:
- Claves primarias UUID; todas las fechas en UTC con zona horaria.
- Los estados son cadenas validadas con CHECK (más fáciles de migrar que los ENUM nativos).
- Todo recurso de usuario pertenece a un workspace (control de acceso por workspace).
- Borrado seguro: clips y fuentes usan `deleted_at` (papelera recuperable); la purga física
  la hace la política de retención, que también elimina los ficheros.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _check(column: str, values: tuple[str, ...]) -> CheckConstraint:
    joined = ", ".join(f"'{v}'" for v in values)
    return CheckConstraint(f"{column} IN ({joined})", name=f"ck_{column}_valid")


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON, list[Any]: JSON}


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow,
                                                 nullable=False)


def pk() -> Mapped[uuid.UUID]:
    return mapped_column(Uuid, primary_key=True, default=uuid.uuid4)


# ---------------------------------------------------------------------------
# Valores válidos
# ---------------------------------------------------------------------------

PLATFORMS = ("twitch", "youtube")
CHANNEL_STATUS = ("unknown", "online", "offline", "error")
CAPABILITY_MODES = ("VIEW_ONLY", "PLATFORM_CLIPS", "FULL_ANALYSIS")
CONNECTION_KINDS = ("oauth_user", "authorized_source")
CONNECTION_STATUS = ("active", "expired", "revoked", "error")
JOB_STATUS = ("queued", "running", "succeeded", "failed", "cancelled")
ASSET_STATUS = ("uploading", "uploaded", "processing", "ready", "failed")
SOURCE_KINDS = ("upload", "live_recording", "platform_clip")
MEDIA_KINDS = ("proxy", "audio", "thumbnail", "waveform", "render", "clip_thumbnail", "contact_sheet")
CANDIDATE_STATUS = ("pending", "accepted", "rejected", "duplicate", "clipped")
CLIP_STATUS = ("detected", "pending", "processing", "editing", "approved", "rejected", "exported",
               "published")
VERSION_STATUS = ("draft", "rendering", "ready", "failed")
SESSION_STATUS = ("live", "ended")
CLIP_ORIGINS = ("analysis", "live", "platform", "manual")


# ---------------------------------------------------------------------------
# Usuarios y workspaces
# ---------------------------------------------------------------------------

class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = pk()
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    session_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    workspaces: Mapped[list[Workspace]] = relationship(back_populates="owner")


class Workspace(TimestampMixin, Base):
    __tablename__ = "workspaces"
    id: Mapped[uuid.UUID] = pk()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
                                                index=True)
    storage_quota_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    owner: Mapped[User] = relationship(back_populates="workspaces")


class Setting(Base):
    __tablename__ = "settings"
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    unique=True, nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow,
                                                 nullable=False)


# ---------------------------------------------------------------------------
# Canales, conexiones y emisiones
# ---------------------------------------------------------------------------

class Channel(TimestampMixin, Base):
    __tablename__ = "channels"
    __table_args__ = (
        UniqueConstraint("workspace_id", "platform", "external_id", name="uq_channel_platform_id"),
        _check("platform", PLATFORMS),
        _check("status", CHANNEL_STATUS),
        Index("ix_channels_tracked", "is_tracked", "platform"),
    )
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    platform: Mapped[str] = mapped_column(String(16), nullable=False)
    external_id: Mapped[str] = mapped_column(String(128), nullable=False)  # login (twitch) / UC… (youtube)
    platform_user_id: Mapped[str | None] = mapped_column(String(64))  # id numérico de Twitch
    handle: Mapped[str | None] = mapped_column(String(128))
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(16), default="unknown", nullable=False)
    is_tracked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    title: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(200))
    viewer_count: Mapped[int | None] = mapped_column(Integer)
    live_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    live_video_id: Mapped[str | None] = mapped_column(String(64))  # YouTube: vídeo del directo actual
    last_live_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    default_template_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("templates.id", ondelete="SET NULL"))
    autopilot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    capabilities: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    connections: Mapped[list[ChannelConnection]] = relationship(back_populates="channel",
                                                                cascade="all, delete-orphan")
    sessions: Mapped[list[StreamSession]] = relationship(back_populates="channel",
                                                         cascade="all, delete-orphan")


class ChannelConnection(TimestampMixin, Base):
    """Autorizaciones: OAuth de usuario (tokens cifrados) o fuente audiovisual autorizada."""

    __tablename__ = "channel_connections"
    __table_args__ = (_check("kind", CONNECTION_KINDS), _check("status", CONNECTION_STATUS))
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    channel_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("channels.id", ondelete="CASCADE"),
                                                         index=True)
    platform: Mapped[str] = mapped_column(String(16), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    external_user_id: Mapped[str | None] = mapped_column(String(128))
    external_login: Mapped[str | None] = mapped_column(String(128))
    scopes: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    access_token_enc: Mapped[str | None] = mapped_column(Text)
    refresh_token_enc: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Fuente autorizada: modo "pull" (URL cifrada) o "listen" (servidor RTMP local con clave)
    source_mode: Mapped[str | None] = mapped_column(String(16))
    source_url_enc: Mapped[str | None] = mapped_column(Text)
    stream_key_enc: Mapped[str | None] = mapped_column(Text)
    listen_port: Mapped[int | None] = mapped_column(Integer)
    rights_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    channel: Mapped[Channel | None] = relationship(back_populates="connections")


class StreamSession(TimestampMixin, Base):
    __tablename__ = "stream_sessions"
    __table_args__ = (
        _check("status", SESSION_STATUS),
        _check("capability_mode", CAPABILITY_MODES),
        Index("ix_stream_sessions_channel_started", "channel_id", "started_at"),
    )
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channels.id", ondelete="CASCADE"), nullable=False)
    platform_stream_id: Mapped[str | None] = mapped_column(String(128))
    title: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(16), default="live", nullable=False)
    capability_mode: Mapped[str] = mapped_column(String(20), default="VIEW_ONLY", nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    peak_viewers: Mapped[int | None] = mapped_column(Integer)
    monitoring: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    analyzed_seconds: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    stats: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    channel: Mapped[Channel] = relationship(back_populates="sessions")


# ---------------------------------------------------------------------------
# Medios
# ---------------------------------------------------------------------------

class SourceAsset(TimestampMixin, Base):
    """Original inmutable (subida, grabación autorizada de directo, clip de plataforma)."""

    __tablename__ = "source_assets"
    __table_args__ = (
        _check("kind", SOURCE_KINDS),
        _check("status", ASSET_STATUS),
        Index("ix_source_assets_ws_sha", "workspace_id", "sha256"),
    )
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="uploading", nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    original_filename: Mapped[str | None] = mapped_column(String(500))
    storage_key: Mapped[str | None] = mapped_column(String(500))
    upload_tmp_key: Mapped[str | None] = mapped_column(String(500))
    sha256: Mapped[str | None] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    expected_size: Mapped[int | None] = mapped_column(BigInteger)
    mime: Mapped[str | None] = mapped_column(String(100))
    duration: Mapped[float | None] = mapped_column(Float)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    fps: Mapped[float | None] = mapped_column(Float)
    has_audio: Mapped[bool | None] = mapped_column(Boolean)
    has_video: Mapped[bool | None] = mapped_column(Boolean)
    probe: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    channel_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("channels.id", ondelete="SET NULL"))
    stream_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("stream_sessions.id", ondelete="SET NULL"))
    stream_offset: Mapped[float | None] = mapped_column(Float)  # segundo del directo en que empieza
    streamer_name: Mapped[str | None] = mapped_column(String(200))
    game: Mapped[str | None] = mapped_column(String(200))
    chat_log: Mapped[list[Any] | None] = mapped_column(JSON)  # [[t, texto], …] si se importó chat
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    media: Mapped[list[MediaAsset]] = relationship(back_populates="source", cascade="all, delete-orphan",
                                                   foreign_keys="MediaAsset.source_asset_id")


class MediaAsset(Base):
    """Derivados: proxies, audio, miniaturas, waveforms, renders."""

    __tablename__ = "media_assets"
    __table_args__ = (_check("kind", MEDIA_KINDS),)
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    source_asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("source_assets.id", ondelete="CASCADE"), index=True)
    clip_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("clip_versions.id", ondelete="CASCADE", use_alter=True, name="fk_media_clip_version"),
        index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    mime: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    sha256: Mapped[str | None] = mapped_column(String(64))
    duration: Mapped[float | None] = mapped_column(Float)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    source: Mapped[SourceAsset | None] = relationship(back_populates="media", foreign_keys=[source_asset_id])


class _JobMixin:
    status: Mapped[str] = mapped_column(String(16), default="queued", nullable=False)
    stage: Mapped[str | None] = mapped_column(String(200))
    progress: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class IngestionJob(_JobMixin, Base):
    __tablename__ = "ingestion_jobs"
    __table_args__ = (_check("status", JOB_STATUS), Index("ix_ingestion_jobs_status", "status"))
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    source_asset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("source_assets.id", ondelete="CASCADE"),
                                                       nullable=False, index=True)
    auto_analyze: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class AnalysisJob(_JobMixin, Base):
    __tablename__ = "analysis_jobs"
    __table_args__ = (_check("status", JOB_STATUS), Index("ix_analysis_jobs_status", "status"))
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    source_asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("source_assets.id", ondelete="CASCADE"), index=True)
    stream_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("stream_sessions.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="full", nullable=False)
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"
    __table_args__ = (Index("ix_transcript_asset_start", "source_asset_id", "start"),)
    id: Mapped[uuid.UUID] = pk()
    source_asset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("source_assets.id", ondelete="CASCADE"),
                                                       nullable=False)
    start: Mapped[float] = mapped_column(Float, nullable=False)
    end: Mapped[float] = mapped_column(Float, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str | None] = mapped_column(String(12))
    confidence: Mapped[float | None] = mapped_column(Float)
    speaker: Mapped[str | None] = mapped_column(String(64))
    words: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)


class DetectedEvent(Base):
    __tablename__ = "detected_events"
    __table_args__ = (
        Index("ix_events_ws_created", "workspace_id", "created_at"),
        Index("ix_events_asset_t", "source_asset_id", "t_start"),
    )
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False)
    source_asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("source_assets.id", ondelete="CASCADE"))
    stream_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("stream_sessions.id", ondelete="CASCADE"), index=True)
    channel_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("channels.id", ondelete="CASCADE"),
                                                         index=True)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    label: Mapped[str] = mapped_column(String(300), nullable=False)
    t_start: Mapped[float | None] = mapped_column(Float)
    t_end: Mapped[float | None] = mapped_column(Float)
    confidence: Mapped[float | None] = mapped_column(Float)
    value: Mapped[float | None] = mapped_column(Float)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class HighlightCandidate(Base):
    __tablename__ = "highlight_candidates"
    __table_args__ = (
        _check("status", CANDIDATE_STATUS),
        CheckConstraint("score >= 0 AND score <= 100", name="ck_candidate_score_range"),
        CheckConstraint('"end" > start', name="ck_candidate_interval"),
        Index("ix_candidates_asset_score", "source_asset_id", "score"),
    )
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    source_asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("source_assets.id", ondelete="CASCADE"))
    stream_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("stream_sessions.id", ondelete="CASCADE"), index=True)
    analysis_job_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("analysis_jobs.id", ondelete="SET NULL"))
    start: Mapped[float] = mapped_column(Float, nullable=False)
    end: Mapped[float] = mapped_column(Float, nullable=False)
    peak_time: Mapped[float] = mapped_column(Float, nullable=False)
    recommended_duration: Mapped[float | None] = mapped_column(Float)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    scores: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    transcript_text: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    duplicate_of_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("highlight_candidates.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


# ---------------------------------------------------------------------------
# Clips, versiones y edición no destructiva
# ---------------------------------------------------------------------------

clip_tags = Table(
    "clip_tags", Base.metadata,
    Column("clip_id", Uuid, ForeignKey("clips.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Uuid, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)

collection_clips = Table(
    "collection_clips", Base.metadata,
    Column("collection_id", Uuid, ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True),
    Column("clip_id", Uuid, ForeignKey("clips.id", ondelete="CASCADE"), primary_key=True),
    Column("added_at", DateTime(timezone=True), default=utcnow, nullable=False),
)


class Clip(TimestampMixin, Base):
    __tablename__ = "clips"
    __table_args__ = (
        _check("status", CLIP_STATUS),
        _check("origin", CLIP_ORIGINS),
        Index("ix_clips_ws_created", "workspace_id", "created_at"),
        Index("ix_clips_ws_score", "workspace_id", "score"),
    )
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False)
    origin: Mapped[str] = mapped_column(String(16), default="analysis", nullable=False)
    candidate_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("highlight_candidates.id", ondelete="SET NULL"))
    source_asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("source_assets.id", ondelete="SET NULL"), index=True)
    channel_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("channels.id", ondelete="SET NULL"),
                                                         index=True)
    stream_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("stream_sessions.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="detected", nullable=False)
    score: Mapped[float | None] = mapped_column(Float)
    category: Mapped[str | None] = mapped_column(String(40))
    start: Mapped[float | None] = mapped_column(Float)
    end: Mapped[float | None] = mapped_column(Float)
    format: Mapped[str] = mapped_column(String(8), default="9:16", nullable=False)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    transcript_text: Mapped[str | None] = mapped_column(Text)
    streamer_name: Mapped[str | None] = mapped_column(String(200))
    platform: Mapped[str | None] = mapped_column(String(16))
    game: Mapped[str | None] = mapped_column(String(200))
    stream_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    detection_latency_s: Mapped[float | None] = mapped_column(Float)
    platform_clip_id: Mapped[str | None] = mapped_column(String(200))
    platform_clip_url: Mapped[str | None] = mapped_column(String(1000))
    platform_thumbnail_url: Mapped[str | None] = mapped_column(String(1000))
    platform_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("clip_versions.id", ondelete="SET NULL", use_alter=True, name="fk_clip_current_version"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    versions: Mapped[list[ClipVersion]] = relationship(
        back_populates="clip", cascade="all, delete-orphan", foreign_keys="ClipVersion.clip_id",
        order_by="ClipVersion.version_no")
    current_version: Mapped[ClipVersion | None] = relationship(foreign_keys=[current_version_id],
                                                               post_update=True)
    tags: Mapped[list[Tag]] = relationship(secondary=clip_tags, back_populates="clips")
    collections: Mapped[list[Collection]] = relationship(secondary=collection_clips, back_populates="clips")


class ClipVersion(Base):
    __tablename__ = "clip_versions"
    __table_args__ = (
        UniqueConstraint("clip_id", "version_no", name="uq_clip_version_no"),
        _check("status", VERSION_STATUS),
    )
    id: Mapped[uuid.UUID] = pk()
    clip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clips.id", ondelete="CASCADE"), nullable=False,
                                               index=True)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    edit_spec: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="draft", nullable=False)
    note: Mapped[str | None] = mapped_column(String(300))
    render_asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="SET NULL", use_alter=True, name="fk_version_render"))
    thumbnail_asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="SET NULL", use_alter=True, name="fk_version_thumb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    clip: Mapped[Clip] = relationship(back_populates="versions", foreign_keys=[clip_id])


class EditProject(TimestampMixin, Base):
    __tablename__ = "edit_projects"
    id: Mapped[uuid.UUID] = pk()
    clip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clips.id", ondelete="CASCADE"), unique=True,
                                               nullable=False)
    base_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("clip_versions.id", ondelete="SET NULL"))
    current_spec: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    head_seq: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class EditOperation(Base):
    __tablename__ = "edit_operations"
    __table_args__ = (UniqueConstraint("edit_project_id", "seq", name="uq_edit_op_seq"),)
    id: Mapped[uuid.UUID] = pk()
    edit_project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("edit_projects.id", ondelete="CASCADE"),
                                                       nullable=False, index=True)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    op_type: Mapped[str] = mapped_column(String(40), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Template(TimestampMixin, Base):
    __tablename__ = "templates"
    __table_args__ = (UniqueConstraint("workspace_id", "slug", name="uq_template_slug"),)
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                           index=True)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    spec: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class Collection(TimestampMixin, Base):
    __tablename__ = "collections"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_collection_name"),)
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    clips: Mapped[list[Clip]] = relationship(secondary=collection_clips, back_populates="collections")


class Tag(Base):
    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_tag_name"),)
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    clips: Mapped[list[Clip]] = relationship(secondary=clip_tags, back_populates="tags")


class Export(_JobMixin, Base):
    """Trabajo de renderizado/exportación de una versión de clip."""

    __tablename__ = "exports"
    __table_args__ = (_check("status", JOB_STATUS),)
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    clip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clips.id", ondelete="CASCADE"), nullable=False,
                                               index=True)
    clip_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clip_versions.id", ondelete="CASCADE"),
                                                       nullable=False)
    media_asset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media_assets.id", ondelete="SET NULL"))
    duration_s: Mapped[float | None] = mapped_column(Float)  # tiempo de renderizado


PUBLISH_PLATFORMS = ("youtube", "tiktok", "instagram")


class Publication(_JobMixin, Base):
    """Publicación de una versión renderizada de un clip en una red social."""

    __tablename__ = "publications"
    __table_args__ = (
        _check("status", JOB_STATUS),
        CheckConstraint("platform IN ('youtube', 'tiktok', 'instagram')", name="ck_publication_platform"),
        Index("ix_publications_clip", "clip_id", "created_at"),
    )
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    clip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clips.id", ondelete="CASCADE"), nullable=False)
    clip_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clip_versions.id", ondelete="CASCADE"),
                                                       nullable=False)
    connection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("channel_connections.id", ondelete="SET NULL"))
    platform: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    privacy: Mapped[str] = mapped_column(String(32), default="public", nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(200))
    external_url: Mapped[str | None] = mapped_column(String(1000))
    response: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)


class ProcessingLog(Base):
    __tablename__ = "processing_logs"
    __table_args__ = (Index("ix_logs_ws_created", "workspace_id", "created_at"),)
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    job_type: Mapped[str] = mapped_column(String(30), nullable=False)
    job_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    level: Mapped[str] = mapped_column(String(10), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_ws_created", "workspace_id", "created_at"),)
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(40))
    target_id: Mapped[str | None] = mapped_column(String(64))
    ip: Mapped[str | None] = mapped_column(String(64))
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class WorkerHeartbeat(Base):
    """Latido de cada proceso worker/monitor (estado de workers en el dashboard)."""

    __tablename__ = "worker_heartbeats"
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    hostname: Mapped[str] = mapped_column(String(200), nullable=False)
    pid: Mapped[int] = mapped_column(Integer, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    info: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
