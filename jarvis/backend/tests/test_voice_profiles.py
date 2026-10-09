"""Voice 2.0: wake-word gating, per-user voice settings reach the TTS providers, voice listing."""

import json
from types import SimpleNamespace

import httpx
import pytest

from jarvis.voice.service import VoiceProfile, VoiceService
from jarvis.voice.session import _speakable, strip_wake


def test_wake_word_detection():
    ww = ["джарвис", "jarvis"]
    assert strip_wake("Джарвис, открой Chrome", ww) == ("открой Chrome", True)
    assert strip_wake("эй джарвис включи музыку", ww) == ("включи музыку", True)
    assert strip_wake("Hey Jarvis — pause", ww) == ("pause", True)
    assert strip_wake("Джервис громкость 30", ww) == ("громкость 30", True)  # common STT spelling
    assert strip_wake("Jarvis", ww) == ("", True)
    assert strip_wake("открой Chrome", ww)[1] is False
    assert strip_wake("Мы говорили про Джарвиса вчера", ww)[1] is False  # mention ≠ address
    assert strip_wake("Friday, lights", ["friday"]) == ("lights", True)  # custom wake word


def test_finished_messages_are_spoken_without_markup():
    assert _speakable("«Gaming Mode» выполнена не полностью.\n✗ Закрываю: discord\n✓ Запускаю: spotify") == \
        "«Gaming Mode» выполнена не полностью. Закрываю: discord. Запускаю: spotify"


def _service(handler, keys):
    async def get(name):
        return keys.get(name)

    app = SimpleNamespace(secrets=SimpleNamespace(get=get),
                          settings=SimpleNamespace(tts_provider="elevenlabs", stt_provider="deepgram",
                                                   elevenlabs_voice_id="DEFAULT", elevenlabs_model="eleven_flash_v2_5"))
    return VoiceService(app, transport=httpx.MockTransport(handler))


async def test_elevenlabs_uses_the_chosen_voice_and_speed():
    seen = {}

    def handler(r: httpx.Request):
        seen["url"], seen["body"] = str(r.url), json.loads(r.content)
        return httpx.Response(200, content=b"ID3mp3")

    svc = _service(handler, {"elevenlabs_api_key": "k"})
    prof = VoiceProfile(tts_provider="elevenlabs", voice_id="myClonedVoice", speed=1.1)
    audio = b"".join([c async for c in svc.synthesize("Привет", prof)])
    assert audio == b"ID3mp3" and "/text-to-speech/myClonedVoice/stream" in seen["url"]
    assert seen["body"]["voice_settings"] == {"speed": 1.1}


async def test_openai_voice_and_style_become_instructions():
    seen = {}

    def handler(r: httpx.Request):
        seen["body"] = json.loads(r.content)
        return httpx.Response(200, content=b"mp3")

    svc = _service(handler, {"openai_api_key": "k"})
    prof = VoiceProfile(tts_provider="openai", voice_id="nova", speed=0.8, style="calm, warm")
    _ = [c async for c in svc.synthesize("Привет", prof)]
    assert seen["body"]["voice"] == "nova" and seen["body"]["model"] == "gpt-4o-mini-tts"
    assert seen["body"]["instructions"] == "calm, warm Speak noticeably slower than normal."
    assert "speed" not in seen["body"]


async def test_missing_key_falls_back_instead_of_failing():
    svc = _service(lambda r: httpx.Response(500), {})
    assert await svc._provider_for(VoiceProfile(tts_provider="elevenlabs")) == "browser"


async def test_elevenlabs_voice_list_includes_custom_voices():
    def handler(r: httpx.Request):
        return httpx.Response(200, json={"voices": [
            {"voice_id": "a1", "name": "George", "labels": {"gender": "male"}, "category": "premade"},
            {"voice_id": "c9", "name": "My Friday", "labels": {}, "category": "cloned"}]})

    svc = _service(handler, {"elevenlabs_api_key": "k"})
    VoiceService._voices_cache.clear()
    voices = await svc.list_voices("elevenlabs")
    assert [(v["name"], v["category"]) for v in voices] == [("George", "premade"), ("My Friday", "cloned")]
    assert {v["id"] for v in await svc.list_voices("openai")} >= {"nova", "onyx", "alloy"}
