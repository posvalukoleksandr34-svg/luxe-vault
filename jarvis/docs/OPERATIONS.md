# Эксплуатация

## Бэкапы

Сервис `backup` каждую ночь (`BACKUP_CRON`, по умолчанию 03:30 UTC):

1. `pg_dump -Fc` всей базы (беседы, память с векторами, задачи, автоматизации, аудит, зашифрованные
   ключи интеграций) и проверка, что дамп читается;
2. `restic backup` дампа и тома `/data` (файлы пользователя, сгенерированный мастер-ключ) — шифрование
   `RESTIC_PASSWORD`, дедупликация; кэш моделей и корзина исключены;
3. ротация: 7 дневных, 4 недельных, 12 месячных снимков; по воскресеньям `restic check` 5 % данных;
4. пинг `BACKUP_HEALTHCHECK_URL` (например healthchecks.io) — узнаете, если бэкап перестал выполняться.

Без `RESTIC_PASSWORD` сервис пишет предупреждение и бэкапы **выключены** (`setup.sh` задаёт пароль).

```bash
make backup                                    # бэкап сейчас + список снимков
docker compose run --rm backup snapshots       # список снимков
```

**Off-site.** По умолчанию репозиторий лежит в `./backups` на том же сервере — это защищает от ошибок,
но не от потери сервера. Для настоящей защиты укажите удалённый репозиторий:

```bash
RESTIC_REPOSITORY=s3:s3.eu-central-1.amazonaws.com/my-bucket/jarvis
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# или Backblaze B2: RESTIC_REPOSITORY=b2:my-bucket:jarvis  B2_ACCOUNT_ID=...  B2_ACCOUNT_KEY=...
```

## Восстановление

На том же или новом сервере:

```bash
git clone <repo> && cd <repo>/jarvis
# 1. верните старый .env (в нём JARVIS_MASTER_KEYS и RESTIC_PASSWORD)
# 2. сделайте репозиторий доступным: скопируйте ./backups или укажите удалённый RESTIC_REPOSITORY
docker compose build
./scripts/restore.sh                 # последний снимок; или ./scripts/restore.sh <snapshot-id>
docker compose exec api jarvis doctor
docker compose exec api jarvis verify-audit
```

`restore.sh` останавливает api/worker/caddy, поднимает Postgres, запускает одноразовый сервис
`restore` (профиль `restore`, том данных с правом записи): `restic restore` → `pg_restore --clean` →
копирование файлов в `/data`, затем запускает всё обратно.

Проверяйте восстановление раз в квартал на отдельной машине — непроверенный бэкап не является бэкапом.

**RPO/RTO:** до 24 часов данных (ночной бэкап; для меньшего RPO поставьте `BACKUP_CRON=0 */6 * * *`),
восстановление — минуты.

## Мониторинг

* **UI:** Dashboard (траты, задачи, ошибки, очередь), Журналы → Инструменты / LLM / Аудит,
  Настройки → Система (состояние компонентов, воркеры, очередь).
* **Prometheus + Grafana:** `COMPOSE_PROFILES=...,monitoring`, Grafana на `http://127.0.0.1:3001`
  (с сервера или через SSH-туннель `ssh -L 3001:localhost:3001 server`), логин `admin` /
  `GRAFANA_ADMIN_PASSWORD`. Готовый дашборд «JARVIS»: траты за 24 ч и по моделям, токены, задержка LLM
  p95, частота и задержка вызовов инструментов, доля ошибок инструментов, очередь и итоги задач,
  одобрения, HTTP.
* **Метрики:** `jarvis_llm_requests_total`, `jarvis_llm_tokens_total`, `jarvis_llm_cost_usd_total`,
  `jarvis_llm_latency_seconds`, `jarvis_tool_calls_total`, `jarvis_tool_latency_seconds`,
  `jarvis_tasks_total`, `jarvis_task_queue_depth`, `jarvis_approvals_total`, `jarvis_http_requests_total`,
  `jarvis_http_latency_seconds`, `jarvis_memory_ops_total`. API — `/metrics` (bearer
  `JARVIS_METRICS_TOKEN`, недоступен снаружи), воркер — `:9100` во внутренней сети.
* **Health:** `/api/health` (процесс жив), `/api/ready` (БД и Redis доступны) — используется
  healthcheck Docker.
* **Логи:** JSON в stdout (секреты маскируются), ротация Docker 10 МБ × 5 файлов. Ошибки задач содержат
  `task_id`: `docker compose logs worker | grep <task_id>`. Полная история конкретной задачи (шаги,
  вызовы инструментов, стоимость) — страница «Задачи» → задача.

## Ротация ключа шифрования

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# .env: JARVIS_MASTER_KEYS=<новый>,<старый>     (новый первым; старый ещё расшифровывает)
docker compose up -d api worker
docker compose exec api jarvis rotate-keys     # перешифровать всё новым ключом
# .env: JARVIS_MASTER_KEYS=<новый>
docker compose up -d api worker
```

Если `JARVIS_MASTER_KEYS` был пустым, ключ сгенерирован в томе: `/data/secrets/master.keys`
(`docker compose exec api cat /data/secrets/master.keys`). Перенесите его в `.env`, чтобы он был в
менеджере паролей, и дальше действуйте как выше.

## Смена модели эмбеддингов

Поменяйте `JARVIS_EMBEDDING_PROVIDER` / `JARVIS_EMBEDDING_MODEL`, перезапустите и выполните
`docker compose exec worker jarvis reembed`. Векторы хранятся отдельно для каждой модели, поэтому
старые не смешиваются с новыми; пока индекс строится, работает поиск по словам.

## Обновление

```bash
./scripts/update.sh      # бэкап → git pull --ff-only → docker compose build → up -d → doctor
```

Миграции БД применяются автоматически при старте `api` (advisory lock — безопасно при нескольких
репликах). Откат: `git checkout <предыдущий тег>`, `docker compose up -d --build`; если миграция
несовместима — восстановление из бэкапа, сделанного `update.sh`.

## Диагностика

| Симптом | Что проверить |
|---|---|
| Сайт не открывается | `docker compose ps`; `docker compose logs caddy` (сертификат: DNS, порты 80/443) |
| «Не могу обратиться к модели» | ключ Anthropic (`jarvis doctor`), дневной лимит (Dashboard), статус https://status.anthropic.com |
| Задачи висят в очереди | `docker compose logs worker`; Настройки → Система → воркеры; `docker compose restart worker` |
| Память ищет только по словам | в логах `embeddings.unavailable` — нет доступа к huggingface.co; задайте `HF_ENDPOINT` (зеркало) или `JARVIS_EMBEDDING_PROVIDER=voyage` |
| Telegram молчит | токен, `JARVIS_TELEGRAM_MODE`; для webhook — HTTPS и `docker compose logs api | grep telegram` |
| WhatsApp не получает сообщения | Callback URL и Verify token в Meta, подписка на `messages`, `WHATSAPP_APP_SECRET` (иначе подпись не сойдётся — 401 в логах) |
| Нет голоса | HTTPS или localhost для микрофона; ключи STT/TTS (`jarvis doctor` → voice) |
| Браузер/песочница «недоступны» | профиль в `COMPOSE_PROFILES`, переменные `JARVIS_BROWSER_WS_ENDPOINT` / `JARVIS_SANDBOX_URL` |
| Забыли пароль | `docker compose exec api jarvis reset-password you@example.com` |
