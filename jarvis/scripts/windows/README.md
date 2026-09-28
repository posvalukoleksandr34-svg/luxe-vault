# JARVIS на Windows

Нужен **Docker Desktop** (https://www.docker.com/products/docker-desktop/) с бэкендом WSL 2.
Первую настройку (`scripts/setup.sh`) выполните один раз в WSL или Git Bash — см. `docs/SETUP.md`.

> Если архив скачан из интернета, Windows может блокировать скрипты. Один раз выполните в PowerShell
> в папке проекта: `Get-ChildItem -Recurse | Unblock-File`

| Файл | Что делает |
|---|---|
| `install-autostart.bat` | Автозапуск при входе в Windows (задача планировщика, без окон) + ярлыки «JARVIS» на рабочем столе и в меню «Пуск» |
| `uninstall-autostart.bat` | Убирает автозапуск (контейнеры продолжают работать до `docker compose down`) |
| `start-jarvis.bat` | Запустить Docker Desktop и JARVIS сейчас и открыть окно JARVIS |
| `open-jarvis.bat` | Открыть окно JARVIS (если уже запущен) |
| `create-shortcuts.ps1` | Пересоздать ярлыки (после смены порта/адреса в `.env`) |

**Как устроен автозапуск.** Задача «JARVIS Autostart» в Планировщике заданий срабатывает через 20 секунд
после входа, через `wscript` запускает `jarvis-start.ps1` без окна: при необходимости стартует Docker Desktop,
ждёт движок (до 10 минут) и выполняет `docker compose up -d`. Журнал: `%LOCALAPPDATA%\JARVIS\jarvis.log`.
Чтобы после входа сразу открывалось и окно JARVIS: `install-autostart.bat -OpenApp`.

**Окно как у программы.** Ярлык запускает Edge (или Chrome) в режиме приложения `--app=<адрес>`: отдельное
окно без адресной строки и вкладок, со своей иконкой на панели задач. Закрепите его: Пуск → JARVIS →
правый клик → «Закрепить на панели задач».

Ещё «роднее» — установить как приложение (PWA): откройте JARVIS в Edge → меню «⋯» → «Приложения» →
«Установить JARVIS» (в Chrome: значок установки в адресной строке). Появится в списке программ Windows,
в «Пуске», с собственным окном; удаляется как обычная программа.
