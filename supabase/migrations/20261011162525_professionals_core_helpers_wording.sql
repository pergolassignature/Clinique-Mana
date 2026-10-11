-- =============================================================================
-- Professionnels: core tables through core helpers, and plain words in the refusals
-- =============================================================================
-- Asked:   gap audit 2026-10-09 (docs/audit/2026-10-09-gap-audit.md, T1, T8, C4, C5)
-- Needs:   *_core_module_helpers.sql (set_stored_files_owner, format_date_short_fr), *_core_subject_latest_email.sql
--          (latest_subject_email); the latest definition of each function below (named in its comment)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * T1: the module no longer writes stored_files nor reads email_log itself here.
--   own_professional_document_files re-owns her documents' files with core's
--   set_stored_files_owner (same rows, same « only rows that differ »); the invitation reminder
--   asks core's latest_subject_email whether a reminder left since the link was made (the same
--   test as the old email_log read). run_professionals_document_notices_for_service,
--   submit_my_submission and the consent trigger (professional_image_consent_signed) are left to
--   the Professionnels features batch that redefines them now (they move to
--   last_subject_emails, expire_notifications_for_subjects, extend_stored_files_retention and
--   set_stored_files_owner then).
-- * T8: « … compte au plus N caractères » becomes « … ne peut pas dépasser N caractères ».
-- * C4 (decisions C-1, C-2): what a reviewer reviews is the professional's profil; « questionnaire »
--   is only the form she fills; « soumission » is never shown. « Soumission introuvable. » becomes
--   « Ce profil envoyé n'existe plus. » (review) or « Cette demande de mise à jour n'existe plus. »
--   (closing an update), « Cette soumission n'attend pas de révision. » « Ce profil n'attend pas de
--   révision. », « Une soumission est déjà en cours. » « Un questionnaire est déjà en cours ou attend
--   une révision. ». An insurance « expire » (P4-511), never « échue »: the refusals, and the labels,
--   subject and description of the insurance email defaults.
-- * C5 (decision C-3): dates in refusals in French, never ISO. The start of a rate, a grid or an
--   agreement and the compensation bounds are short (« 1 nov. 2026 », format_date_short_fr); an
--   insurance's last allowed day is long (« 31 décembre 2100 »), as every document deadline.
-- * Each function is its latest definition with only those texts changed: same signature, same
--   privileges (create or replace keeps the grants).
-- * Email defaults: « Réviser le dossier » becomes « Réviser le profil » on
--   professionals.submission_received, and the insurance defaults lose « échue », each only where
--   the stored default still holds the old text. A clinic's own copy (email_templates) is its
--   text: left as it is. The permission professionals.review's description loses « soumissions ».
--   Idempotent.
-- * French spacing (U+202F before « : ? ! ; ») is applied by the app at display, not here.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_core_helpers_wording', true);

