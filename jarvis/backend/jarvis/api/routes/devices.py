"""Desktop devices: the agent's WebSocket and the device list for the UI."""

from __future__ import annotations

import asyncio
import contextlib
import time
import uuid

from fastapi import APIRouter, Depends, WebSocket

from jarvis.api.deps import Principal, current, get_app, ws_principal
from jarvis.billing.service import QuotaExceeded
from jarvis.core.audit import audit
from jarvis.core.container import AppContext
from jarvis.core.events import make_event
from jarvis.core.logging import log
from jarvis.devices.hub import DeviceInfo

router = APIRouter(tags=["devices"])

CAPABILITIES = {"apps", "media", "volume", "browser", "input", "clipboard", "windows", "screen", "shell"}


@router.get("/api/devices")
async def list_devices(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    return {"devices": [d.public() for d in await app.devices.devices(p.user_id, online_only=False)]}


async def _audit(app: AppContext, info: DeviceInfo, action: str) -> None:
    async with app.sessionmaker() as session:
        await audit(session, action=action, actor="device", user_id=uuid.UUID(info.user_id), target=info.name,
                    data={"device": info.id, "platform": info.platform, "capabilities": info.capabilities})
        await session.commit()


@router.websocket("/api/ws/device")
async def device_socket(ws: WebSocket) -> None:
    app: AppContext = ws.app.state.jarvis
    principal = await ws_principal(ws, app)
    if principal is None or principal.session.kind != "device" or not principal.has_scope("computer"):
        await ws.close(code=4401)
        return
    await ws.accept()
    try:
        hello = await asyncio.wait_for(ws.receive_json(), timeout=15)
    except Exception:  # noqa: BLE001
        await ws.close(code=4400)
        return
    if hello.get("type") != "hello":
        await ws.close(code=4400)
        return
    if app.billing is not None:  # plan: computer control included? how many computers at once?
        try:
            await app.billing.require(principal.user_id, "computer")
            plan = await app.billing.plan(principal.user_id)
            limit = plan.limit("devices")
            others = [d for d in await app.devices.devices(principal.user_id) if d.id != str(principal.session.id)]
            if limit is not None and len(others) + 1 > limit:
                raise QuotaExceeded("devices", limit, plan)
        except QuotaExceeded as exc:
            await ws.send_json({"type": "error", "code": "plan", "message": str(exc)})
            await ws.close(code=4402)
            return
    caps = [c for c in hello.get("capabilities") or [] if c in CAPABILITIES]
    info = DeviceInfo(id=str(principal.session.id), user_id=str(principal.user_id),
                      name=str(hello.get("name") or principal.session.name or "computer")[:80],
                      platform=str(hello.get("platform") or "unknown")[:40], capabilities=caps,
                      version=str(hello.get("version") or "")[:40])
    await app.devices.register(info)
    await _audit(app, info, "device.connected")
    await app.bus.publish(principal.user_id, make_event("device.status", data={**info.public(), "online": True}))
    await ws.send_json({"type": "welcome", "device_id": info.id, "capabilities": caps})
    log.info("device.connected", device=info.id, name=info.name, platform=info.platform, caps=caps)

    async def pump() -> None:
        while True:
            try:
                call = await app.devices.next_call(info)
            except Exception:  # noqa: BLE001 — a Redis hiccup must not silently strand the device
                log.warning("device.inbox_error", device=info.id, exc_info=True)
                await asyncio.sleep(1)
                continue
            if call is not None:
                await ws.send_json(call)

    pumper = asyncio.create_task(pump())
    try:
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")
            if kind == "result" and msg.get("id"):
                await app.devices.deliver_reply(str(msg["id"]), {
                    "ok": bool(msg.get("ok")), "data": msg.get("data") or {}, "error": msg.get("error")})
                await app.devices.touch(info)
            elif kind == "heartbeat":
                await app.devices.touch(info)
                await ws.send_json({"type": "heartbeat_ack", "ts": time.time()})
    except Exception:  # noqa: BLE001 — disconnect or garbage: either way the device is gone
        pass
    finally:
        pumper.cancel()
        with contextlib.suppress(BaseException):
            await pumper
        await app.devices.unregister(info)
        await _audit(app, info, "device.disconnected")
        await app.bus.publish(principal.user_id, make_event("device.status", data={**info.public(), "online": False}))
        log.info("device.disconnected", device=info.id)
