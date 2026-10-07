-- Migration: demandes_intake_fields
-- Module: demandes
-- Purpose: Add intake questionnaire fields to demandes table
-- Created: 2026-01-21

-- =============================================================================
-- ADD INTAKE FIELDS TO DEMANDES
-- These capture client-stated information during initial contact
-- =============================================================================

-- Besoin / raison de la demande
alter table public.demandes
  add column if not exists besoin_raison text default '';

-- Enjeux de la démarche
alter table public.demandes
  add column if not exists enjeux_has_issues text check (enjeux_has_issues in ('yes', 'no')) default null;

alter table public.demandes
  add column if not exists enjeux_demarche text[] default '{}';

alter table public.demandes
  add column if not exists enjeux_comment text default '';

-- Diagnostic ou évaluation
alter table public.demandes
  add column if not exists diagnostic_status text check (diagnostic_status in ('yes', 'no')) default null;

alter table public.demandes
  add column if not exists diagnostic_detail text default '';

-- Consultations antérieures
alter table public.demandes
  add column if not exists has_consulted text check (has_consulted in ('yes', 'no')) default null;

alter table public.demandes
  add column if not exists consultations_previous text[] default '{}';

alter table public.demandes
  add column if not exists consultations_comment text default '';

-- Contexte légal / judiciaire
alter table public.demandes
  add column if not exists has_legal_context text check (has_legal_context in ('yes', 'no')) default null;

alter table public.demandes
  add column if not exists legal_context text[] default '{}';

alter table public.demandes
  add column if not exists legal_context_detail text default '';

-- =============================================================================
-- COMMENTS
-- =============================================================================

comment on column public.demandes.besoin_raison is 'Client-stated reason for the request';
comment on column public.demandes.enjeux_has_issues is 'Whether there are issues in the process (yes/no)';
comment on column public.demandes.enjeux_demarche is 'Array of process issues: availability, coparenting, other';
comment on column public.demandes.enjeux_comment is 'Additional comment about process issues';
comment on column public.demandes.diagnostic_status is 'Whether client has received a diagnosis (yes/no)';
comment on column public.demandes.diagnostic_detail is 'Details about the diagnosis if applicable';
comment on column public.demandes.has_consulted is 'Whether client has consulted before (yes/no)';
comment on column public.demandes.consultations_previous is 'Array of previous consultation types';
comment on column public.demandes.consultations_comment is 'Additional comment about previous consultations';
comment on column public.demandes.has_legal_context is 'Whether there is a legal context (yes/no)';
comment on column public.demandes.legal_context is 'Array of legal contexts: courtOrder, youthProtection';
comment on column public.demandes.legal_context_detail is 'Details about the legal context';
