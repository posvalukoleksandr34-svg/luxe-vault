-- ============================================================================
-- 0064_collection_description.sql
-- ============================================================================
-- A short description for each department (Женщины, Мужчины, Дети), shown
-- under its title on the department page and used as that page's meta
-- description.
--
-- collections.description: localized text, the same shape as `name`
-- ({ "ru": "…", "en": "…", … }). Empty by default: nothing is shown and the
-- page keeps its generic description until the owner writes one in the admin
-- (Разделы и категории). Public like the rest of the row.
--
-- The storefront reads it only when the column exists, so the code runs
-- before and after this migration. Idempotent.
-- ============================================================================

alter table public.collections
  add column if not exists description jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'collections_description_shape'
       and conrelid = 'public.collections'::regclass
  ) then
    alter table public.collections
      add constraint collections_description_shape
      check (jsonb_typeof(description) = 'object' and octet_length(description::text) <= 6000);
  end if;
end;
$$;

comment on column public.collections.description is
  'Short localized description of the department, shown on its page. {} = none.';
