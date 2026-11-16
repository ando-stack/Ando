"""Análisis semántico de la transcripción (español e inglés).

Modelo léxico explicable: cada segmento recibe puntuaciones por categoría a partir de expresiones
típicas de reacciones, remates, historias, victorias, derrotas, fallos, sustos y risas, más
rasgos prosódicos del texto (exclamaciones, mayúsculas, repeticiones, velocidad de habla).

Es deliberadamente transparente: el resultado incluye qué frases dispararon la puntuación, para
que la explicación del clip sea verificable. Puede sustituirse por un modelo de lenguaje
implementando la misma interfaz (`score_segments`).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

import numpy as np

from .transcribe import Segment

CATEGORIES = ("funny", "reaction", "scare", "epic_play", "victory", "defeat", "fail", "story",
              "conversation", "hype")

CATEGORY_LABELS = {
    "funny": "Momento divertido",
    "reaction": "Reacción exagerada",
    "scare": "Susto",
    "epic_play": "Jugada increíble",
    "victory": "Victoria",
    "defeat": "Derrota inesperada",
    "fail": "Error gracioso",
    "story": "Historia / conversación interesante",
    "conversation": "Conversación",
    "hype": "Momento emocionante",
    "chat": "Reacción del chat",
}

_LEX: dict[str, list[str]] = {
    "funny": [r"ja(ja)+", r"je(je)+", r"ha(ha)+", r"\blol\b", r"\blmao\b", r"\bxd+\b", r"me (muero|meo|parto)",
              r"qu[eé] risa", r"\bqu[eé] gracioso", r"i'?m dying", r"that'?s hilarious", r"\(laugh",
              r"\[laugh", r"\brisas?\b", r"laughter", r"\bjodido\b"],
    "reaction": [r"no puede ser", r"qu[eé] (dices|acaba|fuerte|locura)", r"no me lo creo", r"en serio",
                 r"oh dios", r"dios m[ií]o", r"what the", r"oh my god", r"\bomg\b", r"no way", r"are you serious",
                 r"what\?+", r"\bwtf\b", r"madre m[ií]a", r"hostia", r"\bostras\b", r"wow+", r"\bno+o+\b",
                 r"c[oó]mo\?+", r"\bque\?{2,}"],
    "scare": [r"susto", r"me (cago|asust)", r"qu[eé] miedo", r"\bjump ?scare", r"scared", r"scary",
              r"\bah+h+\b", r"oh no", r"help", r"socorro", r"\bcorre+\b", r"\brun+\b"],
    "epic_play": [r"clutch", r"headshot", r"\bace\b", r"qu[eé] (jugada|tiro|crack|bestia)", r"vamos+",
                  r"let'?s go+", r"insane", r"incre[ií]ble", r"no fall[oó]", r"one tap", r"triple", r"quadra",
                  r"penta", r"\bpog", r"what a (shot|play)", r"brutal"],
    "victory": [r"ganamos", r"hemos ganado", r"victoria", r"\bgg\b", r"we won", r"victory", r"winner",
                r"lo logr[eé]", r"lo conseguimos", r"campe[oó]n", r"first place", r"primer puesto", r"\bwin\b"],
    "defeat": [r"perdimos", r"hemos perdido", r"me mataron", r"he muerto", r"estoy muerto", r"we lost",
               r"i died", r"game over", r"derrota", r"defeat", r"eliminad[oa]", r"me han matado"],
    "fail": [r"la cagu[eé]", r"qu[eé] manco", r"fallo", r"me equivoqu[eé]", r"oops", r"my bad", r"i missed",
             r"fall[eé]", r"qu[eé] torpe", r"sin querer", r"by accident", r"what did i (just )?do"],
    "story": [r"resulta que", r"y entonces", r"os cuento", r"la historia", r"una vez", r"so basically",
              r"long story", r"you know what happened", r"me pas[oó]", r"el otro d[ií]a", r"story time",
              r"y de repente", r"and then", r"suddenly"],
    "hype": [r"vamos+", r"let'?s go+", r"\bhype\b", r"\bsi+\b!+", r"\byes+\b", r"venga+", r"dale+", r"come on"],
}

_COMPILED = {k: [re.compile(p, re.IGNORECASE) for p in v] for k, v in _LEX.items()}
_WORD = re.compile(r"\w+", re.UNICODE)


def _norm(text: str) -> str:
    return unicodedata.normalize("NFC", text)


@dataclass
class SegmentScore:
    start: float
    end: float
    interest: float  # 0..1
    categories: dict[str, float] = field(default_factory=dict)
    matches: list[str] = field(default_factory=list)


def score_text(text: str) -> tuple[dict[str, float], list[str]]:
    t = _norm(text)
    cats: dict[str, float] = {}
    matches: list[str] = []
    for cat, patterns in _COMPILED.items():
        hits = 0
        for p in patterns:
            m = p.search(t)
            if m:
                hits += 1
                matches.append(m.group(0))
        if hits:
            cats[cat] = min(1.0, 0.55 + 0.2 * (hits - 1))
    excl = t.count("!") + t.count("¡")
    quest = t.count("?") + t.count("¿")
    words = _WORD.findall(t)
    caps = sum(1 for w in words if len(w) > 2 and w.isupper())
    repeats = len(re.findall(r"\b(\w+)( \1\b)+", t.lower()))
    prosody = min(1.0, 0.15 * excl + 0.08 * quest + 0.15 * caps + 0.2 * repeats)
    if prosody > 0.25:
        cats["reaction"] = max(cats.get("reaction", 0.0), 0.3 + prosody * 0.5)
    return cats, matches


def score_segments(segments: list[Segment]) -> list[SegmentScore]:
    out: list[SegmentScore] = []
    rates = [len(_WORD.findall(s.text)) / max(0.3, s.end - s.start) for s in segments]
    median_rate = float(np.median(rates)) if rates else 2.5
    for s, rate in zip(segments, rates):
        cats, matches = score_text(s.text)
        # Habla acelerada respecto a lo normal del propio streamer → emoción
        if median_rate > 0 and rate > median_rate * 1.6 and len(s.text) > 12:
            cats["reaction"] = max(cats.get("reaction", 0.0), 0.35)
        interest = max(cats.values()) if cats else 0.0
        if len(cats) >= 2:
            interest = min(1.0, interest + 0.1 * (len(cats) - 1))
        out.append(SegmentScore(s.start, s.end, interest, cats, matches))
    return out


def semantic_series(scores: list[SegmentScore], n: int, hop: float) -> np.ndarray:
    x = np.zeros(n, dtype=np.float32)
    for sc in scores:
        a, b = int(sc.start / hop), max(int(sc.start / hop) + 1, int(sc.end / hop))
        x[a:min(n, b)] = np.maximum(x[a:min(n, b)], sc.interest)
    return x


def text_similarity(a: str, b: str) -> float:
    wa = set(_WORD.findall(a.lower()))
    wb = set(_WORD.findall(b.lower()))
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def generate_title(text: str, category: str, max_len: int = 70) -> str:
    """Título descriptivo a partir de la frase más expresiva del fragmento."""
    if text:
        sentences = [s.strip(" .,-") for s in re.split(r"(?<=[.!?¡¿])\s+", text) if len(s.strip()) > 3]
        if sentences:
            best = max(sentences, key=lambda s: (s.count("!") + s.count("?")) * 2 + min(len(s), 60) / 60
                       + (1.5 if score_text(s)[0] else 0))
            best = best[:max_len].rstrip()
            if best:
                return best[0].upper() + best[1:]
    return CATEGORY_LABELS.get(category, "Momento destacado")
