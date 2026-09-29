# JARVIS desktop agent

Lets JARVIS act on **your own computer**: "открой Chrome", "поставь на паузу", "громкость 40",
"найди в YouTube Daft Punk", "закрой Discord", screenshots so JARVIS can see the screen, typing, hotkeys,
mouse, clipboard and window control. JARVIS itself can run on a server — the agent connects out to it,
nothing has to be opened on your PC.

| Capability | Windows | Linux | macOS |
|---|---|---|---|
| Open / close apps | ✓ (known apps, Start menu, App Paths) | ✓ (`PATH`) | ✓ (`open -a`) |
| Open links / searches | ✓ | ✓ `xdg-open` | ✓ |
| Media keys | ✓ | `playerctl` | Spotify / Music |
| Volume (exact %) | ✓ with `pycaw`, else volume keys | `pactl` | ✓ |
| Windows list/focus/min/max | ✓ | `wmctrl`, `xdotool` | apps |
| Keyboard | ✓ (Unicode) | `xdotool` | ✓ |
| Mouse | ✓ | `xdotool` | — |
| Clipboard | ✓ | `xclip` / `wl-clipboard` | ✓ |
| Screenshot | ✓ `Pillow` | `mss` + `Pillow` | ✓ `Pillow` |
| Shell commands | off by default (`JARVIS_ALLOW_SHELL=1`) | same | same |

`python jarvis_desktop.py --check` prints what works on this machine; only those capabilities are offered
to JARVIS.

## Install

1. In JARVIS: **Settings → Sessions and devices → Computer token** (scope `computer`). Copy the token.
2. Windows: run `scripts\windows\install-desktop-agent.bat` — it asks for the token, installs Python
   packages into `%LOCALAPPDATA%\JARVIS\desktop-venv` and starts the agent silently at every sign-in.
   Other systems:
   ```bash
   python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
   cp .env.example .env   # JARVIS_URL + JARVIS_DEVICE_TOKEN
   python jarvis_desktop.py
   ```
3. JARVIS shows the computer under **Settings → Devices**; the computer tools become available to the agent.

## Security

- Permissions are decided by JARVIS before a call reaches the agent: opening apps/sites, media and volume
  run directly; closing apps, typing, mouse, clipboard and screenshots ask you first; shell commands are
  HIGH risk (web-only approval with re-authentication) **and** disabled here unless you enable them.
- Every action is logged by JARVIS (audit log) and by the agent (typed text and commands are logged only
  as their length).
- App names are never passed to a shell; paths or executables that are not known apps are refused.
- Revoking the device token in JARVIS disconnects the agent immediately.
