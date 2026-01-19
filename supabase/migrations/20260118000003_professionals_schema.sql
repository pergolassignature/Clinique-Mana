-- Migration: professionals_schema
-- Module: professionals
-- Gate: 2 — Schema
-- Created: 2026-01-18

-- =============================================================================
-- PROFESSIONALS TABLE
-- Core professional data linked to profiles (providers)
-- =============================================================================

create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'invited', 'active', 'inactive')),

  -- Portrait (public-facing bio)
  portrait_bio text,
  portrait_approach text,

  -- Public contact info (optional, displayed on public profile)
  public_email text,
  public_phone text,

  -- Professional details
  license_number text,
  years_experience integer,

  -- Fiche generation
  fiche_generated_at timestamptz,
  fiche_version integer default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for common query patterns
create index professionals_profile_id_idx on public.professionals(profile_id);
create index professionals_status_idx on public.professionals(status);

-- Comments for documentation
comment on table public.professionals is 'Professional (provider) details linked to profiles';
comment on column public.professionals.profile_id is 'FK to profiles - one professional per provider profile';
comment on column public.professionals.status is 'Onboarding status: pending (invited not sent), invited, active, inactive';
comment on column public.professionals.portrait_bio is 'Public-facing biography paragraph';
comment on column public.professionals.portrait_approach is 'Description of therapeutic approach';

-- =============================================================================
-- SPECIALTIES LOOKUP TABLE
-- Master list of specialties that can be assigned to professionals
-- =============================================================================

create table public.specialties (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name_fr text not null,
  category text not null check (category in ('therapy_type', 'population', 'issue', 'modality')),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Index for filtering by category
create index specialties_category_idx on public.specialties(category);
create index specialties_is_active_idx on public.specialties(is_active);

comment on table public.specialties is 'Master list of specialties for professional matching';
comment on column public.specialties.category is 'Category: therapy_type, population, issue, modality';

-- =============================================================================
-- PROFESSIONAL_SPECIALTIES JUNCTION TABLE
-- Links professionals to their specialties
-- =============================================================================

create table public.professional_specialties (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  specialty_id uuid not null references public.specialties(id) on delete cascade,
  proficiency_level text check (proficiency_level in ('primary', 'secondary', 'familiar')),
  created_at timestamptz not null default now(),

  -- Ensure unique combination
  unique(professional_id, specialty_id)
);

-- Indexes for querying
create index professional_specialties_professional_id_idx on public.professional_specialties(professional_id);
create index professional_specialties_specialty_id_idx on public.professional_specialties(specialty_id);

comment on table public.professional_specialties is 'Junction table linking professionals to their specialties';
comment on column public.professional_specialties.proficiency_level is 'Expertise level: primary, secondary, familiar';

-- =============================================================================
-- PROFESSIONAL_DOCUMENTS TABLE
-- Documents uploaded by or for professionals
-- =============================================================================

create table public.professional_documents (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  document_type text not null check (document_type in ('cv', 'diploma', 'license', 'insurance', 'photo', 'fiche', 'other')),
  file_name text not null,
  file_path text not null,
  file_size integer,
  mime_type text,

  -- Verification status
  verified_at timestamptz,
  verified_by uuid references public.profiles(id),

  -- Expiry for licenses/insurance
  expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for querying
create index professional_documents_professional_id_idx on public.professional_documents(professional_id);
create index professional_documents_document_type_idx on public.professional_documents(document_type);
create index professional_documents_expires_at_idx on public.professional_documents(expires_at) where expires_at is not null;

comment on table public.professional_documents is 'Documents uploaded by or for professionals';
comment on column public.professional_documents.document_type is 'Type: cv, diploma, license, insurance, photo, fiche, other';
comment on column public.professional_documents.file_path is 'Storage path in Supabase storage bucket';

-- =============================================================================
-- PROFESSIONAL_ONBOARDING_INVITES TABLE
-- Invites sent to professionals to complete their profile
-- =============================================================================

create table public.professional_onboarding_invites (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  token text unique not null default encode(gen_random_bytes(32), 'hex'),
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'opened', 'completed', 'expired', 'revoked')),

  -- Tracking
  sent_at timestamptz,
  opened_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),

  -- Who sent the invite
  sent_by uuid references public.profiles(id),

  created_at timestamptz not null default now()
);

