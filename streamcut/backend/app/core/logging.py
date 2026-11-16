"""Logging con redacción de secretos: tokens, claves y contraseñas nunca llegan a los logs."""

from __future__ import annotations

import logging
import re

_PATTERNS = [
    (re.compile(r"(?i)(authorization:\s*)(bearer|oauth)\s+[\w\-.~+/=]+"), r"\1\2 [REDACTED]"),
    (re.compile(r"(?i)((?:access|refresh)_token|client_secret|password|api_key|key|token|secret)"
                r"([\"']?\s*[:=]\s*[\"']?)([^\s\"'&,}]+)"), r"\1\2[REDACTED]"),
    (re.compile(r"(?i)(rtmps?://[^/\s]+/[^/\s]+/)([^\s/]+)"), r"\1[REDACTED]"),
]


def redact(text: str) -> str:
    for pattern, repl in _PATTERNS:
        text = pattern.sub(repl, text)
    return text


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            return True
        clean = redact(msg)
        if clean != msg:
            record.msg = clean
            record.args = ()
        return True


def setup_logging(level: int = logging.INFO) -> None:
    root = logging.getLogger()
    if any(isinstance(f, RedactingFilter) for h in root.handlers for f in h.filters):
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"))
    handler.addFilter(RedactingFilter())
    root.addHandler(handler)
    root.setLevel(level)
    for noisy in ("httpx", "httpcore", "faster_whisper", "numba"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
