-- Migration: add_schedule_preference_to_demandes
-- Module: demandes
-- Purpose: Add schedule preference fields for client availability constraints
-- Created: 2026-01-24

-- =============================================================================
-- ADD SCHEDULE PREFERENCE FIELDS TO DEMANDES
-- These allow clients to indicate their scheduling constraints during intake
-- =============================================================================

-- Schedule preference (predefined options)
-- am: Matin (avant 12h)
-- pm: Apres-midi (12h-17h)
-- evening: Soir (apres 17h)
-- weekend: Fin de semaine
-- other: Autre (preciser)
alter table public.demandes
  add column if not exists schedule_preference text
    check (schedule_preference in ('am', 'pm', 'evening', 'weekend', 'other'));

-- Free-text detail when 'other' is selected
alter table public.demandes
  add column if not exists schedule_preference_detail text;

-- =============================================================================
-- COMMENTS
-- =============================================================================

comment on column public.demandes.schedule_preference is 'Client preferred time slot: am (before 12h), pm (12h-17h), evening (after 17h), weekend, or other';
comment on column public.demandes.schedule_preference_detail is 'Free-text detail when schedule_preference is other';
