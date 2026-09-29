# JARVIS как облачный сервис + установщик для Windows

Цель: пользователь скачивает `JARVIS-Setup.exe`, входит своим логином и сразу пользуется — без Docker, без `.env`,
без своих ключей OpenAI. Сервер и ключи — ваши, клиент — тонкий.

```
 Windows-ПК пользователя                         Ваш облачный сервер (https://app.myjarvis.com)
┌──────────────────────────────┐   HTTPS/WSS   ┌──────────────────────────────────────────────┐
│ JARVIS.exe (трей)             │──────────────▶│ Caddy (веб-интерфейс, HTTPS)                  │
│  • вход → токен устройства    │  токен        │ API FastAPI: аккаунты, тарифы, лимиты         │
│    в Credential Manager       │  устройства   │  ├─ /api/ws/voice   голос («Hey Jarvis»)      │
│  • «Hey Jarvis» (локально)    │               │  ├─ /api/ws/device  управление этим ПК        │
│  • управление ПК (агент)      │               │  └─ воркер: агент, напоминания, память        │
│  • «Открыть JARVIS» → окно    │               │ OpenAI / Deepgram / ElevenLabs — ключи ТОЛЬКО │
└──────────────────────────────┘               │ здесь, в переменных окружения сервера         │
                                               │ Postgres (Supabase) · Redis                    │
                                               └──────────────────────────────────────────────┘
```

## Что уже было и что добавлено

| Нужно | Как сделано |
|---|---|
| Ключи OpenAI на сервере, клиент без ключей | **Уже так было.** Клиент никогда не обращается к OpenAI: он шлёт текст/звук в JARVIS, модель вызывает сервер своим ключом. Это надёжнее «прокси к OpenAI»: прокси отдал бы пользователю сырой доступ к модели и деньгам, а JARVIS считает стоимость каждого вызова и режет по тарифу (`llm_usd_month`, `messages_month`, docs/COMMERCIAL.md). |
| Авторизация, защита API | **Уже было:** аккаунты, регистрация, подтверждение e-mail, 2FA, сессии и токены устройств со скоупами, тарифы. Supabase Auth не нужен — он дублировал бы эту систему (см. ниже). |
| Вход в .exe логином/паролем | **Добавлено:** `POST /api/auth/device-login` → токен устройства (`computer`, `voice`, `chat`). Пароль не хранится. |
| Открыть веб-интерфейс из трея уже вошедшим | **Добавлено:** `POST /api/auth/handoff` → одноразовая ссылка на 60 секунд → окно JARVIS без повторного входа. |
| Отозванный токен | Приложение само показывает окно входа (агент распознаёт отказ сервера). |
| Облако с Supabase | **Добавлено:** `deploy/docker-compose.cloud.yml` (своя VM + управляемая БД), `deploy/Dockerfile.cloud` + `render.yaml` (PaaS). |
| .exe и установщик | **Добавлено:** `desktop/app/` (трей, вход, Credential Manager, «Hey Jarvis», автозапуск), `desktop/build/` (PyInstaller, Inno Setup, GitHub Actions). |

### Почему не Supabase Auth

В JARVIS пользователь — это не только логин: к нему привязаны сессии, токены устройств, 2FA, тариф, лимиты, аудит,
изоляция файлов. Перенос на Supabase Auth потребовал бы второй источник правды и синхронизацию. Supabase отлично
подходит как **управляемый Postgres** (с pgvector) — так он и используется. Если позже понадобится «Войти через
Google» — это добавляется в существующую систему аккаунтов (OAuth-вход), а не заменой её.

---

## Часть 1. Сервер в облаке

### Вариант A (рекомендую): своя VM (Hetzner) + тот же docker compose

Проверенный путь: всё, что работает локально, работает на сервере, включая браузер и песочницу.

1. Сервер: Hetzner Cloud **CX32** (4 vCPU, 8 ГБ) или больше, Ubuntu 24.04. DNS: `A app.myjarvis.com → IP сервера`.
2. На сервере:
   ```bash
   curl -fsSL https://get.docker.com | sh
   git clone https://github.com/posvalukoleksandr34-svg/Jarvin.git jarvis && cd jarvis
   ./scripts/setup.sh            # создаёт .env и генерирует все секреты
   ```
