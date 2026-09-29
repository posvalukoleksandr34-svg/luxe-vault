# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/). Versions follow the app version shown in
Settings → About and `GET /api/version` (app / API / database schema).

## [Unreleased] — Ultra upgrade + commercial core

Database migrations: **0002** (custom commands), **0003** (accounts, subscriptions, usage, billing events,
support reports). They run automatically when the api starts; back up first (`scripts/update.sh` does).

### Added
- **Desktop widget** (`/widget`, shortcut «JARVIS Widget»): glass three-column window — session timer, monthly
  usage, weather (new `GET /api/weather`, Open-Meteo), live voice dialog with an animated microphone
  (Framer Motion), dock (full UI, send clipboard, reminders, voice settings, type), dialog panel.
- **Computer control.** Desktop agent (`desktop/`, Windows/Linux/macOS) connects to `/api/ws/device` with a
  `computer` device token. New skill `computer` (13 tools): open/close apps, media keys, volume, open sites and
  searches (web, YouTube, maps, Spotify), windows, typing, hotkeys, mouse, clipboard, screenshots (the model can
  see them), shell commands (off by default, restricted tier). Local kill switches in `desktop.env`.
  Windows installer: `scripts/windows/install-desktop-agent.bat` (hidden autostart).
- **Custom commands** (`/commands`): a phrase → a chain of steps (tool, wait, say, notify, agent) with
  conditions and error handling, run without a model call. The permission policy is checked when saving and
  on every run; pre-approval needs re-authentication. Templates: Gaming mode, Good morning.
- **Voice 2.0**: per-user voice profile — provider, voice (including your own ElevenLabs voices by ID), speed,
  pitch, speaking style, preview; hands-free mode with a wake word ("Джарвис, …") and a follow-up window.
- **Spotify** integration (OAuth) and skill: play a track/artist/album/playlist, pause/next/volume/shuffle,
  now playing; starts the Spotify app on the PC through the desktop agent if no device is active.
- **Settings** split into sections (General, Account & plan, Voice, AI, Appearance, Devices, Keys, Security,
  Commands & automation, About). Themes: dark, light, **follow the system**, and an accent colour.
  Compact **/mini** window and a "JARVIS Mini" Windows shortcut.
- Visualizer states: idle, listening, thinking, executing (tool), speaking, **error**, audio-reactive.
- **Accounts**: sign-up modes `closed` (default) / `invite` / `open`, e-mail verification, password reset,
  invites, onboarding flag, account data export (JSON) and self-service deletion.
- **Plans & entitlements** (`config/plans.yaml`): monthly messages, burst rate, model budget (USD, measured
  from real token usage), custom commands, automations, devices; feature groups (computer, spotify, google,
  voice_premium, api, …). Enforced on the server at every entry point; unentitled tools are not offered.
- **Payments** (Stripe): Checkout, Customer Portal, signed and idempotent webhooks.
- **Admin** (`/admin`, owner only): users, plans, blocking, usage, spend, feature flags (kill switches),
  maintenance mode, invites, support inbox.
- **Support**: in-app bug/feedback/question form.
- **Public pages**: pricing, terms and privacy templates, sign-up, password reset.
- **Public API v1**: `POST /api/v1/messages`, `GET /api/v1/tasks/{id}`, `GET /api/v1/usage`,
  `GET /api/v1/openapi.json`; `GET /api/version`, `GET /api/public/config`.
- `scripts/update.sh` waits for readiness and rolls the code back automatically; `--rollback <commit>`.

### Changed
- Device tokens accept only known scopes (`voice`, `chat`, `computer`, `*`).
- Skill on/off, skill reload and Telegram webhook registration are owner-only (they are instance-wide).
- Non-owner accounts see only their own spend in the status bar; worker details are owner-only.
- Replies that were not streamed (e.g. custom command results) are now spoken in the voice session.
- OAuth `state` is shared by all OAuth integrations and bound to the integration it was issued for.

### Fixed
- Memory: an empty `HF_ENDPOINT=` line in `.env` broke the local embedding model download ("Request URL is
  missing an 'http://' or 'https://' protocol"); empty now means the default huggingface.co.
- OpenAI brain: `gpt-5.6-terra` rejects `reasoning_effort` together with function tools on `/v1/chat/completions`
  (HTTP 400 "Function tools with reasoning_effort are not supported"). JARVIS now retries once with
  `reasoning_effort: none` and remembers it for that model; requests without tools keep their reasoning effort.
- Device calls: no more `TimeoutError` from long Redis blocking reads; a call that timed out can never be
  executed later on the PC (deadline + removal from the queue).

### Security
- **Tenant isolation of files**: every non-owner account has its own file workspace
  (`/data/files/tenants/<id>`); the owner's workspace cannot reach it. Previously all accounts shared one.
- Disabled accounts lose every session and token immediately.
- Maintenance mode blocks everyone but the owner; payment webhooks keep working.
- No secret, token, API key or e-mail link is ever written to logs; exports never include hashes, tokens or
  encrypted credentials.