-- -----------------------------------------------------------------------------
-- T1: core helpers instead of core tables
-- -----------------------------------------------------------------------------
-- *_professionals_documents_owner_on_link.sql's helper: every stored file of the documents of
-- p_pid (null: of every professional with an account) owned by the professional's account with
-- professionals.self, through core's set_stored_files_owner (only rows that differ are written).
create or replace function private.own_professional_document_files(p_pid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select p.org_id, p.profile_id, pg_catalog.array_agg(d.stored_file_id) as file_ids
      from public.professional_documents d
      join public.professionals p on p.org_id = d.org_id and p.id = d.professional_id
      join public.profiles pr on pr.user_id = p.profile_id and pr.org_id = p.org_id
     where (p_pid is null or d.professional_id = p_pid)
       and p.profile_id is not null
     group by p.org_id, p.profile_id
  loop
    perform private.set_stored_files_owner(r.org_id, r.file_ids, r.profile_id, 'professionals.self');
  end loop;
end;
$$;

-- *_professionals_invitation_delivery.sql's rule, the sent reminder read through core's
-- latest_subject_email (any status: a reminder that failed is not sent again, as before).
create or replace function private.professional_invitations_due_for_reminder(p_org uuid, p_id uuid, p_limit int)
returns table (professional_id uuid, link_id uuid, created_by uuid)
language sql
stable
set search_path = ''
as $$
  with d as (
    select (private.professionals_setting(p_org, 'invitation_reminder_after_days') #>> '{}')::int as days
  )
  select p.id, l.id, l.created_by
    from d
    join public.professionals p on p.org_id = p_org and (p_id is null or p.id = p_id)
    join public.secure_links l
      on l.org_id = p_org and l.purpose = 'professional_invite' and l.subject_type = 'professional'
     and l.subject_id = p.id and l.revoked_at is null and l.use_count < l.max_uses
   where d.days is not null
     and p.profile_id is null and p.status <> 'inactive'
     and l.expires_at > pg_catalog.now()
     and l.last_opened_at is null
     and l.created_at <= pg_catalog.now() - pg_catalog.make_interval(days => d.days)
     and not exists (select 1 from private.latest_subject_email(p_org, 'professional', p.id,
                                                                 array['professionals.invite_reminder'], l.created_at))
     -- P4-493: the link handed over by hand stays the one that works.
     and not exists (select 1 from public.professional_invitation_deliveries x
                      where x.link_id = l.id and x.method = 'copied')
     and exists (select 1 from public.profiles pr
                  where pr.user_id = l.created_by and pr.org_id = p_org and pr.status = 'active')
     and 'professionals.invite' = any (private.permission_keys_for(l.created_by))
   order by l.created_at, l.id
   limit greatest(least(coalesce(p_limit, 100), 500), 1)
$$;

-- -----------------------------------------------------------------------------
-- T8, C4, C5: the refusals
-- -----------------------------------------------------------------------------
-- public.activate_professional: its latest definition, only the message changed: La raison ne peut pas dépasser 500 caractères (T8).
create or replace function public.activate_professional(p_id uuid, p_override_reason text default null)
returns table (status text, account_change text, profile_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_row public.professionals;
  v_ready boolean;
  v_reason text := nullif(pg_catalog.btrim(p_override_reason, E' \t\r\n'), '');
  v_change text;
begin
  if not private.has_permission('professionals.manage') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  v_row := private.lock_professional_with_account(p_id);
  if v_row.status = 'active' then
    raise exception 'Ce dossier est déjà actif.' using errcode = 'P0001', hint = 'status';
  end if;

  select r.ready into v_ready from public.professionals_readiness r where r.professional_id = p_id;
  if coalesce(v_ready, false) then
    v_reason := null;                       -- a complete file needs no override
  else
    if not private.has_permission('professionals.activate_override') then
      raise exception 'Le dossier n''est pas complet. Seule l''administration peut activer un dossier incomplet.'
        using errcode = 'P0001', hint = 'readiness';
    end if;
    if v_reason is null or pg_catalog.char_length(v_reason) < 5 then
      raise exception 'Indiquez la raison (au moins 5 caractères).' using errcode = 'P0001', hint = 'reason';
    end if;
    if pg_catalog.char_length(v_reason) > 500 then
      raise exception 'La raison ne peut pas dépasser 500 caractères.' using errcode = 'P0001', hint = 'reason';
    end if;
  end if;

  update public.professionals p
     set status = 'active', deactivation_reason_id = null, deactivation_note = null,
         activation_override_reason = v_reason, deactivation_disabled_account = false,
         status_changed_at = pg_catalog.now(), status_changed_by = auth.uid()
   where p.id = p_id;

  -- Re-enable the account only if this module's deactivation disabled it (P4-11).
  if v_row.deactivation_disabled_account and private.set_provider_account_status(v_row.profile_id, v_org, 'active') then
    v_change := 'enabled';
  end if;
  return query select 'active'::text, v_change, case when v_change is not null then v_row.profile_id end;
end;
$$;

-- public.deactivate_professional: its latest definition, only the message changed: La note ne peut pas dépasser 500 caractères (T8).
create or replace function public.deactivate_professional(p_id uuid, p_reason_id uuid, p_note text default null)
returns table (status text, account_change text, profile_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_row public.professionals;
  v_reason public.deactivation_reasons;
  v_note text := nullif(pg_catalog.btrim(p_note, E' \t\r\n'), '');
  v_change text;
begin
  if not private.has_permission('professionals.manage') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  v_row := private.lock_professional_with_account(p_id);
  if v_row.status = 'inactive' then
    raise exception 'Ce dossier est déjà inactif.' using errcode = 'P0001', hint = 'status';
  end if;

  select * into v_reason from public.deactivation_reasons r
   where r.org_id = v_org and r.id = p_reason_id and r.is_active;
  if not found then
    raise exception 'Raison introuvable.' using errcode = 'P0001', hint = 'reason';
  end if;
  if v_reason.requires_note and v_note is null then
    raise exception 'Précisez la raison.' using errcode = 'P0001', hint = 'note';
  end if;
  if pg_catalog.char_length(v_note) > 500 then
    raise exception 'La note ne peut pas dépasser 500 caractères.' using errcode = 'P0001', hint = 'note';
  end if;

  -- « Fin de collaboration »: the login goes too (P4-11), unless it is already disabled (then it
  -- is not this module's doing, and reactivation must leave it alone).
  if v_reason.disables_account and private.set_provider_account_status(v_row.profile_id, v_org, 'disabled') then
    v_change := 'disabled';
  end if;

  update public.professionals p
     set status = 'inactive', deactivation_reason_id = p_reason_id, deactivation_note = v_note,
         activation_override_reason = null, deactivation_disabled_account = (v_change is not null),
         status_changed_at = pg_catalog.now(), status_changed_by = auth.uid()
   where p.id = p_id;

  -- An open invitation link stops working (the dialog says so, 4b.3), and the open submission is
  -- closed with its private answers deleted (Loi 25, P4-301).
  perform private.revoke_secure_links(v_org, 'professional_invite', 'professional', p_id, auth.uid());
  perform private.cancel_open_submission(v_org, p_id);

  return query select 'inactive'::text, v_change, case when v_change is not null then v_row.profile_id end;
end;
$$;

-- public.reject_professional_submission: its latest definition, only the message changed: la note (T8) et le profil envoyé, jamais « soumission » (C4).
create or replace function public.reject_professional_submission(p_submission_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_note text := nullif(pg_catalog.btrim(p_note, E' \t\r\n'), '');
  v_pid uuid;
  v_sub public.professional_submissions;
  v_row public.professionals;
begin
  if not private.has_permission('professionals.review') then
    raise exception 'Permission refusée : professionals.review' using errcode = '42501';
  end if;
  if v_note is null then
    raise exception 'Indiquez ce que le professionnel doit corriger.' using errcode = 'P0001', hint = 'note';
  end if;
  if pg_catalog.char_length(v_note) > 1000 then
    raise exception 'La note ne peut pas dépasser 1000 caractères.' using errcode = 'P0001', hint = 'note';
  end if;

  select s.professional_id into v_pid from public.professional_submissions s
   where s.id = p_submission_id and s.org_id = v_org;
  if not found then
    raise exception 'Ce profil envoyé n''existe plus.' using errcode = 'P0001';
  end if;
  v_row := private.lock_active_professional(v_pid, false);
  if v_row.profile_id = auth.uid() then
    raise exception 'Vous ne pouvez pas réviser votre propre profil.' using errcode = 'P0001', hint = 'submission';
  end if;
  select * into v_sub from public.professional_submissions s
   where s.id = p_submission_id and s.org_id = v_org and s.professional_id = v_pid
     for update;
  if v_sub.status <> 'submitted' then
    raise exception 'Ce profil n''attend pas de révision.' using errcode = 'P0001', hint = 'status';
  end if;

  update public.professional_submissions s
     set status = 'draft', decision_note = v_note, reviewed_at = pg_catalog.now(), reviewed_by = auth.uid()
   where s.id = v_sub.id and s.org_id = v_org;
  if v_sub.kind = 'onboarding' then
    update public.professionals p
       set status = 'invited', status_changed_at = pg_catalog.now(), status_changed_by = auth.uid()
     where p.id = v_pid and p.org_id = v_org and p.status = 'in_review';
  end if;
end;
$$;

-- public.set_professional_matching_note: its latest definition, only the message changed: La note ne peut pas dépasser 1000 caractères (T8).
create or replace function public.set_professional_matching_note(p_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_note text := nullif(pg_catalog.btrim(p_note, E' \t\r\n'), '');
  v_row public.professional_matching_notes;
  v_changed boolean;
begin
  if not private.has_permission('professionals.matching') then
    raise exception 'Permission refusée : professionals.matching' using errcode = '42501';
  end if;
  if pg_catalog.char_length(v_note) > 1000 then
    raise exception 'La note ne peut pas dépasser 1000 caractères.' using errcode = 'P0001', hint = 'note';
  end if;
  perform private.lock_professional(p_id);

  if v_note is null then
    delete from public.professional_matching_notes n where n.professional_id = p_id and n.org_id = v_org;
    v_changed := found;
  else
    insert into public.professional_matching_notes as n (org_id, professional_id, note)
    values (v_org, p_id, v_note)
    on conflict on constraint professional_matching_notes_pkey do update
      set note = excluded.note
    where n.note <> excluded.note;
    v_changed := found;
  end if;
  if v_changed then
    update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id;
  end if;

  select * into v_row from public.professional_matching_notes n where n.professional_id = p_id and n.org_id = v_org;
  if not found then
    return null;
  end if;
  return pg_catalog.jsonb_build_object('note', v_row.note, 'updated_at', v_row.updated_at);
end;
$$;

-- public.reject_professional_document: its latest definition, only the message changed: La raison ne peut pas dépasser 1000 caractères (T8).
create or replace function public.reject_professional_document(p_doc_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_reason text := nullif(pg_catalog.btrim(p_reason, E' \t\r\n'), '');
  v_doc public.professional_documents;
begin
  if not private.has_permission('professionals.documents.review') then
    raise exception 'Permission refusée : professionals.documents.review' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Indiquez pourquoi le document est refusé.' using errcode = 'P0001', hint = 'reason';
  end if;
  if pg_catalog.char_length(v_reason) > 1000 then
    raise exception 'La raison ne peut pas dépasser 1000 caractères.' using errcode = 'P0001', hint = 'reason';
  end if;
  v_doc := private.lock_professional_document(p_doc_id);
  perform private.assert_not_own_document(v_doc.professional_id);
  if v_doc.signature_request_id is not null then
    raise exception 'Ce consentement a été signé électroniquement : il ne peut pas être refusé. Supprimez-le, ou envoyez un nouveau consentement à signer.'
      using errcode = 'P0001', hint = 'status';
  end if;
  if v_doc.status not in ('pending', 'verified') then
    raise exception 'Ce document ne peut plus être refusé.' using errcode = 'P0001', hint = 'status';
  end if;

  update public.professional_documents d
     set status = 'rejected', rejection_reason = v_reason, reviewed_by = auth.uid(), reviewed_at = pg_catalog.now()
   where d.professional_id = v_doc.professional_id and d.id = v_doc.id;
  perform private.soft_delete_stored_file(v_doc.stored_file_id, auth.uid());

  perform private.expire_notifications(v_org, 'professional_document', v_doc.id, array['professionals.document_to_review']);
  perform private.after_professional_documents_change(v_org, v_doc.professional_id);
end;
$$;

-- private.create_professional_invitation: its latest definition, only the message changed: un questionnaire en cours, jamais « soumission » (C4).
create or replace function private.create_professional_invitation(
  p_actor uuid, p_id uuid, p_token_hash bytea, p_method text, p_source text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_keys text[];
  v_row public.professionals;
  v_link uuid;
  v_sub uuid;
  v_expires timestamptz;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_actor is null or p_id is null or p_token_hash is null or pg_catalog.length(p_token_hash) <> 32 then
    raise exception 'Arguments invalides : acteur, professionnel et empreinte de 32 octets attendus.' using errcode = '22023';
  end if;
  -- The actor's org unlocked, the professional's lock, then the actor's permissions: a change
  -- committed while this waited for the lock is seen (lock before checks, as Task 3.18).
  select p.org_id into v_org from public.profiles p where p.user_id = p_actor;
  select * into v_row from public.professionals p where p.id = p_id and p.org_id = v_org for no key update;
  v_keys := private.permission_keys_for(p_actor);
  if not ('professionals.invite' = any (v_keys))
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = v_org and p.status = 'active') then
    raise exception 'Permission refusée : professionals.invite' using errcode = '42501';
  end if;
  if v_row.id is null then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;
  if v_row.profile_id is not null then
    raise exception 'Ce professionnel a déjà un compte.' using errcode = 'P0001', hint = 'account';
  end if;
  if v_row.status = 'inactive' then
    raise exception 'Un dossier inactif ne peut pas recevoir d''invitation.' using errcode = 'P0001', hint = 'status';
  end if;

  perform pg_catalog.set_config('app.audit_source', p_source, true);
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);

  v_link := private.issue_professional_invitation_link(v_org, p_id, p_token_hash, p_actor);
  insert into public.professional_invitation_deliveries (org_id, professional_id, link_id, method, created_by)
  values (v_org, p_id, v_link, p_method, p_actor);
  if v_row.status = 'draft' then
    update public.professionals p
       set status = 'invited', status_changed_at = pg_catalog.now(), status_changed_by = p_actor
     where p.id = p_id and p.org_id = v_org;
  end if;

  select s.id into v_sub from public.professional_submissions s
   where s.professional_id = p_id and s.org_id = v_org and s.kind = 'onboarding' and s.status = 'draft'
     for update;
  if found then
    update public.professional_submissions s set secure_link_id = v_link where s.id = v_sub;
  elsif exists (select 1 from public.professional_submissions s
                 where s.professional_id = p_id and s.org_id = v_org and s.status in ('draft', 'submitted')) then
    -- An account-less file cannot hold another open submission; refuse rather than guess.
    raise exception 'Un questionnaire est déjà en cours ou attend une révision.' using errcode = 'P0001', hint = 'submission';
  else
    v_sub := private.create_professional_submission(v_org, p_id, 'onboarding', private.submission_sections(), v_link, p_actor);
  end if;

  select l.expires_at into v_expires from public.secure_links l where l.id = v_link;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return pg_catalog.jsonb_build_object('link_id', v_link, 'submission_id', v_sub, 'email', v_row.email,
                                       'first_name', v_row.first_name, 'expires_at', v_expires);
end;
$$;

-- public.request_professional_update: its latest definition, only the message changed: un questionnaire en cours, jamais « soumission » (C4).
create or replace function public.request_professional_update(p_id uuid, p_sections text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_sections text[];
  v_row public.professionals;
  v_sub uuid;
begin
  if not private.has_permission('professionals.invite') then
    raise exception 'Permission refusée : professionals.invite' using errcode = '42501';
  end if;
  v_sections := private.normalize_submission_sections(p_sections);
  v_row := private.lock_active_professional(p_id, false);
  if v_row.profile_id is null then
    raise exception 'Ce professionnel n''a pas encore de compte.' using errcode = 'P0001', hint = 'account';
  end if;
  if exists (select 1 from public.professional_submissions s
              where s.professional_id = p_id and s.org_id = v_org and s.status in ('draft', 'submitted')) then
    raise exception 'Un questionnaire est déjà en cours ou attend une révision.' using errcode = 'P0001', hint = 'submission';
  end if;
  v_sub := private.create_professional_submission(v_org, p_id, 'update', v_sections, null, auth.uid());
  return pg_catalog.jsonb_build_object('submission_id', v_sub, 'email', v_row.email, 'first_name', v_row.first_name);
end;
$$;

-- public.start_my_profile_update: its latest definition, only the message changed: un questionnaire en cours, jamais « soumission » (C4).
create or replace function public.start_my_profile_update(p_sections text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_sections text[];
  v_pid uuid;
begin
  v_pid := private.my_professional_id();
  v_sections := private.normalize_submission_sections(p_sections);
  perform private.lock_active_professional(v_pid, true);
  if exists (select 1 from public.professional_submissions s
              where s.professional_id = v_pid and s.org_id = v_org and s.status in ('draft', 'submitted')) then
    raise exception 'Un questionnaire est déjà en cours ou attend une révision.' using errcode = 'P0001', hint = 'submission';
  end if;
  return private.create_professional_submission(v_org, v_pid, 'update', v_sections, null, auth.uid());
end;
$$;

-- public.cancel_professional_submission: its latest definition, only the message changed: la demande de mise à jour, jamais « soumission » (C4).
create or replace function public.cancel_professional_submission(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pid uuid;
  v_sub public.professional_submissions;
begin
  if not private.has_permission('professionals.invite') then
    raise exception 'Permission refusée : professionals.invite' using errcode = '42501';
  end if;
  select s.professional_id into v_pid from public.professional_submissions s
   where s.id = p_submission_id and s.org_id = v_org;
  if not found then
    raise exception 'Cette demande de mise à jour n''existe plus.' using errcode = 'P0001';
  end if;
  perform private.lock_professional(v_pid);
  select * into v_sub from public.professional_submissions s
   where s.id = p_submission_id and s.org_id = v_org and s.professional_id = v_pid
     for update;
  if v_sub.kind <> 'update' then
    raise exception 'Le questionnaire d''accueil ne se ferme pas : révoquez l''invitation ou renvoyez le profil au professionnel.'
      using errcode = 'P0001', hint = 'kind';
  end if;
  if v_sub.status not in ('draft', 'submitted') then
    raise exception 'Cette mise à jour est déjà fermée ou appliquée.' using errcode = 'P0001', hint = 'status';
  end if;
  perform private.cancel_open_submission(v_org, v_pid);
end;
$$;

-- public.apply_professional_submission: its latest definition, only the message changed: le profil envoyé, jamais « soumission », l'assurance « a expiré » (C4).
create or replace function public.apply_professional_submission(p_submission_id uuid, p_fields text[] default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pid uuid;
  v_sub public.professional_submissions;
  v_row public.professionals;
  v_available text[];
  v_fields text[];
  v_values jsonb;
  v_items record;
  v_ids uuid[];
  v_flags boolean[];
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  if not private.has_permission('professionals.review') then
    raise exception 'Permission refusée : professionals.review' using errcode = '42501';
  end if;
  if p_fields is not null and (pg_catalog.cardinality(p_fields) > 50
     or exists (select 1 from pg_catalog.unnest(p_fields) x
                 where x is null or not exists (select 1 from private.submission_fields() f where f.field = x))) then
    raise exception 'Champ inconnu.' using errcode = '22023';
  end if;

  -- The professional first, then its submission (the module's lock order).
  select s.professional_id into v_pid from public.professional_submissions s
   where s.id = p_submission_id and s.org_id = v_org;
  if not found then
    raise exception 'Ce profil envoyé n''existe plus.' using errcode = 'P0001';
  end if;
  v_row := private.lock_active_professional(v_pid, false);
  if v_row.profile_id = auth.uid() then
    raise exception 'Vous ne pouvez pas réviser votre propre profil.' using errcode = 'P0001', hint = 'submission';
  end if;
  select * into v_sub from public.professional_submissions s
   where s.id = p_submission_id and s.org_id = v_org and s.professional_id = v_pid
     for update;
  if v_sub.status <> 'submitted' then
    raise exception 'Ce profil n''attend pas de révision.' using errcode = 'P0001', hint = 'status';
  end if;

  if 'sin' = any (coalesce(p_fields, '{}'))
     and not coalesce((private.professionals_setting(v_org, 'collect_sin'))::boolean, false) then
    raise exception 'La collecte du NAS n''est pas activée.' using errcode = 'P0001', hint = 'sin';
  end if;
  v_available := private.submission_available_fields(v_sub);
  if p_fields is not null and not (p_fields <@ v_available) then
    raise exception 'Champ non soumis.' using errcode = '22023';
  end if;
  v_fields := coalesce((select pg_catalog.array_agg(f.field order by f.ord)
                          from private.submission_fields() f
                         where f.field = any (coalesce(p_fields, v_available))), '{}');
  v_values := v_sub.submitted_values;

  -- What may have changed since the provider sent it (P4-305).
  if 'insurance' = any (v_fields) and (v_values #>> '{insurance,expires_on}')::date < private.clinic_today() then
    raise exception 'Cette assurance a expiré depuis l''envoi du profil.'
      using errcode = 'P0001', hint = 'Renvoyez le profil au professionnel : il joindra une preuve en vigueur.';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:apply_professional_submission', true);

  -- Plain fields (values normalised when saved; the tables' checks are a backstop).
  if v_fields && array['personal_phone', 'address_line1', 'address_line2', 'city', 'province', 'postal_code', 'years_experience'] then
    update public.professionals p
       set personal_phone = case when 'personal_phone' = any (v_fields) then v_values #>> '{personal,personal_phone}' else p.personal_phone end,
           address_line1 = case when 'address_line1' = any (v_fields) then v_values #>> '{personal,address_line1}' else p.address_line1 end,
           address_line2 = case when 'address_line2' = any (v_fields) then v_values #>> '{personal,address_line2}' else p.address_line2 end,
           city = case when 'city' = any (v_fields) then v_values #>> '{personal,city}' else p.city end,
           province = case when 'province' = any (v_fields) then coalesce(v_values #>> '{personal,province}', p.province) else p.province end,
           postal_code = case when 'postal_code' = any (v_fields) then v_values #>> '{personal,postal_code}' else p.postal_code end,
           years_experience = case when 'years_experience' = any (v_fields)
                                   then (v_values #>> '{professional,years_experience}')::smallint else p.years_experience end
     where p.id = v_pid and p.org_id = v_org;
  end if;
  if v_fields && array['bio', 'approach', 'public_email', 'public_phone'] then
    update public.professional_public_profiles x
       set bio = case when 'bio' = any (v_fields) then v_values #>> '{portrait,bio}' else x.bio end,
           approach = case when 'approach' = any (v_fields) then v_values #>> '{portrait,approach}' else x.approach end,
           public_email = case when 'public_email' = any (v_fields) then v_values #>> '{portrait,public_email}' else x.public_email end,
           public_phone = case when 'public_phone' = any (v_fields) then v_values #>> '{portrait,public_phone}' else x.public_phone end
     where x.professional_id = v_pid and x.org_id = v_org;
  end if;
  if v_fields && array['min_client_age', 'women_only', 'accepting_new_clients', 'availability_periods', 'availability_note'] then
    update public.professional_matching_profiles x
       set min_client_age = case when 'min_client_age' = any (v_fields)
                                 then (v_values #>> '{clienteles,min_client_age}')::smallint else x.min_client_age end,
           women_only = case when 'women_only' = any (v_fields)
                             then coalesce((v_values #>> '{clienteles,women_only}')::boolean, x.women_only)
                             else x.women_only end,
           accepting_new_clients = case when 'accepting_new_clients' = any (v_fields)
                                        then coalesce((v_values #>> '{availability,accepting_new_clients}')::boolean, x.accepting_new_clients)
                                        else x.accepting_new_clients end,
           availability_periods = case when 'availability_periods' = any (v_fields)
                                       then array(select pg_catalog.jsonb_array_elements_text(coalesce(v_values #> '{availability,availability_periods}', '[]')))
                                       else x.availability_periods end,
           availability_note = case when 'availability_note' = any (v_fields) then v_values #>> '{availability,availability_note}' else x.availability_note end
     where x.professional_id = v_pid and x.org_id = v_org;
  end if;

  -- Sets, through the staff write paths.
  if 'professions' = any (v_fields) then
    select * into v_items from private.parse_profession_items(coalesce(v_values #> '{professional,professions}', '[]'));
    perform private.apply_professional_professions(v_org, v_pid, v_items.titles, v_items.licences, v_items.primary_flags, false);
  end if;
  if 'language_ids' = any (v_fields) then
    perform private.apply_professional_languages(v_org, v_pid, private.submission_uuid_array(v_values #> '{languages,language_ids}', 'language_ids'));
  end if;
  if 'clienteles' = any (v_fields) then
    select x.ids, x.flags into v_ids, v_flags from private.parse_specialized_items(coalesce(v_values #> '{clienteles,clienteles}', '[]')) x;
    perform private.apply_professional_clienteles(v_org, v_pid, v_ids, v_flags);
  end if;
  if 'motif_ids' = any (v_fields) then
    perform private.apply_professional_motifs(v_org, v_pid, private.submission_uuid_array(v_values #> '{motifs,motif_ids}', 'motif_ids'), false);
  end if;
  if v_fields && array['professions', 'motif_ids'] then
    perform private.assert_restricted_motifs_ok(v_org, v_pid);
  end if;

  -- Staged files: attached to the professional (retain_until cleared), readable by the record's
  -- readers and by the provider (owner branch). attach_stored_file re-checks purpose and uploader.
  if 'photo' = any (v_fields) then
    perform private.attach_stored_file((v_values #>> '{photo,file_id}')::uuid, array['professional_submission_file'],
      'professional', v_pid, 'professionals.view', v_row.profile_id,
      case when v_row.profile_id is not null then 'professionals.self' end, v_row.profile_id);
  end if;
  if 'insurance' = any (v_fields) then
    perform private.attach_stored_file((v_values #>> '{insurance,file_id}')::uuid, array['professional_submission_file'],
      'professional', v_pid, 'professionals.view', v_row.profile_id,
      case when v_row.profile_id is not null then 'professionals.self' end, v_row.profile_id);
  end if;


  perform private.apply_submission_private(v_org, v_pid, v_sub.id, v_fields);

  update public.professional_submissions s
     set status = 'approved', reviewed_at = pg_catalog.now(), reviewed_by = auth.uid(), applied_fields = v_fields
   where s.id = v_sub.id and s.org_id = v_org;
  -- Loi 25: no second copy of a SIN or an account once the review is done.
  delete from public.professional_submission_private sp where sp.submission_id = v_sub.id and sp.org_id = v_org;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

-- private.normalize_submission_section: its latest definition, only the message changed: l'assurance « déjà expirée » (C4) et la date limite en français (C5).
create or replace function private.normalize_submission_section(p_section text, p_values jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_keys text[];
  v jsonb := p_values;
  v_out jsonb;
  v_text text;
  v_num numeric;
  v_items record;
  v_ids uuid[];
  v_flags boolean[];
  v_file uuid;
  v_date date;
begin
  if p_values is null or pg_catalog.jsonb_typeof(p_values) <> 'object' then
    raise exception 'Valeurs invalides : objet JSON attendu.' using errcode = '22023';
  end if;
  v_keys := case p_section
    when 'photo' then array['file_id']
    when 'insurance' then array['file_id', 'expires_on']
    else array(select f.field from private.submission_fields() f where f.section = p_section and f.kind in ('plain', 'set'))
  end;
  if p_section in ('tax_bank', 'consent') or pg_catalog.cardinality(v_keys) = 0 then
    raise exception 'Section invalide pour cet enregistrement.' using errcode = '22023';
  end if;
  -- Unknown keys (private ones included: a SIN or an account never enters the draft, P4-38).
  if exists (select 1 from pg_catalog.jsonb_object_keys(v) k where not (k = any (v_keys))) then
    raise exception 'Champ inconnu pour cette section.' using errcode = '22023';
  end if;

  case p_section
  when 'personal' then
    v_text := pg_catalog.upper(pg_catalog.regexp_replace(coalesce(private.submission_string(v, 'postal_code'), ''), '\s', '', 'g'));
    if v_text <> '' and v_text !~ '^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$' then
      raise exception 'Code postal invalide : format A1A 1A1 attendu.' using errcode = 'P0001', hint = 'postal_code';
    end if;
    v_out := pg_catalog.jsonb_build_object(
      'personal_phone', case when nullif(pg_catalog.btrim(private.submission_string(v, 'personal_phone')), '') is not null
                             then private.submission_phone(private.submission_string(v, 'personal_phone'), 'personal_phone') end,
      'address_line1', private.submission_label(private.submission_string(v, 'address_line1'), 'L''adresse', 200, 'address_line1'),
      'address_line2', private.submission_label(private.submission_string(v, 'address_line2'), 'Le complément d''adresse', 200, 'address_line2'),
      'city', private.submission_label(private.submission_string(v, 'city'), 'La ville', 100, 'city'),
      'province', nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(private.submission_string(v, 'province'), ''))), ''),
      'postal_code', case when v_text <> '' then pg_catalog.left(v_text, 3) || ' ' || pg_catalog.right(v_text, 3) end);
    if (v_out ->> 'province') not in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT') then
      raise exception 'Province inconnue.' using errcode = 'P0001', hint = 'province';
    end if;

  when 'professional' then
    select * into v_items from private.parse_profession_items(coalesce(v -> 'professions', '[]'));
    if coalesce(pg_catalog.jsonb_typeof(v -> 'years_experience'), 'null') not in ('number', 'null') then
      raise exception 'Valeur invalide : nombre attendu.' using errcode = '22023', hint = 'years_experience';
    end if;
    v_num := (v ->> 'years_experience')::numeric;
    if v_num is not null and (v_num not between 0 and 60 or v_num <> pg_catalog.trunc(v_num)) then
      raise exception 'Les années d''expérience vont de 0 à 60.' using errcode = 'P0001', hint = 'years_experience';
    end if;
    v_out := pg_catalog.jsonb_build_object(
      'professions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                        'title_id', x.tid,
                                        'licence_number', nullif(pg_catalog.btrim(x.licence, E' \t\r\n'), ''),
                                        'is_primary', x.primary_flag) order by x.ord)
                                 from unnest(v_items.titles, v_items.licences, v_items.primary_flags)
                                      with ordinality as x(tid, licence, primary_flag, ord)), '[]'),
      'years_experience', v_num::int);

  when 'portrait' then
    v_text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(private.submission_string(v, 'public_email'), ''), E' \t\r\n'), ''));
    if v_text is not null and (pg_catalog.char_length(v_text) > 254 or v_text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
      raise exception 'Courriel invalide.' using errcode = 'P0001', hint = 'public_email';
    end if;
    v_out := pg_catalog.jsonb_build_object(
      'bio', private.submission_long_text(private.submission_string(v, 'bio'), 'La présentation', 4000, 'bio'),
      'approach', private.submission_long_text(private.submission_string(v, 'approach'), 'L''approche', 4000, 'approach'),
      'public_email', v_text,
      'public_phone', case when nullif(pg_catalog.btrim(private.submission_string(v, 'public_phone')), '') is not null
                           then private.submission_phone(private.submission_string(v, 'public_phone'), 'public_phone') end);

  when 'languages' then
    v_out := pg_catalog.jsonb_build_object('language_ids',
      pg_catalog.to_jsonb(coalesce((select pg_catalog.array_agg(x order by x)
                                      from pg_catalog.unnest(private.submission_uuid_array(v -> 'language_ids', 'language_ids')) as x), '{}'::uuid[])));

  when 'motifs' then
    v_out := pg_catalog.jsonb_build_object('motif_ids',
      pg_catalog.to_jsonb(coalesce((select pg_catalog.array_agg(x order by x)
                                      from pg_catalog.unnest(private.submission_uuid_array(v -> 'motif_ids', 'motif_ids')) as x), '{}'::uuid[])));

  when 'clienteles' then
    select x.ids, x.flags into v_ids, v_flags from private.parse_specialized_items(coalesce(v -> p_section, '[]')) x;
    -- The client limits (P4-245): the youngest client age (null: none) and « Femmes seulement ».
    if coalesce(pg_catalog.jsonb_typeof(v -> 'min_client_age'), 'null') not in ('number', 'null') then
      raise exception 'Valeur invalide : nombre attendu.' using errcode = '22023', hint = 'min_client_age';
    end if;
    v_num := (v ->> 'min_client_age')::numeric;
    if v_num is not null and (v_num not between 0 and 120 or v_num <> pg_catalog.trunc(v_num)) then
      raise exception 'Les âges vont de 0 à 120 ans.' using errcode = 'P0001', hint = 'min_client_age';
    end if;
    if coalesce(pg_catalog.jsonb_typeof(v -> 'women_only'), 'null') not in ('boolean', 'null') then
      raise exception 'Valeur invalide : booléen attendu.' using errcode = '22023', hint = 'women_only';
    end if;
    v_out := pg_catalog.jsonb_build_object(p_section,
      coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.id, 'specialized', x.flag) order by x.id)
                  from unnest(v_ids, v_flags) as x(id, flag)), '[]'),
      'min_client_age', v_num::int,
      'women_only', coalesce(v -> 'women_only', 'null'::jsonb));

  when 'availability' then
    if coalesce(pg_catalog.jsonb_typeof(v -> 'accepting_new_clients'), 'null') not in ('boolean', 'null') then
      raise exception 'Valeur invalide : booléen attendu.' using errcode = '22023', hint = 'accepting_new_clients';
    end if;
    if coalesce(pg_catalog.jsonb_typeof(v -> 'availability_periods'), 'null') not in ('array', 'null')
       or exists (select 1 from pg_catalog.jsonb_array_elements(coalesce(v -> 'availability_periods', '[]')) as e(x)
                   where coalesce(e.x #>> '{}', '') not in ('am', 'pm', 'end_of_day', 'evening', 'weekend')
                      or pg_catalog.jsonb_typeof(e.x) <> 'string') then
      raise exception 'Périodes invalides : am, pm, end_of_day, evening, weekend attendues.' using errcode = '22023', hint = 'availability_periods';
    end if;
    v_out := pg_catalog.jsonb_build_object(
      'accepting_new_clients', coalesce(v -> 'accepting_new_clients', 'null'::jsonb),
      'availability_periods', coalesce((select pg_catalog.jsonb_agg(d.x order by pg_catalog.array_position(array['am', 'pm', 'end_of_day', 'evening', 'weekend'], d.x))
                                          from (select distinct e.x #>> '{}' as x
                                                  from pg_catalog.jsonb_array_elements(coalesce(v -> 'availability_periods', '[]')) as e(x)) d), '[]'),
      'availability_note', private.submission_long_text(private.submission_string(v, 'availability_note'), 'La note', 500, 'availability_note'));

  when 'photo' then
    v_out := pg_catalog.jsonb_build_object('file_id', private.submission_uuid(v -> 'file_id', 'photo'));

  when 'insurance' then
    v_file := private.submission_uuid(v -> 'file_id', 'insurance');
    v_text := private.submission_string(v, 'expires_on');
    if v_text is not null then
      if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Date invalide.' using errcode = 'P0001', hint = 'expires_on';
      end if;
      begin
        v_date := v_text::date;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'Date invalide.' using errcode = 'P0001', hint = 'expires_on';
      end;
      -- Date-only (P4-2): a proof already expired is refused; no absurd year (4a.17 lesson).
      if v_date < private.clinic_today() then
        raise exception 'Cette assurance est déjà expirée : joignez une preuve en vigueur.' using errcode = 'P0001', hint = 'expires_on';
      end if;
      if v_date > date '2100-12-31' then
        raise exception 'La date doit être au plus tard le 31 décembre 2100.' using errcode = 'P0001', hint = 'expires_on';
      end if;
    end if;
    v_out := pg_catalog.jsonb_build_object('file_id', v_file, 'expires_on', v_date);
  end case;
  -- Only the keys given: a field left out keeps whatever the section already holds (P4-176).
  return coalesce((select pg_catalog.jsonb_object_agg(e.key, e.value) from pg_catalog.jsonb_each(v_out) e
                    where p_values ? e.key), '{}'::jsonb);
end;
$$;

-- private.assert_compensation_date: its latest definition, only the message changed: les bornes en français (C5).
create or replace function private.assert_compensation_date(p_date date, p_hint text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_date is not null and (p_date < date '2000-01-01' or p_date > date '2100-12-31') then
    raise exception 'La date doit être comprise entre le 1 janv. 2000 et le 31 déc. 2100.'
      using errcode = 'P0001', hint = p_hint;
  end if;
end;
$$;

-- private.assert_starts_after: its latest definition, only the message changed: la date en français (C5), pour les taux, les grilles et les ententes.
create or replace function private.assert_starts_after(p_new date, p_open date, p_message text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_new is null then
    raise exception 'La date d''entrée en vigueur est requise.' using errcode = 'P0001', hint = 'effective_from';
  end if;
  perform private.assert_compensation_date(p_new, 'effective_from');
  if p_open is not null and p_new <= p_open then
    raise exception '% %.', p_message, private.format_date_short_fr(p_open)
      using errcode = 'P0001', hint = 'effective_from';
  end if;
end;
$$;

-- public.set_professional_client_agreement: its latest definition, only the message changed: la date en français (C5).
create or replace function public.set_professional_client_agreement(
  p_id uuid,
  p_client_label text,
  p_duration int,
  p_professional_amount_cents int,
  p_client_price_cents int,
  p_effective_from date,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_label text;
  v_note text;
  v_message text;
  v_open public.professional_client_agreements;
  v_last_end date;
  v_id uuid;
begin
  perform private.assert_compensation_access();
  perform private.assert_agreement_duration(p_duration);
  begin
    v_label := private.reference_text(p_client_label, 'La référence du client', 40, true, true);
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message = message_text;
    raise exception '%', v_message using errcode = 'P0001', hint = 'client_label';
  end;
  -- A light guard against a full name (P4-183, Loi 25): two or more words of letters (2 or more
  -- each, hyphens and apostrophes inside) and no digit. « AB-123 », « M.T. », « D-1042 » pass.
  if v_label !~ '[0-9]' and v_label ~ '^[[:alpha:]][[:alpha:]''’-]+([[:space:]]+[[:alpha:]][[:alpha:]''’-]+)+$' then
    raise exception 'Numéro de dossier ou initiales seulement.' using errcode = 'P0001', hint = 'client_label';
  end if;
  if p_professional_amount_cents is null or p_professional_amount_cents not between 1 and 100000 then
    raise exception 'Le montant versé est compris entre 0,01 $ et 1 000 $.' using errcode = 'P0001', hint = 'professional_amount';
  end if;
  if p_client_price_cents is null or p_client_price_cents not between 1 and 100000 then
    raise exception 'Le prix payé par le client est compris entre 0,01 $ et 1 000 $.' using errcode = 'P0001', hint = 'client_price';
  end if;
  if p_professional_amount_cents > p_client_price_cents then
    raise exception 'Le montant versé au professionnel ne peut pas dépasser le prix payé par le client.'
      using errcode = 'P0001', hint = 'professional_amount';
  end if;
  v_note := private.compensation_note(p_note);
  perform private.assert_compensation_date(p_effective_from, 'effective_from');

  perform private.lock_professional(p_id);
  select * into v_open from public.professional_client_agreements a
   where a.professional_id = p_id and a.org_id = v_org and a.duration = p_duration
     and a.client_id is null and pg_catalog.lower(a.client_label) = pg_catalog.lower(v_label)
     and a.effective_to is null;
  perform private.assert_starts_after(p_effective_from, v_open.effective_from, 'La nouvelle entente doit commencer après le');
  select max(a.effective_to) into v_last_end from public.professional_client_agreements a
   where a.professional_id = p_id and a.org_id = v_org and a.duration = p_duration
     and a.client_id is null and pg_catalog.lower(a.client_label) = pg_catalog.lower(v_label);
  if v_last_end is not null and p_effective_from < v_last_end then
    raise exception 'La nouvelle entente doit commencer au plus tôt le %.', private.format_date_short_fr(v_last_end)
      using errcode = 'P0001', hint = 'effective_from';
  end if;
  if v_open.id is not null then
    update public.professional_client_agreements a set effective_to = p_effective_from
     where a.professional_id = p_id and a.org_id = v_org and a.id = v_open.id;
  end if;

  insert into public.professional_client_agreements
    (org_id, professional_id, client_label, duration, professional_amount_cents, client_price_cents, effective_from, note, created_by)
  values (v_org, p_id, v_label, p_duration, p_professional_amount_cents, p_client_price_cents, p_effective_from, v_note, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- public.end_professional_client_agreement: its latest definition, only the message changed: la date en français (C5).
create or replace function public.end_professional_client_agreement(p_row_id uuid, p_effective_to date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.professional_client_agreements;
begin
  perform private.assert_compensation_access();
  perform private.assert_compensation_date(p_effective_to, 'effective_to');
  if p_effective_to < private.clinic_today() then
    raise exception 'La fin de l''entente ne peut pas précéder aujourd''hui.' using errcode = 'P0001', hint = 'effective_to';
  end if;
  select * into v_row from public.professional_client_agreements a where a.id = p_row_id and a.org_id = v_org;
  if v_row.id is null then
    raise exception 'Entente introuvable.' using errcode = 'P0001';
  end if;
  perform private.lock_professional(v_row.professional_id);
  select * into v_row from public.professional_client_agreements a where a.id = p_row_id and a.org_id = v_org;
  if v_row.id is null then
    raise exception 'Entente introuvable.' using errcode = 'P0001';
  end if;
  if private.agreement_has_successor(v_row) then
    raise exception 'Seule la dernière entente d''un client et d''une durée peut prendre fin.' using errcode = 'P0001';
  end if;
  if p_effective_to is not null and p_effective_to <= v_row.effective_from then
    raise exception 'La fin doit suivre le début (%).', private.format_date_short_fr(v_row.effective_from)
      using errcode = 'P0001', hint = 'effective_to';
  end if;
  update public.professional_client_agreements a set effective_to = p_effective_to
   where a.professional_id = v_row.professional_id and a.org_id = v_org and a.id = v_row.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- C4: the email defaults and the permission's description (only where the old text is still there)
-- -----------------------------------------------------------------------------
update public.email_template_defaults d
   set button_label = 'Réviser le profil'
 where d.key = 'professionals.submission_received' and d.button_label = 'Réviser le dossier';

update public.email_template_defaults d
   set label = case d.label
                 when 'Assurance bientôt échue' then 'Assurance expire bientôt'
                 when 'Assurance échue' then 'Assurance expirée'
                 when 'Rappel : assurance échue' then 'Rappel : assurance expirée'
                 else d.label end,
       subject = case when d.subject = 'Votre assurance est échue' then 'Votre assurance est expirée' else d.subject end,
       description = pg_catalog.replace(d.description, 'dont la preuve d''assurance est échue,', 'dont la preuve d''assurance est expirée,')
 where d.key in ('professionals.document_expiring', 'professionals.document_expired', 'professionals.document_expired_reminder')
   and (d.label in ('Assurance bientôt échue', 'Assurance échue', 'Rappel : assurance échue')
        or d.subject = 'Votre assurance est échue'
        or d.description like '%dont la preuve d''assurance est échue,%');

update public.permissions p
   set description = 'Réviser et appliquer les profils envoyés'
 where p.key = 'professionals.review' and p.description = 'Réviser et appliquer les soumissions';

select pg_catalog.set_config('app.audit_source', '', true);
