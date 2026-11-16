"""Señal de chat: picos de mensajes/segundo y emotes de risa o hype.

Es una señal complementaria. Los mensajes se adelantan CHAT_DELAY segundos porque el chat
reacciona con retraso a lo que ocurre en pantalla.
"""

from __future__ import annotations

import re

import numpy as np

CHAT_DELAY = 6.0

LAUGH = re.compile(r"(KEKW|LUL|OMEGALUL|LMAO|ICANT|pepeLaugh|jaja|jeje|haha|xd+\b|😂|🤣|💀)", re.IGNORECASE)
HYPE = re.compile(r"(Pog\w*|POGGERS|\bW+\b|EZ\b|Clap|GG\b|🔥|LETSGO|monkaS|NOO+|WTF|OMG)", re.IGNORECASE)


def classify(text: str) -> tuple[int, int]:
    return int(bool(LAUGH.search(text))), int(bool(HYPE.search(text)))


def series(messages: list[tuple[float, str]], n: int, hop: float, delay: float = CHAT_DELAY) -> dict:
    total = np.zeros(n, dtype=np.float32)
    laugh = np.zeros(n, dtype=np.float32)
    hype = np.zeros(n, dtype=np.float32)
    for t, text in messages:
        i = int((t - delay) / hop)
        if 0 <= i < n:
            total[i] += 1
            a, b = classify(text)
            laugh[i] += a
            hype[i] += b
    return {"total": total, "laugh": laugh, "hype": hype}


def activity_score(s: dict, hop: float) -> np.ndarray:
    """0..1 a partir del z robusto de mensajes por segundo (ventana 5 s) y su composición."""
    k = max(1, int(5 / hop))
    kern = np.ones(k, dtype=np.float32) / (k * hop)
    rate = np.convolve(s["total"], kern, mode="same")
    if rate.max() <= 0:
        return np.zeros_like(rate)
    med = float(np.median(rate))
    mad = float(np.median(np.abs(rate - med)) * 1.4826) or max(0.2, med * 0.5)
    z = np.clip((rate - med) / mad, 0, 8) / 8
    emo = np.convolve(s["laugh"] + s["hype"], np.ones(k, dtype=np.float32), mode="same")
    tot = np.convolve(s["total"], np.ones(k, dtype=np.float32), mode="same")
    frac = np.divide(emo, tot, out=np.zeros_like(emo), where=tot > 0)
    return np.clip(z * (0.7 + 0.5 * frac), 0, 1).astype(np.float32)


class ChatSpikeDetector:
    """Detector incremental para directos: mensajes/s frente a la línea base de los últimos minutos."""

    def __init__(self, window_s: float = 10.0, baseline_s: float = 300.0, min_rate: float = 1.0,
                 z_threshold: float = 3.0, cooldown_s: float = 45.0):
        self.window_s = window_s
        self.baseline_s = baseline_s
        self.min_rate = min_rate
        self.z_threshold = z_threshold
        self.cooldown_s = cooldown_s
        self.times: list[float] = []
        self.flags: list[tuple[int, int]] = []
        self.rates: list[float] = []
        self.last_spike = -1e9

    def add(self, t: float, text: str) -> None:
        self.times.append(t)
        self.flags.append(classify(text))

    def check(self, now: float) -> dict | None:
        cutoff = now - self.baseline_s
        while self.times and self.times[0] < cutoff:
            self.times.pop(0)
            self.flags.pop(0)
        recent = [i for i, t in enumerate(self.times) if t >= now - self.window_s]
        rate = len(recent) / self.window_s
        self.rates.append(rate)
        self.rates = self.rates[-int(self.baseline_s / 2):]
        if len(self.rates) < 10 or now - self.last_spike < self.cooldown_s:
            return None
        base = np.array(self.rates[:-3] or [0.0])
        med = float(np.median(base))
        mad = float(np.median(np.abs(base - med)) * 1.4826) or max(0.3, med * 0.5)
        z = (rate - med) / mad
        if rate >= self.min_rate and z >= self.z_threshold:
            self.last_spike = now
            laugh = sum(self.flags[i][0] for i in recent)
            hype = sum(self.flags[i][1] for i in recent)
            return {"rate": round(rate, 2), "baseline": round(med, 2), "z": round(float(z), 2),
                    "laugh": laugh, "hype": hype, "messages": len(recent)}
        return None
