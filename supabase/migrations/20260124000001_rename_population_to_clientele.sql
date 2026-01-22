-- Migration: rename_population_to_clientele
-- Module: specialties
-- Created: 2026-01-24
-- Description: Rename the 'population' category to 'clientele' in specialties table
--              for clarity in the UI (population is ambiguous, clientele is explicit)

-- =============================================================================
-- PHASE 1: Allow both 'population' and 'clientele' temporarily
-- =============================================================================

-- Drop the existing check constraint and recreate with both values allowed
-- The constraint name is auto-generated, so we need to find and drop it dynamically

do $$
declare
  v_constraint_name text;
begin
  -- Find the check constraint on the category column
  select conname into v_constraint_name
  from pg_constraint c
  join pg_class t on c.conrelid = t.oid
  join pg_namespace n on t.relnamespace = n.oid
  where t.relname = 'specialties'
    and n.nspname = 'public'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%category%';

  -- Drop the constraint if it exists
  if v_constraint_name is not null then
    execute format('alter table public.specialties drop constraint %I', v_constraint_name);
  end if;
end $$;

-- Add new constraint that allows both 'population' and 'clientele' temporarily
-- Using a named constraint for easier management in the future
alter table public.specialties
  add constraint specialties_category_check
  check (category in ('therapy_type', 'population', 'clientele', 'issue', 'modality'));

-- =============================================================================
-- PHASE 2: Migrate data from 'population' to 'clientele'
-- =============================================================================

update public.specialties
set category = 'clientele'
where category = 'population';

-- =============================================================================
-- PHASE 3: Remove 'population' from allowed values
-- =============================================================================

-- Drop the temporary constraint
alter table public.specialties drop constraint if exists specialties_category_check;

-- Add final constraint with only 'clientele' (no more 'population')
alter table public.specialties
  add constraint specialties_category_check
  check (category in ('therapy_type', 'clientele', 'issue', 'modality'));

-- =============================================================================
-- UPDATE DOCUMENTATION
-- =============================================================================

comment on column public.specialties.category is 'Category: therapy_type, clientele, issue, modality';
