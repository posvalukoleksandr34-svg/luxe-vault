# Интеграции

Все ключи можно задать в `.env` или в **Настройки → Ключи API** (хранятся в БД зашифрованными;
значение из `.env` имеет приоритет). Состояние каждой интеграции видно на странице **Интеграции** и в
`docker compose exec api jarvis doctor`.

## Anthropic (обязательно)

1. https://console.anthropic.com → API Keys → Create key.
2. `ANTHROPIC_API_KEY=sk-ant-...` или Настройки → Ключи API → «Anthropic (мозг)».
3. Лимит расходов в день: `JARVIS_DAILY_COST_LIMIT_USD` (по умолчанию 20). Траты по дням, моделям и
   задачам — на Dashboard и в «Журналах → LLM».

Маршрутизация — `config/models.yaml`: `main` (чат), `voice` (быстрый первый ответ), `deep` (фоновые
отчёты), `worker` (суб-агенты), `fast` (память), `local` (резерв). Меняете модель или effort — правите
файл и `docker compose restart api worker`.

## Google: Gmail, Calendar, Drive

Без Google JARVIS использует встроенный календарь и локальные черновики писем — сценарии работают, но
не синхронизируются с вашим аккаунтом.

1. https://console.cloud.google.com → создайте проект.
2. **APIs & Services → Library**: включите *Gmail API*, *Google Calendar API*, *Google Drive API*.
3. **OAuth consent screen**: тип *External*, добавьте свой адрес в *Test users* (для личного использования
   публикация не нужна; в режиме Testing токен обновления живёт 7 дней — чтобы не переподключаться,
   переведите приложение в *In production*, для личного использования проверка Google не требуется,
   будет предупреждение «unverified app»).
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorized redirect URI: `<JARVIS_PUBLIC_URL>/api/integrations/google/callback`
   (например `https://jarvis.example.com/api/integrations/google/callback`).
5. `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET` в `.env` → `docker compose up -d`.
6. **Интеграции → Google → Подключить**.

Запрашиваемые права: `gmail.modify` (читать, черновики, отправка, архив), `calendar`, `drive.readonly`
(поиск и чтение), `drive.file` (только файлы, созданные JARVIS). Токены хранятся зашифрованными;
«Отключить» отзывает их у Google.

Отправка письма всегда идёт через черновик и подтверждение («Я готов выполнить действие. Подтвердить?»).

## Telegram

