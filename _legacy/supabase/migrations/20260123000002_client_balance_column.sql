-- Migration: client_balance_column
-- Module: facturation
-- Gate: 1 — Client Balance
-- Created: 2026-01-23

-- =============================================================================
-- ADD BALANCE_CENTS TO CLIENTS
-- Signed balance: negative = owes money, positive = has credit (like bank)
-- =============================================================================

alter table public.clients
  add column if not exists balance_cents int not null default 0;

comment on column public.clients.balance_cents is
  'Signed balance: negative = client owes money, positive = client has credit';

-- Index for finding clients with outstanding balances
create index if not exists clients_balance_cents_idx
  on public.clients(balance_cents)
  where balance_cents != 0;
