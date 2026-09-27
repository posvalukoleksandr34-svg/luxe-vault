#!/bin/sh
set -e
case "$1" in
  api)
    jarvis migrate
    exec uvicorn jarvis.api.app:create_app --factory --host 0.0.0.0 --port 8000 \
      --proxy-headers --forwarded-allow-ips="*" --ws-max-size 16777216 --timeout-graceful-shutdown 20
    ;;
  worker)
    exec python -m jarvis.tasks.worker
    ;;
  sandbox)
    exec uvicorn jarvis.sandbox_server:app --host 0.0.0.0 --port 8090
    ;;
  *)
    exec "$@"
    ;;
esac
