from __future__ import annotations

import logging
import sys

import structlog

_REDACT_KEYS = {"password", "token", "api_key", "authorization", "secret", "access_token", "refresh_token"}


def _redact(_, __, event_dict):
    for key in list(event_dict):
        if key.lower() in _REDACT_KEYS:
            event_dict[key] = "***"
    return event_dict


def configure_logging(level: str = "INFO", json: bool = True) -> None:
    processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        _redact,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]
    renderer = structlog.processors.JSONRenderer() if json else structlog.dev.ConsoleRenderer(colors=False)
    structlog.configure(
        processors=[*processors, renderer],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level.upper())),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )
    logging.basicConfig(level=level.upper(), stream=sys.stdout, format="%(message)s")
    for noisy in ("httpx", "httpcore", "httpx2", "httpcore2", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


log = structlog.get_logger("jarvis")
