-- Newsletter double opt-in.
--
-- Until now an address typed into the sign-up form went straight onto the
-- list. Anyone could subscribe anyone, and the shop could not show that the
-- owner of an address had agreed — which is what consent to marketing email
-- has to be able to show (GDPR art. 7(1); in Germany and Austria double
-- opt-in is the expected proof).
--
-- Now a sign-up is 'pending' and gets one email with a confirmation link
-- (lib/server/newsletter.ts). Only 'active' addresses receive campaigns
-- (activeRecipients reads status = 'active'), so a pending one gets nothing
-- but that email. Unconfirmed sign-ups are deleted after 30 days.
--
-- Existing 'active' rows were collected under the old single opt-in; they
-- stay active (confirmed_at null marks them). Whether to re-ask them is the
-- operator's call — see docs/compliance/audit-2026-10-04.md.
--
-- Deploy order: apply BEFORE or together with the code. Without this the new
-- code refuses sign-ups (it will not fall back to single opt-in).

alter table public.newsletter_subscribers
  drop constraint if exists newsletter_subscribers_status_check;
alter table public.newsletter_subscribers
  add constraint newsletter_subscribers_status_check
  check (status in ('pending', 'active', 'unsubscribed'));

alter table public.newsletter_subscribers
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmation_sent_at timestamptz;

comment on column public.newsletter_subscribers.confirmed_at is
  'When the owner of the address clicked the confirmation link. Null on rows from before double opt-in (0051).';
comment on column public.newsletter_subscribers.confirmation_sent_at is
  'When the last confirmation email went out; throttles resends and dates unconfirmed sign-ups for deletion.';
