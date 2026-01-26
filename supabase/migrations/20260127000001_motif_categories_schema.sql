-- Migration: motif_categories_schema
-- Module: motifs
-- Gate: 2 — Schema
-- Created: 2026-01-27
--
-- Creates the motif_categories table to replace hardcoded MOTIF_DISPLAY_GROUPS.
-- Categories represent neutral "spheres of life" for organizing motifs.
-- This enables admin configurability of category names, icons, and ordering.

-- =============================================================================
-- MOTIF_CATEGORIES TABLE
-- Master list of motif categories (display groupings)
-- =============================================================================

create table if not exists public.motif_categories (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label_fr text not null,
  description_fr text,
  icon_name text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for common query patterns
create index if not exists motif_categories_is_active_idx on public.motif_categories(is_active);
create index if not exists motif_categories_display_order_idx on public.motif_categories(display_order);
create index if not exists motif_categories_key_idx on public.motif_categories(key);

-- Comments for documentation
comment on table public.motif_categories is 'Master list of motif categories (spheres of life for display grouping)';
comment on column public.motif_categories.key is 'Stable ASCII snake_case identifier (e.g., inner_life, relationships)';
comment on column public.motif_categories.label_fr is 'French-Canadian display label';
comment on column public.motif_categories.description_fr is 'Optional French-Canadian description';
comment on column public.motif_categories.icon_name is 'Lucide icon name (e.g., heart, brain, users)';
comment on column public.motif_categories.display_order is 'Sort order for UI display (lower = first)';
comment on column public.motif_categories.is_active is 'Soft delete flag - inactive categories are hidden but preserved';

-- =============================================================================
-- UPDATED_AT TRIGGER
-- Automatically maintain updated_at on motif_categories
-- =============================================================================

create trigger motif_categories_set_updated_at
  before update on public.motif_categories
  for each row
  execute function public.set_updated_at();

-- =============================================================================
-- ADD CATEGORY_ID TO MOTIFS TABLE
-- Link motifs to their display category
-- =============================================================================

alter table public.motifs
  add column if not exists category_id uuid references public.motif_categories(id) on delete set null;

-- Index for querying motifs by category
create index if not exists motifs_category_id_idx on public.motifs(category_id);

-- Comment for documentation
comment on column public.motifs.category_id is 'FK to motif_categories - the display group this motif belongs to';

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.motif_categories enable row level security;

-- Read: any authenticated user can read categories
drop policy if exists "motif_categories_select_authenticated" on public.motif_categories;
create policy "motif_categories_select_authenticated"
  on public.motif_categories
  for select
  to authenticated
  using (true);

-- Insert: admin/staff only
drop policy if exists "motif_categories_insert_admin_staff" on public.motif_categories;
create policy "motif_categories_insert_admin_staff"
  on public.motif_categories
  for insert
  to authenticated
  with check ((select public.get_my_role()) in ('admin', 'staff'));

-- Update: admin/staff only
drop policy if exists "motif_categories_update_admin_staff" on public.motif_categories;
create policy "motif_categories_update_admin_staff"
  on public.motif_categories
  for update
  to authenticated
  using ((select public.get_my_role()) in ('admin', 'staff'))
  with check ((select public.get_my_role()) in ('admin', 'staff'));

-- Delete: blocked - use is_active = false instead (soft delete pattern)
drop policy if exists "motif_categories_delete_blocked" on public.motif_categories;
create policy "motif_categories_delete_blocked"
  on public.motif_categories
  for delete
  to authenticated
  using (false);

-- Service role can do everything (for migrations and admin operations)
drop policy if exists "motif_categories_all_service_role" on public.motif_categories;
create policy "motif_categories_all_service_role"
  on public.motif_categories
  for all
  to service_role
  using (true)
  with check (true);

-- =============================================================================
-- GRANTS
-- =============================================================================

grant select, insert, update on public.motif_categories to authenticated;