-- Indexes for querying
create index professional_onboarding_invites_professional_id_idx on public.professional_onboarding_invites(professional_id);
create index professional_onboarding_invites_token_idx on public.professional_onboarding_invites(token);
create index professional_onboarding_invites_status_idx on public.professional_onboarding_invites(status);
create index professional_onboarding_invites_expires_at_idx on public.professional_onboarding_invites(expires_at);

comment on table public.professional_onboarding_invites is 'Onboarding invites sent to professionals';
comment on column public.professional_onboarding_invites.token is 'Unique token for public invite URL';

-- =============================================================================
-- PROFESSIONAL_QUESTIONNAIRE_SUBMISSIONS TABLE
-- Questionnaire responses submitted by professionals during onboarding
-- =============================================================================

create table public.professional_questionnaire_submissions (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  invite_id uuid references public.professional_onboarding_invites(id),

  -- Questionnaire responses stored as JSONB for flexibility
  responses jsonb not null default '{}'::jsonb,

  -- Submission status
  status text not null default 'draft' check (status in ('draft', 'submitted', 'reviewed', 'approved')),

  -- Review tracking
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  review_notes text,

  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for querying
create index professional_questionnaire_submissions_professional_id_idx on public.professional_questionnaire_submissions(professional_id);
create index professional_questionnaire_submissions_status_idx on public.professional_questionnaire_submissions(status);

comment on table public.professional_questionnaire_submissions is 'Questionnaire responses from professionals';
comment on column public.professional_questionnaire_submissions.responses is 'JSONB containing questionnaire answers';

-- =============================================================================
-- PROFESSIONAL_AUDIT_LOG TABLE
-- Immutable log of changes to professional records
-- =============================================================================

create table public.professional_audit_log (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null default 'professional',
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

-- Indexes for querying audit history
create index professional_audit_log_professional_id_idx on public.professional_audit_log(professional_id);
create index professional_audit_log_created_at_idx on public.professional_audit_log(created_at);
create index professional_audit_log_action_idx on public.professional_audit_log(action);

comment on table public.professional_audit_log is 'Append-only audit log for professional changes';
comment on column public.professional_audit_log.actor_id is 'Who made the change (NULL for system/triggers)';
comment on column public.professional_audit_log.action is 'Action type: created, updated, status_changed, document_uploaded, specialty_added, etc.';
comment on column public.professional_audit_log.entity_type is 'Type of entity changed: professional, document, specialty, invite';

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- Automatically maintain updated_at on relevant tables
-- =============================================================================

create trigger professionals_set_updated_at
  before update on public.professionals
  for each row
  execute function public.set_updated_at();

create trigger professional_documents_set_updated_at
  before update on public.professional_documents
  for each row
  execute function public.set_updated_at();

create trigger professional_questionnaire_submissions_set_updated_at
  before update on public.professional_questionnaire_submissions
  for each row
  execute function public.set_updated_at();

-- =============================================================================
-- AUDIT TRIGGER FUNCTION FOR PROFESSIONALS
-- Automatically log changes to professionals table
-- =============================================================================

create or replace function public.audit_professional_changes()
returns trigger
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
begin
  -- Determine actor (current user's profile id, if exists)
  select id into v_actor_id
  from public.profiles
  where user_id = auth.uid();

  if tg_op = 'INSERT' then
    insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      new.id,
      v_actor_id,
      'created',
      'professional',
      new.id,
      null,
      jsonb_build_object(
        'status', new.status,
        'public_email', new.public_email,
        'public_phone', new.public_phone
      )
    );
    return new;

  elsif tg_op = 'UPDATE' then
    -- Log status changes
    if old.status is distinct from new.status then
      insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.id,
        v_actor_id,
        'status_changed',
        'professional',
        new.id,
        jsonb_build_object('status', old.status),
        jsonb_build_object('status', new.status)
      );
    end if;

    -- Log portrait changes
    if old.portrait_bio is distinct from new.portrait_bio or old.portrait_approach is distinct from new.portrait_approach then
      insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.id,
        v_actor_id,
        'portrait_updated',
        'professional',
        new.id,
        jsonb_build_object('portrait_bio', old.portrait_bio, 'portrait_approach', old.portrait_approach),
        jsonb_build_object('portrait_bio', new.portrait_bio, 'portrait_approach', new.portrait_approach)
      );
    end if;

    -- Log fiche generation
    if old.fiche_generated_at is distinct from new.fiche_generated_at then
      insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.id,
        v_actor_id,
        'fiche_generated',
        'professional',
        new.id,
        jsonb_build_object('fiche_version', old.fiche_version),
        jsonb_build_object('fiche_version', new.fiche_version, 'fiche_generated_at', new.fiche_generated_at)
      );
    end if;

    return new;

  elsif tg_op = 'DELETE' then
    insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      old.id,
      v_actor_id,
      'deleted',
      'professional',
      old.id,
      jsonb_build_object('status', old.status),
      null
    );
    return old;
  end if;

  return null;
