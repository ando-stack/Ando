"""Identificación de plataforma y canal a partir de un enlace o identificador."""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

TWITCH_HOSTS = {"twitch.tv", "www.twitch.tv", "m.twitch.tv", "go.twitch.tv"}
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}
TWITCH_RESERVED = {"directory", "videos", "settings", "p", "downloads", "jobs", "turbo", "search", "inventory",
                   "subscriptions", "wallet", "drops", "friends", "messages", "moderator", "u", "store"}
TWITCH_LOGIN = re.compile(r"^[a-zA-Z0-9_]{3,25}$")
YT_HANDLE = re.compile(r"^@?[a-zA-Z0-9._\-]{3,30}$")
YT_CHANNEL_ID = re.compile(r"^UC[a-zA-Z0-9_\-]{22}$")
YT_VIDEO_ID = re.compile(r"^[a-zA-Z0-9_\-]{11}$")


class InvalidChannelURL(ValueError):
    pass


@dataclass
class ParsedChannel:
    platform: str
    kind: str  # login | handle | channel_id | username | video
    value: str

    @property
    def canonical_url(self) -> str:
        if self.platform == "twitch":
            return f"https://www.twitch.tv/{self.value.lower()}"
        if self.kind == "handle":
            return f"https://www.youtube.com/@{self.value}"
        if self.kind == "channel_id":
            return f"https://www.youtube.com/channel/{self.value}"
        if self.kind == "username":
            return f"https://www.youtube.com/user/{self.value}"
        return f"https://www.youtube.com/watch?v={self.value}"


def parse_channel(text: str, platform_hint: str | None = None) -> ParsedChannel:
    text = (text or "").strip()
    if not text or len(text) > 500:
        raise InvalidChannelURL("Introduce un enlace o identificador de canal")
    if "://" not in text and "/" not in text and "." not in text.split("@")[-1]:
        # Identificador suelto
        if platform_hint == "youtube" or text.startswith("@") or YT_CHANNEL_ID.match(text):
            if YT_CHANNEL_ID.match(text):
                return ParsedChannel("youtube", "channel_id", text)
            if YT_HANDLE.match(text):
                return ParsedChannel("youtube", "handle", text.lstrip("@"))
        if TWITCH_LOGIN.match(text):
            return ParsedChannel("twitch", "login", text.lower())
        raise InvalidChannelURL("Identificador no válido")
    if "://" not in text:
        text = "https://" + text
    u = urlparse(text)
    if u.scheme not in ("http", "https"):
        raise InvalidChannelURL("Solo se aceptan enlaces http(s)")
    host = (u.hostname or "").lower()
    parts = [p for p in u.path.split("/") if p]
    if host in TWITCH_HOSTS:
        if not parts or parts[0].lower() in TWITCH_RESERVED:
            raise InvalidChannelURL("El enlace de Twitch debe ser el de un canal: twitch.tv/nombre")
        login = parts[0]
        if not TWITCH_LOGIN.match(login):
            raise InvalidChannelURL("Nombre de canal de Twitch no válido")
        return ParsedChannel("twitch", "login", login.lower())
    if host in YOUTUBE_HOSTS:
        if host == "youtu.be" and parts and YT_VIDEO_ID.match(parts[0]):
            return ParsedChannel("youtube", "video", parts[0])
        if parts and parts[0].startswith("@") and YT_HANDLE.match(parts[0]):
            return ParsedChannel("youtube", "handle", parts[0][1:])
        if len(parts) >= 2 and parts[0] == "channel" and YT_CHANNEL_ID.match(parts[1]):
            return ParsedChannel("youtube", "channel_id", parts[1])
        if len(parts) >= 2 and parts[0] in ("user", "c") and YT_HANDLE.match(parts[1]):
            return ParsedChannel("youtube", "username" if parts[0] == "user" else "handle", parts[1])
        if parts and parts[0] == "watch":
            v = parse_qs(u.query).get("v", [""])[0]
            if YT_VIDEO_ID.match(v):
                return ParsedChannel("youtube", "video", v)
        if len(parts) >= 2 and parts[0] in ("live", "shorts", "embed") and YT_VIDEO_ID.match(parts[1]):
            return ParsedChannel("youtube", "video", parts[1])
        raise InvalidChannelURL("No se reconoce el canal de YouTube (usa youtube.com/@canal o /channel/UC…)")
    raise InvalidChannelURL("Plataforma no compatible: usa un enlace de Twitch o YouTube")
