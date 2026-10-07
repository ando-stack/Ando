"""Chat del stream: la mejor pista de qué momentos fueron graciosos o épicos.

* Twitch VOD (directo resubido): se descarga la repetición del chat.
* Twitch en directo: se escucha el chat (anónimo) mientras se graba.
* YouTube (directos guardados): repetición del chat vía yt-dlp.
"""

from __future__ import annotations

import glob
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Optional

Mensaje = tuple[float, str]  # (segundo del vídeo, texto)

# Emotes y expresiones típicas. Se comparan palabra a palabra en minúsculas.
RISA = re.compile(
    r"^(?:lul|lulw|kekw|kek|kekl|omegalul|lmao+|lmfao|lol+|rofl|icant|pepelaugh|"
    r"xd+|x+d+|kekwait|aware|clueless|"
    r"(?:ja|je|ji|ha|he|js|aj|xa){2,}[jahes]*|jsjs\w*|jajaj\w*|"
    r"😂+|🤣+|💀+|:face-with-tears-of-joy:|:rolling-on-the-floor-laughing:|:skull:)$"
)
HYPE = re.compile(
    r"^(?:pog\w*|poggers|pogu|pogchamp|w+|gg+|clip|clipped|clipalo|clipea|omg+|wtf+|"
    r"no+o+|holy|hype|monkas|monkaw|letsgo|vamo+s*|"
    r"🔥+|😱+|🤯+|😮+|💯+|:fire:|:exploding-head:|:face-screaming-in-fear:)$"
)

RETRASO_CHAT = 5.0  # el chat reacciona unos segundos después de lo que pasa


@dataclass
class Chat:
    mensajes: list[Mensaje] = field(default_factory=list)
    origen: str = ""

    def __bool__(self) -> bool:
        return len(self.mensajes) >= 30

    def palabras_destacadas(self, a: float, b: float, n: int = 2) -> list[tuple[str, int]]:
        """Emotes de risa/hype más repetidos entre a y b (segundos del vídeo)."""
        cuenta: Counter = Counter()
        for t, texto in self.mensajes:
            if a + RETRASO_CHAT * 0.4 <= t <= b + RETRASO_CHAT:
                for p in set(_palabras(texto)):
                    if RISA.match(p) or HYPE.match(p):
                        cuenta[_normal(p)] += 1
        return cuenta.most_common(n)


def _palabras(texto: str) -> list[str]:
    return [p for p in re.split(r"[\s,.!¡?¿]+", texto.lower()) if p]


def _normal(p: str) -> str:
    if re.fullmatch(r"(?:ja|je|ha|aj|js)+[jahes]*", p):
        return "JAJAJA"
    if re.fullmatch(r"x+d+", p):
        return "XD"
    return p.upper() if p.isascii() else p


def clasificar(texto: str) -> tuple[bool, bool]:
    """(es_risa, es_hype) para un mensaje."""
    risa = hype = False
    for p in _palabras(texto):
        if RISA.match(p):
            risa = True
        elif HYPE.match(p):
            hype = True
    if not risa and re.search(r"(?:ja){3,}|(?:je){3,}|(?:ha){3,}|😂|🤣|💀", texto.lower()):
        risa = True
    return risa, hype


# ---------------------------------------------------------------------------
# Twitch VOD
# ---------------------------------------------------------------------------

GQL = "https://gql.twitch.tv/gql"
CLIENT_IDS = ["kd1unb4b3q4t58fwlpcbzcbnm76a8fp", "kimne78kx3ncx6brgo4mv6wki5h1ko"]
HASH_COMENTARIOS = "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a"


def id_vod_twitch(info: dict) -> Optional[str]:
    if "twitch" not in (info.get("extractor_key") or info.get("extractor") or "").lower():
        return None
    m = re.search(r"(?:videos/|^v)(\d+)", str(info.get("id", "")) + " " + (info.get("webpage_url") or ""))
    return m.group(1) if m else None


