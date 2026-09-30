-- Closes writes that a customer could make straight to the database through
-- Supabase's public REST API, around the application's own endpoints.
--
-- Row Level Security decides WHICH ROWS a role may touch; it says nothing
-- about WHICH COLUMNS. A policy written to allow one field to change therefore
-- allowed every field of that row to change. The application does all of these
-- writes with the service role (lib/server/*), after its own validation,
-- rate limits and CAPTCHA; the browser never uses these policies. So they are
-- removed rather than narrowed, and the only writers left are the server's.
--
-- Every statement is idempotent; safe to re-run.

-- ---------------------------------------------------------------- orders ----
-- 0004 let a signed-in customer UPDATE their own delivered order, meant only
-- to flip return_status from 'none' to 'requested'. The WITH CHECK constrained
-- user_id and return_status and nothing else, so the same request could set
-- total, payment_status, refunded_amount, status, the delivery address and the
-- email on that order. Returns are filed through /api/orders/[id]/refund-request
-- (service role) into return_requests since 0039; nothing uses this policy.
drop policy if exists "users request a return on delivered orders" on public.orders;

-- ------------------------------------------------------- support_tickets ----
-- 0003: "anyone can file a support ticket" WITH CHECK (true), to anon. Any
-- visitor could insert a ticket with any content and any user_id — which then
-- appears in that user's own support history as though they had written it,
-- a ready-made phishing channel — skipping the endpoint's CAPTCHA, rate limit
-- and validation. /api/support files tickets with the service role.
drop policy if exists "anyone can file a support ticket" on public.support_tickets;

-- ---------------------------------------------------------- site_reviews ----
-- 0006: testimonials inserted directly, around /api/reviews' CAPTCHA and rate
-- limit (they still wait for moderation, but the queue could be flooded).
drop policy if exists "anyone can leave a testimonial" on public.site_reviews;

-- ------------------------------------------------------- return_requests ----
-- 0039: a direct insert skipped the endpoint's check that every photograph
-- is the customer's own upload (returns/<user id>/…), so a request could point
-- the admin at another customer's return photos.
drop policy if exists "users file a return on their paid orders" on public.return_requests;

-- --------------------------------------------------------- notifications ----
-- 0010: meant for "mark as read", but row-scoped, so a customer could rewrite
-- the title and body of their own notifications. Reads are marked through
-- /api/notifications (service role). Column-level privilege keeps the policy
-- harmless if anything ever relies on it: only is_read may change.
revoke update on public.notifications from anon, authenticated;
grant update (is_read) on public.notifications to authenticated;

-- ------------------------------------------------------------- profiles ----
-- A customer may edit their own profile (name, birth date). welcome_sent_at is
-- the server's record that the welcome email went out; resetting it would let
-- a script have that email sent again and again. Same guard as
-- stripe_customer_id in 0007, using auth.role(), which reads the role from
-- the JWT claims under current and older PostgREST alike.
create or replace function public.protect_profile_server_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and new.welcome_sent_at is distinct from old.welcome_sent_at then
    raise exception 'welcome_sent_at is not user-writable';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_profile_server_fields() from public, anon, authenticated;

drop trigger if exists profiles_protect_server_fields on public.profiles;
create trigger profiles_protect_server_fields
  before update on public.profiles
  for each row execute function public.protect_profile_server_fields();
