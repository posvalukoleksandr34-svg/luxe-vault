-- Product reviews: verified buyers only, one review per customer per product.
--
-- 1. ONE REVIEW PER CUSTOMER PER PRODUCT. 0004's unique index was per
--    (customer, product, order), so someone who bought the same item twice
--    could review it twice. A review is an opinion of a product; a customer
--    gets one, and the slot stays taken whether the review is pending,
--    published or rejected (delete a rejected one to let them try again).
--
-- 2. THE PURCHASE IS CHECKED FOR THE PRODUCT, NOT JUST THE ORDER. 0004's
--    insert policy asked only that the order be the customer's own and
--    delivered. It never asked whether that order contained the product being
--    reviewed, so anyone with one delivered order could review any product by
--    writing to the REST API directly. Now the row must point at a delivered
--    order of the reviewer's that contains this product. The insert policy
--    asks it of customers, and a trigger asks it of every writer, service role
--    included, so no code path (an admin tool, an import, a future endpoint)
--    can create a review without the purchase behind it.
--
-- 3. CUSTOMERS WRITE ONLY THE REVIEW: rating, comment, product, order and
--    their own user id. Status (always 'pending' on insert; a review is
--    published only after an admin approves it), created_at and id are the
--    database's.
--
-- 4. review_eligibility(product) REPLACES can_review(product). It answers
--    with a status ('signed_out', 'not_purchased', 'reviewed' or 'eligible')
--    so the product page shows the right message instead of a bare no.
--
-- "Delivered" is the order status that counts. Orders run pending →
-- processing → shipped → delivered; there is no separate 'completed' state,
-- delivered is it. A paid order still on its way does not count yet: a
-- review comes from someone who has the item.
--
-- Deploy order: apply before or together with the code. Until both are in
-- place the product page shows no review form and the API accepts no review
-- (old code against this database, or new code without it, fails closed).
--
-- Idempotent; safe to re-run. If a customer already has two reviews of one
-- product it stops at the first block, having changed nothing.

-- ------------------------------------------------------------ duplicates ----
-- Choosing which of someone's reviews to delete is the operator's call, not a
-- migration's.
do $$
declare
  pairs integer;
begin
  select count(*) into pairs
    from (select 1 from public.reviews group by user_id, product_id having count(*) > 1) d;
  if pairs > 0 then
    raise exception
      'public.reviews has % customer/product pair(s) with more than one review. Keep one review per pair, delete the others, then run this again. To list them: select user_id, product_id, count(*) from public.reviews group by 1, 2 having count(*) > 1;',
      pairs;
  end if;
end $$;

-- ---------------------------------------------------- one per customer ----
-- Created before the old index is dropped, so uniqueness never lapses.
create unique index if not exists reviews_one_per_user_product_idx
  on public.reviews (user_id, product_id);

drop index if exists public.reviews_one_per_user_product_order_idx;

-- ------------------------------------------- the purchase, for everyone ----
-- SECURITY DEFINER so the check reads orders whoever is writing; it compares
-- against the row's own user_id, which the insert policy pins to auth.uid()
-- for customers.
create or replace function public.reviews_require_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Moderation and text edits do not fire this (see the trigger's column
  -- list). An order being purged sets order_id to null through its foreign
  -- key; the review outlives it, as 0004 intended.
  if tg_op = 'UPDATE'
     and new.user_id = old.user_id
     and new.product_id = old.product_id
     and (new.order_id is not distinct from old.order_id or new.order_id is null) then
    return new;
  end if;

  if new.order_id is null or not exists (
    select 1
      from public.orders o
      join public.order_items i on i.order_id = o.id
     where o.id = new.order_id
       and o.user_id = new.user_id
       and o.status = 'delivered'
       and i.product_id = new.product_id
  ) then
    raise exception 'review refused: no delivered order of this customer contains product %', new.product_id
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.reviews_require_purchase() from public, anon, authenticated;

drop trigger if exists reviews_require_purchase on public.reviews;
create trigger reviews_require_purchase
  before insert or update of user_id, product_id, order_id on public.reviews
  for each row execute function public.reviews_require_purchase();

-- ------------------------------------------------------- insert policy ----
-- The same question as the trigger, asked of customers. Columns of the new
-- row are written reviews.<column>: unqualified inside the subquery,
-- product_id and order_id would mean order_items' own columns.
drop policy if exists "users review their delivered orders" on public.reviews;
drop policy if exists "verified buyers review products they received" on public.reviews;
create policy "verified buyers review products they received"
  on public.reviews for insert
  to authenticated
  with check (
    reviews.user_id = auth.uid()
    and reviews.status = 'pending'
    and exists (
      select 1
        from public.orders o
        join public.order_items i on i.order_id = o.id
       where o.id = reviews.order_id
         and o.user_id = auth.uid()
         and o.status = 'delivered'
         and i.product_id = reviews.product_id
    )
  );

-- --------------------------------------------------- writable columns ----
-- Same approach as 0048: what a customer may set, column by column.
revoke insert on public.reviews from anon, authenticated;
grant insert (user_id, product_id, order_id, rating, comment) on public.reviews to authenticated;

-- ------------------------------------------------- review_eligibility ----
drop function if exists public.can_review(text);

create or replace function public.review_eligibility(p_product_id text)
returns table (status text, order_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user  uuid := auth.uid();
  v_order uuid;
begin
  if v_user is null then
    return query select 'signed_out'::text, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.reviews r
     where r.user_id = v_user and r.product_id = p_product_id
  ) then
    return query select 'reviewed'::text, null::uuid;
    return;
  end if;

  select o.id into v_order
    from public.orders o
    join public.order_items i on i.order_id = o.id
   where o.user_id = v_user
     and o.status = 'delivered'
     and i.product_id = p_product_id
   order by o.delivered_at desc nulls last
   limit 1;

  return query
    select (case when v_order is null then 'not_purchased' else 'eligible' end)::text, v_order;
end;
$$;

revoke all on function public.review_eligibility(text) from public, anon;
grant execute on function public.review_eligibility(text) to authenticated;

comment on function public.review_eligibility(text) is
  'Whether the signed-in customer may review this product: signed_out, not_purchased, reviewed or eligible (with the delivered order to review it against).';
comment on table public.reviews is
  'Product reviews. Verified buyers only: each row points at a delivered order of the reviewer''s that contains the product (enforced by the reviews_require_purchase trigger). One per customer per product.';