def _gql(cuerpo: list | dict, client_id: str) -> dict | list:
    datos = json.dumps(cuerpo).encode()
    req = urllib.request.Request(GQL, data=datos, method="POST", headers={
        "Client-Id": client_id, "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def _pagina_twitch(vod: str, client_id: str, offset: Optional[int] = None,
                   cursor: Optional[str] = None) -> tuple[list[Mensaje], Optional[str]]:
    variables: dict = {"videoID": vod}
    if cursor:
        variables["cursor"] = cursor
    else:
        variables["contentOffsetSeconds"] = offset or 0
    respuesta = _gql([{
        "operationName": "VideoCommentsByOffsetOrCursor",
        "variables": variables,
        "extensions": {"persistedQuery": {"version": 1, "sha256Hash": HASH_COMENTARIOS}},
    }], client_id)
    bloque = respuesta[0] if isinstance(respuesta, list) else respuesta
    if bloque.get("errors"):
        raise RuntimeError(bloque["errors"][0].get("message", "error GQL"))
    comentarios = (((bloque.get("data") or {}).get("video") or {}).get("comments")) or {}
    mensajes: list[Mensaje] = []
    siguiente = None
    for borde in comentarios.get("edges") or []:
        nodo = borde.get("node") or {}
        texto = "".join(f.get("text", "") for f in ((nodo.get("message") or {}).get("fragments") or []))
        mensajes.append((float(nodo.get("contentOffsetSeconds", 0)), texto))
        siguiente = borde.get("cursor")
    if not (comentarios.get("pageInfo") or {}).get("hasNextPage"):
        siguiente = None
    return mensajes, siguiente


def chat_twitch_vod(vod: str, duracion: float, limite_segundos: float = 240,
                    progreso=None) -> Chat:
    """Descarga la repetición del chat en paralelo (trozos de 10 min)."""
    client_id = None
    for cid in CLIENT_IDS:
        try:
            _pagina_twitch(vod, cid, offset=0)
            client_id = cid
            break
        except Exception:
            continue
    if client_id is None:
        return Chat(origen="twitch (no disponible)")

    fin_limite = time.time() + limite_segundos
    trozo = 600
    tramos = [(a, min(duracion, a + trozo)) for a in range(0, int(duracion) + 1, trozo)]
    hechos = [0]

    def bajar(tramo: tuple[float, float]) -> list[Mensaje]:
        a, b = tramo
        salida: list[Mensaje] = []
        cursor = None
        primera = True
        while time.time() < fin_limite:
            try:
                msgs, cursor = _pagina_twitch(vod, client_id, offset=int(a) if primera else None,
                                              cursor=None if primera else cursor)
            except Exception:
                break
            primera = False
            salida += [m for m in msgs if a <= m[0] < b]
            if not cursor or not msgs or msgs[-1][0] >= b:
                break
        hechos[0] += 1
        if progreso:
            progreso(hechos[0] * 100 / len(tramos), "Leyendo el chat del directo…")
        return salida

    with ThreadPoolExecutor(max_workers=8) as pool:
        partes = list(pool.map(bajar, tramos))
    mensajes = sorted(m for parte in partes for m in parte)
    return Chat(mensajes=mensajes, origen="chat de Twitch")


# ---------------------------------------------------------------------------
# Twitch en directo (IRC anónimo)
# ---------------------------------------------------------------------------

def canal_twitch(url: str) -> Optional[str]:
    m = re.search(r"twitch\.tv/([A-Za-z0-9_]{3,25})/?(?:$|\?)", url)
    if m and m.group(1).lower() not in {"videos", "directory", "settings"}:
        return m.group(1).lower()
    return None


class OyenteTwitch(threading.Thread):
    """Guarda los mensajes del chat de un directo mientras se graba."""

    def __init__(self, canal: str):
        super().__init__(daemon=True)
        self.canal = canal
        self.chat = Chat(origen="chat de Twitch (en directo)")
        self.inicio = time.time()
        self._parar = threading.Event()

    def parar(self) -> Chat:
        self._parar.set()
        self.join(timeout=5)
        return self.chat

    def run(self) -> None:
        try:
            s = socket.create_connection(("irc.chat.twitch.tv", 6667), timeout=10)
            s.sendall(f"NICK justinfan{int(time.time()) % 100000}\r\nJOIN #{self.canal}\r\n".encode())
            s.settimeout(1.0)
            resto = ""
            while not self._parar.is_set():
                try:
                    datos = s.recv(65536).decode("utf-8", "replace")
                except socket.timeout:
                    continue
                if not datos:
                    break
                resto += datos
                *lineas, resto = resto.split("\r\n")
                for linea in lineas:
                    if linea.startswith("PING"):
                        s.sendall(b"PONG :tmi.twitch.tv\r\n")
                    elif " PRIVMSG #" in linea:
                        texto = linea.split(" :", 1)[1] if " :" in linea else ""
                        self.chat.mensajes.append((time.time() - self.inicio, texto))
            s.close()
        except OSError:
            pass


# ---------------------------------------------------------------------------
# YouTube (repetición del chat de directos)
# ---------------------------------------------------------------------------

def tiene_chat_youtube(info: dict) -> bool:
    return "live_chat" in (info.get("subtitles") or {})


def chat_youtube(url: str, carpeta: str, limite_segundos: float = 300) -> Chat:
    os.makedirs(carpeta, exist_ok=True)
    cmd = [sys.executable, "-m", "yt_dlp", "--skip-download", "--write-subs",
           "--sub-langs", "live_chat", "--no-playlist",
           "--extractor-args", "youtube:player_client=default,mweb", "-q", "--no-warnings",
           "-o", os.path.join(carpeta, "chat.%(ext)s"), url]
    try:
        subprocess.run(cmd, timeout=limite_segundos, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        pass  # usamos lo que haya dado tiempo a bajar
    mensajes: list[Mensaje] = []
    for ruta in glob.glob(os.path.join(carpeta, "chat*live_chat.json*")):
        with open(ruta, encoding="utf-8", errors="replace") as f:
            for linea in f:
                m = _mensaje_youtube(linea)
                if m:
                    mensajes.append(m)
    return Chat(mensajes=sorted(mensajes), origen="chat de YouTube")


def _mensaje_youtube(linea: str) -> Optional[Mensaje]:
    try:
        d = json.loads(linea)
    except ValueError:
        return None
    accion = d.get("replayChatItemAction") or {}
    try:
        t = int(accion.get("videoOffsetTimeMsec", -1)) / 1000
    except (TypeError, ValueError):
        return None
    if t < 0:
        return None
    for a in accion.get("actions") or []:
        item = (a.get("addChatItemAction") or {}).get("item") or {}
        render = item.get("liveChatTextMessageRenderer") or item.get("liveChatPaidMessageRenderer")
        if not render:
            continue
        partes = []
        for run in (render.get("message") or {}).get("runs") or []:
            if "text" in run:
                partes.append(run["text"])
            elif "emoji" in run:
                e = run["emoji"]
                atajo = (e.get("shortcuts") or [""])[0]
                partes.append(e.get("emojiId") if not (e.get("emojiId") or "").isascii() else atajo)
        return t, " ".join(partes)
    return None
