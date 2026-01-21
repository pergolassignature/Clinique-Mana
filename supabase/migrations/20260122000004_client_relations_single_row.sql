-- Migration: client_relations_single_row
-- Module: clients
-- Purpose: Refactor client_relations to single-row per relationship (SaaS best practice)
-- Created: 2026-01-22
--
-- This migration converts from dual-row approach (A→B and B→A) to single-row
-- with canonical ordering (lower UUID always in client_a_id).
-- Benefits: Single source of truth, no sync issues, atomic operations.

-- =============================================================================
-- STEP 1: Create new table structure
-- =============================================================================

-- Drop existing table and recreate with new structure
drop table if exists public.client_relations cascade;

create table public.client_relations (
  id uuid primary key default gen_random_uuid(),

  -- Always store with client_a_id < client_b_id (lexicographically)
  -- This ensures consistent ordering regardless of which side creates the relation
  client_a_id uuid not null references public.clients(id) on delete cascade,
  client_b_id uuid not null references public.clients(id) on delete cascade,

  -- What A is to B (e.g., if A is Patrice and B is Virginie, and Patrice is parent)
  -- then relation_type_a_to_b = 'parent', relation_type_b_to_a = 'child'
  relation_type_a_to_b text not null check (relation_type_a_to_b in (
    'parent', 'child', 'spouse', 'sibling', 'guardian', 'ward', 'other'
  )),
  relation_type_b_to_a text not null check (relation_type_b_to_a in (
    'parent', 'child', 'spouse', 'sibling', 'guardian', 'ward', 'other'
  )),

  notes text,
  created_at timestamptz not null default now(),

  -- Ensure only one relationship per pair (canonical ordering enforced by trigger)
  constraint client_relations_unique_pair unique(client_a_id, client_b_id),

  -- Prevent self-relations
  constraint client_relations_no_self_relation check (client_a_id != client_b_id)
);

-- =============================================================================
-- STEP 2: Create helper function to enforce canonical ordering
-- =============================================================================

create or replace function public.enforce_client_relation_ordering()
returns trigger as $$
declare
  v_temp_id uuid;
  v_temp_type text;
begin
  -- Swap if client_a_id > client_b_id to maintain canonical ordering
  if new.client_a_id > new.client_b_id then
    -- Swap the IDs
    v_temp_id := new.client_a_id;
    new.client_a_id := new.client_b_id;
    new.client_b_id := v_temp_id;

    -- Swap the relation types too
    v_temp_type := new.relation_type_a_to_b;
    new.relation_type_a_to_b := new.relation_type_b_to_a;
    new.relation_type_b_to_a := v_temp_type;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger client_relations_enforce_ordering
  before insert or update on public.client_relations
  for each row
  execute function public.enforce_client_relation_ordering();

-- =============================================================================
-- STEP 3: Create indexes
-- =============================================================================

create index client_relations_client_a_id_idx on public.client_relations(client_a_id);
create index client_relations_client_b_id_idx on public.client_relations(client_b_id);

-- Composite index for finding all relations for a given client
create index client_relations_either_client_idx
  on public.client_relations(client_a_id, client_b_id);

-- =============================================================================
-- STEP 4: Create view for easy querying
-- This view expands each relation into two rows (one from each perspective)
-- =============================================================================

-- View returns: for each client, what their RELATED client is TO THEM
-- Example: If Patrice (A) is parent of Virginie (B):
--   - relation_type_a_to_b = 'parent' (what A is to B)
--   - relation_type_b_to_a = 'child' (what B is to A)
--   - Patrice queries: sees Virginie as 'child' (relation_type_b_to_a - what B is to A)
--   - Virginie queries: sees Patrice as 'parent' (relation_type_a_to_b - what A is to B)
create or replace view public.client_relations_expanded as
select
  r.id,
  r.client_a_id as client_id,
  r.client_b_id as related_client_id,
  r.relation_type_b_to_a as relation_type,  -- What the related client (B) is to me (A)
  r.notes,
  r.created_at,
  c.first_name as related_first_name,
  c.last_name as related_last_name
from public.client_relations r
join public.clients c on c.id = r.client_b_id

union all

select
  r.id,
  r.client_b_id as client_id,
  r.client_a_id as related_client_id,
  r.relation_type_a_to_b as relation_type,  -- What the related client (A) is to me (B)
  r.notes,
  r.created_at,
  c.first_name as related_first_name,
  c.last_name as related_last_name
from public.client_relations r
join public.clients c on c.id = r.client_a_id;

comment on view public.client_relations_expanded is
  'Expanded view showing relations from each client perspective. Use this for queries.';

-- =============================================================================
-- STEP 5: Comments
-- =============================================================================

comment on table public.client_relations is
  'Single-row per relationship between clients. Uses canonical ordering (client_a_id < client_b_id).';
comment on column public.client_relations.client_a_id is
  'First client in the pair (lexicographically smaller UUID)';
comment on column public.client_relations.client_b_id is
  'Second client in the pair (lexicographically larger UUID)';
comment on column public.client_relations.relation_type_a_to_b is
  'What client_a is to client_b (e.g., parent means A is parent of B)';
comment on column public.client_relations.relation_type_b_to_a is
  'What client_b is to client_a (e.g., child means B is child of A)';

-- =============================================================================
-- STEP 6: RLS Policies
-- =============================================================================

alter table public.client_relations enable row level security;

-- Allow authenticated users to read all relations
create policy "Authenticated users can view client relations"
  on public.client_relations for select
  to authenticated
  using (true);

-- Allow authenticated users to insert relations
create policy "Authenticated users can create client relations"
  on public.client_relations for insert
  to authenticated
  with check (true);

-- Allow authenticated users to update relations
create policy "Authenticated users can update client relations"
  on public.client_relations for update
  to authenticated
  using (true)
  with check (true);

-- Allow authenticated users to delete relations
create policy "Authenticated users can delete client relations"
  on public.client_relations for delete
  to authenticated
  using (true);
