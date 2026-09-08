-- ---------------------------------------------------------------------------
-- 0020 — Fix the stock-alert uniqueness rule
-- ---------------------------------------------------------------------------
-- 0019 declared:
--
--   unique (email, product_id, size, color, notified_at)
--
-- intending "one LIVE alert per person per variant, and notified rows kept as
-- history". It does neither, because in Postgres NULLs are DISTINCT inside a
-- unique constraint. Two pending alerts both have notified_at = NULL, the
-- constraint sees two different tuples, and both are accepted.
--
-- That made the constraint simultaneously too weak and too strong:
--
--   TOO WEAK   the same customer could subscribe to the same variant any
--              number of times, and would be emailed once per row.
--
--   TOO STRONG claim_restock_alerts() stamps every claimed row with the same
--              now(). The moment two duplicate rows existed, stamping them
--              produced two identical tuples — a unique violation that failed
--              the WHOLE sweep, so nobody was notified at all.
--
-- Both symptoms were reproduced: a repeat subscription returned 201 instead of
-- being recognised as a duplicate, and the claim aborted with
-- "duplicate key value violates unique constraint".
--
-- A PARTIAL unique index is what was meant all along: it constrains only the
-- rows where notified_at is null, so one live alert is enforced while any
-- number of historical rows may coexist.
-- ---------------------------------------------------------------------------

-- Collapse the duplicates 0019 allowed, keeping the oldest of each set —
-- that is the row whose position in the queue the customer actually earned.
delete from public.stock_alerts a
 using public.stock_alerts b
 where a.notified_at is null
   and b.notified_at is null
   and a.email = b.email
   and a.product_id = b.product_id
   and a.size = b.size
   and a.color = b.color
   and a.created_at > b.created_at;

alter table public.stock_alerts
  drop constraint if exists stock_alerts_email_product_id_size_color_notified_at_key;

-- One LIVE alert per person per variant. Notified rows fall out of the index
-- entirely, so re-subscribing after a restock is a fresh row rather than a
-- conflict.
create unique index if not exists stock_alerts_one_live_per_variant
  on public.stock_alerts (email, product_id, size, color)
  where notified_at is null;

comment on index public.stock_alerts_one_live_per_variant is
  'One un-notified alert per email per variant. Partial so notified history does not conflict.';
