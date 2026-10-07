-- Migration: professionals_audit_helpers
-- Module: professionals
-- Gate: 3 — Audit Logging (Cross-cutting)
-- Created: 2026-01-18

-- =============================================================================
-- AUDIT TRIGGER: PROFESSIONAL_DOCUMENTS
-- Logs document uploads, verifications, expiry changes
-- =============================================================================

create or replace function public.audit_professional_document_changes()
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
      new.professional_id,
      v_actor_id,
      'document_uploaded',
      'document',
      new.id,
      null,
      jsonb_build_object(
        'document_type', new.document_type,
        'file_name', new.file_name,
        'file_path', new.file_path,
        'expires_at', new.expires_at
      )
    );
    return new;

  elsif tg_op = 'UPDATE' then
    -- Log verification changes
    if old.verified_at is null and new.verified_at is not null then
      insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.professional_id,
        v_actor_id,
        'document_verified',
        'document',
        new.id,
        null,
        jsonb_build_object(
          'document_type', new.document_type,
          'file_name', new.file_name,
          'verified_at', new.verified_at,
          'verified_by', new.verified_by
        )
      );
    end if;

    -- Log unverification (reject)
    if old.verified_at is not null and new.verified_at is null then
      insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.professional_id,
        v_actor_id,
        'document_rejected',
        'document',
        new.id,
        jsonb_build_object(
          'verified_at', old.verified_at,
          'verified_by', old.verified_by
        ),
        null
      );
    end if;

    -- Log expiry date changes
    if old.expires_at is distinct from new.expires_at then
      insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.professional_id,
        v_actor_id,
        'document_expiry_updated',
        'document',
        new.id,
        jsonb_build_object('expires_at', old.expires_at),
        jsonb_build_object('expires_at', new.expires_at)
      );
    end if;

    return new;

  elsif tg_op = 'DELETE' then
    insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      old.professional_id,
      v_actor_id,
      'document_deleted',
      'document',
      old.id,
      jsonb_build_object(
        'document_type', old.document_type,
        'file_name', old.file_name,
        'file_path', old.file_path
      ),
      null
    );
    return old;
  end if;

  return null;
end;
$$ language plpgsql;

create trigger professional_documents_audit_trigger
  after insert or update or delete on public.professional_documents
  for each row
  execute function public.audit_professional_document_changes();

-- =============================================================================
-- AUDIT TRIGGER: PROFESSIONAL_ONBOARDING_INVITES
-- Logs invite creation, opens, completions, revocations
-- =============================================================================

create or replace function public.audit_professional_invite_changes()
returns trigger
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
begin
  -- Determine actor (current user's profile id, if exists)
  -- Note: For anon users (public invite page), actor_id will be null
  select id into v_actor_id
  from public.profiles
  where user_id = auth.uid();

  if tg_op = 'INSERT' then
    insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      new.professional_id,
      v_actor_id,
      'invite_created',
      'invite',
      new.id,
      null,
      jsonb_build_object(
        'email', new.email,
        'expires_at', new.expires_at,
        'sent_by', new.sent_by
      )
    );
    return new;

  elsif tg_op = 'UPDATE' then
    -- Log status transitions
    if old.status is distinct from new.status then
      insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.professional_id,
        v_actor_id,
        case new.status
          when 'opened' then 'invite_opened'
          when 'completed' then 'invite_completed'
          when 'expired' then 'invite_expired'
          when 'revoked' then 'invite_revoked'
          else 'invite_status_changed'
        end,
        'invite',
        new.id,
        jsonb_build_object('status', old.status),
        jsonb_build_object(
          'status', new.status,
          'opened_at', new.opened_at,
          'completed_at', new.completed_at
        )
      );
    end if;

    -- Log sent_at being set (email sent)
    if old.sent_at is null and new.sent_at is not null then
      insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.professional_id,
        v_actor_id,
        'invite_sent',
        'invite',
        new.id,
        null,
        jsonb_build_object(
          'email', new.email,
          'sent_at', new.sent_at
        )
      );
    end if;

    return new;

  elsif tg_op = 'DELETE' then
    insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      old.professional_id,
      v_actor_id,
      'invite_deleted',
      'invite',
      old.id,
      jsonb_build_object(
        'email', old.email,
        'status', old.status
      ),
      null
    );
    return old;
  end if;

  return null;
