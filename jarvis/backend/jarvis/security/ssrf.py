"""Outbound URL guard for agent-driven fetches.

The agent can be steered by content it reads (prompt injection). Any tool that
fetches a model-chosen URL must refuse internal targets: the docker network,
cloud metadata endpoints, loopback, RFC1918, link-local, CGNAT (Tailscale).
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit


class UnsafeURLError(ValueError):
    pass


_BLOCKED_HOSTNAMES = {"localhost", "metadata.google.internal", "metadata"}


def _ip_is_public(ip: ipaddress._BaseAddress) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or (isinstance(ip, ipaddress.IPv4Address) and ip in ipaddress.ip_network("100.64.0.0/10"))
    )


async def assert_public_url(url: str, *, resolve: bool = True) -> str:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise UnsafeURLError(f"scheme not allowed: {parts.scheme or '(none)'}")
    host = (parts.hostname or "").strip(".").lower()
    if not host:
        raise UnsafeURLError("missing host")
    if host in _BLOCKED_HOSTNAMES or host.endswith(".internal") or host.endswith(".local"):
        raise UnsafeURLError(f"host not allowed: {host}")
    if parts.username or parts.password:
        raise UnsafeURLError("credentials in URL are not allowed")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not _ip_is_public(literal):
            raise UnsafeURLError(f"address not allowed: {host}")
        return url
    if "." not in host:  # docker service names: postgres, redis, api...
        raise UnsafeURLError(f"host not allowed: {host}")
    if resolve:
        loop = asyncio.get_running_loop()
        try:
            infos = await loop.getaddrinfo(host, parts.port or (443 if parts.scheme == "https" else 80),
                                           type=socket.SOCK_STREAM)
        except socket.gaierror as exc:
            raise UnsafeURLError(f"cannot resolve {host}") from exc
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if not _ip_is_public(ip):
                raise UnsafeURLError(f"{host} resolves to a non-public address")
    return url
