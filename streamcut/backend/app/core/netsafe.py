"""Validación de enlaces y protección SSRF.

- Los enlaces de canales solo se aceptan si son de Twitch o YouTube (lista cerrada de hosts).
- Las fuentes audiovisuales autorizadas (RTMP/SRT/HLS) se resuelven por DNS y se rechazan las
  direcciones privadas, de loopback, link-local o reservadas salvo que se permita explícitamente
  (STREAMCUT_ALLOW_PRIVATE_SOURCES=true, p. ej. para tu propio OBS en la red local).
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from .config import get_settings

SOURCE_SCHEMES = {"rtmp", "rtmps", "srt", "https", "http"}
# Protocolos que ffmpeg puede usar al leer una fuente remota: nunca "file", "concat", "subfile"…
FFMPEG_PROTOCOL_WHITELIST = "rtmp,rtmps,srt,udp,tcp,tls,http,https,hls,crypto,httpproxy"


class UnsafeURL(ValueError):
    pass


def _is_public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    return not (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_multicast
                or addr.is_reserved or addr.is_unspecified or
                (addr.version == 6 and addr.ipv4_mapped is not None and not _is_public(str(addr.ipv4_mapped))))


def resolve_all(host: str) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise UnsafeURL(f"No se puede resolver el host '{host}'") from exc
    return sorted({info[4][0] for info in infos})


def validate_source_url(url: str, allow_private: bool | None = None) -> str:
    """Valida una URL de señal audiovisual autorizada y devuelve la URL normalizada."""
    if allow_private is None:
        allow_private = get_settings().allow_private_sources
    url = url.strip()
    if len(url) > 2048 or any(c in url for c in "\r\n\t "):
        raise UnsafeURL("URL no válida")
    parsed = urlparse(url)
    if parsed.scheme.lower() not in SOURCE_SCHEMES:
        raise UnsafeURL(f"Esquema no permitido: {parsed.scheme or '(vacío)'}. Usa rtmp, rtmps, srt o https")
    if not parsed.hostname:
        raise UnsafeURL("La URL no tiene host")
    if not allow_private:
        for ip in resolve_all(parsed.hostname):
            if not _is_public(ip):
                raise UnsafeURL("La fuente apunta a una red privada o local. Activa "
                                "STREAMCUT_ALLOW_PRIVATE_SOURCES si es tu propio equipo.")
    return url


def validate_public_http_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname:
        raise UnsafeURL("Solo se permiten URLs http(s)")
    for ip in resolve_all(parsed.hostname):
        if not _is_public(ip):
            raise UnsafeURL("Dirección no pública")
    return url