3. В `.env`:
   ```
   JARVIS_SITE_ADDRESS=app.myjarvis.com      # Caddy сам получит HTTPS-сертификат Let's Encrypt
   JARVIS_PUBLIC_URL=https://app.myjarvis.com
   HTTP_PORT=80
   HTTPS_PORT=443
   JARVIS_LLM_PROVIDER=openai
   OPENAI_API_KEY=…                          # ваш ключ — пользователи его не видят
   DEEPGRAM_API_KEY=…                        # серверное распознавание (нужно для «Hey Jarvis» в .exe)
   ELEVENLABS_API_KEY=…                      # голос
   JARVIS_SIGNUP_MODE=open                   # или invite
   SMTP_HOST=… SMTP_USER=… SMTP_PASSWORD=… SMTP_FROM=…   # подтверждение e-mail и сброс пароля
   STRIPE_SECRET_KEY=… STRIPE_WEBHOOK_SECRET=… STRIPE_PRICE_PRO=…
   ```
4. `docker compose up -d` — готово. Проверка: `https://app.myjarvis.com/api/version`.

**С Supabase вместо локального Postgres** (управляемая база с бэкапами):

1. Supabase → New project → Database → Extensions: включите `vector` и `pg_trgm` (миграции делают это сами, если у роли есть права).
2. Supabase → Connect → **Session pooler** (порт **5432**). Transaction pooler (6543) не подходит: asyncpg использует
   подготовленные запросы.
3. В `.env`:
   ```
   DATABASE_URL=postgresql+asyncpg://postgres.<ref>:<пароль>@aws-0-<регион>.pooler.supabase.com:5432/postgres?ssl=require
   ```
4. Запуск с облачным оверлеем (локальные postgres и backup не стартуют):
   ```bash
   docker compose -f docker-compose.yml -f deploy/docker-compose.cloud.yml up -d
   ```
   Бэкапы базы — средствами Supabase (Database → Backups / PITR).

### Вариант B: Render (PaaS) + Supabase

`render.yaml` в корне: сервисы `jarvis-api` (API + воркер + планировщик в одном процессе — у Render диск принадлежит
одному сервису, а файловые инструменты должны видеть тот же `/data`), `jarvis-web` (Caddy + интерфейс), `jarvis-redis`.
Render → New → Blueprint → репозиторий → заполните переменные с `sync: false` (`JARVIS_DATABASE_URL`,
`JARVIS_PUBLIC_URL`, `JARVIS_MASTER_KEYS` — сгенерируйте `python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"`,
`OPENAI_API_KEY` …). Домен привязывается к `jarvis-web`.

Ограничения: на Render нет изолированного браузера и песочницы (это отдельные контейнеры с сетевой изоляцией) —
навыки «Браузер» и «Код» будут недоступны. **Статус: конфигурация написана и образ `deploy/Dockerfile.cloud`
собран и проверен локально; сам деплой на Render не выполнялся.**

Railway: те же образы — сервис из `deploy/Dockerfile.cloud` (команда `docker-entrypoint.sh api`,
`JARVIS_EMBEDDED_WORKER=true`), сервис из `frontend/Dockerfile` (`JARVIS_API_UPSTREAM=<api>.railway.internal:8000`),
плагин Redis, база — Supabase.

### Безопасность мультиаккаунтного сервера

* Регистрация: `JARVIS_SIGNUP_MODE=open` + SMTP (иначе нет подтверждения e-mail).
* Тарифы и лимиты — `config/plans.yaml`; бюджет модели на пользователя ограничивает ваши расходы на OpenAI.
* Изолированный браузер и песочница кода общие для сервера: давайте их только доверенным тарифам (`features` в плане).
* `JARVIS_MASTER_KEYS` храните в менеджере паролей: без него не расшифровать сохранённые интеграции.
* Сервер запущен только владельцем: админка, выключатели функций, режим обслуживания — `/admin`.

---

## Часть 2. Клиент: JARVIS.exe

### Структура

```
desktop/
├── jarvis_app.py            точка входа JARVIS.exe
├── app/
│   ├── main.py              трей, фоновый рантайм, повторный вход
│   ├── login_window.py      окно входа (tkinter, тёмное)
│   ├── credentials.py       токен в Windows Credential Manager (keyring)
│   ├── api.py               device-login, handoff, logout
│   ├── config.py            адрес сервера (вшивается при сборке) и папка данных
│   └── windows.py           автозапуск (HKCU\…\Run), один экземпляр, окно Edge/Chrome --app
├── jarvis_desktop.py        управление компьютером (агент, как раньше)
├── resources/jarvis.ico
├── requirements-app.txt
└── build/
    ├── build.ps1            сборка: venv → адрес сервера → модель wake word → PyInstaller → Inno Setup
    ├── jarvis.spec          PyInstaller (одна папка, без консоли, без UPX)
    ├── installer.iss        Inno Setup (без прав администратора, автозапуск, удаление)
    └── github-actions-desktop.yml   сборка установщика на Windows-раннере GitHub
satellite/jarvis_satellite.py «Hey Jarvis» (openWakeWord) + голос — используется приложением
```

