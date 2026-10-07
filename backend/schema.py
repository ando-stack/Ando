"""Esquema de project.json y su validación.

project.json describe TODA la edición. Los tiempos son segundos (float):
- Los tiempos "de fuente" (in/out de segmentos, caras, palabras originales) se miden
  sobre el archivo original.
- Los tiempos "de salida" (start/end de textos, emojis, zooms, subtítulos...) se miden
  sobre el vídeo final, que es la concatenación de los segmentos de la pista de vídeo.
Las posiciones (x, y) son relativas al lienzo: 0..1.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

SCHEMA_VERSION = 1
EPS = 1e-3


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------- fuentes
class Source(Strict):
    id: str
    name: str                      # nombre original del archivo
    original: str                  # ruta relativa a la carpeta del proyecto (nunca se modifica)
    proxy: Optional[str] = None    # versión ligera para previsualizar
    audio: Optional[str] = None    # audio procesado (loudnorm + reducción de ruido)
    corrected: Optional[str] = None        # original con LUT (render)
    correctedProxy: Optional[str] = None   # proxy con LUT (previsualización)
    duration: float = Field(gt=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    fps: float = Field(gt=0)
    rotation: int = 0
    hasAudio: bool = True
    videoCodec: str = ""
    audioCodec: str = ""
    creationTime: Optional[str] = None
    device: Optional[str] = None


class Segment(Strict):
    """Tramo de un clip fuente colocado en la pista de vídeo (se concatenan en orden)."""
    id: str
    sourceId: str
    inPoint: float = Field(ge=0)
    outPoint: float = Field(gt=0)
    volume: float = Field(default=1.0, ge=0, le=4)
    reframeX: Optional[float] = Field(default=None, ge=0, le=1)  # centro manual para 9:16

    @model_validator(mode="after")
    def _check(self):
        if self.outPoint - self.inPoint < 0.04:
            raise ValueError(f"segmento {self.id}: la duración debe ser al menos 0.04 s")
        return self


class TimedItem(Strict):
    id: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)

    @model_validator(mode="after")
    def _check_times(self):
        if self.end - self.start < 0.04:
            raise ValueError(f"{self.id}: 'end' debe ser mayor que 'start' (mín. 0.04 s)")
        return self


# ---------------------------------------------------------------- subtítulos
class CaptionWord(Strict):
    text: str
    start: float = Field(ge=0)
    end: float = Field(ge=0)


class CaptionBlock(TimedItem):
    words: list[CaptionWord] = Field(min_length=1)


CaptionPreset = Literal["clasico", "tiktok", "neon", "minimal", "karaoke"]


class CaptionStyle(Strict):
    preset: CaptionPreset = "tiktok"
    font: str = "Montserrat"
    fontSize: float = Field(default=0.055, gt=0.01, le=0.25)  # relativo a la altura del lienzo
    color: str = "#FFFFFF"
    highlightColor: str = "#FFD400"
    strokeColor: str = "#000000"
    background: bool = False
    backgroundColor: str = "#000000AA"
    y: float = Field(default=0.8, ge=0, le=1)
    uppercase: bool = True
    maxWords: int = Field(default=4, ge=1, le=12)


class Captions(Strict):
    style: CaptionStyle = CaptionStyle()
    blocks: list[CaptionBlock] = []


# ---------------------------------------------------------------- textos / emojis
Animation = Literal["none", "fade", "pop", "slide-up", "slide-left", "typewriter", "bounce"]


class TextStyle(Strict):
    font: str = "Montserrat"
    fontSize: float = Field(default=0.07, gt=0.01, le=0.4)
    color: str = "#FFFFFF"
    background: Optional[str] = "#E6007ECC"
    strokeColor: Optional[str] = None
    bold: bool = True
    uppercase: bool = False


class TextItem(TimedItem):
    text: str = Field(min_length=1, max_length=200)
    kind: Literal["titulo", "texto", "dato"] = "texto"
    x: float = Field(default=0.5, ge=0, le=1)
    y: float = Field(default=0.2, ge=0, le=1)
    animation: Animation = "pop"
    style: TextStyle = TextStyle()


class EmojiItem(TimedItem):
    emoji: str = Field(min_length=1, max_length=16)
    file: str                      # nombre del svg en /assets/emojis
    x: float = Field(default=0.8, ge=0, le=1)
    y: float = Field(default=0.3, ge=0, le=1)
    size: float = Field(default=0.14, gt=0.02, le=0.6)  # relativo a la altura
    rotation: float = Field(default=0, ge=-180, le=180)
    animation: Animation = "pop"


# ---------------------------------------------------------------- efectos
class ZoomItem(TimedItem):
    kind: Literal["punch", "smooth"] = "smooth"   # punch = salto inmediato; smooth = acercamiento progresivo
    scale: float = Field(default=1.15, ge=1.0, le=3.0)
    x: float = Field(default=0.5, ge=0, le=1)     # punto de enfoque
    y: float = Field(default=0.45, ge=0, le=1)


class TransitionItem(Strict):
    id: str
    at: float = Field(ge=0)                       # tiempo de salida del corte
    duration: float = Field(default=0.4, gt=0.05, le=2.0)
    type: Literal["fade", "flash", "zoom", "whip", "glitch"] = "fade"
    sfx: Optional[str] = None


# ---------------------------------------------------------------- color
class ColorAnalysis(Strict):
    luma: float = 0
    contrast: float = 0
    saturation: float = 0
    tempBias: float = 0          # >0 dominante cálida, <0 fría
    tintBias: float = 0          # >0 magenta, <0 verde
    clippedHigh: float = 0
    clippedLow: float = 0
    issues: list[str] = []


class ColorSettings(Strict):
    enabled: bool = False
    needsCorrection: bool = False
    analyzed: bool = False
    analysis: Optional[ColorAnalysis] = None
    lutFile: Optional[str] = None
    intensity: float = Field(default=1.0, ge=0, le=1)
    temperature: float = Field(default=0, ge=-1, le=1)   # ajuste manual extra
    exposure: float = Field(default=0, ge=-1, le=1)
    contrast: float = Field(default=0, ge=-1, le=1)
    saturation: float = Field(default=0, ge=-1, le=1)
    version: int = 0
    message: str = ""


# ---------------------------------------------------------------- caras
class FaceSample(Strict):
    t: float                      # tiempo de fuente
    x: float                      # caja normalizada (esquina sup. izq.)
    y: float
    w: float
    h: float
    interpolated: bool = False


class FaceTrackPart(Strict):
    sourceId: str
    samples: list[FaceSample]


class FaceTrack(Strict):
    id: str
    label: str
    thumbnail: Optional[str] = None
    parts: list[FaceTrackPart] = []


class SourceRange(Strict):
    sourceId: str
    start: float
    end: float


class PixelateItem(TimedItem):
    faceId: str
    mode: Literal["pixelate", "blur"] = "pixelate"
    intensity: float = Field(default=0.75, ge=0.05, le=1)
    margin: float = Field(default=0.35, ge=0, le=1.5)


class Faces(Strict):
    analyzed: bool = False
    tracks: list[FaceTrack] = []
    unreliable: list[SourceRange] = []
    pixelate: list[PixelateItem] = []
    verification: list[dict] = []


# ---------------------------------------------------------------- audio
class Music(Strict):
    file: str                     # nombre del archivo en /assets/music
    volume: float = Field(default=0.25, ge=0, le=1.5)
    ducking: bool = True
    duckVolume: float = Field(default=0.08, ge=0, le=1)
    start: float = Field(default=0, ge=0)
    end: Optional[float] = None
    fadeIn: float = 1.0
    fadeOut: float = 2.0


class SfxItem(Strict):
    id: str
    file: str                     # nombre del archivo en /assets/sfx
    at: float = Field(ge=0)
    volume: float = Field(default=0.6, ge=0, le=2)


class AudioSettings(Strict):
    normalize: bool = True
    denoise: bool = True
    voiceVolume: float = Field(default=1.0, ge=0, le=4)
    music: Optional[Music] = None
    sfx: list[SfxItem] = []
    speech: list[list[float]] = []      # tramos con voz (tiempo de salida) para el ducking


# ---------------------------------------------------------------- reencuadre vertical
class ReframeSample(Strict):
    t: float            # tiempo de fuente
    x: float            # centro horizontal (0..1) de la persona que habla


class ReframePart(Strict):
    sourceId: str
    samples: list[ReframeSample] = []


class Reframe(Strict):
    auto: bool = True
    offset: float = Field(default=0, ge=-0.5, le=0.5)    # ajuste manual global
    parts: list[ReframePart] = []


# ---------------------------------------------------------------- pistas / ajustes
TRACKS = ["video", "subtitulos", "textos", "emojis", "zooms", "transiciones",
          "color", "pixelado", "musica", "sfx"]


class TrackState(Strict):
    enabled: bool = True


def _default_tracks():
    return {t: TrackState() for t in TRACKS}


class Canvas(Strict):
    width: int = Field(default=1920, ge=128, le=7680)
    height: int = Field(default=1080, ge=128, le=7680)
    fps: float = Field(default=30, gt=0, le=120)
    aspect: Literal["16:9", "9:16"] = "16:9"


class AutoEditSettings(Strict):
    silences: bool = True
    silenceThresholdDb: float = Field(default=-35, ge=-80, le=-5)
    minSilence: float = Field(default=0.6, ge=0.1, le=5)
    silencePadding: float = Field(default=0.12, ge=0, le=1)
    fillers: bool = True
    retakes: bool = True
    punchIns: bool = True
    punchInScale: float = Field(default=1.12, ge=1, le=2)
    smoothZooms: bool = True
    subtitles: bool = True
    captionPreset: CaptionPreset = "tiktok"
    texts: bool = True
    emojis: bool = True
    emojisPerMinute: float = Field(default=3, ge=0, le=20)
    transitions: bool = True
    normalizeAudio: bool = True
    denoise: bool = True
    music: Optional[str] = None
    musicVolume: float = Field(default=0.2, ge=0, le=1)
    sfx: bool = False
    color: bool = True
    intensity: float = Field(default=0.6, ge=0, le=1)   # intensidad global de la edición creativa
    language: str = "es"


class CutMark(Strict):
    at: float
    reason: str


class ChatMessage(Strict):
    role: Literal["user", "assistant", "system"]
    content: str
    time: str
    changes: list[str] = []
    pending: bool = False


class Project(Strict):
    version: int = SCHEMA_VERSION
    name: str
    createdAt: str
    updatedAt: str
    canvas: Canvas = Canvas()
    previewCodec: Literal["h264", "vp9"] = "h264"   # códec de los proxies (según lo que reproduzca el navegador)
    sources: list[Source] = []
    segments: list[Segment] = []
    captions: Captions = Captions()
    texts: list[TextItem] = []
    emojis: list[EmojiItem] = []
    zooms: list[ZoomItem] = []
    transitions: list[TransitionItem] = []
    color: ColorSettings = ColorSettings()
    faces: Faces = Faces()
    audio: AudioSettings = AudioSettings()
    reframe: Reframe = Reframe()
    tracks: dict[str, TrackState] = Field(default_factory=_default_tracks)
    cuts: list[CutMark] = []
    autoEdit: AutoEditSettings = AutoEditSettings()
    warnings: list[str] = []
    chat: list[ChatMessage] = []
    transcript: list[dict] = []    # palabras con tiempo de fuente: {sourceId,start,end,text}

    @model_validator(mode="after")
    def _cross_checks(self):
        errors = []
        src = {s.id: s for s in self.sources}
        if len(src) != len(self.sources):
            errors.append("hay fuentes con id repetido")
        for seg in self.segments:
            s = src.get(seg.sourceId)
            if not s:
                errors.append(f"segmento {seg.id}: la fuente '{seg.sourceId}' no existe")
            elif seg.outPoint > s.duration + 0.05:
                errors.append(f"segmento {seg.id}: outPoint {seg.outPoint:.2f} supera la duración del clip ({s.duration:.2f})")
            if seg.inPoint >= seg.outPoint:
                errors.append(f"segmento {seg.id}: inPoint debe ser menor que outPoint")
        total = self.duration()
        ids: set[str] = set()
        groups = [("texto", self.texts), ("emoji", self.emojis), ("zoom", self.zooms),
                  ("subtítulo", self.captions.blocks), ("pixelado", self.faces.pixelate)]
        for label, items in groups:
            for it in items:
                if it.id in ids:
                    errors.append(f"id repetido: {it.id}")
                ids.add(it.id)
                if it.start > total + EPS:
                    errors.append(f"{label} {it.id}: empieza en {it.start:.2f}s, después del final del vídeo ({total:.2f}s)")
        for tr in self.transitions:
            if tr.at > total + EPS:
                errors.append(f"transición {tr.id}: está después del final del vídeo")
        for sfx in self.audio.sfx:
            if sfx.at > total + EPS:
                errors.append(f"efecto de sonido {sfx.id}: está después del final del vídeo")
        face_ids = {f.id for f in self.faces.tracks}
        for p in self.faces.pixelate:
            if p.faceId not in face_ids:
                errors.append(f"pixelado {p.id}: la cara '{p.faceId}' no existe")
        for name in self.tracks:
            if name not in TRACKS:
                errors.append(f"pista desconocida: {name}")
        if errors:
            raise ValueError("; ".join(errors))
        return self

    # ------------------------------------------------------------ utilidades
    def duration(self) -> float:
        return sum(s.outPoint - s.inPoint for s in self.segments)

    def source(self, sid: str) -> Optional[Source]:
        return next((s for s in self.sources if s.id == sid), None)


def project_json_schema() -> dict:
    return Project.model_json_schema()


def validation_message(err: ValidationError) -> str:
    parts = []
    for e in err.errors()[:8]:
        loc = ".".join(str(x) for x in e["loc"])
        msg = e["msg"].replace("Value error, ", "")
        parts.append(f"{loc}: {msg}" if loc else msg)
    return "; ".join(parts)


class ProjectInvalid(Exception):
    pass


def validate(data: dict) -> Project:
    try:
        return Project.model_validate(data)
    except ValidationError as e:
        raise ProjectInvalid(validation_message(e)) from e


def load(path: Path) -> Project:
    return validate(json.loads(Path(path).read_text(encoding="utf-8")))


def save(project: Project | dict, path: Path) -> Project:
    """Valida y guarda de forma atómica. Si no es válido, no toca el archivo."""
    from datetime import datetime, timezone
    data = project.model_dump(mode="json") if isinstance(project, Project) else project
    proj = validate(data)
    proj.updatedAt = datetime.now(timezone.utc).isoformat(timespec="seconds")
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".project-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(proj.model_dump(mode="json"), f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)
    return proj
