-- 0025 — Curated Vaults: a match score on a saved look
--
-- The account's "Curated Vaults" section is the customer-facing list of what
-- 0024 already stores, so it reads public.saved_looks. It is NOT a second
-- table.
--
-- That is worth stating plainly, because a `saved_capsules(id, user_id, items,
-- style_notes, created_at)` table was the obvious thing to add here, and every
-- one of its columns already exists:
--
--     items        -> saved_looks.product_ids   (product slugs, catalogue-checked)
--     style_notes  -> saved_looks.notes
--     user_id      -> saved_looks.user_id       (from the session, never the body)
--     created_at   -> saved_looks.created_at
--
-- A parallel table would have split one concept across two: "Save look" writes
-- a row that /stylist/share/<id> reads, so capsules saved into a new table
-- would either be unshareable, or shareable only after the save endpoint wrote
-- both — two rows to keep in step, two sets of RLS policies, and a share link
-- that outlives a deletion from the account page. Everything below therefore
-- extends the table that already holds these rows.
--
-- The one thing 0024 does not have is the match score shown on a vault card.

alter table public.saved_looks
  add column if not exists match_score smallint
    check (match_score is null or match_score between 0 and 100);

comment on column public.saved_looks.match_score is
  'How much of the brief this look satisfied, 0-100. Null for a look saved without a brief (a shared capsule someone else assembled, or a save from before this column existed) — the card then simply shows no score rather than a fabricated one.';
