# Статус реализации

Легенда:
**Implemented** — код написан и проверен (тестами и/или запуском);
**Configured** — работает из коробки после `docker compose up -d`, ничего не нужно;
**Requires credentials** — код готов, нужен ключ/токен (вписать в `.env` или Настройки → Ключи API);
**Requires external account** — нужна регистрация/настройка у внешнего сервиса (см. INTEGRATIONS.md);
**Not yet implemented** — не сделано.

## Ядро

| Компонент | Статус | Примечание |
|---|---|---|
| Агентный цикл: план → инструменты → результат, стрим ответа | Implemented, Configured | тесты `test_harness.py` |
| Долговечность: чекпойнты, lease/heartbeat, возобновление после рестарта | Implemented | проверено перезапуском контейнеров |
| Идемпотентность вызовов инструментов после падения | Implemented | тест crash-resume |
| Таймауты, ретраи с backoff, лимиты частоты, без бесконечных повторов | Implemented | |
| Отмена («стоп», кнопка, каскад на дочерние задачи) | Implemented | |
| Структурированный вывод и валидация входа/выхода инструментов | Implemented | Pydantic + JSON Schema |
| Суб-агенты (research / browser / coding / planner) | Implemented | |
| Роутер моделей, фолбэки, дневной бюджет, учёт стоимости | Implemented | |
| Claude Opus 5 / Sonnet 5 / Haiku 4.5 | Requires credentials | `ANTHROPIC_API_KEY` |
| OpenAI GPT-5.6 Terra / Luna вместо Claude (`JARVIS_LLM_PROVIDER=openai`) | Implemented, Requires credentials | `OPENAI_API_KEY`; проверено против эмулятора OpenAI API, с настоящим ключом не запускалось |
| Локальная модель (Ollama/vLLM) как резерв | Implemented, Requires external account* | *нужна машина с моделью; профиль `local-ai` |
| DemoBrain (работа без ключа) | Implemented, Configured | `JARVIS_FAKE_LLM=true`; только для проверки конвейера |
| Личность и идентичность (`config/identity/*.md`) | Implemented, Configured | |
| Статусы без раскрытия рассуждений | Implemented | thinking-блоки не отправляются клиенту |

## Разрешения и безопасность

| Компонент | Статус |
|---|---|
| 4 уровня (autonomous/confirm/restricted/forbidden), правила в UI, «Всегда разрешать» | Implemented, Configured |
| Одобрения в web, Telegram, WhatsApp, голосом; потолки каналов; истечение | Implemented |
| Повышение прав (пароль/TOTP), TOTP | Implemented |
| Taint-эскалация после недоверенного контента | Implemented |
| Хеш-цепочка аудита с защитой БД-триггером | Implemented |
| Шифрование секретов (MultiFernet), ротация ключа | Implemented |
| SSRF-защита, CSP, CSRF, лимиты входа, сессии и токены устройств со скоупами | Implemented, Configured |
| Изоляция песочницы и браузера | Implemented, Configured (профили `sandbox`, `browser`) |

## Память

| Компонент | Статус |
|---|---|
| Типы памяти, извлечение после каждого ответа, согласование (add/update/supersede/skip), дедупликация | Implemented (извлечение требует ключ Anthropic) |
| Гибридный поиск: pgvector + FTS (рус/англ) + триграммы, RRF | Implemented, Configured |
| Локальные эмбеддинги (fastembed, multilingual MiniLM) | Implemented, Configured — модель (~220 МБ) скачивается с huggingface.co при первом использовании |
| Voyage / OpenAI эмбеддинги | Requires credentials |
| Просмотр, правка, удаление, закрепление, экспорт/импорт в UI | Implemented |

## Задачи и автоматизации

| Компонент | Статус |
|---|---|
| Очередь на Postgres, фоновые задачи, уведомления о завершении | Implemented, Configured |
| Напоминания, cron-автоматизации («каждую пятницу»), интервалы, «запустить сейчас» | Implemented, Configured |

## Инструменты и интеграции

