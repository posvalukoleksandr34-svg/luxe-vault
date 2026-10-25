-- Department descriptions (0064): a localized object, empty by default,
-- readable like the rest of the department row, written only by the server.
-- One transaction, rolled back.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.check(p_name text, p_got boolean, p_detail text) returns void
language plpgsql as $$ begin
  if not p_got then raise exception 'FAIL %: %', p_name, p_detail; end if;
  raise notice 'PASS %', p_name;
end $$;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$ begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

create or replace function pg_temp.as_role(p_role text, p_sql text) returns text
language plpgsql as $$
declare n bigint;
begin
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    get diagnostics n = row_count;
    reset role;
    return n::text;
  exception when others then
    reset role;
    return 'denied';
  end;
end $$;

insert into public.collections (slug, name) values ('dbdesc', '{"ru":"Тест","en":"Test"}');

select pg_temp.check('a department has no description until one is written',
  (select description = '{}'::jsonb from public.collections where slug = 'dbdesc'), 'default');

select pg_temp.check('a localized description is stored',
  pg_temp.try($q$update public.collections set description = '{"en":"Coats and knitwear.","it":"Cappotti."}' where slug = 'dbdesc'$q$) = 'ok'
  and (select description->>'en' = 'Coats and knitwear.' from public.collections where slug = 'dbdesc'), 'update');

select pg_temp.check('a description that is not an object is refused',
  pg_temp.try($q$update public.collections set description = '"plain text"' where slug = 'dbdesc'$q$) = '23514', 'string');

select pg_temp.check('an oversized description is refused',
  pg_temp.try(format($q$update public.collections set description = jsonb_build_object('en', %L) where slug = 'dbdesc'$q$, repeat('x', 7000))) = '23514', 'size');

select pg_temp.check('the public key reads it with the department',
  pg_temp.as_role('anon', $q$select description from public.collections where slug = 'dbdesc'$q$) = '1', 'anon read');

select pg_temp.check('the public key cannot write it',
  pg_temp.as_role('anon', $q$update public.collections set description = '{"en":"x"}' where slug = 'dbdesc'$q$) in ('denied', '0'), 'anon write');

rollback;
