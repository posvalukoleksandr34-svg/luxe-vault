# H. Установка

## 1. Сервер

| | Минимум | Рекомендуется |
|---|---|---|
| CPU / RAM | 2 vCPU / 4 ГБ | 4 vCPU / 8 ГБ (браузер + песочница + локальные эмбеддинги) |
| Диск | 20 ГБ | 40 ГБ SSD |
| ОС | любая Linux с Docker Engine 24+ и Compose v2 | Ubuntu 24.04 LTS |
| Сеть | исходящий HTTPS | + открытые 80/443 и домен, если нужен доступ извне, Telegram webhook или WhatsApp |

GPU не нужен: модель работает через API Anthropic. Для локальной модели — профиль `local-ai` на
машине с GPU (или отдельный узел, см. ниже).

```bash
# Ubuntu: Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
# файрвол: наружу только SSH и веб
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
```

## 2. Установка

```bash
git clone <repo> jarvis-src && cd jarvis-src/jarvis
./scripts/setup.sh                  # интерактивно: домен, ключ Anthropic
# или без вопросов:
./scripts/setup.sh --yes --domain jarvis.example.com --anthropic-key sk-ant-... --profiles browser,sandbox
docker compose up -d
docker compose ps                   # api должен стать healthy (миграции выполняются при старте)
```

`setup.sh` создаёт `.env` (права 600) и генерирует все секреты: пароль БД, ключ шифрования
(`JARVIS_MASTER_KEYS`), токен песочницы, токен метрик, пароль бэкапов, секреты вебхуков, пароль
Grafana. Скрипт можно запускать повторно — существующие значения сохраняются.

> **Сохраните `JARVIS_MASTER_KEYS` и `RESTIC_PASSWORD` в менеджер паролей.** Без них не восстановить
> зашифрованные ключи интеграций и бэкапы.

## 3. Первый вход

* Если в `.env` заданы `JARVIS_OWNER_EMAIL` и `JARVIS_OWNER_PASSWORD` — владелец создаётся при старте.
* Иначе: `docker compose logs api | grep "SETUP CODE"` → откройте сайт → «Первый запуск» → код,
  e-mail, пароль (минимум 10 символов). Код одноразовый и действует до создания владельца.

Затем в интерфейсе:

1. **Настройки → Ключи API** — ключ Anthropic (если не задан в `.env`), ключи голоса и поиска. Ключи
   хранятся в БД зашифрованными; изменение требует повторного ввода пароля.
2. **Настройки → Безопасность** — включите TOTP (Google Authenticator и т.п.).
3. **Интеграции** — Google, Telegram, WhatsApp (см. [INTEGRATIONS.md](INTEGRATIONS.md)).
4. **Навыки** — включите/выключите нужные.
5. `config/identity/user.md` — расскажите JARVIS о себе (имя, город, работа, предпочтения); личность и
   правила поведения — `identity.md`, `personality.md`, `operating_rules.md`. После правок:
   `docker compose restart api worker`.

## 4. Домен и HTTPS

DNS-запись `A jarvis.example.com → IP сервера`, затем `JARVIS_SITE_ADDRESS=jarvis.example.com` и
`JARVIS_PUBLIC_URL=https://jarvis.example.com` в `.env` (или `setup.sh --domain`), `docker compose up -d`.
Caddy сам получит и будет продлевать сертификат Let's Encrypt. Порты 80 и 443 должны быть доступны
из интернета.

Без публичного домена (только домашняя сеть или VPN): оставьте `JARVIS_SITE_ADDRESS=:80` и заходите
через Tailscale/WireGuard. Telegram в режиме `polling` работает и без публичного адреса; WhatsApp и
Google OAuth — нет (им нужен HTTPS-адрес; Google допускает `http://localhost` для локальной проверки).

## 5. Профили (опциональные компоненты)

`COMPOSE_PROFILES` в `.env`, через запятую:

| Профиль | Что добавляет | Переменные |
|---|---|---|
| `browser` | реальный браузер для навыка «Браузер» | `JARVIS_BROWSER_WS_ENDPOINT=ws://browser:3000/` |
| `sandbox` | исполнение кода для навыка «Код» | `JARVIS_SANDBOX_URL=http://sandbox:8090`, `SANDBOX_TOKEN` |
| `monitoring` | Prometheus + Grafana на `127.0.0.1:3001` | `GRAFANA_ADMIN_PASSWORD` |
| `local-ai` | Ollama | `JARVIS_LOCAL_LLM_BASE_URL=http://ollama:11434/v1`, затем `docker compose exec ollama ollama pull qwen3:14b` |

По умолчанию включены `browser,sandbox`. Изменили — `docker compose up -d`.

## 6. Локальная модель на отдельной машине (опционально)

На ПК с GPU: `ollama serve` (слушает :11434), подключите обе машины к одной сети Tailscale, в `.env`
сервера: `JARVIS_LOCAL_LLM_BASE_URL=http://<tailscale-ip>:11434/v1`. Маршрут `local` из
`config/models.yaml` станет резервом для `main` при недоступности API.

## 7. Голосовой спутник с wake word

См. [`satellite/README.md`](../satellite/README.md): Raspberry Pi 4/5 или любой ПК с микрофоном,
`python3 jarvis_satellite.py --calibrate`, токен устройства:
`docker compose exec api jarvis device-token you@example.com kitchen --scopes voice,chat`.

## 8. Полезные команды

```bash
docker compose exec api jarvis doctor          # проверка конфигурации и связности
docker compose logs -f api worker              # логи
make backup / make restore SNAPSHOT=latest     # бэкап / восстановление
./scripts/update.sh                            # бэкап → git pull → пересборка → рестарт
docker compose up -d --scale worker=3          # больше параллельных задач
```

## 9. Разработка

```bash
make test-infra                     # Postgres (pgvector) :55432 + Redis :56379 в Docker
make dev-backend                    # API + встроенный воркер на :8000 с автоперезагрузкой
make dev-frontend                   # Vite на :5173, проксирует /api на :8000
```

Для backend нужен [uv](https://docs.astral.sh/uv/) (или обычный venv: `pip install -e "backend[dev,local-embeddings]"`).
Без ключа Anthropic: `JARVIS_FAKE_LLM=true` — детерминированный демо-мозг.

### За корпоративным TLS-прокси

Если исходящий трафик проходит через прокси с собственным CA, сборка и контейнеры должны доверять ему:

```bash
EXTRA_CA_CERT=/path/to/ca.crt docker compose -f docker-compose.yml -f infrastructure/docker-compose.proxy-ca.yml up -d --build
```
