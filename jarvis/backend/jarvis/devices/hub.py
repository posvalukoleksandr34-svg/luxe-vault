"""Desktop devices: the bridge between JARVIS and the user's own computers.

A desktop agent (`desktop/jarvis_desktop.py`) runs on the user's PC and keeps a WebSocket open to
`/api/ws/device`, authenticated with a device token that has the `computer` scope. JARVIS itself never
touches the PC directly: tools call `DeviceHub.call(user_id, action, args)`, the hub forwards the call to
one of *that user's* connected devices and waits for the result.

The worker (which runs tools) and the API (which holds the WebSocket) are different processes, so the
call travels through Redis lists:

    worker  RPUSH jarvis:device:{id}:inbox  {req}        API  BLPOP inbox  → ws.send(call)
    worker  BLPOP jarvis:device:reply:{req_id}           API  ws result    → RPUSH reply

Lists (not pub/sub) so a call is never lost if the API loop is momentarily between reads. Without Redis
(tests, single-process dev) the same flow runs through asyncio queues.

Tenant isolation: devices are registered under the owning user's id; `call()` only ever looks at the
calling user's devices.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from redis.asyncio import Redis

from jarvis.core.logging import log

PRESENCE_TTL_S = 90  # a device is online if it sent anything (hello/heartbeat/result) within this window
# redis-py closes reads after its socket timeout (5 s by default), so blocking pops wait in short slices.
BLOCK_SLICE_S = 2


class DeviceError(Exception):
    """A call could not be delivered or the device reported a failure."""


@dataclass
class DeviceInfo:
    id: str
    user_id: str
    name: str
    platform: str
    capabilities: list[str]
    version: str = ""
    connected_at: float = field(default_factory=time.time)
    seen_at: float = field(default_factory=time.time)

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "platform": self.platform, "capabilities": self.capabilities,
                "version": self.version, "connected_at": self.connected_at, "seen_at": self.seen_at,
                "online": time.time() - self.seen_at < PRESENCE_TTL_S}


class DeviceHub:
    def __init__(self, redis: Redis | None):
        self.redis = redis
        # process-local (no Redis) state
        self._local: dict[str, DeviceInfo] = {}
        self._inboxes: dict[str, asyncio.Queue] = {}
        self._replies: dict[str, asyncio.Future] = {}

    # ------------------------------------------------------------------ presence

    @staticmethod
    def _devices_key(user_id: str) -> str:
        return f"jarvis:devices:{user_id}"

    async def register(self, info: DeviceInfo) -> None:
        info.seen_at = time.time()
        if self.redis is None:
            self._local[info.id] = info
            self._inboxes.setdefault(info.id, asyncio.Queue())
            return
        await self.redis.hset(self._devices_key(info.user_id), info.id, json.dumps(info.__dict__))
        await self.redis.expire(self._devices_key(info.user_id), 7 * 86400)

    async def touch(self, info: DeviceInfo) -> None:
        await self.register(info)

    async def unregister(self, info: DeviceInfo) -> None:
        if self.redis is None:
            self._local.pop(info.id, None)
            return
        await self.redis.hdel(self._devices_key(info.user_id), info.id)

    async def devices(self, user_id: uuid.UUID | str, *, online_only: bool = True) -> list[DeviceInfo]:
        uid = str(user_id)
        if self.redis is None:
            found = [d for d in self._local.values() if d.user_id == uid]
        else:
            raw = await self.redis.hgetall(self._devices_key(uid))
            found = []
            for v in raw.values():
                with contextlib.suppress(ValueError, TypeError):
                    found.append(DeviceInfo(**json.loads(v)))
        if online_only:
            found = [d for d in found if time.time() - d.seen_at < PRESENCE_TTL_S]
        return sorted(found, key=lambda d: d.seen_at, reverse=True)

    async def pick(self, user_id: uuid.UUID | str, capability: str, device: str | None = None) -> DeviceInfo:
        online = await self.devices(user_id)
        if not online:
            raise DeviceError("no computer is connected — start the JARVIS desktop agent on your PC")
        if device:
            wanted = device.lower()
            online = [d for d in online if d.id == device or wanted in d.name.lower()]
            if not online:
                raise DeviceError(f"device '{device}' is not connected")
        capable = [d for d in online if capability in d.capabilities]
        if not capable:
            raise DeviceError(f"the connected computer does not allow '{capability}' "
                              f"(enable it in the desktop agent settings)")
        return capable[0]

    # ------------------------------------------------------------------ calls (tool side)

    async def call(self, user_id: uuid.UUID | str, action: str, args: dict[str, Any] | None = None, *,
                   capability: str | None = None, device: str | None = None, timeout_s: float = 20.0) -> dict:
        target = await self.pick(user_id, capability or action.split(".")[0], device)
        # `deadline`: a call the tool already gave up on must never run on the PC later
        req = {"type": "call", "id": uuid.uuid4().hex, "action": action, "args": args or {},
               "deadline": time.time() + timeout_s}
        started = time.monotonic()
        if self.redis is None:
            fut: asyncio.Future = asyncio.get_running_loop().create_future()
            self._replies[req["id"]] = fut
            await self._inboxes[target.id].put(req)
            try:
                reply = await asyncio.wait_for(fut, timeout=timeout_s)
            except asyncio.TimeoutError as exc:
                raise DeviceError(f"{target.name} did not answer within {timeout_s:.0f}s") from exc
            finally:
                self._replies.pop(req["id"], None)
        else:
            inbox = f"jarvis:device:{target.id}:inbox"
            await self.redis.rpush(inbox, json.dumps(req))
            await self.redis.expire(inbox, 120)
            got = None
            deadline = time.monotonic() + timeout_s
            try:
                while got is None and time.monotonic() < deadline:
                    got = await self.redis.blpop([f"jarvis:device:reply:{req['id']}"], timeout=BLOCK_SLICE_S)
            finally:
                if got is None:  # timeout, error or cancellation: take the call back so it cannot fire later
                    with contextlib.suppress(Exception):
                        await self.redis.lrem(inbox, 0, json.dumps(req))
            if got is None:
                raise DeviceError(f"{target.name} did not answer within {timeout_s:.0f}s")
            reply = json.loads(got[1])
        log.info("device.call", device=target.id, action=action, ok=reply.get("ok"),
                 ms=int((time.monotonic() - started) * 1000), error=(reply.get("error") or "")[:200])
        if not reply.get("ok"):
            raise DeviceError(reply.get("error") or f"{action} failed on {target.name}")
        data = reply.get("data") or {}
        data.setdefault("device", target.name)
        return data

    # ------------------------------------------------------------------ device side (API process)

    async def next_call(self, info: DeviceInfo, timeout_s: float = BLOCK_SLICE_S) -> dict | None:
        """The next pending call for this device, skipping calls whose caller already gave up."""
        if self.redis is None:
            try:
                call = await asyncio.wait_for(self._inboxes[info.id].get(), timeout=timeout_s)
            except asyncio.TimeoutError:
                return None
        else:
            got = await self.redis.blpop([f"jarvis:device:{info.id}:inbox"], timeout=min(BLOCK_SLICE_S, timeout_s))
            call = json.loads(got[1]) if got else None
        if call is not None and call.get("deadline") and call["deadline"] < time.time():
            log.warning("device.call_expired", device=info.id, action=call.get("action"))
            return None
        return call

    async def deliver_reply(self, req_id: str, reply: dict[str, Any]) -> None:
        if self.redis is None:
            fut = self._replies.get(req_id)
            if fut is not None and not fut.done():
                fut.set_result(reply)
            return
        key = f"jarvis:device:reply:{req_id}"
        await self.redis.rpush(key, json.dumps(reply))
        await self.redis.expire(key, 60)
