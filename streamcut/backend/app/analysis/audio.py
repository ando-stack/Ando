"""Análisis acústico.

Se calculan descriptores cada HOP segundos sobre audio mono 16 kHz y se normalizan respecto a una
línea base LOCAL (mediana/MAD móvil de ~60 s). Así un micrófono permanentemente alto no genera
falsos positivos: lo que cuenta es el cambio respecto a lo que había alrededor.

Detectores (heurísticos, explicables y sin modelos pesados):
- loud_reaction: subida brusca y sostenida de energía.
- scream: energía alta + centroide espectral alto + baja planitud (voz tensa, no ruido).
- laughter: ráfagas de energía muy regulares a 3-7 Hz durante >1 s (patrón "ja-ja-ja").
- silence: tramos de energía muy baja (puntos de corte naturales).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

SR = 16000
HOP = 0.25  # segundos por muestra de la serie
_FRAME = 512  # ventana corta para envolvente (32 ms)


@dataclass
class AudioFeatures:
    hop: float
    rms_db: np.ndarray
    centroid: np.ndarray
    flatness: np.ndarray
    zcr: np.ndarray
    onset: np.ndarray
    laugh_mod: np.ndarray  # regularidad de la envolvente a 3-7 Hz (0..1)
    clip_ratio: float = 0.0
    noise_floor_db: float = -60.0
    z_energy: np.ndarray = field(default_factory=lambda: np.zeros(0))
    z_centroid: np.ndarray = field(default_factory=lambda: np.zeros(0))

    @property
    def n(self) -> int:
        return len(self.rms_db)

    @property
    def duration(self) -> float:
        return self.n * self.hop


@dataclass
class AudioEvent:
    type: str
    start: float
    end: float
    confidence: float
    value: float
    label: str


def _frames(x: np.ndarray, size: int) -> np.ndarray:
    n = len(x) // size
    return x[: n * size].reshape(n, size)


def rolling_robust_z(x: np.ndarray, window: int, floor: float = 1.0,
                     mask: np.ndarray | None = None, exclude: int = 0) -> np.ndarray:
    """z-score robusto respecto a la mediana/MAD de una ventana centrada (línea base LOCAL).

    `mask` limita la línea base a las muestras activas (p. ej. con voz): así los silencios no
    rebajan la referencia y un micro siempre alto no dispara falsos positivos. `exclude` deja
    fuera ±exclude muestras alrededor del centro para que un evento no eleve su propia base.
    """
    n = len(x)
    if n == 0:
        return x.astype(np.float32)
    if mask is None:
        mask = np.ones(n, dtype=bool)
    step = max(1, window // 16)
    centers = np.arange(0, n, step)
    med = np.empty(len(centers), dtype=np.float32)
    mad = np.empty(len(centers), dtype=np.float32)
    half = window // 2
    gmask = x[mask] if mask.any() else x
    gmed = float(np.median(gmask))
    gmad = float(np.median(np.abs(gmask - gmed)) * 1.4826)
    for i, c in enumerate(centers):
        a, b = max(0, c - half), min(n, c + half + 1)
        sel = mask[a:b].copy()
        if exclude:
            sel[max(0, c - exclude - a): max(0, c + exclude + 1 - a)] = False
        seg = x[a:b][sel]
        if seg.size < max(8, window // 10):
            med[i], mad[i] = gmed, gmad
            continue
        m = np.median(seg)
        med[i] = m
        mad[i] = np.median(np.abs(seg - m)) * 1.4826
    med_full = np.interp(np.arange(n), centers, med)
    mad_full = np.maximum(np.interp(np.arange(n), centers, mad), floor)
    return ((x - med_full) / mad_full).astype(np.float32)


def _periodicity(env: np.ndarray, rate: float, lo_hz: float = 3.0, hi_hz: float = 7.5) -> float:
    """Regularidad de la envolvente (autocorrelación normalizada máxima entre lo_hz y hi_hz).

    La risa ("ja-ja-ja") produce ráfagas muy regulares; el habla normal, mucho menos.
    """
    e = env - env.mean()
    denom = float((e * e).sum())
    if denom <= 1e-12:
        return 0.0
    lags = range(max(1, int(rate / hi_hz)), int(rate / lo_hz) + 1)
    best = 0.0
    for lag in lags:
        if lag >= len(e) - 2:
            break
        r = float((e[:-lag] * e[lag:]).sum()) / denom
        best = max(best, r)
    return best


def compute_features(samples: np.ndarray, sr: int = SR, hop: float = HOP) -> AudioFeatures:
    if samples.size == 0:
        z = np.zeros(1, dtype=np.float32)
        return AudioFeatures(hop, z - 80, z, z, z, z, z)
    clip_ratio = float(np.mean(np.abs(samples) > 0.985))
    hop_n = int(sr * hop)
    blocks = _frames(samples, hop_n)
    if blocks.shape[0] == 0:
        blocks = samples[None, :]
    rms = np.sqrt(np.mean(blocks ** 2, axis=1) + 1e-10)
    rms_db = 20 * np.log10(rms)
    zcr = np.mean(np.abs(np.diff(np.sign(blocks), axis=1)) > 0, axis=1)

    # Espectro por bloque (ventana Hann sobre los primeros 2048 puntos del bloque)
    nfft = min(2048, blocks.shape[1])
    win = np.hanning(nfft).astype(np.float32)
    spec = np.abs(np.fft.rfft(blocks[:, :nfft] * win, axis=1)) + 1e-9
    freqs = np.fft.rfftfreq(nfft, 1 / sr)
    centroid = (spec * freqs).sum(axis=1) / spec.sum(axis=1)
    flatness = np.exp(np.mean(np.log(spec), axis=1)) / np.mean(spec, axis=1)
    flux = np.r_[0, np.sqrt((np.diff(np.log(spec), axis=0).clip(min=0) ** 2).sum(axis=1))]

    # Regularidad de la envolvente (patrón de risa ≈ 3-7 Hz) en ventanas de 1.5 s
    env_frames = _frames(samples, _FRAME // 2)
    env = np.sqrt(np.mean(env_frames ** 2, axis=1) + 1e-10) if env_frames.size else np.zeros(1)
    env_rate = sr / (_FRAME // 2)  # ~62 Hz
    per_hop = hop * env_rate
    win_env = int(1.5 * env_rate)
    laugh = np.zeros(len(rms), dtype=np.float32)
    if len(env) > win_env:
        for i in range(len(rms)):
            c = int(i * per_hop)
            seg = env[max(0, c - win_env // 2): max(0, c - win_env // 2) + win_env]
            if len(seg) == win_env:
                laugh[i] = _periodicity(seg, env_rate)

    floor = float(np.percentile(rms_db, 10))
    feats = AudioFeatures(hop=hop, rms_db=rms_db.astype(np.float32), centroid=centroid.astype(np.float32),
                          flatness=flatness.astype(np.float32), zcr=zcr.astype(np.float32),
                          onset=flux.astype(np.float32), laugh_mod=laugh, clip_ratio=clip_ratio,
                          noise_floor_db=floor)
    window = int(90 / hop)
    # Muestras "activas" para la línea base: si una parte relevante del audio está claramente por
    # encima del ruido de fondo (voz/juego frente a silencios) solo cuenta esa parte; si el audio es
    # continuo y uniforme, todo cuenta como actividad normal.
    loud = feats.rms_db > floor + 10
    active = loud if float(loud.mean()) >= 0.15 else feats.rms_db > floor - 1
    excl = int(3 / hop)
    feats.z_energy = rolling_robust_z(feats.rms_db, window, floor=2.0, mask=active, exclude=excl)
    feats.z_energy[~active] = np.minimum(feats.z_energy[~active], 0)
    feats.z_centroid = rolling_robust_z(feats.centroid, window, floor=80.0, mask=active, exclude=excl)
    return feats


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    out = []
    i = 0
    n = len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j < n and mask[j]:
                j += 1
            out.append((i, j))
            i = j
        else:
            i += 1
    return out


def _merge(events: list[AudioEvent], gap: float = 0.8) -> list[AudioEvent]:
    """Une eventos del mismo tipo separados por menos de `gap` segundos."""
    out: list[AudioEvent] = []
    for ev in sorted(events, key=lambda e: (e.type, e.start)):
        last = out[-1] if out else None
        if last and last.type == ev.type and ev.start - last.end <= gap:
            last.end = max(last.end, ev.end)
            if ev.value > last.value:
                last.value, last.label = ev.value, ev.label
            last.confidence = max(last.confidence, ev.confidence)
        else:
            out.append(AudioEvent(ev.type, ev.start, ev.end, ev.confidence, ev.value, ev.label))
    return sorted(out, key=lambda e: e.start)


def detect_events(f: AudioFeatures, sensitivity: float = 1.0) -> list[AudioEvent]:
    """Eventos acústicos. `sensitivity` > 1 detecta más (umbrales más bajos)."""
    events: list[AudioEvent] = []
    h = f.hop
    if f.n < 4:
        return events
    active = f.rms_db > (f.noise_floor_db + 6)
    thr = 2.6 / sensitivity

    # Reacciones fuertes: z de energía alto sostenido ≥ 0.5 s
    for a, b in _runs((f.z_energy > thr) & active):
        if (b - a) * h < 0.5:
            continue
        peak = float(f.z_energy[a:b].max())
        conf = float(min(1.0, (peak - thr) / 3 + 0.5))
        events.append(AudioEvent("loud_reaction", a * h, b * h, conf, peak,
                                 f"Reacción intensa (+{peak:.1f}σ de volumen)"))

    # Gritos: fuerte + agudo + tonal
    scream_mask = (f.z_energy > thr * 0.9) & (f.z_centroid > 1.5 / sensitivity) & (f.flatness < 0.35) & active
    for a, b in _runs(scream_mask):
        if (b - a) * h < 0.5:
            continue
        peak = float(f.z_energy[a:b].max())
        conf = float(min(1.0, 0.45 + 0.1 * peak))
        events.append(AudioEvent("scream", a * h, b * h, conf, peak, "Posible grito"))

    # Risas: modulación 3-7 Hz con voz activa ≥ 1 s
    laugh_mask = (f.laugh_mod > 0.6 / min(sensitivity, 1.3)) & active
    for a, b in _runs(laugh_mask):
        if (b - a) * h < 1.0:
            continue
        val = float(f.laugh_mod[a:b].mean())
        conf = float(min(0.95, 0.2 + val * 0.75))
        events.append(AudioEvent("laughter", a * h, b * h, conf, val, "Posible risa"))

    events = _merge(events)

    # Silencios ≥ 1.5 s (puntos de corte)
    silent = f.rms_db < (f.noise_floor_db + 3)
    for a, b in _runs(silent):
        if (b - a) * h >= 1.5:
            events.append(AudioEvent("silence", a * h, b * h, 0.9, float(f.rms_db[a:b].mean()), "Silencio"))
    return events


def silence_points(f: AudioFeatures, min_len: float = 0.3) -> np.ndarray:
    """Centros de pausas cortas (≥ min_len) útiles para no cortar en mitad de una palabra."""
    silent = f.rms_db < (np.percentile(f.rms_db, 25) + 2)
    pts = [((a + b) / 2) * f.hop for a, b in _runs(silent) if (b - a) * f.hop >= min_len]
    return np.asarray(pts, dtype=np.float32)


def audio_quality(f: AudioFeatures, start: float, end: float) -> float:
    """0..1: penaliza saturación y una relación señal/ruido pobre en el tramo."""
    a, b = int(start / f.hop), max(int(start / f.hop) + 1, int(end / f.hop))
    seg = f.rms_db[a:b]
    if seg.size == 0:
        return 0.0
    snr = float(np.percentile(seg, 90) - f.noise_floor_db)
    q = np.clip(snr / 30, 0, 1)
    q -= min(0.5, f.clip_ratio * 50)
    return float(np.clip(q, 0, 1))