### Как работает

1. **Первый запуск** → окно входа (e-mail, пароль, при необходимости код 2FA; ссылки «Создать аккаунт» и
   «Забыли пароль?» открывают сайт). `POST /api/auth/device-login` → токен устройства → Credential Manager
   (Панель управления → Диспетчер учётных данных → Учётные данные Windows → «JARVIS»). Пароль не сохраняется.
2. **Дальше** приложение живёт в трее. Автозапуск (`JARVIS.exe --background`) ставит установщик, переключается в меню.
3. **«Hey Jarvis»**: модель openWakeWord работает на ПК, звук до слова-активатора никуда не уходит. После него фраза
   отправляется на сервер, ответ звучит из колонок. Окно не открывается; в трее — уведомление «Слушаю…».
4. **Управление ПК** — тот же агент (приложения, музыка, громкость, сайты…), подключается тем же токеном.
5. **«Открыть JARVIS»** в меню трея → одноразовая ссылка → окно `/widget` (Edge/Chrome в режиме приложения) уже вошедшим.
6. **«Выйти из аккаунта»** → токен отзывается на сервере и удаляется из Credential Manager → окно входа.
   Если токен отозвали в «Настройки → Устройства» — приложение само попросит войти заново.

### Сборка установщика

На Windows (Python 3.12 x64 и Inno Setup 6: `winget install JRSoftware.InnoSetup`):

```powershell
cd desktop
powershell -ExecutionPolicy Bypass -File build\build.ps1 -ServerUrl https://app.myjarvis.com -Version 1.0.0
# → desktop\dist\JARVIS-Setup-1.0.0.exe
```

Или без своей Windows-машины: скопируйте `desktop/build/github-actions-desktop.yml` в `.github/workflows/desktop.yml`
репозитория Jarvin, задайте переменную `JARVIS_SERVER_URL`, запустите Actions → desktop-installer → Run workflow;
установщик появится в артефактах запуска.

Разработка без сборки: `pip install -r desktop/requirements-app.txt`, затем
`set JARVIS_URL=http://localhost:8088` и `python desktop\jarvis_app.py`.

### Подпись кода (обязательно для продажи)

Неподписанный `.exe` Windows SmartScreen встречает предупреждением «Неизвестный издатель», антивирусы чаще дают
ложные срабатывания. Нужен сертификат подписи кода (OV/EV, ~200–500 $ в год; EV сразу снимает SmartScreen).
`build.ps1` подписывает `JARVIS.exe` и установщик, если заданы `SIGN_PFX` и `SIGN_PASSWORD`.

### Требования к серверу для «Hey Jarvis» в .exe

Приложение распознаёт речь на сервере: нужен `DEEPGRAM_API_KEY` или `OPENAI_API_KEY`, а у тарифа пользователя —
функция `voice_premium` (docs/COMMERCIAL.md). Без неё голос работает только в браузере, а в трее придёт уведомление.

---

## Статус проверки

| Что | Статус |
|---|---|
| `device-login`, handoff (одноразовость, защита от открытого редиректа, только из приложения), выход, отзыв токена → повторный вход | Проверено на стенде (13/13) |
| Агент подключается токеном приложения; отозванный токен распознаётся | Проверено на стенде |
| `deploy/Dockerfile.cloud` (config и skills внутри, `.env` не попадает в образ) | Собран и проверен |
| `deploy/docker-compose.cloud.yml` (Supabase вместо локальной БД) | `docker compose config` проверен; с настоящим Supabase не запускался |
| `render.yaml` | Написан, на Render не деплоился |
| Трей, окно входа, Credential Manager, автозапуск, «Hey Jarvis» в приложении | Код написан; на Windows не запускался (среда разработки — Linux) |
| PyInstaller / Inno Setup / GitHub Actions | Скрипты написаны и синтаксически проверены; установщик не собирался |
