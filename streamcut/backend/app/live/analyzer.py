"""Análisis incremental ligero del directo (señal autorizada).

Por cada segmento nuevo se extrae su audio y se actualiza una ventana deslizante de ~3 minutos.
Las reacciones se confirman cuando ha pasado suficiente tiempo después del pico (contexto
posterior) y entonces se encola la creación del clip, que hace el análisis profundo (transcripción,
semántica, puntuación completa) solo sobre ese fragmento.
"""

from __future__ import annotations

import logging
import subprocess
import time
from dataclasses import dataclass, field

import numpy as np

from app.analysis import audio as audio_mod
from app.media.ffmpeg import ffmpeg_bin

from .ingest import LiveSegment

log = logging.getLogger(__name__)

WINDOW_SECONDS = 180.0
POST_WAIT = 12.0  # segundos de contexto posterior antes de confirmar un momento
COOLDOWN = 25.0


def segment_pcm(seg: LiveSegment, sr: int = 16000) -> np.ndarray:
    raw = subprocess.run([ffmpeg_bin(), "-hide_banner", "-nostdin", "-v", "error", "-i", str(seg.path), "-vn",
                          "-ac", "1", "-ar", str(sr), "-f", "s16le", "pipe:1"], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


@dataclass
class Trigger:
    peak: float  # segundos desde el inicio de la captura
    peak_wall: float
    reason: str
    strength: float
    events: list[dict] = field(default_factory=list)


@dataclass
class IncrementalAnalyzer:
    sensitivity: float = 1.0
    sr: int = 16000
    pcm: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.float32))
    window_start: float = 0.0  # offset (s) del primer sample de `pcm`
    processed_index: int = -1
    confirmed_until: float = 0.0
    last_trigger: float = -1e9
    analyzed_seconds: float = 0.0
    wall_origin: float = 0.0
    reported_events: set = field(default_factory=set)
    arrivals: list = field(default_factory=list)  # (fin del segmento en la captura, hora real de llegada)

    def wall_time(self, t: float) -> float:
        """Hora real aproximada en que ocurrió el instante `t` de la captura (según la llegada del segmento)."""
        for end, arrived in self.arrivals:
            if t <= end:
                return arrived - (end - t)
        return self.wall_origin + t

    def feed(self, seg: LiveSegment) -> None:
        if seg.index <= self.processed_index:
            return
        self.processed_index = seg.index
        self.arrivals.append((seg.end, time.time()))
        self.arrivals = self.arrivals[-200:]
        x = segment_pcm(seg, self.sr)
        if self.pcm.size == 0:
            self.window_start = seg.start
        expected_end = self.window_start + self.pcm.size / self.sr
        gap = seg.start - expected_end
        if gap > 0.5:  # hueco (p. ej. reconexión): se rellena con silencio para mantener la línea temporal
            self.pcm = np.concatenate([self.pcm, np.zeros(int(gap * self.sr), dtype=np.float32)])
        self.pcm = np.concatenate([self.pcm, x])
        excess = self.pcm.size - int(WINDOW_SECONDS * self.sr)
        if excess > 0:
            self.pcm = self.pcm[excess:]
            self.window_start += excess / self.sr
        self.analyzed_seconds += x.size / self.sr

    @property
    def end(self) -> float:
        return self.window_start + self.pcm.size / self.sr

    def step(self) -> tuple[list[Trigger], list[audio_mod.AudioEvent]]:
        """Devuelve (momentos confirmados, eventos acústicos nuevos) con tiempos absolutos de captura."""
        if self.pcm.size < self.sr * 20:
            return [], []
        f = audio_mod.compute_features(self.pcm, self.sr)
        events = audio_mod.detect_events(f, self.sensitivity)
        zone_end = self.end - POST_WAIT
        zone_start = max(self.confirmed_until, self.window_start + 10)
        triggers: list[Trigger] = []
        new_events: list[audio_mod.AudioEvent] = []
        for ev in events:
            a = ev.start + self.window_start
            b = ev.end + self.window_start
            if ev.type == "silence" or not (zone_start <= a < zone_end):
                continue
            key = (ev.type, round(a))
            if key in self.reported_events:
                continue
            self.reported_events.add(key)
            new_events.append(audio_mod.AudioEvent(ev.type, a, b, ev.confidence, ev.value, ev.label))
        strong = [e for e in new_events if e.type in ("loud_reaction", "scream", "laughter")
                  and e.confidence >= 0.55]
        if strong:
            best = max(strong, key=lambda e: e.confidence * (1 + e.value / 10))
            if best.start - self.last_trigger >= COOLDOWN:
                self.last_trigger = best.start
                triggers.append(Trigger(best.start + 0.5, self.wall_time(best.start + 0.5), best.label,
                                        best.confidence,
                                        [{"type": e.type, "start": e.start, "end": e.end, "confidence": e.confidence}
                                         for e in strong]))
        self.confirmed_until = max(self.confirmed_until, zone_end)
        if len(self.reported_events) > 5000:
            self.reported_events = {k for k in self.reported_events if k[1] > self.window_start}
        return triggers, new_events
