#!/usr/bin/env bash
# Applies every migration in supabase/migrations, in order, to an EMPTY
# Postgres with Supabase's roles, auth/storage stand-ins and default grants,
# then checks the database-wide access rules (scripts/ci/check-access.sql).
#
#   DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres scripts/ci/verify-migrations.sh
#
# For CI and local use against a DISPOSABLE database only — it creates roles
# and schemas. Never point it at production.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to a disposable Postgres}"
case "$DATABASE_URL" in *supabase.co*|*supabase.com*|*pooler*) echo "Refusing: DATABASE_URL looks like a Supabase project, not a disposable database." >&2; exit 2;; esac
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
psql_() { psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

psql_ <<'SQL'
-- What a Supabase project has before the first migration runs.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, encrypted_password text,
  raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
create or replace function auth.role() returns text language sql stable as $f$ select current_setting('request.jwt.claim.role', true) $f$;
create or replace function auth.jwt() returns jsonb language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint,
  allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $f$ select string_to_array(name, '/') $f$;
create or replace function storage.extension(name text) returns text language sql immutable as $f$ select split_part(name, '.', -1) $f$;
-- Supabase's defaults: every API role may use `public`, and new tables and
-- functions there are granted to all of them. RLS and explicit REVOKEs are
-- the only barriers, which is exactly what check-access.sql verifies.
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
SQL

count=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  PGOPTIONS='-c search_path=public,extensions' psql_ -f "$f" >/dev/null
  count=$((count + 1))
done
echo "Applied $count migrations to an empty database."

# Idempotency: a migration may be run twice (a retried deploy, a pasted SQL
# block run again), so a second pass must succeed too. From 0027 on, that is
# the rule. 0005 and 0026 predate it: their seed rows use an ON CONFLICT target
# that later migrations replaced, so they can no longer be re-run on top of
# the full set. Both were applied long ago and are never re-run.
rerun=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  n=$(basename "$f" | cut -c1-4)
  [ "$((10#$n))" -ge 27 ] || continue
  PGOPTIONS='-c search_path=public,extensions' psql_ -f "$f" >/dev/null 2>&1 || { echo "Not re-runnable: $(basename "$f")" >&2; exit 1; }
  rerun=$((rerun + 1))
done
echo "Re-applied $rerun migrations (0027 onwards): idempotent."

psql_ -f "$ROOT/scripts/ci/check-access.sql"
