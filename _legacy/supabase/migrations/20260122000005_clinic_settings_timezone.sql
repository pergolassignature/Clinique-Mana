-- Migration: clinic_settings_timezone
-- Module: external-payers (clinic settings)
-- Purpose: Add timezone setting to clinic_settings table
-- Created: 2026-01-22

-- =============================================================================
-- ADD TIMEZONE COLUMN
-- Default to America/Toronto (EST/EDT) for Quebec clinic
-- =============================================================================

alter table public.clinic_settings
  add column timezone text not null default 'America/Toronto';

comment on column public.clinic_settings.timezone is 'IANA timezone identifier for the clinic (e.g., America/Toronto)';
