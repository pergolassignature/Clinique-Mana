-- Migration: insurance_expiry_management
-- Module: professionals
-- Purpose: Automated insurance expiry detection and reactivation on valid insurance upload
-- Created: 2026-01-27

-- =============================================================================
-- PART 1: ADD DEACTIVATION_REASON COLUMN
-- Tracks why a professional was deactivated: manual (admin) or insurance_expired (cron)
-- =============================================================================

alter table public.professionals
add column if not exists deactivation_reason text
  check (deactivation_reason in ('manual', 'insurance_expired'));

comment on column public.professionals.deactivation_reason is
  'Raison de désactivation: manual (admin) ou insurance_expired (automatique). NULL si actif ou autre statut.';

create index if not exists professionals_deactivation_reason_idx
  on public.professionals(deactivation_reason)
  where deactivation_reason is not null;

-- =============================================================================
-- PART 2: HELPER FUNCTION - NEXT INSURANCE EXPIRY DATE
-- Calculates next March 31 (Quebec insurance renewal date)
-- =============================================================================

create or replace function public.next_insurance_expiry_date(from_date date default current_date)
returns date
language plpgsql
stable
as $$
declare
  year_to_use integer;
  march_31 date;
begin
  year_to_use := extract(year from from_date);
  march_31 := make_date(year_to_use, 3, 31);

  -- If we're past March 31 this year, use next year
  if from_date > march_31 then
    march_31 := make_date(year_to_use + 1, 3, 31);
  end if;

  return march_31;
end;
$$;

comment on function public.next_insurance_expiry_date is
  'Calcule la prochaine date d''expiration d''assurance (31 mars). Si la date est passée, retourne le 31 mars de l''année suivante.';

-- =============================================================================
-- PART 3: DEACTIVATION FUNCTION (FOR CRON JOB)
-- Finds active professionals with expired or missing verified insurance and deactivates them
-- CONSERVATIVE: Never overwrites deactivation_reason = 'manual'
-- =============================================================================