end;
$$ language plpgsql;

create trigger professional_onboarding_invites_audit_trigger
  after insert or update or delete on public.professional_onboarding_invites
  for each row
  execute function public.audit_professional_invite_changes();

-- =============================================================================
-- AUDIT TRIGGER: PROFESSIONAL_QUESTIONNAIRE_SUBMISSIONS
-- Logs submission events and review actions
-- =============================================================================

create or replace function public.audit_professional_questionnaire_changes()
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
      new.professional_id,
      v_actor_id,
      'questionnaire_started',
      'questionnaire',
      new.id,
      null,
      jsonb_build_object(
        'status', new.status,
        'invite_id', new.invite_id
      )
    );
    return new;

  elsif tg_op = 'UPDATE' then
    -- Log status transitions
    if old.status is distinct from new.status then
      insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.professional_id,
        v_actor_id,
        case new.status
          when 'submitted' then 'questionnaire_submitted'
          when 'reviewed' then 'questionnaire_reviewed'
          when 'approved' then 'questionnaire_approved'
          else 'questionnaire_status_changed'
        end,
        'questionnaire',
        new.id,
        jsonb_build_object('status', old.status),
        jsonb_build_object(
          'status', new.status,
          'submitted_at', new.submitted_at,
          'reviewed_at', new.reviewed_at,
          'reviewed_by', new.reviewed_by,
          'review_notes', new.review_notes
        )
      );
    end if;

    return new;
  end if;

  return null;
end;
$$ language plpgsql;

create trigger professional_questionnaire_submissions_audit_trigger
  after insert or update on public.professional_questionnaire_submissions
  for each row
  execute function public.audit_professional_questionnaire_changes();

-- =============================================================================
-- AUDIT TRIGGER: PROFESSIONAL_SPECIALTIES
-- Logs specialty additions and removals
-- =============================================================================

create or replace function public.audit_professional_specialty_changes()
returns trigger
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_specialty_name text;
begin
  -- Determine actor
  select id into v_actor_id
  from public.profiles
  where user_id = auth.uid();

  if tg_op = 'INSERT' then
    -- Get specialty name for context
    select name_fr into v_specialty_name
    from public.specialties
    where id = new.specialty_id;

    insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      new.professional_id,
      v_actor_id,
      'specialty_added',
      'specialty',
      new.id,
      null,
      jsonb_build_object(
        'specialty_id', new.specialty_id,
        'specialty_name', v_specialty_name,
        'proficiency_level', new.proficiency_level
      )
    );
    return new;

  elsif tg_op = 'DELETE' then
    -- Get specialty name for context
    select name_fr into v_specialty_name
    from public.specialties
    where id = old.specialty_id;

    insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      old.professional_id,
      v_actor_id,
      'specialty_removed',
      'specialty',
      old.id,
      jsonb_build_object(
        'specialty_id', old.specialty_id,
        'specialty_name', v_specialty_name,
        'proficiency_level', old.proficiency_level
      ),
      null
    );
    return old;
  end if;

  return null;
end;
$$ language plpgsql;

create trigger professional_specialties_audit_trigger
  after insert or delete on public.professional_specialties
  for each row
  execute function public.audit_professional_specialty_changes();

-- =============================================================================
-- HELPER FUNCTION: Log custom audit events
-- For use in application code when triggers aren't sufficient
-- =============================================================================

create or replace function public.log_professional_audit(
  p_professional_id uuid,
  p_action text,
  p_entity_type text default 'professional',
  p_entity_id uuid default null,
  p_old_value jsonb default null,
  p_new_value jsonb default null
)
returns uuid
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_audit_id uuid;
begin
  -- Determine actor
  select id into v_actor_id
  from public.profiles
  where user_id = auth.uid();

  insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (p_professional_id, v_actor_id, p_action, p_entity_type, coalesce(p_entity_id, p_professional_id), p_old_value, p_new_value)
  returning id into v_audit_id;

  return v_audit_id;
end;
$$ language plpgsql;

comment on function public.log_professional_audit is 'Manually log a professional audit event from application code';

-- Grant execute to authenticated users (RLS on audit_log table will still control what they can read)
grant execute on function public.log_professional_audit to authenticated;