1. Напишите [@BotFather](https://t.me/BotFather) → `/newbot` → получите токен.
2. `TELEGRAM_BOT_TOKEN=...` → `docker compose up -d`.
3. Режим: `JARVIS_TELEGRAM_MODE=polling` (работает везде, без публичного адреса) или `webhook`
   (нужен HTTPS `JARVIS_PUBLIC_URL`; JARVIS сам регистрирует вебхук с секретом
   `JARVIS_TELEGRAM_WEBHOOK_SECRET`).
4. **Интеграции → Telegram → Получить код** → отправьте боту `/start 123456` (код действует 10 минут).

Бот отвечает только в личных чатах и только привязанным аккаунтам. Одобрения — inline-кнопки,
голосовые сообщения распознаются (нужен STT-ключ). Пример: «JARVIS, напомни мне завтра в 10 купить молоко».

## WhatsApp (официальный Meta Cloud API)

Нужны: аккаунт Meta for Developers, бизнес-приложение и номер телефона, не зарегистрированный в
обычном WhatsApp (можно тестовый номер Meta для начала). Нужен публичный HTTPS-адрес.

1. https://developers.facebook.com → My Apps → Create app → тип *Business* → добавьте продукт *WhatsApp*.
2. **WhatsApp → API Setup**: скопируйте *Phone number ID*; создайте постоянный токен
   (Business Settings → System users → Generate token с правами `whatsapp_business_messaging`,
   `whatsapp_business_management`).
3. **App settings → Basic**: *App secret*.
4. `.env`: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`
   (`WHATSAPP_VERIFY_TOKEN` уже сгенерирован `setup.sh`) → `docker compose up -d`.
5. **WhatsApp → Configuration → Webhook**: Callback URL `<JARVIS_PUBLIC_URL>/api/webhooks/whatsapp`
   (адрес показан на странице «Интеграции»), Verify token = `WHATSAPP_VERIFY_TOKEN`, подпишитесь на поле
   `messages`.
6. **Интеграции → WhatsApp → Получить код** → отправьте на номер бота `link 123456`.

Каждый вебхук проверяется по HMAC-подписи `X-Hub-Signature-256`. Одобрения — interactive buttons.
Ограничение платформы: вне 24-часового окна после вашего последнего сообщения бизнес может писать
только шаблонами, поэтому напоминание в WhatsApp доходит, только если вы писали боту за последние 24 часа.
В веб и другие привязанные каналы уведомления приходят всегда.

## Голос

| Что | Провайдер по умолчанию | Ключ | Без ключа |
|---|---|---|---|
| Распознавание (STT) | Deepgram nova-3, `language=multi` (рус/англ) | `DEEPGRAM_API_KEY` | OpenAI `gpt-4o-mini-transcribe` (`OPENAI_API_KEY`), иначе распознавание браузера (Chrome) |
| Синтез (TTS) | ElevenLabs Flash v2.5 (стрим MP3) | `ELEVENLABS_API_KEY`, голос `JARVIS_ELEVENLABS_VOICE_ID` | OpenAI `gpt-4o-mini-tts`, иначе синтез браузера |
| VAD | Silero VAD v5 в браузере | — | — |
| Wake word | openWakeWord `hey_jarvis` на спутнике | — | — |

Страница **Голос**: нажмите на сферу; говорите — VAD сам определит конец фразы; начните
говорить во время ответа — JARVIS замолчит (barge-in). Микрофон в браузере работает только по HTTPS
или на `localhost`.

## Веб-поиск

`JARVIS_SEARCH_PROVIDER=anthropic` (по умолчанию) — серверные web search/fetch Claude, отдельный ключ
не нужен (оплачиваются по тарифу Anthropic). Альтернативы: `tavily` (`TAVILY_API_KEY`) или `brave`
(`BRAVE_API_KEY`); тогда страницы загружает сам JARVIS с защитой от SSRF.

## MCP-серверы

`config/mcp.yaml`:

```yaml
servers:
  - name: github
    transport: http
    url: https://api.githubcopilot.com/mcp/
    headers: {Authorization: "Bearer ${GITHUB_TOKEN}"}
    default_risk: external        # всё требует подтверждения…
    tools:
      get_file_contents: {risk: read}   # …кроме явно помеченного чтения
```

Инструменты появляются как `mcp__<server>__<tool>` и проходят через тот же шлюз: разрешения, аудит,
таймауты, лимиты. Их ответы считаются недоверенными (включают taint). Поддерживаются транспорты `http`
и `stdio`. После правки — `docker compose restart worker`.

## REST-коннекторы без кода

`config/connectors.yaml` — любой HTTP API (Home Assistant, Notion, свой сервис) для навыка «API»:

```yaml
connectors:
  - name: home_assistant
    description: Smart home. GET states/<entity_id>; POST services/<domain>/<service>
    base_url: http://homeassistant.local:8123/api
    auth: {type: bearer, env: HOME_ASSISTANT_TOKEN}
    allow: ["states*", "services/light/*"]
    allow_private_network: true
```

Доступны только пути из `allow`; `api_get` — чтение без подтверждения, `api_call` — с подтверждением.

## Голосовой спутник

См. [`satellite/README.md`](../satellite/README.md). Токен устройства со скоупами `voice,chat`:
Настройки → Сессии и устройства, или `docker compose exec api jarvis device-token <email> <имя>`.
Модель `hey_jarvis` распространяется по лицензии CC BY-NC-SA 4.0 — только личное некоммерческое
использование; для другого применения обучите собственное слово в openWakeWord.
