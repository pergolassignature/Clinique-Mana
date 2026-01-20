-- Migration: motifs_rls_write_access
-- Module: motifs
-- Gate: RLS
-- Created: 2026-01-19
--
-- Temporarily enables INSERT and UPDATE for authenticated users on motifs table.
-- This unblocks staff from managing motifs via the UI.
-- DELETE remains blocked (soft-delete via is_active flag).
--
-- TODO: Tighten to staff/admin claim once roles system is finalized.

-- =============================================================================
-- INSERT POLICY
-- Any authenticated user can create new motifs
-- =============================================================================

drop policy if exists "motifs_insert_authenticated" on public.motifs;
create policy "motifs_insert_authenticated"
  on public.motifs
  for insert
  to authenticated
  with check (true);

-- =============================================================================
-- UPDATE POLICY
-- Any authenticated user can update existing motifs (archive, restore, edit)
-- =============================================================================

drop policy if exists "motifs_update_authenticated" on public.motifs;
create policy "motifs_update_authenticated"
  on public.motifs
  for update
  to authenticated
  using (true)
  with check (true);

-- NOTE: DELETE is intentionally NOT granted.
-- Motifs should be archived (is_active = false), never hard deleted.
