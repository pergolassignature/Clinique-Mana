-- Migration: schedule_preference_to_array
-- Module: demandes
-- Purpose: Change schedule_preference from text to text[] for multi-selection
-- Created: 2026-01-24

-- =============================================================================
-- CHANGE SCHEDULE_PREFERENCE TO ARRAY TYPE
-- Allows clients to select multiple time preferences (e.g., morning AND evening)
-- =============================================================================

-- Step 1: Add new array column
alter table public.demandes
  add column if not exists schedule_preferences text[] default '{}';

-- Step 2: Migrate existing data (single value to array)
update public.demandes
set schedule_preferences = case
  when schedule_preference is not null then array[schedule_preference]
  else '{}'
end
where schedule_preferences = '{}' or schedule_preferences is null;

-- Step 3: Drop the old column
alter table public.demandes
  drop column if exists schedule_preference;

-- Step 4: Add check constraint for valid values
alter table public.demandes
  add constraint schedule_preferences_valid_values
  check (schedule_preferences <@ array['am', 'pm', 'evening', 'weekend', 'other']::text[]);

-- =============================================================================
-- COMMENTS
-- =============================================================================

comment on column public.demandes.schedule_preferences is 'Client preferred time slots (multi-select): am, pm, evening, weekend, other';