create or replace function public.deactivate_professionals_with_expired_insurance()
returns table (
  professional_id uuid,
  profile_display_name text,
  insurance_expires_at timestamptz,
  deactivated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with professionals_to_deactivate as (
    select
      p.id as professional_id,
      pr.display_name,
      -- Get latest verified insurance document
      (
        select pd.expires_at
        from public.professional_documents pd
        where pd.professional_id = p.id
          and pd.document_type = 'insurance'
          and pd.verified_at is not null
        order by pd.created_at desc
        limit 1
      ) as latest_insurance_expires_at
    from public.professionals p
    join public.profiles pr on pr.id = p.profile_id
    where p.status = 'active'
  ),
  deactivation_candidates as (
    select
      ptd.professional_id,
      ptd.display_name,
      ptd.latest_insurance_expires_at
    from professionals_to_deactivate ptd
    where
      -- No verified insurance at all
      ptd.latest_insurance_expires_at is null
      -- OR insurance is expired (expires_at is in the past)
      or ptd.latest_insurance_expires_at < now()
  )
  update public.professionals p
  set
    status = 'inactive',
    deactivation_reason = 'insurance_expired',
    updated_at = now()
  from deactivation_candidates dc
  where p.id = dc.professional_id
    -- CRITICAL: Never overwrite manual deactivations
    and (p.deactivation_reason is null or p.deactivation_reason != 'manual')
  returning
    p.id as professional_id,
    dc.display_name as profile_display_name,
    dc.latest_insurance_expires_at as insurance_expires_at,
    p.updated_at as deactivated_at;
end;
$$;

comment on function public.deactivate_professionals_with_expired_insurance is
  'Désactive les professionnels actifs dont l''assurance est expirée ou manquante. Ne touche jamais aux désactivations manuelles. Retourne les professionnels affectés pour journalisation.';

-- =============================================================================
-- PART 4: REACTIVATION TRIGGER
-- Automatically reactivates professionals when valid insurance is verified
-- CONSERVATIVE: Only reactivates if deactivation_reason = 'insurance_expired'
-- =============================================================================

create or replace function public.reactivate_professional_on_insurance_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_professional_status text;
  v_deactivation_reason text;
begin
  -- Only process insurance documents
  if new.document_type != 'insurance' then
    return new;
  end if;

  -- Only process when verified_at transitions from NULL to NOT NULL
  if old.verified_at is not null or new.verified_at is null then
    return new;
  end if;

  -- Check if expires_at is valid (must be set and in the future)
  if new.expires_at is null or new.expires_at <= now() then
    return new;
  end if;

  -- Get current professional status and deactivation reason
  select status, deactivation_reason
  into v_professional_status, v_deactivation_reason
  from public.professionals
  where id = new.professional_id;

  -- Only reactivate if:
  -- 1. Professional is currently inactive
  -- 2. Deactivation reason is EXACTLY 'insurance_expired'
  -- NEVER reactivate if deactivation_reason = 'manual' or NULL (legacy/unknown)
  if v_professional_status = 'inactive' and v_deactivation_reason = 'insurance_expired' then
    update public.professionals
    set
      status = 'active',
      deactivation_reason = null,
      updated_at = now()
    where id = new.professional_id;
  end if;

  return new;
end;
$$;

comment on function public.reactivate_professional_on_insurance_verification is
  'Trigger qui réactive automatiquement un professionnel quand une assurance valide est vérifiée. Ne réactive que si deactivation_reason = ''insurance_expired''. Ne touche jamais aux désactivations manuelles.';

-- Create trigger on professional_documents
drop trigger if exists professional_documents_insurance_reactivation_trigger on public.professional_documents;

create trigger professional_documents_insurance_reactivation_trigger
  after update on public.professional_documents
  for each row
  execute function public.reactivate_professional_on_insurance_verification();

-- =============================================================================
-- PART 5: UPDATE AUDIT TRIGGER
-- Include deactivation_reason in status change logs
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
        'deactivation_reason', new.deactivation_reason,
        'public_email', new.public_email,
        'public_phone', new.public_phone
      )
    );
    return new;

  elsif tg_op = 'UPDATE' then
    -- Log status changes (include deactivation_reason for context)
    if old.status is distinct from new.status then
      insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.id,
        v_actor_id,
        'status_changed',
        'professional',
        new.id,
        jsonb_build_object(
          'status', old.status,
          'deactivation_reason', old.deactivation_reason
        ),
        jsonb_build_object(
          'status', new.status,
          'deactivation_reason', new.deactivation_reason
        )
      );
    end if;

    -- Log deactivation_reason changes (even without status change)
    if old.deactivation_reason is distinct from new.deactivation_reason
       and old.status is not distinct from new.status then
      insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.id,
        v_actor_id,
        'deactivation_reason_changed',
        'professional',
        new.id,
        jsonb_build_object('deactivation_reason', old.deactivation_reason),
        jsonb_build_object('deactivation_reason', new.deactivation_reason)
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
      jsonb_build_object(
        'status', old.status,
        'deactivation_reason', old.deactivation_reason
      ),
      null
    );
    return old;
  end if;

  return null;
end;
$$ language plpgsql;

-- Note: The trigger already exists from 20260118000003_professionals_schema.sql
-- CREATE OR REPLACE FUNCTION updates it in place, no need to recreate trigger

-- =============================================================================
-- SUMMARY OF CONSERVATIVE BEHAVIORS
-- =============================================================================
--
-- 1. Verified insurance WITHOUT expires_at → considered expired (no expiry = invalid)
-- 2. deactivation_reason = 'manual' → NEVER auto-reactivated by this system
-- 3. deactivation_reason = NULL → NEVER auto-reactivated (legacy/unknown reason)
-- 4. New insurance WITHOUT expires_at → does NOT trigger reactivation
-- 5. New insurance WITH past expires_at → does NOT trigger reactivation
-- 6. Only insurance documents with verified_at NOT NULL are considered valid
-- 7. Only the latest verified insurance document is checked for expiry
--
-- =============================================================================
