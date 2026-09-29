"""Voice preferences as a tool: "говори голосом Nova", "говори помедленнее", "включи режим без рук"."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from jarvis.tools.base import Risk, ToolContext, ToolError, tool
from jarvis.voice.service import VoiceError, VoiceProfilePatch


class VoiceArgs(BaseModel):
    voice: str | None = Field(None, description="Voice name as the user said it (e.g. 'Nova', 'Onyx', a custom "
                                                "ElevenLabs voice name)")
    provider: Literal["elevenlabs", "openai", "browser"] | None = None
    speed: float | None = Field(None, ge=0.5, le=2.0, description="1.0 normal; 0.8 slower; 1.2 faster")
    style: str | None = Field(None, max_length=300, description="Speaking style for OpenAI voices")
    hands_free: bool | None = Field(None, description="Listen continuously and act only after the wake word")


@tool(name="voice_set_preferences", description="Change how JARVIS speaks and listens for this user: voice, "
      "provider, speed, style, hands-free wake-word mode. Saved permanently.", risk=Risk.WRITE,
      activity="Меняю голос")
async def voice_set_preferences(ctx: ToolContext, args: VoiceArgs) -> dict:
    voice = ctx.app.voice
    current = await voice.profile(ctx.user_id)
    patch = VoiceProfilePatch(speed=args.speed, style=args.style, hands_free=args.hands_free,
                              tts_provider=args.provider)
    if args.voice:
        providers = [args.provider] if args.provider else \
            [p for p in (await voice.available_providers())["tts"] if p != "browser"]
        wanted = args.voice.strip().lower()
        match = None
        for provider in providers:
            try:
                voices = await voice.list_voices(provider)
            except VoiceError:
                continue
            match = next((v for v in voices if v["name"].lower() == wanted or v["id"].lower() == wanted), None) or \
                next((v for v in voices if wanted in v["name"].lower()), None)
            if match:
                break
        if match is None:
            if (args.provider or current.tts_provider) == "browser":
                patch.voice_id, patch.voice_name, patch.tts_provider = args.voice, args.voice, "browser"
            else:
                raise ToolError(f"no voice called '{args.voice}'",
                                hint="voices: " + ", ".join(v["name"] for p in providers for v in
                                                            (await _safe_list(voice, p)))[:400])
        else:
            patch.voice_id, patch.voice_name, patch.tts_provider = match["id"], match["name"], match["provider"]
    patch_data = patch.model_dump(exclude_none=True)
    if not patch_data:
        raise ToolError("nothing to change")
    saved = await voice.save_profile(ctx.user_id, VoiceProfilePatch(**patch_data))
    return {"saved": saved.model_dump(), "note": "applies to the next spoken answer"}


async def _safe_list(voice, provider: str) -> list[dict]:
    try:
        return await voice.list_voices(provider)
    except VoiceError:
        return []
