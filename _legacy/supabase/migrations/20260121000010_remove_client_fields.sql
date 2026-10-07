-- Migration: remove_client_fields
-- Module: clients
-- Gate: 2 — Schema
-- Created: 2026-01-21
-- Description: Remove birth_first_name, pronouns columns and 'unknown' from sex options

-- =============================================================================
-- DROP COLUMNS
-- =============================================================================

-- Drop birth_first_name column
alter table public.clients drop column if exists birth_first_name;

-- Drop pronouns column
alter table public.clients drop column if exists pronouns;

-- =============================================================================
-- UPDATE SEX CONSTRAINT
-- Remove 'unknown' option, keeping only 'male', 'female', 'other'
-- =============================================================================

-- First, update any existing 'unknown' values to null
update public.clients set sex = null where sex = 'unknown';

-- Drop the old constraint and add new one
alter table public.clients drop constraint if exists clients_sex_check;
alter table public.clients add constraint clients_sex_check check (sex in ('male', 'female', 'other'));

-- Note: Comments on dropped columns are automatically removed
