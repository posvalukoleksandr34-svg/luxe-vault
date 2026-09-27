# Nightly: pg_dump (custom format) + restic snapshot of the data volume.
# No package manager needed: restic is a static binary copied from the official image; pg_dump, busybox
# crond and wget come with the postgres image. PID 1 / signal handling: `init: true` in compose.
FROM restic/restic:0.18.1 AS restic
FROM postgres:16-alpine
COPY --from=restic /usr/bin/restic /usr/local/bin/restic
COPY backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["cron"]
