-- Migration: add_groups_specialty
-- Module: specialties
-- Created: 2026-01-24
-- Description: Add 'groups' specialty to the clientele category
--              This allows professionals to indicate they work with therapeutic groups.

-- =============================================================================
-- ADD GROUPS SPECIALTY (IDEMPOTENT)
-- =============================================================================

-- Insert the new 'groups' specialty only if it doesn't already exist
-- Using ON CONFLICT to ensure idempotency

insert into public.specialties (code, name_fr, category, is_active, sort_order)
values ('groups', 'Groupes', 'clientele', true, 7)
on conflict (code) do nothing;
