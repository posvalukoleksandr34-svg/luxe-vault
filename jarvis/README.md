# JARVIS — персональный ИИ-агент на своём сервере

JARVIS — это не чат-бот, а агент: планирует, вызывает инструменты, помнит, ставит задачи в фон,
выполняет автоматизации по расписанию и спрашивает подтверждение перед рискованными действиями.
Одно ядро обслуживает все каналы: веб-командный центр, голос (с wake word «Hey JARVIS»),
Telegram и WhatsApp.

```
Вы ── Web / Voice / Telegram / WhatsApp ──► API ──► очередь задач (Postgres) ──► Worker: агентный цикл
                                                                                 │  Claude Opus 5 (router)
                                                                                 │  инструменты + навыки + MCP
                                                                                 │  память (pgvector + FTS)
                                                                                 └► статусы в реальном времени
```

## Быстрый старт (один сервер, Docker)

```bash
git clone <repo> && cd <repo>/jarvis
./scripts/setup.sh                      # создаёт .env и все секреты; спросит домен и ключ Anthropic
docker compose up -d                    # всё поднимается одной командой
docker compose logs api | grep SETUP    # одноразовый код, если владелец не задан в .env
```

Откройте `JARVIS_PUBLIC_URL` (по умолчанию http://localhost), создайте владельца кодом из логов,
добавьте ключ Anthropic в **Настройки → Ключи API**, если не указали его при установке.
С доменом (`./scripts/setup.sh --domain jarvis.example.com`) Caddy сам получит HTTPS-сертификат.

Попробовать без ключа: `JARVIS_FAKE_LLM=true` в `.env` включает детерминированный «демо-мозг»
(правила вместо модели) — чтобы проверить весь конвейер: память, напоминания, одобрения, задачи.

## Что внутри

| | |
|---|---|
| **Агентное ядро** | durable-цикл с чекпойнтами после каждого шага, идемпотентные вызовы инструментов, таймауты, ретраи, лимиты, отмена, возобновление после рестарта, суб-агенты |
| **Модели** | роутер: Claude Opus 5 (основной/голос/глубокий), Sonnet 5 (суб-агенты), Haiku 4.5 (память), локальная модель как резерв; дневной лимит расходов |
| **Разрешения** | 4 уровня: autonomous / confirm / restricted / forbidden; «Я готов выполнить действие. Подтвердить?» в любом канале; повышение прав паролем/TOTP |
| **Память** | профиль, проекты, люди, эпизоды, важное; автоматическое извлечение, дедупликация, замещение устаревшего; гибридный поиск (смысл + слова + опечатки) |
| **Навыки** | 10 встроенных: календарь, почта, исследование, файлы, Google Drive, браузер, код (песочница), погода, планирование, REST API |
| **Каналы** | Web (WebSocket), голос (VAD, стриминг, barge-in), Telegram (кнопки одобрения, голосовые), WhatsApp Cloud API |
| **Задачи** | фоновые задачи, напоминания, «каждую пятницу…», переживают перезапуск |
| **Безопасность** | неизменяемый аудит-журнал с хеш-цепочкой, шифрование секретов, SSRF-защита, изолированные браузер и песочница, CSP |
| **Эксплуатация** | Prometheus + Grafana, JSON-логи, ночные зашифрованные бэкапы (restic), восстановление одной командой |

## Документация

| Документ | О чём |
|---|---|
| [docs/STATUS.md](docs/STATUS.md) | **Что реализовано, что требует ключей/аккаунтов, чего ещё нет** |
| [CHANGELOG.md](CHANGELOG.md) | Что изменилось в каждой версии |
| [desktop/README.md](desktop/README.md) | Управление компьютером: установка desktop-агента на ПК |
| [docs/COMMANDS.md](docs/COMMANDS.md) | Свои команды («игровой режим» и т. п.) |
| [docs/VOICE.md](docs/VOICE.md) | Голос, свой голос, режим без рук |
| [docs/COMMERCIAL.md](docs/COMMERCIAL.md) | Аккаунты, тарифы и лимиты, оплата Stripe, админка, API v1 |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Если что-то не работает |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Архитектура, стек, агентное ядро, память, разрешения, задачи, каналы |
| [docs/SETUP.md](docs/SETUP.md) | Установка на сервер, домен/HTTPS, профили, локальная разработка |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Anthropic, Google, Telegram, WhatsApp, голос, поиск, MCP, REST-коннекторы, спутник с wake word |
| [docs/SECURITY.md](docs/SECURITY.md) | Модель угроз и механизмы защиты |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Бэкапы и восстановление, мониторинг, ротация ключей, обновления, диагностика |
| [docs/SKILLS.md](docs/SKILLS.md) | Как написать свой навык |
| [docs/TESTING.md](docs/TESTING.md) | Тесты и сквозные сценарии |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Дальнейшие этапы |

## Структура

```
jarvis/
├── backend/            FastAPI + агентное ядро (Python 3.12)
│   ├── jarvis/         agent/ llm/ tools/ permissions/ memory/ tasks/ skills/ channels/ voice/ integrations/ api/ …
│   ├── migrations/     Alembic
│   └── tests/
├── frontend/           командный центр (React 19 + Vite + Tailwind) + Caddy (edge, HTTPS)
├── skills/             навыки: skill.yaml + instructions.md + tools.py + tests/
├── config/             models.yaml, permissions.yaml, mcp.yaml, connectors.yaml, identity/*.md
├── infrastructure/     backup (restic), sandbox, monitoring (Prometheus/Grafana)
├── satellite/          голосовой спутник с wake word «Hey JARVIS» (Raspberry Pi / ПК)
├── scripts/            setup, backup-now, restore, update, dev-backend
└── docker-compose.yml
```

Личность и правила поведения — обычные Markdown-файлы в `config/identity/`; модели и их параметры —
`config/models.yaml`; политика подтверждений — `config/permissions.yaml` (плюс правила в UI).
