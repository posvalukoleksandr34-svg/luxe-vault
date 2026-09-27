# JARVIS voice satellite — "Hey JARVIS"

A small always-on listener for a Raspberry Pi (4/5) or any spare computer with a mic and speaker.

- Wake word detection runs **on the device** with [openWakeWord](https://github.com/dscripka/openWakeWord)
  (`hey_jarvis` model). Nothing is sent until the wake word fires.
- After the wake word it records until you stop talking, sends the utterance to your JARVIS
  (`/api/ws/voice`, device token), and plays the spoken reply sentence by sentence.
- Say "Hey JARVIS" while it talks to interrupt it. Confirm pending actions by voice ("да" / "нет").

## Setup
```bash
sudo apt install -y libportaudio2          # Raspberry Pi OS / Debian
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # JARVIS_URL + a device token from Settings → Sessions and devices
python jarvis_satellite.py --list-devices   # pick INPUT_DEVICE / OUTPUT_DEVICE if needed
python jarvis_satellite.py --calibrate      # suggests SPEECH_RMS for your room
python jarvis_satellite.py
```
Run as a service: see `jarvis-satellite.service`.

Server requirements: a speech-to-text key on the server (`DEEPGRAM_API_KEY` or `OPENAI_API_KEY`) and, for a
natural voice, `ELEVENLABS_API_KEY` (or OpenAI TTS).

Licensing note: the pre-trained `hey_jarvis` model is CC BY-NC-SA 4.0 (personal, non-commercial use).
You can train your own wake word with openWakeWord's training notebook.

Status: implemented and syntax-checked; not tested on physical audio hardware in CI.
