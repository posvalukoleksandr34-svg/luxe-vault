# Навыки (skills)

Навык — папка в `skills/`: инструкции для модели + (необязательно) инструменты + тесты. JARVIS находит
навыки при старте. Включение/выключение и настройки навыка — страница **Навыки**, применяются к следующей
задаче без перезапуска. Новый навык или изменённый `tools.py`: `docker compose restart api worker`
(в режиме разработки со встроенным воркером достаточно кнопки «Перечитать папку»).

В системный промпт попадает только индекс (название + описание); полные инструкции модель загружает сама через `skill_load` или получает автоматически, когда сообщение совпало с триггером.

```
skills/weather/
├── skill.yaml          манифест
├── instructions.md     как и когда использовать (для модели)
├── tools.py            инструменты (необязательно — см. skills/planning: только инструкции)
└── tests/test_*.py     тесты
```

## skill.yaml

```yaml
name: weather                     # уникальное имя (a-z, _)
version: 1.0.0
title: Погода                     # для UI
icon: cloud-sun                   # имя иконки lucide
description: Current weather and a 7-day forecast (Open-Meteo, no API key).   # видит модель в индексе
triggers: [погод, прогноз, дожд, weather, forecast]   # подстроки → подгрузить инструкции автоматически
tools: [weather_forecast]         # инструменты навыка (имена из tools.py)
requires: []                      # google | browser | sandbox | search | fetch — без них инструменты скрыты
permissions:                      # переопределить уровень для конкретных инструментов
  weather_forecast: autonomous
config:                           # настройки, редактируемые в UI
  default_location: ""
enabled_by_default: true
```

## tools.py

```python
from pydantic import BaseModel, Field
from jarvis.tools.base import Risk, ToolContext, ToolError, tool


class Args(BaseModel):                      # схема входа → JSON Schema для модели и валидация
    location: str = Field(description="City or place name")
    days: int = Field(3, ge=1, le=7)


@tool(
    name="weather_forecast",
    description="Current weather and daily forecast for a location.",   # модель читает это описание
    risk=Risk.READ,            # READ | WRITE | EXTERNAL | HIGH → уровень подтверждения по permissions.yaml
    activity="Смотрю погоду",  # безопасный статус, который увидит пользователь
    timeout_s=20,              # жёсткий таймаут
    retries=2,                 # ретраи — только если инструмент идемпотентен (READ по умолчанию)
    untrusted_output=False,    # True для текста из внешнего мира: он будет помечен и включит taint
)
async def weather_forecast(ctx: ToolContext, args: Args) -> dict:
    await ctx.progress("Ищу место…")        # промежуточный статус (необязательно)
    ...
    if not found:
        raise ToolError("place not found")   # модель увидит понятную ошибку и сможет исправиться
    return {"place": "...", "now": {...}}    # JSON-совместимый результат; большие ответы обрезаются
```

`ToolContext` даёт: `ctx.app` (доступ к сервисам: `app.memory`, `app.tasks`, `app.secrets`, `app.box`,
`app.sessionmaker`, `app.channels`…), `ctx.user_id`, `ctx.task_id`, `ctx.channel`, `ctx.timezone`.

Другие параметры `@tool`: `idempotent`, `parallel_safe` (по умолчанию True только для READ),
`requires=("google",)`, `output=<PydanticModel>` (проверка результата), `summarize=` (короткий итог для
ленты активности), `max_output_chars`.

**Правила хорошего инструмента**

1. Один инструмент — одно действие; описание говорит, *когда* его использовать.
2. Возвращайте компактные структурированные данные, а не сырые HTML/JSON мегабайтами.
3. Внешний текст (письма, страницы, файлы) — `untrusted_output=True`.
4. Всё, что уходит наружу или необратимо, — `Risk.EXTERNAL` / `Risk.HIGH`; не понижайте риск ради удобства,
   пользователь сам может выбрать «Всегда разрешать» для confirm-уровня.
5. Секреты берите через `await ctx.app.secrets.get("name")`, не из `os.environ` напрямую.
6. HTTP к адресам от пользователя/модели — только через `jarvis.integrations.web.fetch_page` или
   `jarvis.security.ssrf.assert_public_url`.

## instructions.md

Коротко и по делу: когда применять навык, в каком порядке вызывать инструменты, формат ответа, особенности
голосового канала. Пример — `skills/weather/instructions.md`, `skills/email/instructions.md`.

## Тесты

```python
async def test_weather_forecast_shapes_result(weather_module):
    ctx = ToolContext(app=None, user_id=uuid.uuid4())
    out = await weather_module.fn(ctx, weather_module.input_model(location="Berlin", days=1))
    assert out["place"] == "Berlin, Germany"
```

Внешние HTTP-вызовы подменяйте `httpx.MockTransport` (см. `skills/weather/tests`). Для инструментов,
которым нужна БД, используйте фикстуры `app`, `user`, `tool_ctx` из `jarvis.testing` (подключены в
`skills/conftest.py`). Запуск: `make test-backend`.

## Встроенные навыки

| Навык | Инструменты | Требует |
|---|---|---|
| calendar | `calendar_list_events`, `calendar_create_event`, `calendar_update_event`, `calendar_delete_event`*, `calendar_find_free_time` | — (Google — если подключён) |
| email | `email_search`, `email_read`, `email_create_draft`, `email_list_drafts`, `email_send_draft`*, `email_archive` | — (Gmail — если подключён; иначе локальные черновики) |
| research | `web_search`, `web_fetch` | search / fetch (см. `JARVIS_SEARCH_PROVIDER`) |
| files | `files_list`, `files_read`, `files_write`, `files_move`, `files_delete`*, `files_search` | — |
| drive | `drive_search`, `drive_read`, `drive_upload`* | google |
| browser | `browser_open`, `browser_snapshot`, `browser_click`, `browser_type`*, `browser_screenshot` | browser |
| coding | `sandbox_exec`* | sandbox |
| weather | `weather_forecast` | — |
| planning | — (методика декомпозиции целей и планов) | — |
| apis | `api_list`, `api_get`, `api_call`* | `config/connectors.yaml` |

\* — требует подтверждения по умолчанию.

Встроенные в ядро инструменты (всегда доступны): `time_now`, `memory_remember/search/update/forget`,
`reminder_create/list/cancel`, `automation_create`*/`list/toggle/delete`, `skill_load`, `agent_delegate`,
`task_spawn_background`, `task_status`, `task_cancel`, `notify_user`.

Внешние инструменты без кода — через MCP (`config/mcp.yaml`) или REST-коннекторы
(`config/connectors.yaml`), см. [INTEGRATIONS.md](INTEGRATIONS.md).
