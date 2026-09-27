-- Notifications are stored as WHAT happened, and worded when they are read.
--
-- Until now a notification was written as finished text, in the language of
-- the order it was about. One account's bell could therefore mix Italian (an
-- order placed on /it), English and — rows from before the storefront dropped
-- it — Russian, under a header in the language of the page.
--
--   template  which message: payment_failed, status, return_refunded,
--             return_rejected
--   params    what varies: orderId, status, tracking, timeframe, reason, note
--
-- The app renders both in the reader's language (lib/server/notifications.ts).
-- `title` and `body` stay, written in the default language, as what a row
-- reads as if it cannot be rendered. Rows from before this migration have no
-- template; the app recognises them from their text instead, so there is no
-- backfill here.
--
-- Safe to apply before or after the deploy: the app writes without these
-- columns until they exist, and reads with `select *`.

alter table public.notifications
  add column if not exists template text,
  add column if not exists params jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.notifications
    add constraint notifications_template_check
    check (template is null or template in ('payment_failed', 'status', 'return_refunded', 'return_rejected'));
exception when duplicate_object then null; end $$;

comment on column public.notifications.template is
  'Which message this is; rendered in the reader''s language from params. Null on rows written before 0046.';
comment on column public.notifications.params is
  'The parts of the message that vary (orderId, status, tracking, timeframe, reason, note).';
