-- ---------------------------------------------------------------------------
-- 0013 — Rate limiting that survives the request that set it
-- ---------------------------------------------------------------------------
-- Exactly one endpoint was throttled — the admin login — and it counted
-- attempts in a `Map` inside the Node process. On Vercel that map lives in a
-- single warm lambda: a second concurrent instance starts with an empty map,
-- and every instance forgets everything when it is recycled. It slowed a
-- single-threaded script and nothing else.
--
-- Everything else was open. In particular:
--
--   /api/orders/lookup   order ids are LV- plus six characters, so an
--                        unthrottled endpoint is an enumeration oracle for
--                        other people's names and addresses
--   /api/auth/recovery   sends mail on demand — free email bombing, on the
--                        shop's own Resend quota and sender reputation
--   /api/support         and /api/reviews: spam straight into the admin queue
--   /api/orders          order creation itself
--
-- Postgres is the right home for the counter because it is the one thing every
-- instance already shares. The cost is one round trip per limited request,
-- which is the same round trip these endpoints were about to make anyway.
-- ---------------------------------------------------------------------------

create table if not exists public.rate_limits (
  -- Which limit this is: 'order.create', 'auth.recovery', and so on. Keeping
  -- buckets separate means a burst of review submissions cannot lock someone
  -- out of checkout.
  bucket       text not null check (char_length(bucket) between 1 and 64),

  -- Who is being counted — usually a client IP, sometimes an email address for
  -- limits that should follow the account rather than the network.
  subject      text not null check (char_length(subject) between 1 and 200),

  window_start timestamptz not null default now(),
  count        integer not null default 0 check (count >= 0),

  primary key (bucket, subject)
);

-- Only used by the pruning sweep below.
create index if not exists rate_limits_window_idx
  on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;

-- No policies at all: this table is written only by the service role, which
-- bypasses RLS. A client that could read it would learn how close other people
-- are to their limits; one that could write it could clear its own counter.

comment on table public.rate_limits is
  'Shared request counters. Written only via check_rate_limit() with the service role.';

-- ---------------------------------------------------------------------------
-- check_rate_limit — count this request and say whether it is allowed
-- ---------------------------------------------------------------------------
-- The increment and the decision happen in one statement. Two simultaneous
-- requests from the same subject cannot both read "9 of 10" and both proceed:
-- the second one blocks on the row lock and sees the first one's increment.
--
-- Returns the decision plus what an HTTP 429 needs to be useful — how many
-- attempts are left, and how many seconds until the window resets.
-- ---------------------------------------------------------------------------
create or replace function public.check_rate_limit(
  p_bucket text,
  p_subject text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count  integer;
  v_start  timestamptz;
  v_expiry interval := make_interval(secs => greatest(p_window_seconds, 1));
begin
  insert into public.rate_limits as r (bucket, subject, window_start, count)
  values (p_bucket, p_subject, now(), 1)
  on conflict (bucket, subject) do update
    -- An expired window restarts at 1 rather than being deleted and
    -- re-inserted, which would be two statements and a race between them.
    set count = case
          when r.window_start < now() - v_expiry then 1
          else r.count + 1
        end,
        window_start = case
          when r.window_start < now() - v_expiry then now()
          else r.window_start
        end
  returning r.count, r.window_start into v_count, v_start;

  -- Opportunistic sweep. A dedicated cron would be tidier, but this table is
  -- pure cache and one delete every thousandth call keeps it bounded without
  -- adding infrastructure to operate.
  if random() < 0.001 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return query select
    v_count <= p_limit,
    greatest(p_limit - v_count, 0),
    greatest(ceil(extract(epoch from (v_start + v_expiry - now())))::integer, 0);
end;
$$;

revoke all on function public.check_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;

comment on function public.check_rate_limit(text, text, integer, integer) is
  'Atomically counts a request against (bucket, subject) and returns whether it is allowed.';
