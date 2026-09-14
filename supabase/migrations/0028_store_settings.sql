-- ============================================================================
-- 0028_store_settings.sql
-- ============================================================================
-- Store-wide settings the admin edits at /admin/settings, starting with
-- shipping: the standard delivery fee, the free-shipping threshold and the
-- default delivery window. Read by getShippingSettings()
-- (lib/server/store-settings.ts); config/shipping.ts holds the fallback used
-- until this migration is applied.
--
-- Security (RLS): anyone may READ — the storefront shows these figures to
-- every visitor — but there are no insert/update/delete policies, so the anon
-- and authenticated roles cannot change a row. Writes go only through
-- /api/admin/settings, which runs behind the admin session check in
-- middleware.ts and uses the service role.
-- ============================================================================

create table if not exists public.store_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.store_settings is
  'Admin-managed store settings (key/value). Public read, service-role write.';

alter table public.store_settings enable row level security;

drop policy if exists "store_settings_public_read" on public.store_settings;
create policy "store_settings_public_read"
  on public.store_settings
  for select
  to anon, authenticated
  using (true);

-- Shape checks, so a hand-edited row cannot put a nonsense fee into checkout.
-- Limits match SHIPPING_LIMITS in config/shipping.ts.
alter table public.store_settings drop constraint if exists store_settings_value_valid;
alter table public.store_settings add constraint store_settings_value_valid check (
  case key
    when 'shipping_price' then
      jsonb_typeof(value) = 'number' and (value::text)::numeric between 0 and 1000
    when 'free_shipping_threshold' then
      jsonb_typeof(value) = 'number' and (value::text)::numeric between 0 and 100000
    when 'delivery_timeframe' then
      jsonb_typeof(value -> 'min') = 'number'
      and jsonb_typeof(value -> 'max') = 'number'
      and (value ->> 'min')::int between 1 and 90
      and (value ->> 'max')::int between 1 and 90
      and (value ->> 'max')::int >= (value ->> 'min')::int
    else true
  end
);

-- Defaults. `do nothing` so re-running never overwrites what the admin saved.
-- delivery_timeframe is in business days (Mon–Fri); the storefront words it
-- in each language ("10–14 business days", "10–14 рабочих дней", …).
insert into public.store_settings (key, value) values
  ('shipping_price',          '25'::jsonb),
  ('free_shipping_threshold', '200'::jsonb),
  ('delivery_timeframe',      '{"min": 10, "max": 14, "unit": "business_days"}'::jsonb)
on conflict (key) do nothing;
