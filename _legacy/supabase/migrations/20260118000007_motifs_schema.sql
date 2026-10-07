-- Migration: motifs_schema
-- Module: motifs
-- Gate: 2 — Schema
-- Created: 2026-01-19
--
-- Motifs are non-clinical orientation tags used to triage and orient requests.
-- They are NOT diagnoses. Display groupings (spheres of life) are UI-only.

-- =============================================================================
-- MOTIFS TABLE
-- Master list of consultation motifs (reasons for seeking help)
-- =============================================================================

create table if not exists public.motifs (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  is_active boolean not null default true,
  is_restricted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for common query patterns
create index if not exists motifs_is_active_idx on public.motifs(is_active);
create index if not exists motifs_key_idx on public.motifs(key);

-- Comments for documentation
comment on table public.motifs is 'Master list of consultation motifs (non-clinical orientation tags)';
comment on column public.motifs.key is 'Stable ASCII snake_case identifier (e.g., anxiety, life_transition)';
comment on column public.motifs.label is 'French-Canadian display label';
comment on column public.motifs.is_active is 'Soft delete flag - inactive motifs are hidden but preserved';
comment on column public.motifs.is_restricted is 'If true, only licensed professionals can select this motif';

-- =============================================================================
-- UPDATED_AT TRIGGER
-- Automatically maintain updated_at on motifs
-- =============================================================================

create trigger motifs_set_updated_at
  before update on public.motifs
  for each row
  execute function public.set_updated_at();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.motifs enable row level security;

-- Read: any authenticated user can read active motifs
drop policy if exists "motifs_select_authenticated" on public.motifs;
create policy "motifs_select_authenticated"
  on public.motifs
  for select
  to authenticated
  using (true);

-- Writes: service_role only (until staff roles are finalized)
drop policy if exists "motifs_write_service_role" on public.motifs;
create policy "motifs_write_service_role"
  on public.motifs
  for all
  to service_role
  using (true)
  with check (true);

-- =============================================================================
-- DEMANDE_MOTIFS JUNCTION TABLE
-- Links demandes to their selected motifs (many-to-many)
-- =============================================================================

create table if not exists public.demande_motifs (
  demande_id uuid not null,
  motif_id uuid not null references public.motifs(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (demande_id, motif_id)
);

-- NOTE: demandes table does not exist yet. Uncomment when created:
-- alter table public.demande_motifs
--   add constraint demande_motifs_demande_id_fk
--   foreign key (demande_id)
--   references public.demandes(id)
--   on delete cascade;

-- Index for querying motifs by demande
create index if not exists demande_motifs_demande_id_idx on public.demande_motifs(demande_id);
create index if not exists demande_motifs_motif_id_idx on public.demande_motifs(motif_id);

-- Comments
comment on table public.demande_motifs is 'Junction table linking demandes to their selected motifs';
comment on column public.demande_motifs.demande_id is 'FK to demandes table (constraint added when table exists)';

-- RLS
alter table public.demande_motifs enable row level security;

drop policy if exists "demande_motifs_select_authenticated" on public.demande_motifs;
create policy "demande_motifs_select_authenticated"
  on public.demande_motifs
  for select
  to authenticated
  using (true);

drop policy if exists "demande_motifs_write_service_role" on public.demande_motifs;
create policy "demande_motifs_write_service_role"
  on public.demande_motifs
  for all
  to service_role
  using (true)
  with check (true);

-- =============================================================================
-- PROFESSIONAL_MOTIFS JUNCTION TABLE
-- Links professionals to motifs they specialize in (many-to-many)
-- =============================================================================

create table if not exists public.professional_motifs (
  professional_id uuid not null references public.professionals(id) on delete cascade,
  motif_id uuid not null references public.motifs(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (professional_id, motif_id)
);

-- Index for querying
create index if not exists professional_motifs_professional_id_idx on public.professional_motifs(professional_id);
create index if not exists professional_motifs_motif_id_idx on public.professional_motifs(motif_id);

-- Comments
comment on table public.professional_motifs is 'Junction table linking professionals to motifs they handle';
comment on column public.professional_motifs.professional_id is 'FK to professionals table';

-- RLS
alter table public.professional_motifs enable row level security;

drop policy if exists "professional_motifs_select_authenticated" on public.professional_motifs;
create policy "professional_motifs_select_authenticated"
  on public.professional_motifs
  for select
  to authenticated
  using (true);

drop policy if exists "professional_motifs_write_service_role" on public.professional_motifs;
create policy "professional_motifs_write_service_role"
  on public.professional_motifs
  for all
  to service_role
  using (true)
  with check (true);
