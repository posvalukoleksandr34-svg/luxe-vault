"""Spotify playback through the Web API (per-user OAuth, see `jarvis.integrations.spotify`)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from jarvis.integrations.spotify import NoActiveDevice, SpotifyAPI
from jarvis.tools.base import Risk, ToolContext, ToolError, tool

Kind = Literal["track", "artist", "album", "playlist"]
NO_DEVICE = ("no Spotify device is active — open Spotify on your PC or phone (or start the JARVIS desktop agent "
             "so JARVIS can open it for you)")


def _track(item: dict | None) -> dict | None:
    if not item:
        return None
    return {"name": item.get("name"), "artists": ", ".join(a["name"] for a in item.get("artists", [])) or None,
            "album": (item.get("album") or {}).get("name"), "uri": item.get("uri"),
            "duration_s": round(item.get("duration_ms", 0) / 1000)}


class SearchArgs(BaseModel):
    query: str = Field(min_length=1, max_length=200, description="What to look for, e.g. 'Imagine Dragons Believer'")
    kind: Kind = "track"


@tool(name="spotify_search", description="Search Spotify for tracks, artists, albums or playlists.",
      activity="Ищу в Spotify", requires=("spotify",))
async def spotify_search(ctx: ToolContext, args: SearchArgs) -> dict:
    return {"results": await SpotifyAPI(ctx.app, ctx.user_id).search(args.query, args.kind, limit=8)}


class PlayArgs(BaseModel):
    query: str | None = Field(None, max_length=200, description="Song / artist / album / playlist to play; "
                              "empty = resume what was playing")
    kind: Kind = "track"
    uri: str | None = Field(None, description="Exact spotify: URI (from spotify_search), instead of query")


@tool(name="spotify_play", description="Play a song, artist, album or playlist on the user's Spotify (or resume).",
      risk=Risk.WRITE, activity="Включаю музыку", requires=("spotify",), timeout_s=40)
async def spotify_play(ctx: ToolContext, args: PlayArgs) -> dict:
    api = SpotifyAPI(ctx.app, ctx.user_id)
    uri, picked = args.uri, None
    if not uri and args.query:
        found = await api.search(args.query, args.kind, limit=1)
        if not found:
            raise ToolError(f"nothing found on Spotify for '{args.query}'")
        picked = found[0]
        uri = picked["uri"]
    if uri and not uri.startswith("spotify:"):
        raise ToolError("uri must be a spotify: URI")
    body: dict = {}
    if uri:
        body = {"uris": [uri]} if uri.startswith("spotify:track:") else {"context_uri": uri}
    device_id = await api.ensure_device()
    if device_id is None:
        raise ToolError(NO_DEVICE)
    try:
        await api.request("PUT", "/me/player/play", params={"device_id": device_id}, json=body or None)
    except NoActiveDevice as exc:
        raise ToolError(NO_DEVICE) from exc
    return {"playing": picked or ({"uri": uri} if uri else "resumed"), "device_id": device_id}


class ControlArgs(BaseModel):
    action: Literal["pause", "resume", "next", "previous", "volume", "shuffle", "repeat"]
    value: int | None = Field(None, ge=0, le=100, description="volume percent (action=volume)")
    enabled: bool | None = Field(None, description="shuffle on/off, repeat on/off")


@tool(name="spotify_control", description="Pause, resume, skip, go back, set volume, shuffle or repeat on Spotify.",
      risk=Risk.WRITE, activity="Управляю Spotify", requires=("spotify",))
async def spotify_control(ctx: ToolContext, args: ControlArgs) -> dict:
    api = SpotifyAPI(ctx.app, ctx.user_id)
    calls = {
        "pause": ("PUT", "/me/player/pause", None),
        "resume": ("PUT", "/me/player/play", None),
        "next": ("POST", "/me/player/next", None),
        "previous": ("POST", "/me/player/previous", None),
        "shuffle": ("PUT", "/me/player/shuffle", {"state": "false" if args.enabled is False else "true"}),
        "repeat": ("PUT", "/me/player/repeat", {"state": "off" if args.enabled is False else "context"}),
    }
    if args.action == "volume":
        if args.value is None:
            raise ToolError("value (0-100) is required for volume")
        method, path, params = "PUT", "/me/player/volume", {"volume_percent": args.value}
    else:
        method, path, params = calls[args.action]
    try:
        await api.request(method, path, params=params)
    except NoActiveDevice as exc:
        raise ToolError(NO_DEVICE) from exc
    return {"done": args.action, **({"volume": args.value} if args.action == "volume" else {})}


class Empty(BaseModel):
    pass


@tool(name="spotify_now_playing", description="What is playing on Spotify right now, and on which device.",
      activity="Смотрю, что играет", requires=("spotify",))
async def spotify_now_playing(ctx: ToolContext, args: Empty) -> dict:
    data = await SpotifyAPI(ctx.app, ctx.user_id).request("GET", "/me/player")
    if not data:
        return {"playing": False, "note": "nothing is playing on any Spotify device"}
    return {"playing": bool(data.get("is_playing")), "track": _track(data.get("item")),
            "device": (data.get("device") or {}).get("name"),
            "volume": (data.get("device") or {}).get("volume_percent"),
            "shuffle": data.get("shuffle_state"), "repeat": data.get("repeat_state")}
