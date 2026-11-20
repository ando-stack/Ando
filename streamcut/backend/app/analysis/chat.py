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


def _token(text: str) -> str:
    """Emote o palabra representativa de un mensaje de risa/hype (p. ej. "W", "KEKW", "POG")."""
    m = LAUGH.search(text) or HYPE.search(text)
    tok = (m.group(0) if m else text.split()[0] if text.split() else "").strip()
    if re.fullmatch(r"w+", tok, re.IGNORECASE):
        return "W"
    if re.fullmatch(r"(ja|je|ha)+j?", tok, re.IGNORECASE):
        return "JAJAJA"
    return tok.upper()[:20]


class ChatSpikeDetector:
    """Detector incremental para directos. Dispara un momento destacado cuando:

    - "rate": el chat va mucho más rápido de lo normal (mensajes/s frente a los últimos minutos), o
    - "emotes": el chat se llena de golpe de spam de reacción ("W", "KEKW", "POG", "JAJAJA"…) aunque
      la velocidad apenas cambie (canales con el chat siempre rápido).

    Los umbrales se adaptan al tamaño del chat: en canales pequeños (menos de ``small_chat_rate``
    mensajes/s de media) bastan ráfagas más cortas (unos 5–6 mensajes o 3–4 reacciones seguidas) de al
    menos 3 personas distintas.
    """

    def __init__(self, window_s: float = 10.0, baseline_s: float = 300.0, min_rate: float = 1.0,
                 z_threshold: float = 3.0, cooldown_s: float = 30.0, min_emotes: int = 8,
                 emote_ratio: float = 0.5, small_chat_rate: float = 0.5,
                 rate_trigger: bool = True):
        self.window_s = window_s
        self.baseline_s = baseline_s
        self.min_rate = min_rate
        self.z_threshold = z_threshold
        self.cooldown_s = cooldown_s
        self.min_emotes = min_emotes
        self.emote_ratio = emote_ratio
        self.small_chat_rate = small_chat_rate
        self.rate_trigger = rate_trigger  # False: solo cuentan las ráfagas de reacciones
        self.times: list[float] = []
        self.flags: list[tuple[int, int]] = []
        self.tokens: list[str] = []
        self.users: list[str | None] = []
        self.rates: list[float] = []
        self.ratios: list[float] = []
        self.last_spike = -1e9

    def add(self, t: float, text: str, user: str | None = None) -> None:
        self.users.append(user)
        flags = classify(text)
        self.times.append(t)
        self.flags.append(flags)
        self.tokens.append(_token(text) if any(flags) else "")

    def check(self, now: float) -> dict | None:
        cutoff = now - self.baseline_s
        while self.times and self.times[0] < cutoff:
            self.times.pop(0)
            self.flags.pop(0)
            self.tokens.pop(0)
            self.users.pop(0)
        recent = [i for i, t in enumerate(self.times) if t >= now - self.window_s]
        rate = len(recent) / self.window_s
        emo = [i for i in recent if any(self.flags[i])]
        ratio = len(emo) / len(recent) if recent else 0.0
        self.rates.append(rate)
        self.ratios.append(ratio)
        keep = int(self.baseline_s / 2)
        self.rates, self.ratios = self.rates[-keep:], self.ratios[-keep:]
        if len(self.rates) < 10 or now - self.last_spike < self.cooldown_s:
            return None
        base = np.array(self.rates[:-3] or [0.0])
        med = float(np.median(base))
        small = med < self.small_chat_rate
        floor = 0.15 if small else 0.3
        mad = max(float(np.median(np.abs(base - med)) * 1.4826), floor) if small else \
            (float(np.median(np.abs(base - med)) * 1.4826) or max(floor, med * 0.5))
        z = (rate - med) / mad
        base_ratio = float(np.median(self.ratios[:-3] or [0.0]))
        min_rate = min(self.min_rate, 0.5) if small else self.min_rate
        min_emotes = max(3, round(self.min_emotes / 2)) if small else self.min_emotes
        kind = None
        if self.rate_trigger and rate >= min_rate and z >= self.z_threshold:
            kind = "rate"
        elif len(emo) >= min_emotes and ratio >= max(self.emote_ratio, base_ratio + 0.25):
            kind = "emotes"
        if kind is None:
            return None
        # En chats pequeños, una sola persona spameando no es un momento: hacen falta al menos 3 personas
        names = {self.users[i] for i in recent if self.users[i]}
        if small and names and len(names) < 3:
            return None
        self.last_spike = now
        laugh = sum(self.flags[i][0] for i in recent)
        hype = sum(self.flags[i][1] for i in recent)
        counts: dict[str, int] = {}
        for i in emo:
            counts[self.tokens[i]] = counts.get(self.tokens[i], 0) + 1
        top = max(counts, key=counts.get) if counts else None
        return {"kind": kind, "rate": round(rate, 2), "baseline": round(med, 2), "z": round(float(z), 2),
                "laugh": laugh, "hype": hype, "messages": len(recent), "emotes": len(emo),
                "top": top, "top_count": counts.get(top, 0) if top else 0}
