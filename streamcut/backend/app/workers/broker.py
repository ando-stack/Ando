"""Configuración del broker Dramatiq (Redis en producción, en memoria en modo all-in-one/tests)."""

from __future__ import annotations

import dramatiq
from dramatiq.brokers.stub import StubBroker

from app.core.config import get_settings

_broker = None


def setup_broker():
    global _broker
    if _broker is not None:
        return _broker
    s = get_settings()
    if s.broker == "redis":
        from dramatiq.brokers.redis import RedisBroker
        _broker = RedisBroker(url=s.redis_url)
    else:
        _broker = StubBroker()
        _broker.emit_after("process_boot")
    dramatiq.set_broker(_broker)
    return _broker


setup_broker()
