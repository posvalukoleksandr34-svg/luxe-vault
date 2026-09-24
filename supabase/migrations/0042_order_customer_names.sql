-- ============================================================================
-- 0042_order_customer_names.sql
-- ============================================================================
-- The buyer's first and last name as two fields. Checkout asks for them
-- separately. customer_name keeps the full name ("First Last"), so every
-- existing reader — the admin, invoices, emails, place_order() — works
-- unchanged. These two columns record the split, which a single string
-- cannot: "Anna Maria Rossi" could be either first name "Anna Maria" or
-- surname "Maria Rossi".
--
-- Nullable: orders placed before this migration, and any order from a
-- client that still sends one name, have only customer_name.
--
-- Written by the app right after place_order() creates the order
-- (lib/server/orders-store.ts), so place_order() itself is not redefined.
-- ============================================================================

alter table public.orders
  add column if not exists customer_first_name text
    check (customer_first_name is null or char_length(customer_first_name) between 1 and 50),
  add column if not exists customer_last_name  text
    check (customer_last_name is null or char_length(customer_last_name) between 1 and 50);
