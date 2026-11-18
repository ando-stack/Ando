"""Especificación de edición NO destructiva.

Un clip nunca modifica su original: guarda una lista de operaciones/estado (EditSpec) que el
worker de render convierte en un MP4. Los tiempos de segmentos y subtítulos son ABSOLUTOS en el
original, de forma que recortar o dividir no desincroniza los subtítulos.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

FORMAT_SIZES = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080)}
QUALITY_SCALE = {"1080p": 1.0, "720p": 2 / 3}


class Region(BaseModel):
    x: float = Field(0.0, ge=0, le=1)
    y: float = Field(0.0, ge=0, le=1)
    w: float = Field(1.0, gt=0, le=1)
    h: float = Field(1.0, gt=0, le=1)

    @model_validator(mode="after")
    def _inside(self) -> "Region":
        self.w = min(self.w, 1 - self.x)
        self.h = min(self.h, 1 - self.y)
        return self


class Segment(BaseModel):
    start: float = Field(ge=0)
    end: float

    @model_validator(mode="after")
    def _order(self) -> "Segment":
        if self.end - self.start < 0.2:
            raise ValueError("Cada segmento debe durar al menos 0.2 s")
        return self


class Layout(BaseModel):
    mode: Literal["fit_blur", "crop", "split", "fit_black"] = "fit_blur"
    main: Region = Field(default_factory=Region)  # zona principal (gameplay / cara)
    webcam: Region | None = None  # zona de la webcam para split screen
    split_ratio: float = Field(0.38, ge=0.2, le=0.6)  # proporción superior ocupada por la webcam


class PunchIn(BaseModel):
    t: float = Field(ge=0)  # segundos en la línea de tiempo de salida
    duration: float = Field(1.5, gt=0, le=30)
    scale: float = Field(1.15, ge=1.0, le=2.0)


class Zoom(BaseModel):
    enabled: bool = False
    punch_ins: list[PunchIn] = Field(default_factory=list)


class Word(BaseModel):
    start: float
    end: float
    text: str


class Cue(BaseModel):
    start: float
    end: float
    text: str = Field(max_length=500)
    words: list[Word] = Field(default_factory=list)


class SubtitleStyle(BaseModel):
    font: str = "Inter"
    size: int = Field(72, ge=16, le=200)
    bold: bool = True
    uppercase: bool = False
    color: str = "#FFFFFF"
    highlight_color: str = "#A78BFA"
    outline_color: str = "#000000"
    outline: float = Field(5, ge=0, le=20)
    shadow: float = Field(2, ge=0, le=20)
    position: Literal["bottom", "middle", "top"] = "bottom"
    margin_v: int = Field(260, ge=0, le=1000)
    animation: Literal["none", "karaoke", "pop"] = "karaoke"
    words_per_line: int = Field(4, ge=1, le=12)

    @field_validator("color", "highlight_color", "outline_color")
    @classmethod
    def _hex(cls, v: str) -> str:
        v = v.strip()
        if not (len(v) == 7 and v.startswith("#") and all(c in "0123456789abcdefABCDEF" for c in v[1:])):
            raise ValueError("Color debe ser #RRGGBB")
        return v.upper()


class Subtitles(BaseModel):
    enabled: bool = True
    style: SubtitleStyle = Field(default_factory=SubtitleStyle)
    cues: list[Cue] = Field(default_factory=list)


class Audio(BaseModel):
    normalize: bool = True
    target_lufs: float = Field(-14.0, ge=-30, le=-5)
    limiter: bool = True
    denoise: bool = False
    gain_db: float = Field(0.0, ge=-20, le=20)


class Fades(BaseModel):
    video_in: float = Field(0.15, ge=0, le=3)
    video_out: float = Field(0.25, ge=0, le=3)


EMOJIS = ("laugh", "rofl", "shock", "fire", "skull", "flushed", "cry", "cool", "hundred", "eyes")
EmojiName = Literal["laugh", "rofl", "shock", "fire", "skull", "flushed", "cry", "cool", "hundred", "eyes"]


class Overlay(BaseModel):
    """Emote superpuesto. `t` está en la línea de tiempo de SALIDA; x/y son el centro (0..1)."""

    kind: Literal["emoji"] = "emoji"
    name: EmojiName
    t: float = Field(ge=0)
    duration: float = Field(1.6, ge=0.3, le=5)
    x: float = Field(0.8, ge=0, le=1)
    y: float = Field(0.2, ge=0, le=1)
    size: float = Field(0.2, ge=0.05, le=0.5)  # fracción del ancho del vídeo


class TitleCard(BaseModel):
    """Título gancho al inicio del clip."""

    enabled: bool = False
    text: str = Field("", max_length=80)
    duration: float = Field(2.6, ge=1, le=6)


class EditSpec(BaseModel):
    version: int = 1
    source_asset_id: str
    segments: list[Segment] = Field(min_length=1, max_length=50)
    format: Literal["9:16", "16:9", "1:1"] = "9:16"
    quality: Literal["1080p", "720p"] = "1080p"
    layout: Layout = Field(default_factory=Layout)
    zoom: Zoom = Field(default_factory=Zoom)
    subtitles: Subtitles = Field(default_factory=Subtitles)
    audio: Audio = Field(default_factory=Audio)
    fades: Fades = Field(default_factory=Fades)
    overlays: list[Overlay] = Field(default_factory=list, max_length=12)
    title_card: TitleCard = Field(default_factory=TitleCard)
    auto_edit: bool = True

    @property
    def output_duration(self) -> float:
        return sum(s.end - s.start for s in self.segments)

    def size(self) -> tuple[int, int]:
        w, h = FORMAT_SIZES[self.format]
        k = QUALITY_SCALE[self.quality]
        return int(round(w * k / 2) * 2), int(round(h * k / 2) * 2)

    def to_output_time(self, t: float) -> float | None:
        """Convierte un tiempo absoluto del original al tiempo del clip (None si quedó fuera)."""
        acc = 0.0
        for s in self.segments:
            if s.start <= t <= s.end:
                return acc + (t - s.start)
            acc += s.end - s.start
        return None


def cues_from_words(words: list[dict], start: float, end: float, words_per_line: int = 4,
                    max_chars: int = 24) -> list[dict]:
    """Agrupa palabras (tiempos absolutos) en subtítulos cortos estilo redes sociales."""
    cues: list[dict] = []
    group: list[dict] = []

    def flush() -> None:
        if group:
            cues.append({"start": group[0]["start"], "end": group[-1]["end"],
                         "text": " ".join(w["text"].strip() for w in group).strip(),
                         "words": [{"start": w["start"], "end": w["end"], "text": w["text"].strip()}
                                   for w in group]})
            group.clear()

    for w in words:
        if w["end"] <= start or w["start"] >= end or not w["text"].strip():
            continue
        if group and w["start"] - group[-1]["end"] > 0.8:
            flush()
        group.append(w)
        txt = " ".join(x["text"].strip() for x in group)
        if len(group) >= words_per_line or len(txt) >= max_chars or w["text"].strip()[-1:] in ".?!,":
            flush()
    flush()
    return cues
