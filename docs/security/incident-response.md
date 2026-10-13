# Incident response runbook

Print it: during an incident the wiki may be what is down. Fill in the
contacts once and keep them current.

| Role | Who | How to reach |
|---|---|---|
| Incident lead | _owner_ | |
| Deputy | | |
| Lawyer (data protection) | | |
| Vercel / Supabase / Cloudflare / Stripe support | dashboards → Support | |

**Severity.**

- SEV1: customer data exposed, money moving wrongly, or the shop down.
- SEV2: a confirmed intrusion with no data impact yet.
- SEV3: a suspicious signal.

**Every incident, first 30 minutes:**

1. Open a timeline (a doc or the Telegram ops thread) and write down everything with UTC times.
2. **Export logs now:** Vercel runtime logs, Supabase (Auth, API, Postgres), Cloudflare Security Events, GitHub audit log. Retention is short.
3. Do not delete anything that may be evidence.
4. Never paste secrets into the timeline.

**Signals.** The app writes one JSON line per security event (`lib/server/security-events.ts`). Search the platform logs for `security_event` and act on these starting thresholds:

| Event | Investigate when |
|---|---|
| `admin_login_failed` | more than 10 in 5 min, or any from a `source` never seen before |
| `admin_login_refused_config` | any: sign-in is blocked (TOTP secret invalid or unreachable) |
| `rate_limited` | more than 200 in 5 min, or one `source` hitting `order.lookup`, `coupon.validate` or `payment.start` repeatedly |
| `rate_limiter_unavailable` | any: the database or `check_rate_limit` is failing, and the sensitive endpoints answer 503 |
| `webhook_signature_invalid` | any burst. Single ones are scanners; repeated ones against Stripe may mean a rotated secret not updated in Vercel |
| `cron_unauthorized` | any repeat: someone is probing the cron routes |

`source` is a keyed hash of the address, not the address. Cloudflare's logs map it back to an IP for the same request time.

---

## A. Suspected credential exposure (a key in a commit, a log or a screenshot)