end;
$$ language plpgsql;

create trigger professionals_audit_trigger
  after insert or update or delete on public.professionals
  for each row
  execute function public.audit_professional_changes();

-- =============================================================================
-- SEED DATA: INITIAL SPECIALTIES
-- Common therapy types, populations, issues, and modalities
-- =============================================================================

insert into public.specialties (code, name_fr, category, sort_order) values
  -- Therapy types
  ('cbt', 'Thérapie cognitivo-comportementale (TCC)', 'therapy_type', 1),
  ('psychodynamic', 'Thérapie psychodynamique', 'therapy_type', 2),
  ('humanistic', 'Approche humaniste', 'therapy_type', 3),
  ('systemic', 'Thérapie systémique', 'therapy_type', 4),
  ('gestalt', 'Gestalt-thérapie', 'therapy_type', 5),
  ('emdr', 'EMDR', 'therapy_type', 6),
  ('act', 'Thérapie d''acceptation et d''engagement (ACT)', 'therapy_type', 7),
  ('dbt', 'Thérapie comportementale dialectique (DBT)', 'therapy_type', 8),
  ('art_therapy', 'Art-thérapie', 'therapy_type', 9),
  ('play_therapy', 'Thérapie par le jeu', 'therapy_type', 10),

  -- Populations
  ('children', 'Enfants (0-12 ans)', 'population', 1),
  ('adolescents', 'Adolescents (13-17 ans)', 'population', 2),
  ('adults', 'Adultes', 'population', 3),
  ('seniors', 'Aînés (65+)', 'population', 4),
  ('couples', 'Couples', 'population', 5),
  ('families', 'Familles', 'population', 6),
  ('lgbtq', 'Communauté LGBTQ+', 'population', 7),
  ('indigenous', 'Communautés autochtones', 'population', 8),
  ('newcomers', 'Nouveaux arrivants', 'population', 9),

  -- Issues
  ('anxiety', 'Anxiété', 'issue', 1),
  ('depression', 'Dépression', 'issue', 2),
  ('trauma', 'Trauma et TSPT', 'issue', 3),
  ('grief', 'Deuil et perte', 'issue', 4),
  ('stress', 'Gestion du stress', 'issue', 5),
  ('burnout', 'Épuisement professionnel', 'issue', 6),
  ('self_esteem', 'Estime de soi', 'issue', 7),
  ('relationships', 'Difficultés relationnelles', 'issue', 8),
  ('anger', 'Gestion de la colère', 'issue', 9),
  ('addiction', 'Dépendances', 'issue', 10),
  ('eating_disorders', 'Troubles alimentaires', 'issue', 11),
  ('perinatal', 'Santé périnatale', 'issue', 12),

  -- Modalities
  ('in_person', 'En personne', 'modality', 1),
  ('video', 'Vidéoconférence', 'modality', 2),
  ('phone', 'Téléphone', 'modality', 3),
  ('group', 'Thérapie de groupe', 'modality', 4);
