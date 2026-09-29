# Если что-то не работает

Сначала: `docker compose ps` (все сервисы `healthy`?) и `docker compose exec api jarvis doctor`.
Логи: `docker compose logs --tail 100 api worker`. Ключи и токены в логи не пишутся — логи можно показывать.

| Симптом | Причина и что делать |
|---|---|
| Баннер «нет ключа OPENAI_API_KEY / ANTHROPIC_API_KEY» | Мозг не настроен: ключ активного провайдера (`JARVIS_LLM_PROVIDER`) в `.env` или «Настройки → Ключи». |
| «Компьютер не подключён» | Desktop-агент не запущен или токен без права `computer`. На ПК: `desktop/README.md`; токен — «Настройки → Устройства → Компьютер». Лог агента: `%LOCALAPPDATA%\JARVIS\desktop-agent.log`. |
| Агент пишет «rejected the device token» (4401) | Токен отозван или без scope `computer` — выдайте новый. |
| Агент пишет «plan … does not allow (more) computers» (4402) | Тариф аккаунта не включает управление компьютером или превышен лимит устройств. |
| «Приложение не найдено» | Агент ищет по имени в меню «Пуск»/PATH. Назовите как в меню «Пуск» или добавьте псевдоним в `APPS` в `desktop/jarvis_desktop.py`. |
| Громкость/медиа не работают на Linux | Нужны `pactl`/`playerctl` (PulseAudio/PipeWire и MPRIS-плеер). |
| Spotify: «Premium is required» | Управление воспроизведением через API Spotify — только Premium. Без него JARVIS открывает поиск в приложении и жмёт медиа-клавиши через агент. |
| Spotify: «no Spotify device is active» | Откройте Spotify на ПК или телефоне (или запустите desktop-агент — JARVIS откроет Spotify сам). |
| Spotify OAuth: «INVALID_CLIENT: Invalid redirect URI» | Redirect URI в приложении Spotify должен совпадать с показанным в «Интеграции» и быть `https://…` или `http://127.0.0.1:…` (не `localhost`). |
| Голос молчит / «Ошибка» на странице Голос | Разрешите микрофон браузеру; без ключей Deepgram/ElevenLabs/OpenAI распознавание работает только в Chrome/Edge. |
| Режим без рук не реагирует | Начинайте фразу со слова-активатора («Джарвис, …»); посмотрите подпись «не для меня: …» — так распознаватель услышал фразу. Добавьте этот вариант в слова-активаторы. |
| Команда не срабатывает | Фраза должна точно совпасть с триггером (без учёта регистра и знаков). Добавьте вариант триггера. |
| HTTP 402 / «Достигнут лимит тарифа» | Лимит тарифа (`config/plans.yaml`). Владелец может сменить тариф в Админке. |
| HTTP 503 «Идут технические работы» | Включён режим обслуживания: Админка → Режим обслуживания. |
| Письма подтверждения/сброса не приходят | Не настроен SMTP (`SMTP_HOST`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD`), либо письмо в спаме. В логах — `mail.failed` с типом ошибки. |
| Тариф не поменялся после оплаты | Тариф меняет только вебхук Stripe. Проверьте endpoint и `STRIPE_WEBHOOK_SECRET`; в логах — `stripe.webhook_rejected`. |
| После обновления не стартует | `scripts/update.sh` откатывает код сам; вручную — `scripts/update.sh --rollback <commit>`; если мешает схема БД — `scripts/restore.sh latest`. |
| Windows: окно JARVIS не открывается | `scripts/windows/create-shortcuts.ps1` заново; нужен Edge или Chrome. |