| Компонент | Статус |
|---|---|
| Встроенный календарь, локальные черновики писем, файлы (загрузка, чтение PDF/DOCX/текста, корзина) | Implemented, Configured |
| Google Calendar, Gmail (поиск, чтение, черновики, отправка с подтверждением, архив), Google Drive | Implemented, Requires external account (Google Cloud OAuth-клиент) |
| Веб-поиск и чтение страниц через серверные инструменты Claude | Implemented, Requires credentials (ключ Anthropic) |
| Tavily / Brave | Implemented, Requires credentials |
| Реальный браузер (Playwright) | Implemented, Configured (профиль `browser`) |
| Исполнение кода в песочнице | Implemented, Configured (профиль `sandbox`) |
| Погода (Open-Meteo, без ключа) | Implemented, Configured |
| REST-коннекторы без кода (`connectors.yaml`) | Implemented; каждый API — Requires credentials |
| MCP-клиент (http, stdio), инструменты в общем шлюзе разрешений | Implemented; серверы — по вашему выбору |
| Microsoft Outlook / OneDrive, Dropbox, iCloud / CalDAV, IMAP/SMTP (не-Gmail почта) | **Not yet implemented** (частично закрывается MCP-серверами) |
| Управление вашим настольным компьютером (агент на ПК: окна, мышь, приложения) | **Not yet implemented** — есть только изолированные браузер и песочница |
| Платежи и покупки | **Not implemented намеренно** — запрещено политикой (`forbidden`) |

## Каналы

| Компонент | Статус |
|---|---|
| Веб-командный центр (Dashboard, Chat, Voice, Tasks, Automations, Memory, Skills, Tools, Permissions, Integrations, Logs, Settings), тёмная/светлая тема, мобильная вёрстка | Implemented, Configured |
| Telegram: текст, голосовые, кнопки одобрения, привязка кодом, polling и webhook | Implemented, Requires external account (@BotFather) |
| WhatsApp Cloud API: текст, аудио, interactive-кнопки, привязка, проверка подписи | Implemented, Requires external account (Meta Business + номер) |
| WhatsApp: сообщения вне 24-часового окна (шаблоны) | **Not yet implemented** |
| Голос в браузере: VAD (Silero), barge-in, TTS по предложениям, одобрение голосом | Implemented; качественные STT/TTS — Requires credentials (Deepgram/ElevenLabs или OpenAI); без ключей — речь браузера (Chrome) |
| Потоковое распознавание (partial transcripts во время речи) | **Not yet implemented** — распознаётся фраза целиком после паузы (VAD), ответ озвучивается по предложениям |
| Wake word «Hey JARVIS» на спутнике (openWakeWord) | Implemented; нужно устройство с микрофоном (Raspberry Pi / ПК) и токен устройства |
| Wake word в браузере | **Not yet implemented** (браузер — по нажатию) |
| Нативное мобильное приложение, web push | **Not yet implemented** (мобильный веб + Telegram/WhatsApp) |

## Эксплуатация

| Компонент | Статус |
|---|---|
| `docker compose up -d`, Caddy с автоматическим HTTPS, сегментация сетей | Implemented, Configured |
| Ночные бэкапы restic + pg_dump, ротация, проверка, healthcheck-пинг | Implemented, Configured (пароль генерирует `setup.sh`) |
| Off-site бэкапы (S3/B2) | Requires external account |
| Восстановление `scripts/restore.sh` | Implemented — см. «Что не проверено» |
| Prometheus + Grafana с дашбордом | Implemented, Configured (профиль `monitoring`) |
| Журналы в UI: инструменты, LLM (токены, стоимость, задержка), аудит | Implemented |
| Многопользовательский режим | Частично: модель данных и API изолируют пользователей, `jarvis create-user`; UI управления пользователями — **Not yet implemented** |

## Что не проверено

Честно о границах проверки в среде разработки:

* **С настоящей моделью Claude** сквозные сценарии не прогонялись (в среде разработки не было ключа).
  Интеграция с API проверена тестами формирования запросов и разбора ответов (thinking, tool use,
  server tools, refusal, pause_turn, ошибки), а конвейер — DemoBrain. Первое, что стоит сделать после
  установки ключа, — ручной прогон из [TESTING.md](TESTING.md#ручная-проверка-с-настоящей-моделью).
* **Google, Telegram, WhatsApp, Deepgram, ElevenLabs** — без реальных аккаунтов: проверены на моках
  протоколов (формат запросов, подписи вебхуков, OAuth state, кнопки одобрения).
* **Восстановление из бэкапа** end-to-end не выполнялось: создание снимка и `restic check` проверены,
  а `restore.sh` (остановка, `restic restore`, `pg_restore --clean`, копирование файлов) — нет.
  Проверьте на отдельной машине перед тем, как полагаться на бэкапы.
* **Мониторинг** (Prometheus/Grafana) — конфигурация написана, контейнеры не запускались.
* **Голосовой спутник** — код проверен синтаксически, на реальном микрофоне и динамике не запускался.
* **Загрузка локальной модели эмбеддингов** — в среде разработки huggingface.co был недоступен; проверена
  деградация на поиск по словам. С доступом к интернету модель скачается автоматически.
* **Последние изменения** (синхронизация включения навыков между API и воркером, тексты подсказок)
  проверены на развёрнутом стеке; новый регрессионный тест для синхронизации навыков добавлен, но полный
  прогон pytest после него не выполнялся.
