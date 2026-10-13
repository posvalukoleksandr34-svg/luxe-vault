-- check_rate_limit (0013): the counter every limit in lib/server/rate-limit.ts
-- relies on. One transaction, rolled back. The concurrent case is in
-- concurrency.sh (only separate sessions can race).
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.check(p_name text, p_got boolean, p_detail text) returns void
language plpgsql as $$ begin
  if not p_got then raise exception 'FAIL %: %', p_name, p_detail; end if;
  raise notice 'PASS %', p_name;
end $$;

create temp table t_calls (n int, allowed boolean, remaining int, retry_after int);
-- One call per statement, as one request per HTTP call: a set-returning call
-- that does not depend on the series would be evaluated once and reused.
do $$ begin
  for i in 1..5 loop
    insert into t_calls select i, r.allowed, r.remaining, r.retry_after
      from public.check_rate_limit('dbtest.bucket', 'subject-a', 3, 600) r;
  end loop;
end $$;

select pg_temp.check('the first 3 calls of a limit of 3 are allowed',
  (select bool_and(allowed) from t_calls where n <= 3), (select string_agg(allowed::text, ',' order by n) from t_calls));
select pg_temp.check('the 4th and 5th are refused',
  (select not bool_or(allowed) from t_calls where n > 3), (select string_agg(allowed::text, ',' order by n) from t_calls));
select pg_temp.check('remaining counts down 2, 1, 0 and stays 0',
  (select array_agg(remaining order by n) = array[2,1,0,0,0] from t_calls), (select array_agg(remaining order by n)::text from t_calls));
select pg_temp.check('a refusal says when to come back (0 < retry_after <= window)',
  (select bool_and(retry_after between 1 and 600) from t_calls where not allowed), (select string_agg(retry_after::text, ',') from t_calls));

select pg_temp.check('another subject has its own budget',
  (select allowed from public.check_rate_limit('dbtest.bucket', 'subject-b', 3, 600)), 'refused');
select pg_temp.check('another bucket has its own budget',
  (select allowed from public.check_rate_limit('dbtest.other', 'subject-a', 3, 600)), 'refused');

-- The window has passed: the next call starts a fresh one.
update public.rate_limits set window_start = now() - interval '601 seconds'
 where bucket = 'dbtest.bucket' and subject = 'subject-a';
select pg_temp.check('after the window, the subject is allowed again and counted from 1',
  (select allowed and remaining = 2 from public.check_rate_limit('dbtest.bucket', 'subject-a', 3, 600)), 'still refused');

select pg_temp.check('a window of 0 seconds is treated as 1, never as "no window"',
  (select count(*) = 1 from public.check_rate_limit('dbtest.zero', 'subject-a', 1, 0) where allowed)
  and (select not allowed from public.check_rate_limit('dbtest.zero', 'subject-a', 1, 0)), 'second call allowed');

select pg_temp.check('the browser roles cannot call the counter (it would let them reset or burn budgets)',
  not has_function_privilege('anon', 'public.check_rate_limit(text, text, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.check_rate_limit(text, text, integer, integer)', 'execute'), 'executable');

rollback;
