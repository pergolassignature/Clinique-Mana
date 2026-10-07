-- Migration: recommendations_schema
-- Module: recommendations
-- Gate: 1 - Core Tables
-- Created: 2026-01-22

-- =============================================================================
-- RECOMMENDATION_CONFIGS TABLE
-- Configurable scoring rules and AI prompts (advisory only)
-- =============================================================================

create table public.recommendation_configs (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name_fr text not null,
  description_fr text,

  -- AI prompt (advisory only)
  system_prompt text not null,
  user_prompt_template text not null,

  -- Scoring weights (must sum to 100)
  weight_motif_match int not null default 30,
  weight_specialty_match int not null default 25,
  weight_availability int not null default 20,
  weight_profession_fit int not null default 15,
  weight_experience int not null default 10,

  -- Hard constraints
  require_availability_within_days int not null default 14,
  require_motif_overlap boolean not null default true,
  require_population_match boolean not null default true,

  -- Normalization bounds
  availability_max_hours int not null default 40,
  experience_max_years int not null default 20,

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint weights_sum_100 check (
    weight_motif_match + weight_specialty_match + weight_availability +
    weight_profession_fit + weight_experience = 100
  )
);

comment on table public.recommendation_configs is 'Configurable scoring rules and AI advisory prompts for recommendations';
comment on column public.recommendation_configs.key is 'Unique config key: default, high_urgency, legal_context';
comment on column public.recommendation_configs.system_prompt is 'AI system prompt for advisory text analysis only';
comment on column public.recommendation_configs.user_prompt_template is 'AI user prompt template with placeholders';
comment on column public.recommendation_configs.availability_max_hours is 'Cap hours at this value for scoring normalization';
comment on column public.recommendation_configs.experience_max_years is 'Cap years at this value for scoring normalization';

create trigger recommendation_configs_set_updated_at
  before update on public.recommendation_configs
  for each row
  execute function public.set_updated_at();

-- =============================================================================
-- DEMANDE_RECOMMENDATIONS TABLE
-- Stores recommendation results and audit metadata
-- =============================================================================

create table public.demande_recommendations (
  id uuid primary key default gen_random_uuid(),
  demande_id uuid not null references public.demandes(id) on delete cascade,
  config_id uuid references public.recommendation_configs(id) on delete set null,

  -- Input data (sanitized, no client PII)
  input_snapshot jsonb not null,

  -- Results
  recommendations jsonb not null,
  ai_summary_fr text,
  ai_extracted_preferences jsonb,
  exclusions jsonb,
  near_eligible jsonb,

  -- Metadata
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles(id) on delete set null,
  model_version text,
  processing_time_ms int,

  -- Validity tracking
  is_current boolean not null default true,
  superseded_at timestamptz,
  superseded_by uuid references public.demande_recommendations(id) on delete set null,

  created_at timestamptz not null default now()
);

comment on table public.demande_recommendations is 'Stored recommendation results per demande';
comment on column public.demande_recommendations.input_snapshot is 'Sanitized input: professional IDs, computed scores, motif keys (no raw client PII)';
comment on column public.demande_recommendations.recommendations is 'Array of {professional_id, rank, scores}';
comment on column public.demande_recommendations.ai_summary_fr is '2-3 sentence summary in French-Canadian';
comment on column public.demande_recommendations.ai_extracted_preferences is 'Structured preferences: {timing, modality, etc.}';
comment on column public.demande_recommendations.exclusions is 'Array of {professional_id, reason_code, reason_fr}';
comment on column public.demande_recommendations.near_eligible is 'Professionals who failed only 1 constraint';
comment on column public.demande_recommendations.is_current is 'TRUE for the active recommendation, FALSE when superseded';

create index demande_recommendations_demande_idx
  on public.demande_recommendations(demande_id);

create index demande_recommendations_generated_by_idx
  on public.demande_recommendations(generated_by)
  where generated_by is not null;

create index demande_recommendations_current_idx
  on public.demande_recommendations(demande_id, is_current)
  where is_current = true;

-- =============================================================================
-- RECOMMENDATION_PROFESSIONAL_DETAILS TABLE
-- Per-professional breakdown of deterministic scores + AI advisory notes
-- =============================================================================

create table public.recommendation_professional_details (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.demande_recommendations(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,

  rank int not null,
  total_score numeric(5,2) not null,

  motif_match_score numeric(5,2) not null,
  specialty_match_score numeric(5,2) not null,
  availability_score numeric(5,2) not null,
  profession_fit_score numeric(5,2) not null,
  experience_score numeric(5,2) not null,

  ai_ranking_adjustment numeric(3,2),
  ai_reasoning_bullets jsonb not null,

  matched_motifs jsonb not null,
  matched_specialties jsonb not null,
  available_slots_count int not null,
  next_available_slot timestamptz,

  created_at timestamptz not null default now(),

  unique(recommendation_id, professional_id)
);

comment on table public.recommendation_professional_details is 'Per-professional scoring breakdown for recommendations';
comment on column public.recommendation_professional_details.rank is 'Recommendation rank (1, 2, 3, etc.)';
comment on column public.recommendation_professional_details.total_score is 'Weighted total score 0-100';
comment on column public.recommendation_professional_details.ai_ranking_adjustment is 'AI advisory adjustment -5 to +5';
comment on column public.recommendation_professional_details.ai_reasoning_bullets is 'Array of 3-5 bullet points in FR-CA';
comment on column public.recommendation_professional_details.matched_motifs is 'Array of matched motif keys';
comment on column public.recommendation_professional_details.matched_specialties is 'Array of matched specialty codes';

create index recommendation_professional_details_recommendation_idx
  on public.recommendation_professional_details(recommendation_id);

create index recommendation_professional_details_professional_idx
  on public.recommendation_professional_details(professional_id);

-- =============================================================================
-- RECOMMENDATION_AUDIT_LOG TABLE
-- Audit trail for recommendation actions
-- =============================================================================

create table public.recommendation_audit_log (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.demande_recommendations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  context jsonb,
  created_at timestamptz not null default now()
);

comment on table public.recommendation_audit_log is 'Audit log for recommendation actions';
comment on column public.recommendation_audit_log.action is 'Action type: generated, viewed, used_for_assignment';

create index recommendation_audit_log_recommendation_idx
  on public.recommendation_audit_log(recommendation_id);

create index recommendation_audit_log_created_at_idx
  on public.recommendation_audit_log(created_at);