1. **Identify** which secret it is: admin password or session secret, TOTP, Supabase service role, Stripe secret or webhook secret, NOWPayments, `CRON_SECRET`, `INTERNAL_API_SECRET`, `EDGE_ORIGIN_SECRET`, or a backup key. Record only its name, never its value.
2. **Rotate it** at the provider, update Vercel (and GitHub Actions secrets if it is used there), and redeploy:

   | Secret | Where | What rotation does |
   |---|---|---|
   | `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET` | Vercel | Every admin session ends |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (rotate the JWT secret if the anon key is also suspect) | |
   | `STRIPE_SECRET_KEY` | Stripe → API keys → Roll | Check the Stripe log for refunds or payouts you did not make |
   | `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → Roll | |
   | `EDGE_ORIGIN_SECRET` | Cloudflare Transform Rule and Vercel, together | Otherwise the site answers 403 |
   | Backup age key | New key pair | Re-encrypting old backups is not possible; they stay readable by the old key, so keep it offline |

3. **Look for use:**
   - the provider's logs since the exposure;
   - `admin_sessions` (logins with IP and user agent);
   - `/api/admin/reconciliation`;
   - GitHub pushes to `main`.
4. **A secret in git:** rotation is the fix. Rewriting history is a separate, explicitly authorised operation and does not un-publish anything.

## B. Unauthorized administrative access

1. **Kill all sessions:** rotate `ADMIN_SESSION_SECRET`, or the password, then redeploy. If Cloudflare Access protects `/admin`, revoke the person there too.
2. **Read `admin_sessions`** (IP, user agent, times) and the platform logs for `/api/admin/*` writes in the window.
3. **Check what an admin can change:**
   - order statuses;
   - refunds (Stripe dashboard → Payments → Refunds);
   - products and prices;
   - promo codes (look for new or edited ones);
   - newsletter sends;
   - settings.
4. **Reverse unauthorised refunds or promo codes** at the source. A refund cannot be undone: contact Stripe support.
5. **Turn on TOTP** if it was off (`scripts/admin-totp-setup.mjs`).

## C. Payment discrepancies (paid in Stripe, not in the shop, or the reverse)

1. **Run `/api/admin/reconciliation?days=N`.** It is read-only and lists every mismatch with order and payment ids.
2. **`paid_not_recorded`:** the webhook did not land or was refused.
   - Stripe → Webhooks → the event → **Resend**. The handler is idempotent and checks amount and currency against the order.
   - If it refuses (amount mismatch), the Telegram alert says why. Do not mark the order paid by hand without matching the amount.
3. **`recorded_not_paid`:** do not ship. Check the payment in Stripe. If no money exists, cancel the order.
4. **`payment_without_order`:**
   - a Dashboard charge or another integration, or an order deleted before AUD-06;
   - refund it, or attach it by hand after checking amount and customer.

## D. Incorrect refunds (double, or the wrong amount)

1. **Stripe dashboard → the payment:** list its refunds with their idempotency keys (`refund:<payment>:…`). Two refunds with different keys are two deliberate requests; the same key means Stripe returned one.
2. **A refund cannot be cancelled once it succeeds.** Contact the customer, and Stripe support for a pending one.
3. **The order's recorded amount** follows `charge.refunded` automatically; reconciliation shows any gap.
4. **"Stripe did not confirm the refund":** this is the ambiguous case (AUD-22). The order stays blocked for 10 minutes. Check Stripe; do not press again before checking.

## E. Inventory inconsistencies (sold out but on the shelf, or the reverse)

1. **Stock held by unpaid orders** is released by `/api/cron/reservations`. Run it with `?dry=1` to see what it would release, and check the hourly workflow is green.
2. **A paid order whose stock was gone:** `ensurePaidOrderStock` reported "insufficient" (Telegram alert: stock conflict). Refund it or source the item. Never ship what is not there.
3. **Find the product's history:**
   ```sql
   select o.order_number, o.status, o.payment_status, o.restocked_at
     from public.orders o
     join public.order_items i on i.order_id = o.id
    where i.product_id = '<slug>'
    order by o.created_at;
   ```
   `restocked_at` set means the units were returned once and only once.
4. **Fix counts** in Admin → Inventory. The availability tag follows the stock (0032).

## F. Database corruption or loss

1. **Stop writes:** put the site in maintenance (Cloudflare rule or Vercel), so orders do not land in a broken database.
2. **Do not restore over production.** Create a NEW Supabase project, then restore the newest verified backup into it (`scripts/backup/restore-test.sh` shows the steps; `docs/security/phase-1-backups.md`).
3. **Rotate every secret** the old project held.
4. **Reconcile orders, stock and refunds** against Stripe (§C) for the gap since the backup.
5. **Repoint Vercel** to the new project, redeploy, and smoke-test (MANUAL_ACTIONS_REQUIRED.md §11).

## G. Failed backups

1. **"Offsite backup" red:** read the `::error::` line. Each failure names its cause:
   - not configured;
   - upload failed or did not verify;
   - empty or unreadable dump;
   - media missing.
2. **Fix it and run the workflow by hand.** One missed night is acceptable; a second is not. The weekly restore test fails when the newest backup is more than 30 hours old.
3. **"Backup restore test" red:** treat it as SEV2 until the cause is known. The newest backup may not be restorable, and an unrestorable backup is not a backup.

## H. Suspected customer-data exposure

1. **Contain:** rotate the credential involved (§A), and close the hole (take the route offline if needed).
2. **Establish what and whose:** logs, the tables involved, the time window. Note that `orders` holds names, addresses, phones and emails; card data never reaches the shop (Stripe Elements).
3. **Notify:**
   - **GDPR:** the supervisory authority **within 72 hours** of becoming aware, and the affected people without undue delay when the risk to them is high.
   - **Switzerland (nFADP):** the FDPIC as soon as possible.
   - **Stripe:** if payment data could be involved.
   - Have the lawyer confirm which regimes apply **before** an incident.
4. **Post-mortem within a week:** timeline, root cause, what detection missed, and the action items.

## Rehearse

Twice a year, run a tabletop exercise with this page and a stopwatch: "the admin password was phished", "the Supabase project was deleted", "Stripe shows 20 refunds nobody made".
