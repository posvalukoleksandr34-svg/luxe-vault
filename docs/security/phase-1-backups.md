# Phase 1b — Offsite backups and restore drills

Part of the [security roadmap](README.md). The code is in `scripts/backup/`,
`.github/workflows/offsite-backup.yml` and
`.github/workflows/backup-restore-test.yml`. Nothing runs until the secrets
below exist; until then both workflows exit with a warning.

## Why Supabase's own backups are not enough

Supabase's daily backups, and point-in-time recovery if enabled, live in the
**same account** as the database. An attacker holding that account, a mistyped
"delete project", or a billing lapse takes the database and its backups
together. The rule this follows is **3-2-1 with one copy immutable**:

| Copy | Where | Protects against |
|---|---|---|
| Live database | Supabase | — |
| Supabase backups / PITR | Supabase, same account | bad deploys and accidental deletes; fastest restore |
| **Offsite, encrypted, Object-Locked** | **another provider, another account** | account takeover, ransomware, provider outage, deletion |

## What runs

| Workflow | When | What |
|---|---|---|
| **Offsite backup** | nightly, 02:43 UTC | `pg_dump` of the `public`, `auth` and `storage` schemas, age-encrypted, plus a manifest of every table's row count. Every Storage bucket, copied through an rclone crypt remote. A git bundle of every branch, age-encrypted. |
| **Backup restore test** | Mondays, 05:19 UTC | Takes the newest backup and fails if it is more than 30 hours old. Decrypts it and checks its SHA-256. Restores it into a throwaway Postgres and compares every table's row count with the manifest. |

Either one failing posts to the Telegram operations chat, through the existing
`/api/internal/telegram`, when `INTERNAL_API_SECRET` is available to it.

Design choices that matter for ransomware:

- **Encrypted before upload.** `auth.users` holds password hashes, and most
  tables hold customer PII. The storage provider only ever sees ciphertext.
- **Append-only.** Media uses `rclone copy`, never `sync`, so a file deleted
  or encrypted upstream is not deleted here. The bucket's **Object Lock**
  means even the CI key cannot delete or overwrite a backup until its
  retention expires.
- **Two decryption keys.** The CI key lets the restore test run unattended.
  The offline key never touches GitHub, so losing or revoking the CI key
  never makes backups unreadable.
- **Secrets in a protected Environment.** Only jobs running from `main` can
  read them. A workflow edited in a pull request cannot.

Recovery objectives: **RPO 24 h** from the offsite copy (minutes with
Supabase PITR), and a target **RTO of 4 h** for a full rebuild into a new
project.

## One-time setup (about 45 minutes)

### 1. Backup bucket (Backblaze B2 recommended, AWS S3 equivalent)

Use a **separate account** from everything else, with its own MFA.

1. Create a **private** bucket, e.g. `luxe-vault-backups`, with **Object Lock
   enabled**. On most providers this can only be chosen at creation.
2. Default retention: **Compliance mode, 30 days**. (Governance mode is
   gentler, but an account admin can lift it, which is exactly what an
   attacker with that account would do.)
3. Lifecycle rule: delete file versions older than 90 days. They become
   deletable only once their lock expires.
4. Create an application key limited to this bucket, with **list, read and
   write, but not delete**. On B2 that is `listFiles`, `readFiles` and
   `writeFiles`, without `deleteFiles` or `bypassGovernance`. Note the key ID,
   the key and the S3 endpoint (e.g. `https://s3.eu-central-003.backblazeb2.com`).

Cost for a database this size is a few cents a month.

### 2. Encryption keys (age)

```bash
age-keygen -o ci-backup.key        # prints: Public key: age1...
age-keygen -o offline-backup.key   # prints: Public key: age1...
```

- `offline-backup.key`: put it in the password manager, and print a copy for
  the safe. **Without one of the two private keys, no backup can ever be
  read.**
- `ci-backup.key`: its full contents (the `AGE-SECRET-KEY-1…` line) become
  the secret `BACKUP_AGE_IDENTITY`.
- Both public keys, space-separated, become the variable
  `BACKUP_AGE_RECIPIENTS`.
- Then delete both files from the laptop.

A third key for a second person is just a third recipient.

### 3. Media passphrase

`openssl rand -base64 32`. It becomes `BACKUP_MEDIA_PASSPHRASE`. Keep a copy
in the password manager: it is the only way to read the media backup.

### 4. Supabase credentials

- **Database URL:** Dashboard → **Connect** → **Session pooler**. Copy the URI
  `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
  It has to be the **session** pooler (port 5432), not the transaction pooler
  (6543), which `pg_dump` cannot use. GitHub's runners have no IPv6, and the
  direct `db.<ref>.supabase.co` host is IPv6-only.
- **Storage S3 keys:** Storage → **Settings → S3 Connection**. Enable it, then
  note the endpoint (`https://<ref>.supabase.co/storage/v1/s3`) and region, and
  create an access key. These keys read every bucket regardless of RLS: treat
  them as secrets.
- Set `PG_IMAGE` in the workflows (default `postgres:17`) to a major version
  **at least** the production server's. Settings → Infrastructure shows it.

### 5. GitHub

Settings → **Environments → New environment** `backups` → **Deployment
branches: Selected → `main`**. Then add:

