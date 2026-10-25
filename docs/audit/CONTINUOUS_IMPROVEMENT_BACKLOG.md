# Continuous improvement backlog and working notes

Read this first when resuming. Then `git status` and `git log -5`: do not
assume earlier work landed without checking.

## Current state (2026-10-25)

- `main` = `2a35603` (#30). Working branch `claude/admiring-albattani-xgdcm5`
  carries main plus the work below (not merged yet).
- Completed this session: CI-1 (one order per checkout attempt), CI-2
  (email bounce/complaint webhook), CI-3 (cart quantity cap matches the
  order), CI-4 (page heading on state pages), CI-5
  (checkout no longer flashes an empty cart), CI-6 (address book error
  handling), CI-7 (saved cards error handling, client and API), CI-8 (admin
  stock page error handling), CI-9 (tab titles, `/cart`), CI-10 (localised
  homepage titles, 404 titles).
- CI-equivalent checks run locally on the branch head (CI runs only on pull
  requests, so these commits have no GitHub run yet): typecheck, lint, four
  unit suites, backup tests, build, client-bundle check, migrations on an
  empty database, 177 DB checks, gitleaks over the full history (no leaks). Details in
  [CONTINUOUS_IMPROVEMENT_LOG.md](CONTINUOUS_IMPROVEMENT_LOG.md).
- Local stand (outside the repo, scratchpad): Postgres 16 on
  `/var/tmp/lvpg:55441`, PostgREST `:54330`, gateway with storage `:54321`
  (`refunds/gateway.js`), fake Stripe `:54324`, `next start` on `:3003`
  behind the edge proxy `:3000`. The container restarts now and then; bring
  each service up with `nohup … < /dev/null &` (a pipe left open by
  Postgres hangs any `| tail`), and never `pgrep -f` a pattern that appears
  in the same command line.
- The site renders at ~5 fps in this GPU-less container: browser checks must
  wait on conditions, not fixed times.

## Owner approval needed (summary; details in the checklist)

OA-19 apply migration 0061 · OA-03 six Stripe/shop mismatches · OA-04 burned
admin credentials · OA-06/07 backups · OA-13 protect `main` · OA-15 live smoke
test · OA-12 review-email consent and bounce handling.

## Ranked queue

Scores: impact × frequency × confidence ÷ (effort × risk), judged roughly.

| # | Task | Why (evidence) | Status |
|---|---|---|---|
| 1 | One order per checkout attempt | Known gap in PROJECT_IMPROVEMENT_LOG; duplicate orders hold stock 48 h | DONE (CI-1); live after OA-19 |
| 2 | Handle email bounces and complaints (Resend webhook → `email_suppressions`) | PRODUCTION_READINESS_REPORT C-9; no handler existed; blocked turning review requests on (OA-12) | DONE (CI-2); live after OA-12 |
| 3 | Quantity above 20 is silently cut to 20 at order time | Confirmed: the cart allowed up to the stock; the order was cut to 20 | DONE (CI-3) |
| 4 | Intermittent React #418 hydration warning | Seen once per many runs (PROJECT_IMPROVEMENT_LOG); not reproduced in 64 loads, nor in 132 more (CI-10 crawl) | WATCH (no reproduction) |
| 6 | Descriptive tab titles for /account and /checkout (client pages; title from the segment layout, localised) | Crawl: both show the default site title | DONE (CI-9) |
| 7 | A `/cart` URL (typed or bookmarked) that opens the cart instead of a 404 | Crawl: `/cart` is 404; nothing links to it | DONE (CI-9) |
| 8 | Support inbox and notification bell: a failed *first* load shows the empty state | Scan after CI-8; refreshes already keep data | LOW |
| 5 | Build-tooling advisories (Tailwind 3 → 4, eslint-config-next) | AUD-17 / C-12; build-time only | DEFERRED (major upgrade, high regression risk) |

## Important decisions

- New schema goes in additive migrations that the code tolerates being
  absent (pattern used since 0027); applying them is an owner action.
- Server-only tables: RLS on, `revoke all` from anon/authenticated, no
  policies; listed in `scripts/security/verify-production.sql`.
- Never push with force (the environment refuses it); a merged branch is
  brought up to date with `git merge origin/main`.
