-- Data minimisation: the date of birth is no longer collected.
--
-- 0035 added profiles.birth_date as an optional field in the account. Nothing
-- in the shop ever read it — no birthday offer, no age check, no email — so
-- it was personal data held for no purpose. The account no longer asks for it
-- (components/account/profile-form.tsx, app/api/account/profile/route.ts);
-- this removes what was stored.
--
-- IRREVERSIBLE: the values are deleted with the column. If a birthday offer
-- is ever wanted, ask for the date again then, with that purpose stated.
-- Safe to re-run. Apply after the deploy that stops reading the column.

alter table public.profiles drop column if exists birth_date;