-- What a backup is expected to contain, as one JSON document.
--
-- Run against the live database right after pg_dump (scripts/backup/backup.sh)
-- and again against the restored copy (scripts/backup/restore-test.sh); the
-- restore test compares the two. Row counts come from count(*), not from the
-- planner's estimates, which can be wildly off on small tables.
select json_build_object(
  'server_version', current_setting('server_version'),
  'extensions', (
    select coalesce(json_agg(json_build_object('name', e.extname, 'schema', n.nspname) order by e.extname), '[]'::json)
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname <> 'plpgsql'
  ),
  'tables', (
    select coalesce(
      json_object_agg(
        t.table_schema || '.' || t.table_name,
        (xpath('/row/c/text()', query_to_xml(
          format('select count(*) as c from %I.%I', t.table_schema, t.table_name), false, true, ''
        )))[1]::text::bigint
        order by t.table_schema, t.table_name
      ),
      '{}'::json
    )
    from information_schema.tables t
    where t.table_schema in ('public', 'auth', 'storage')
      and t.table_type = 'BASE TABLE'
  )
);