| Kind | Name | Value |
|---|---|---|
| Secret | `SUPABASE_DB_URL` | session-pooler URI (step 4) |
| Secret | `BACKUP_S3_ACCESS_KEY_ID` | bucket key ID (step 1) |
| Secret | `BACKUP_S3_SECRET_ACCESS_KEY` | bucket key (step 1) |
| Secret | `BACKUP_AGE_IDENTITY` | contents of `ci-backup.key` |
| Secret | `BACKUP_MEDIA_PASSPHRASE` | step 3 |
| Secret | `SUPABASE_S3_ACCESS_KEY_ID` | step 4 |
| Secret | `SUPABASE_S3_SECRET_ACCESS_KEY` | step 4 |
| Variable | `BACKUP_AGE_RECIPIENTS` | both public keys, space-separated |
| Variable | `BACKUP_BUCKET` | `luxe-vault-backups` |
| Variable | `BACKUP_S3_ENDPOINT` | step 1 (leave empty for AWS S3) |
| Variable | `BACKUP_S3_REGION` | e.g. `eu-central-003` |
| Variable | `SUPABASE_S3_ENDPOINT` | step 4 |
| Variable | `SUPABASE_S3_REGION` | step 4 |

`INTERNAL_API_SECRET` (for failure alerts) and `SITE_URL` are read as
repository-level secrets or variables, as the abandoned-cart workflow already
does.

### 6. First run

1. Actions → **Offsite backup** → Run workflow. Check that `db/`, `media/`
   and `code/` appear in the bucket.
2. Actions → **Backup restore test** → Run workflow. The job summary reads
   e.g. `Backup 20261001T024312Z (0 h old): 34 tables, 18423 rows restored`.
   A handful of pg_restore warnings about Supabase-only objects (`pg_graphql`,
   `supabase_vault`, event triggers) is normal; the row counts are the
   verdict.
3. Try deleting a file in the bucket with the CI key. It must be refused.

## Restoring for real

Supabase's own restore (Dashboard → Database → Backups) is faster when the
project still exists and is trustworthy. Use this path when it is not.

Treat any restore after an attack as a **new** environment: rotate every
secret first (see the incident response plan in the roadmap).

```bash
# 0. Tools: age, rclone, and a pg_restore at least as new as the dump's.
export RCLONE_CONFIG_BACKUP_TYPE=s3 RCLONE_CONFIG_BACKUP_PROVIDER=Other \
       RCLONE_CONFIG_BACKUP_ENDPOINT=<endpoint> RCLONE_CONFIG_BACKUP_REGION=<region> \
       RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID=<id> RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY=<key>

# 1. Pick a backup (newest last) and fetch it.
rclone lsf backup:luxe-vault-backups/db --include '*.manifest.json' | sort | tail -5
S=20261001T024312Z
rclone copyto backup:luxe-vault-backups/db/$S.dump.age ./$S.dump.age
rclone copyto backup:luxe-vault-backups/db/$S.manifest.json ./$S.manifest.json

# 2. Decrypt with the OFFLINE key and verify it is the file that was backed up.
age -d -i offline-backup.key -o db.dump $S.dump.age
sha256sum db.dump; jq -r .dump_sha256 $S.manifest.json      # must match

# 3. Into a NEW Supabase project (session-pooler URL of the new project).
#    Supabase owns its auth and storage schemas, so only their DATA comes
#    back. Order matters: public's foreign keys point at auth.users, so the
#    users go in first.
jq -r '.extensions[] | "create extension if not exists \"\(.name)\" with schema \"\(.schema)\";"' \
  $S.manifest.json | psql "$NEW_DB_URL"          # "already exists" errors are fine
pg_restore --no-owner --data-only --schema=auth \
  --table=users --table=identities -d "$NEW_DB_URL" db.dump
pg_restore --no-owner --schema=public -d "$NEW_DB_URL" db.dump
pg_restore --no-owner --data-only --schema=storage \
  --table=buckets --table=objects -d "$NEW_DB_URL" db.dump
# The triggers that create a profile for each new sign-up live ON auth.users,
# so the public restore does not bring them back. 0001 is idempotent.
psql "$NEW_DB_URL" -f supabase/migrations/0001_profiles.sql

# 4. Media: decrypt straight into the new project's Storage.
export RCLONE_CONFIG_MEDIA_TYPE=crypt RCLONE_CONFIG_MEDIA_REMOTE=backup:luxe-vault-backups/media \
       RCLONE_CONFIG_MEDIA_PASSWORD=$(printf '%s' '<media passphrase>' | rclone obscure -)
export RCLONE_CONFIG_NEW_TYPE=s3 RCLONE_CONFIG_NEW_PROVIDER=Other RCLONE_CONFIG_NEW_FORCE_PATH_STYLE=true \
       RCLONE_CONFIG_NEW_ENDPOINT=https://<new-ref>.supabase.co/storage/v1/s3 RCLONE_CONFIG_NEW_REGION=<region> \
       RCLONE_CONFIG_NEW_ACCESS_KEY_ID=<id> RCLONE_CONFIG_NEW_SECRET_ACCESS_KEY=<key>
for b in product-images newsletter-images returns support-attachments; do rclone copy media:$b new:$b; done

# 5. Code, if GitHub itself is the problem.
rclone copyto backup:luxe-vault-backups/code/$S.bundle.age ./repo.bundle.age
age -d -i offline-backup.key -o repo.bundle repo.bundle.age && git clone repo.bundle luxe-vault
```

Then point Vercel's `NEXT_PUBLIC_SUPABASE_URL`, the anon key and the service
role key at the new project. Update `images.remotePatterns` in
`next.config.js`, which pins the project host, and redeploy.

This procedure was rehearsed against a Postgres built from this repo's 44
migrations. Users, profiles, buckets, all 32 foreign keys and both
`auth.users` triggers came back, and a new sign-up got its profile. A real
Supabase project has more internal tables, though. **Rehearse steps 1–4 once
on a scratch project.** The weekly test proves the
data is complete. Only a rehearsal proves the procedure is.
