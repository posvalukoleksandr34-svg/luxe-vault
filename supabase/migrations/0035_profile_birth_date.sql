-- ============================================================================
-- 0035_profile_birth_date.sql
-- ============================================================================
-- An optional date of birth on the profile, for "Личные данные и
-- безопасность" in the account.
--
-- Written through /api/account/profile with the request-scoped client, so the
-- existing "users update their own profile" policy (0001) is what authorises
-- it; the route checks the date is a real calendar date, not before 1900 and
-- not in the future. Only the 1900 floor is repeated as a CHECK here: "not in
-- the future" depends on the clock, which a CHECK constraint must not.
--
-- The account UI reads the column before offering the field, so the page works
-- — without the field — until this migration has been applied.
-- ============================================================================

alter table public.profiles
  add column if not exists birth_date date
    check (birth_date is null or birth_date >= date '1900-01-01');

comment on column public.profiles.birth_date is
  'Optional, set by the customer in the account. Validated in /api/account/profile.';
