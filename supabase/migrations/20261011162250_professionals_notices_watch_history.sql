-- =============================================================================
-- Professionnels: notices that say who and stay true, « À surveiller » for documents, the
-- contract's preparation in Historique
-- =============================================================================
-- Asked:   gap audit 2026-10-09 (docs/audit/2026-10-09-gap-audit.md) V7, V18, T3, T4; decisions
--          P4-540 – P4-545
-- Needs:   *_professionals_review_notices_important.sql (submit_my_submission,
--          attach_professional_document), *_professionals_insurance_dates_wording.sql
--          (run_professionals_document_notices_for_service), *_professionals_list_photo.sql
--          (professionals_list), *_professionals_readiness_insurance.sql
--          (get_professional_readiness), *_professionals_history_document_type.sql
--          (list_professional_history), *_professionals_contract_paper_renew.sql
--          (private.professional_history_tables)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * « Document à vérifier » says who uploaded (V18, P4-541): « Pia Un · CV · téléversé par la
--   professionnelle » (le professionnel for `male`, her first name when the gender is not given),
--   or « … · téléversé par {display name} » when a staff member uploaded it.
-- * A notice stays only while it is true (T3, P4-542):
--   - a newer document of the same type (any path: an upload, the questionnaire's approval, the
--     signed consent) closes the « Document à vérifier » of the older pending ones (they stay
--     pending in Documents; only the newest one is asked for): trigger on professional_documents;
--   - a file that becomes inactive closes the « Document à vérifier » of its documents (P4-408:
--     an inactive file is not chased): trigger on professionals;
--   - « Documents requis manquants » is recreated when its count changes (it kept the week's first
--     count), still at most one open per clinic and a new one each ISO week.
-- * The owner of a file who also reviews (an admin who is a professional) is never alerted by her
--   own file (P4-304: she cannot review it), P4-543. Notices are addressed by permission (P3-15),
--   so the notice is marked read for her at once (core helper private.mark_notification_read_for,
--   reviewed as a core change, as private.expire_notifications): no unread count, no Accueil.
-- * « Documents requis manquants » opens the list filtered on the files it counts:
--   `/professionnels?statut=actif&documents=incomplets` (V7, P4-540); the open ones are relinked.
-- * « À surveiller » (V7, P4-540): professionals_list gains `documents_to_review` (pending
--   documents, appended) and get_professional_readiness `documents_to_review`; the app flags
--   missing documents (from documents_done / documents_required and the readiness item) and
--   documents waiting for review.
-- * Historique (T4, P4-545): professional_contract_snapshots joins
--   private.professional_history_tables(). A snapshot is written by « Préparer le contrat », its
--   preview, « Régénérer » and « Préparer un nouveau contrat » (P4-434, P4-502, P4-524);
--   list_professional_history returns only `{renewal}` for its rows (a contract was in force when
--   it was prepared), never its values or its Annexe A (they print the pay). The send, the
--   signatures and the paper contract were already listed.
-- * Every function: its latest definition with only what is said here changed (same signature,
--   grants and checks). Additive; production-safe.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_notices_watch_history', true);

-- -----------------------------------------------------------------------------
-- Core helper: a notice marked read for one member (reviewed as a core change)
-- -----------------------------------------------------------------------------
-- Marks p_notification_id read for p_user_id when she is a member of the notice's org (nothing
-- otherwise; idempotent). For a module RPC that must not alert the person a notice is about while
-- the notice is addressed by permission. Security invoker, granted to no role, like private.notify.
create function private.mark_notification_read_for(p_notification_id uuid, p_user_id uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.notification_reads (notification_id, user_id, org_id)
  select n.id, p.user_id, p.org_id
    from public.notifications n
    join public.profiles p on p.user_id = p_user_id and p.org_id = n.org_id
   where n.id = p_notification_id
  on conflict do nothing
$$;
revoke all on function private.mark_notification_read_for(uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- « Envoyer mon profil »: *_professionals_review_notices_important.sql's, the sender spared
-- -----------------------------------------------------------------------------
create or replace function public.submit_my_submission()
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
  v_gaps text[];
  v_now timestamptz := pg_catalog.now();
  v_notice uuid;
begin
  v_pid := private.my_professional_id();
  perform private.lock_active_professional(v_pid, true);
  v_sub := private.lock_my_draft(v_org, v_pid);
  v_gaps := private.submission_gaps(v_sub);
  if pg_catalog.cardinality(v_gaps) > 0 then
    raise exception 'Certaines sections sont incomplètes.' using errcode = 'P0001', hint = 'sections',
      detail = pg_catalog.array_to_string(v_gaps, ',');
  end if;
  perform private.dry_run_submission_sets(v_org, v_pid, v_sub.submitted_values, v_sub.requested_sections);

  update public.professional_submissions s
     set status = 'submitted', submitted_at = v_now, decision_note = null, reviewed_at = null, reviewed_by = null
   where s.id = v_sub.id and s.org_id = v_org;

  update public.stored_files f
     set retain_until = v_now + interval '90 days'
   where f.org_id = v_org and f.purpose = 'professional_submission_file'
     and f.subject_type = 'professional_submission' and f.subject_id = v_sub.id
     and f.status = 'ready' and f.retain_until is not null and f.retain_until < v_now + interval '90 days'
     and f.id in (select (v_sub.submitted_values #>> '{photo,file_id}')::uuid
                  union all
                  select (v_sub.submitted_values #>> '{insurance,file_id}')::uuid);

  select * into v_row from public.professionals p where p.id = v_pid and p.org_id = v_org;
  if v_sub.kind = 'onboarding' and v_row.status in ('draft', 'invited') then
    update public.professionals p
       set status = 'in_review', status_changed_at = v_now, status_changed_by = auth.uid()
     where p.id = v_pid and p.org_id = v_org;
  end if;

  -- One important notice per sending (Accueil « À surveiller », P4-506) (a resubmission after a refusal notifies again, P4-271): the key holds the
  -- clock time, not the transaction's, so two sendings never share it.
  v_notice := private.notify(
    v_org, 'professionals', 'professionals.submission_received', 'important',
    case v_sub.kind when 'onboarding' then 'Profil à réviser' else 'Mise à jour à réviser' end,
    v_row.first_name || ' ' || v_row.last_name
      || case v_sub.kind when 'onboarding' then ' a envoyé son profil.' else ' a envoyé une mise à jour de son profil.' end,
    '/professionnels/' || v_pid || '/documents', 'professional', v_pid, 'professionals.review', null,
    'submission:' || v_sub.id || ':' || pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSUS'), null);
  -- She cannot review her own profile (P4-304): a reviewer who sends hers is not alerted (P4-543).
  perform private.mark_notification_read_for(v_notice, auth.uid());
end;
$$;

-- -----------------------------------------------------------------------------
-- A document to verify: *_professionals_review_notices_important.sql's attach_professional_document,
-- the notice names the uploader (V18) and spares the file's owner (T3)
-- -----------------------------------------------------------------------------
create or replace function public.attach_professional_document(
  p_id uuid,
  p_type_key text,
  p_file_id uuid,
  p_expires_on date default null,
  p_metadata jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_self boolean;
  v_purpose text;
  v_row public.professionals;
  v_type public.document_types;
  v_file public.stored_files;
  v_today date;
  v_expires date;
  v_metadata jsonb := '{}';
  v_status text;
  v_id uuid;
  v_key text;
  v_value text;
  v_uploader text;
  v_notice uuid;
begin
  if private.has_permission('professionals.manage') then
    v_self := false;
    v_purpose := 'professional_document';
  elsif private.has_permission('professionals.self') and p_id is not null and p_id = private.current_professional_id() then
    v_self := true;
    v_purpose := 'professional_self_document';
  else
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  if p_id is null or p_type_key is null or p_file_id is null then
    raise exception 'Professionnel, type et fichier requis.' using errcode = '22023';
  end if;
  if p_metadata is null or pg_catalog.jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Métadonnées invalides.' using errcode = '22023';
  end if;

  perform private.lock_professional(p_id);
  select * into v_row from public.professionals p where p.id = p_id and p.org_id = v_org;

  select * into v_type from public.document_types t where t.org_id = v_org and t.key = p_type_key and t.is_active;
  if not found then
    raise exception 'Type de document inconnu.' using errcode = 'P0001', hint = 'type';
  end if;
  -- P4-489 (Jonathan, 2026-10-09): the professional fills in and signs her consent online (the
  -- questionnaire, « Mes documents »), never uploads one; staff may still upload a paper one.
  if v_self and v_type.key = 'image_consent' then
    raise exception 'Le consentement se remplit et se signe en ligne.' using errcode = 'P0001', hint = 'type';
  end if;

  -- The file (attach_stored_file re-checks purpose, uploader, clinic, status and staging).
  select * into v_file from public.stored_files f
   where f.id = p_file_id and f.org_id = v_org and f.purpose = v_purpose and f.status = 'ready'
     and (f.retain_until is null or f.retain_until > pg_catalog.now())
     and (not v_self or f.uploaded_by = auth.uid())
     and not exists (select 1 from public.professional_documents d where d.stored_file_id = f.id);
  if not found then
    raise exception 'Fichier introuvable. Téléversez-le de nouveau.' using errcode = 'P0001', hint = 'file';
  end if;
  if not (v_file.mime_type = any (v_type.accepted_mime)) then
    raise exception 'Ce type de fichier n''est pas accepté pour ce document.' using errcode = 'P0001', hint = 'file';
  end if;
  if v_file.size_bytes > v_type.max_bytes then
    raise exception 'Ce fichier dépasse la taille permise pour ce document (% Mo).',
      pg_catalog.replace(pg_catalog.trim_scale(pg_catalog.round(v_type.max_bytes / 1048576.0, 1))::text, '.', ',')
      using errcode = 'P0001', hint = 'file';
  end if;

  v_today := private.clinic_today();
  if v_type.expiry_rule = 'none' then
    if p_expires_on is not null then
      raise exception 'Ce type de document n''a pas d''échéance.' using errcode = 'P0001', hint = 'expires_on';
    end if;
  else
    v_expires := coalesce(p_expires_on, private.document_default_expiry(v_type.expiry_rule, v_today));
    if v_expires < v_today or v_expires > date '2100-12-31' then
      raise exception 'L''échéance doit être aujourd''hui ou plus tard.' using errcode = 'P0001', hint = 'expires_on';
    end if;
  end if;

  for v_key, v_value in select e.key, e.value from pg_catalog.jsonb_each_text(p_metadata) e loop
    if v_type.key <> 'insurance' or v_key not in ('insurer', 'policy_number')
       or pg_catalog.jsonb_typeof(p_metadata -> v_key) not in ('string', 'null') then
      raise exception 'Métadonnées invalides.' using errcode = '22023';
    end if;
    v_value := nullif(pg_catalog.btrim(v_value, E' \t\r\n'), '');
    if v_value is not null then
      if pg_catalog.char_length(v_value) > 120 or not private.is_tidy_text(v_value) then
        raise exception 'L''assureur et le numéro de police comptent au plus 120 caractères, sans caractères invisibles.'
          using errcode = 'P0001', hint = v_key;
      end if;
      v_metadata := v_metadata || pg_catalog.jsonb_build_object(v_key, v_value);
    end if;
  end loop;

  if (select count(*) from public.professional_documents d where d.professional_id = p_id and d.org_id = v_org) >= 200 then
    raise exception 'Ce dossier compte déjà 200 documents. Supprimez-en avant d''en ajouter.' using errcode = 'P0001';
  end if;

  v_status := case when not v_self and private.has_permission('professionals.documents.review')
                        and v_row.profile_id is distinct from auth.uid()
                   then 'verified' else 'pending' end;

  -- The file now belongs to the professional: read with professionals.view, and by the provider
  -- (owner branch) once they have an account.
  perform private.attach_stored_file(p_file_id, array[v_purpose], 'professional', p_id, 'professionals.view',
    v_row.profile_id, case when v_row.profile_id is not null then 'professionals.self' end,
    case when v_self then auth.uid() end);

  insert into public.professional_documents
    (org_id, professional_id, document_type_id, stored_file_id, status, expires_on, metadata, uploaded_by, reviewed_by, reviewed_at)
  values (v_org, p_id, v_type.id, p_file_id, v_status, v_expires, v_metadata, auth.uid(),
          case when v_status = 'verified' then auth.uid() end,
          case when v_status = 'verified' then pg_catalog.now() end)
  returning id into v_id;

  if v_status = 'verified' then
    perform private.after_professional_documents_change(v_org, p_id);
  else
    -- Who uploaded it (V18, P4-541): the professional herself, or the staff member by name.
    if v_self then
      v_uploader := case v_row.gender when 'female' then 'la professionnelle' when 'male' then 'le professionnel'
                                      else v_row.first_name end;
    else
      select pr.display_name into v_uploader from public.profiles pr where pr.user_id = auth.uid() and pr.org_id = v_org;
      v_uploader := coalesce(nullif(pg_catalog.btrim(v_uploader), ''), 'un membre de l''équipe');
    end if;
    v_notice := private.notify(
      v_org, 'professionals', 'professionals.document_to_review', 'important', 'Document à vérifier',
      pg_catalog.left(v_row.first_name || ' ' || v_row.last_name || ' · ' || v_type.name || ' · téléversé par ' || v_uploader || '.', 500),
      '/professionnels/' || p_id || '/documents', 'professional_document', v_id,
      'professionals.documents.review', null, 'document:' || v_id || ':uploaded', null);
    -- Nobody reviews a document of her own file (P4-304): its owner is not alerted (P4-543).
    if v_row.profile_id is not null then
      perform private.mark_notification_read_for(v_notice, v_row.profile_id);
    end if;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- T3: « Document à vérifier » closes when a newer document of the type arrives, or the file
-- becomes inactive
-- -----------------------------------------------------------------------------
-- After an insert into professional_documents (an upload, the questionnaire's approval, the signed
-- consent): the older pending documents of the same type and professional lose their notice. Rows
-- are inserted only by definer RPCs and triggers (no client insert grant).
create function private.professional_documents_supersede_notices()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select d.id from public.professional_documents d
     where d.professional_id = new.professional_id and d.org_id = new.org_id
       and d.document_type_id = new.document_type_id and d.id <> new.id and d.status = 'pending'
       and d.created_at <= new.created_at
  loop
    perform private.expire_notifications(new.org_id, 'professional_document', r.id, array['professionals.document_to_review']);
  end loop;
  return null;
end;
$$;
revoke all on function private.professional_documents_supersede_notices() from public, anon, authenticated, service_role;

create trigger professional_documents_supersede_notices
  after insert on public.professional_documents
  for each row execute function private.professional_documents_supersede_notices();

-- After a status change of a file to inactive (deactivate_professional, the status function): its
-- documents' review notices close. The documents stay pending; reactivated, the file shows them in
-- « À surveiller » (documents_to_review).
create function private.professionals_close_document_notices()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select d.id from public.professional_documents d
     where d.professional_id = new.id and d.org_id = new.org_id and d.status = 'pending'
  loop
    perform private.expire_notifications(new.org_id, 'professional_document', r.id, array['professionals.document_to_review']);
  end loop;
  return null;
end;
$$;
revoke all on function private.professionals_close_document_notices() from public, anon, authenticated, service_role;

create trigger professionals_close_document_notices
  after update of status on public.professionals
  for each row
  when (new.status = 'inactive' and old.status is distinct from 'inactive')
  execute function private.professionals_close_document_notices();

-- Data: the review notices of documents no longer the newest pending of their type, or of an
-- inactive file, close now. Idempotent.
update public.notifications n
   set expires_at = pg_catalog.now()
  from public.professional_documents d
  join public.professionals p on p.id = d.professional_id and p.org_id = d.org_id
 where n.kind = 'professionals.document_to_review' and n.subject_type = 'professional_document'
   and n.subject_id = d.id and n.org_id = d.org_id
   and (n.expires_at is null or n.expires_at > pg_catalog.now())
   and (p.status = 'inactive'
        or exists (select 1 from public.professional_documents x
                    where x.professional_id = d.professional_id and x.org_id = d.org_id
                      and x.document_type_id = d.document_type_id and x.id <> d.id
                      and x.created_at > d.created_at));

-- -----------------------------------------------------------------------------
-- The job's notices: *_professionals_insurance_dates_wording.sql's, step 3 changed
-- -----------------------------------------------------------------------------
-- {today, clinic_name, marked, expiring, expired, missing, emails: [{document_id, professional_id,
-- profile_id, email, first_name, template_key, expires_on}]} for p_org on p_today (default: the
-- clinic's today; tests pass a date). At most 500 emails, by professional id. P0001 HINT
-- module_disabled when the module is off for the clinic (start_job_run already refuses it). No
-- email while a newer insurance waits for review: a document (P4-408) or a questionnaire sent to
-- the clinic (P4-496).
create or replace function public.run_professionals_document_notices_for_service(p_org uuid, p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_clinic text;
  v_today date;
  v_marked int;
  v_expiring int := 0;
  v_expired int := 0;
  v_missing int;
  v_emails jsonb;
  v_week text;
  v_open text;
  v_missing_key text;
  r record;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_org is null then
    raise exception 'Organisation manquante' using errcode = '22023';
  end if;
  select o.timezone, o.name into v_tz, v_clinic from public.organizations o where o.id = p_org;
  if not found then
    raise exception 'Organisation inconnue' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(p_org, 'professionals') then
    raise exception 'Le module Professionnels est désactivé pour cette clinique.' using errcode = 'P0001', hint = 'module_disabled';
  end if;
  v_today := coalesce(p_today, (pg_catalog.now() at time zone v_tz)::date);
  perform pg_catalog.set_config('app.audit_source', 'job:professionals.insurance_expiry_notice', true);
  perform pg_catalog.set_config('app.audit_actor', '', true);

  -- 1. Past their last valid day.
  update public.professional_documents d
     set status = 'expired'
   where d.org_id = p_org and d.status = 'verified' and d.expires_on < v_today;
  get diagnostics v_marked = row_count;
  update public.professional_public_profiles x
     set photo_document_id = (
           select d.id from public.professional_documents d
             join public.document_types t on t.org_id = d.org_id and t.id = d.document_type_id and t.key = 'photo'
            where d.professional_id = x.professional_id and d.org_id = p_org and d.status = 'verified'
            order by d.reviewed_at desc nulls last, d.created_at desc, d.id desc
            limit 1)
   where x.org_id = p_org and x.photo_document_id is not null
     and exists (select 1 from public.professional_documents d
                  where d.professional_id = x.professional_id and d.id = x.photo_document_id and d.status <> 'verified');

  -- 2. The insurance notices of active professionals. A file no longer active is not chased
  -- (P4-408): its open insurance notices close.
  update public.notifications n
     set expires_at = pg_catalog.now()
   where n.org_id = p_org and n.subject_type = 'professional'
     and n.kind in ('professionals.insurance_expiring', 'professionals.insurance_expired')
     and (n.expires_at is null or n.expires_at > pg_catalog.now())
     and exists (select 1 from public.professionals p
                  where p.id = n.subject_id and p.org_id = p_org and p.status <> 'active');
  for r in
    select s.professional_id, s.expires_on, s.state, s.dedupe_key, p.first_name, p.last_name
      from private.professional_insurance_state(p_org, v_today, null) s
      join public.professionals p on p.id = s.professional_id and p.org_id = p_org and p.status = 'active'
     where s.state is not null
     order by s.professional_id
  loop
    perform private.expire_notifications(p_org, 'professional', r.professional_id,
      array['professionals.insurance_expiring', 'professionals.insurance_expired'], array[r.dedupe_key]);
    if r.state = 'expiring' then
      perform private.notify(
        p_org, 'professionals', 'professionals.insurance_expiring', 'important', 'Assurance expire bientôt',
        'L''assurance de ' || r.first_name || ' ' || r.last_name || ' est valide jusqu''au ' || private.format_date_fr(r.expires_on) || '.',
        '/professionnels/' || r.professional_id || '/documents', 'professional', r.professional_id,
        'professionals.manage', null, r.dedupe_key, pg_catalog.now() + interval '60 days');
      v_expiring := v_expiring + 1;
    else
      perform private.notify(
        p_org, 'professionals', 'professionals.insurance_expired', 'important', 'Assurance expirée',
        'L''assurance de ' || r.first_name || ' ' || r.last_name || ' était valide jusqu''au ' || private.format_date_fr(r.expires_on)
          || '. Son dossier reste actif.',
        '/professionnels/' || r.professional_id || '/documents', 'professional', r.professional_id,
        'professionals.manage', null, r.dedupe_key, pg_catalog.now() + interval '60 days');
      v_expired := v_expired + 1;
    end if;
  end loop;

  -- 3. Active professionals whose required documents are not all in order (a count, no name).
  -- One open notice per clinic, renewed each ISO week and whenever the count changes (T3,
  -- P4-542); it opens the list on the files it counts (V7, P4-540).
  select count(*)::int into v_missing
    from public.professionals_readiness rd
    join public.professionals p on p.id = rd.professional_id and p.org_id = p_org and p.status = 'active'
   where rd.org_id = p_org and not rd.documents_ok;
  if v_missing > 0 then
    v_week := pg_catalog.to_char(v_today, 'IYYY-"W"IW');
    select n.dedupe_key into v_open
      from public.notifications n
     where n.org_id = p_org and n.kind = 'professionals.documents_missing'
       and n.subject_type = 'organization' and n.subject_id = p_org
       and (n.expires_at is null or n.expires_at > pg_catalog.now())
       and n.dedupe_key like 'documents_missing:' || v_week || ':' || v_missing || ':%'
     order by n.created_at desc
     limit 1;
    -- The open notice of this week and count stays; otherwise a new key (week, count and the
    -- clock time: a count that comes back within the week is a new notice, never a closed one).
    v_missing_key := coalesce(v_open,
      'documents_missing:' || v_week || ':' || v_missing || ':'
        || pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSUS'));
    perform private.expire_notifications(p_org, 'organization', p_org, array['professionals.documents_missing'],
      array[v_missing_key]);
    perform private.notify(
      p_org, 'professionals', 'professionals.documents_missing', 'normal', 'Documents requis manquants',
      case when v_missing = 1 then '1 professionnel actif n''a pas tous ses documents requis.'
           else v_missing || ' professionnels actifs n''ont pas tous leurs documents requis.' end,
      '/professionnels?statut=actif&documents=incomplets', 'organization', p_org, 'professionals.manage', null,
      v_missing_key, pg_catalog.now() + interval '7 days');
  else
    perform private.expire_notifications(p_org, 'organization', p_org, array['professionals.documents_missing']);
  end if;

  -- 4. The emails due today (one statement).
  with due as (
    select s.professional_id, s.document_id, s.expires_on, s.state, s.step_start, s.weekly_after_expiry,
           p.first_name, p.email, p.profile_id
      from private.professional_insurance_state(p_org, v_today, null) s
      join public.professionals p on p.id = s.professional_id and p.org_id = p_org and p.status = 'active'
     where s.state is not null and not s.has_pending
       -- P4-496: nor while a questionnaire sent to the clinic holds a new insurance still in force.
       and not exists (
         select 1
           from public.professional_submissions q
           join public.stored_files f
             on f.id = (q.submitted_values #>> '{insurance,file_id}')::uuid and f.org_id = q.org_id
            and f.status = 'ready' and f.purpose = 'professional_submission_file'
            and f.subject_type = 'professional_submission' and f.subject_id = q.id
            and (f.retain_until is null or f.retain_until > pg_catalog.now())
          where q.org_id = p_org and q.professional_id = s.professional_id and q.status = 'submitted'
            and 'insurance' = any (q.requested_sections)
            and (q.submitted_values #>> '{insurance,expires_on}')::date >= v_today)
  ),
  mail as (
    select e.subject_id as professional_id,
           max((e.created_at at time zone v_tz)::date) filter (where e.template_key = 'professionals.document_expiring') as last_expiring,
           max((e.created_at at time zone v_tz)::date) filter (where e.template_key = 'professionals.document_expired') as last_expired,
           max((e.created_at at time zone v_tz)::date)
             filter (where e.template_key in ('professionals.document_expired', 'professionals.document_expired_reminder'))
             as last_any_expired
      from public.email_log e
     where e.org_id = p_org and e.subject_type = 'professional'
       and e.subject_id in (select due.professional_id from due)
       and e.template_key in ('professionals.document_expiring', 'professionals.document_expired',
                              'professionals.document_expired_reminder')
       and (e.status <> 'failed' or e.error_code = 'provider_unavailable')
       and e.created_at > pg_catalog.now() - interval '400 days'
     group by e.subject_id
  ),
  pick as (
    select d.*,
           case
             when d.state = 'expiring' then
               case when m.last_expiring is null or m.last_expiring < d.step_start then 'professionals.document_expiring' end
             when m.last_expired is null or m.last_expired <= d.expires_on then 'professionals.document_expired'
             when d.weekly_after_expiry and m.last_any_expired <= v_today - 7 then 'professionals.document_expired_reminder'
           end as template_key
      from due d
      left join mail m on m.professional_id = d.professional_id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'document_id', x.document_id, 'professional_id', x.professional_id, 'profile_id', x.profile_id,
           'email', x.email, 'first_name', x.first_name, 'template_key', x.template_key, 'expires_on', x.expires_on)
           order by x.professional_id), '[]'::jsonb)
    into v_emails
    from (select * from pick where pick.template_key is not null order by pick.professional_id limit 500) x;

  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return pg_catalog.jsonb_build_object(
    'today', v_today, 'clinic_name', v_clinic, 'marked', v_marked, 'expiring', v_expiring, 'expired', v_expired,
    'missing', v_missing, 'emails', v_emails);
end;
$$;

-- The open « Documents requis manquants » open the filtered list (operational log, not audited).
update public.notifications n
   set link_path = '/professionnels?statut=actif&documents=incomplets'
 where n.kind = 'professionals.documents_missing' and n.link_path = '/professionnels'
   and (n.expires_at is null or n.expires_at > pg_catalog.now());

-- -----------------------------------------------------------------------------
-- « À surveiller »: documents waiting for review (V7)
-- -----------------------------------------------------------------------------
-- *_professionals_list_photo.sql's view with `documents_to_review` appended: the file's pending
-- documents (uploaded by her, or by staff without documents.review), under the caller's RLS.
create or replace view public.professionals_list with (security_invoker = true) as
select p.id, p.org_id, p.first_name, p.last_name, p.email, p.status, p.status_changed_at, p.deactivation_reason_id,
       p.profile_id is not null              as has_account,
       pp.profession_title_id                as primary_title_id,
       pp.licence_number                     as primary_licence_number,
       p.gender,
       coalesce(l.ids, '{}')                 as language_ids,
       coalesce(c.ids, '{}')                 as clientele_ids,
       coalesce(m.ids, '{}')                 as motif_ids,
       mp.accepting_new_clients,
       r.matching_complete,
       r.ready,
       r.email_matches_login,
       p.created_at, p.updated_at,
       r.documents_done,
       r.documents_required,
       r.insurance_status,
       r.insurance_expires_on,
       -- Appended (a view's columns cannot be reordered): the stored file of the photo on the
       -- public profile, as get_professional_record's photo_file_id (the newest verified photo;
       -- the status test is a safeguard). Under the caller's RLS: null when she cannot read it.
       (select d.stored_file_id
          from public.professional_public_profiles x
          join public.professional_documents d on d.professional_id = x.professional_id and d.id = x.photo_document_id
         where x.professional_id = p.id and d.status = 'verified') as photo_file_id,
       -- Appended: documents waiting for review (V7, P4-540).
       (select count(*)::int from public.professional_documents d
         where d.professional_id = p.id and d.status = 'pending') as documents_to_review
  from public.professionals p
  left join public.professional_professions pp on pp.professional_id = p.id and pp.is_primary
  left join public.professional_matching_profiles mp on mp.professional_id = p.id
  left join public.professionals_readiness r on r.professional_id = p.id
  left join (select x.professional_id, array_agg(x.language_id order by x.language_id) as ids
               from public.professional_languages x group by x.professional_id) l on l.professional_id = p.id
  left join (select x.professional_id, array_agg(x.clientele_id order by x.clientele_id) as ids
               from public.professional_clienteles x group by x.professional_id) c on c.professional_id = p.id
  left join (select x.professional_id, array_agg(x.motif_id order by x.motif_id) as ids
               from public.professional_motifs x group by x.professional_id) m on m.professional_id = p.id
 where (select private.has_permission('professionals.view'));

-- *_professionals_readiness_insurance.sql's, with `documents_to_review` (the record's « À surveiller »).
create or replace function public.get_professional_readiness(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'complete', r.ready,
           'done', r.matching_complete::int + r.account_created::int + r.submission_approved::int + r.documents_ok::int
                   + r.contract_signed::int,
           'total', 5,
           'items', pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object(
               'key', 'matching_profile',
               'done', r.matching_complete,
               'missing', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
                 case when not r.has_profession then 'profession' end,
                 case when not r.licences_ok then 'licence' end,
                 case when not r.restricted_motifs_ok then 'regulated_title' end,
                 case when not r.has_language then 'language' end,
                 case when not r.has_clientele then 'clientele' end,
                 case when not r.has_motif then 'motif' end], null))),
             pg_catalog.jsonb_build_object('key', 'account_created', 'done', r.account_created, 'missing', '[]'::jsonb),
             pg_catalog.jsonb_build_object('key', 'submission_approved', 'done', r.submission_approved, 'missing', '[]'::jsonb),
             pg_catalog.jsonb_build_object('key', 'documents', 'done', r.documents_ok,
                                           'missing', pg_catalog.to_jsonb(r.documents_missing)),
             pg_catalog.jsonb_build_object('key', 'contract_signed', 'done', r.contract_signed, 'missing', '[]'::jsonb)),
           'warnings', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
             case when not r.email_matches_login then 'login_email_mismatch' end], null)),
           'insurance', pg_catalog.jsonb_build_object(
             'status', coalesce(r.insurance_status, 'missing'),
             'expires_on', r.insurance_expires_on),
           'documents_to_review', (select count(*)::int from public.professional_documents d
                                    where d.professional_id = p_id and d.status = 'pending'))
    from public.professionals_readiness r
   where r.professional_id = p_id
$$;

-- -----------------------------------------------------------------------------
-- Historique: the contract's preparation (T4)
-- -----------------------------------------------------------------------------
create or replace function private.professional_history_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['professionals', 'professional_public_profiles', 'professional_matching_profiles',
               'professional_matching_notes',
               'professional_professions', 'professional_clienteles',
               'professional_motifs', 'professional_languages', 'professional_payer_numbers',
               'professional_private', 'professional_retention', 'professional_session_counts',
               'professional_client_agreements', 'professional_submissions', 'professional_consents',
               'professional_documents', 'professional_invitation_deliveries', 'professional_paper_contracts',
               'professional_contract_snapshots']
$$;

-- *_professionals_history_document_type.sql's, with one more branch: a contract snapshot's row
-- returns only `{renewal}` (a contract was in force when it was prepared), never its values, terms
-- or signers.
create or replace function public.list_professional_history(p_id uuid, p_before_id bigint default null, p_limit int default 50)
returns table (
  id bigint, created_at timestamptz, table_name text, record_id text, action text,
  changed_fields jsonb, actor_id uuid, actor_name text, actor_role text, source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_before bigint := coalesce(p_before_id, 9223372036854775807);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_prefix text := p_id::text;
  v_tables text[] := private.professional_history_tables();
  v_signing_ids text[];
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  if not private.has_permission('professionals.compensation') then
    v_tables := array(select t from pg_catalog.unnest(v_tables) t
                       where t <> all (private.professional_compensation_history_tables()));
  end if;
  select coalesce(pg_catalog.array_agg(x.id), '{}') into v_signing_ids
    from (select r.id::text as id
            from public.signature_requests r
           where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
             and r.purpose in ('professionals.service_contract', 'professionals.image_consent')
          union all
          select s.id::text
            from public.signature_requests r
            join public.signature_request_signers s on s.request_id = r.id
           where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
             and r.purpose in ('professionals.service_contract', 'professionals.image_consent')) x;

  return query
    select a.id, a.created_at, a.table_name, a.record_id, a.action,
           case
             -- A contract snapshot (T4): whether a contract was in force then, nothing it prints.
             when a.table_name = 'professional_contract_snapshots'
               then pg_catalog.jsonb_build_object('renewal', exists (
                      select 1 from public.signature_requests r
                       where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
                         and r.purpose = 'professionals.service_contract' and r.status = 'signed'
                         and coalesce(r.completed_at, r.completed_event_at, r.created_at) < a.created_at
                      union all
                      select 1 from public.professional_paper_contracts c
                       where c.org_id = v_org and c.professional_id = p_id and c.created_at < a.created_at))
             -- A signer's row names its role (« par le professionnel », « par la clinique ») and the form.
             when a.table_name = 'signature_request_signers' and sr.role is not null
                  and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
               then a.changed_fields || pg_catalog.jsonb_build_object('role', sr.role, 'purpose', sr.purpose)
             when a.table_name = 'signature_requests' and rq.purpose is not null
                  and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
               then a.changed_fields || pg_catalog.jsonb_build_object('purpose', rq.purpose)
             when a.table_name = 'professional_submissions' and a.action <> 'insert' and sk.kind is not null
                  and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
               then a.changed_fields || pg_catalog.jsonb_build_object('kind', sk.kind)
             -- A document's row names its type (its upload row may be on an older page, or gone).
             when a.table_name = 'professional_documents' and dt.type_id is not null
                  and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
               then a.changed_fields
                    || pg_catalog.jsonb_build_object('document_type_name', dt.type_name)
                    || case when a.changed_fields ? 'document_type_id' then '{}'::jsonb
                            else pg_catalog.jsonb_build_object('document_type_id', dt.type_id) end
             when a.table_name <> 'professional_private' then a.changed_fields
             when a.action = 'read' and pg_catalog.jsonb_typeof(a.changed_fields -> 'fields') = 'array'
               then pg_catalog.jsonb_build_object('fields', (
                      select coalesce(pg_catalog.jsonb_agg(f.value order by f.ord), '[]'::jsonb)
                        from pg_catalog.jsonb_array_elements(a.changed_fields -> 'fields') with ordinality as f(value, ord)
                       where f.value in ('"sin"'::jsonb, '"bank_account"'::jsonb)))
           end,
           a.actor_id, pr.display_name, a.actor_role, a.source
      -- Two branches, so neither scans the clinic's whole log (P4-475): the file's own rows through
      -- audit_log_org_record_prefix_idx with the cursor, and the signature requests and signers
      -- through audit_log_record_idx. They never share a row, so union all is the OR it replaces.
      from ((select x.* from public.audit_log x
              where x.org_id = v_org
                and left(x.record_id, 36) = v_prefix
                and x.id < v_before
                and x.table_name = any (v_tables)
                and not (x.table_name = 'professional_submissions' and x.action = 'update'
                         and pg_catalog.jsonb_typeof(x.changed_fields) = 'object'
                         and not exists (select 1 from pg_catalog.jsonb_object_keys(x.changed_fields) k(key)
                                          where k.key not in ('submitted_values', 'secure_link_id')))
                -- A snapshot is written once (first write wins, P4-434): only its insert is an event.
                and not (x.table_name = 'professional_contract_snapshots' and x.action <> 'insert')
              order by x.id desc
              limit v_limit)
            union all
            (select x.* from public.audit_log x
              where x.org_id = v_org
                and x.table_name in ('signature_requests', 'signature_request_signers')
                and x.record_id = any (v_signing_ids)
                and x.id < v_before
                and x.action = 'update'
                and pg_catalog.jsonb_typeof(x.changed_fields) = 'object'
                and x.changed_fields ? 'status'
              order by x.id desc
              limit v_limit)) a
      left join public.profiles pr on pr.user_id = a.actor_id and pr.org_id = a.org_id
      -- record_id is '<professional_id>:<submission id>' (the primary key's columns).
      left join lateral (select s.kind from public.professional_submissions s
                          where a.table_name = 'professional_submissions'
                            and s.professional_id = p_id and s.org_id = v_org
                            and s.id::text = pg_catalog.substr(a.record_id, 38)) sk on true
      left join lateral (select s.role, r.purpose from public.signature_request_signers s
                           join public.signature_requests r on r.id = s.request_id
                          where a.table_name = 'signature_request_signers' and s.org_id = v_org
                            and s.id::text = a.record_id) sr on true
      left join lateral (select r.purpose from public.signature_requests r
                          where a.table_name = 'signature_requests' and r.org_id = v_org
                            and r.id::text = a.record_id) rq on true
      -- record_id is '<professional_id>:<document id>'. The live row first; a deleted document's
      -- type from its audited insert or delete (the whole row, never redacted).
      left join lateral (select t.id as type_id, t.name as type_name
                           from public.document_types t
                          where a.table_name = 'professional_documents' and t.org_id = v_org
                            and t.id::text = coalesce(
                                  (select d.document_type_id::text from public.professional_documents d
                                    where d.org_id = v_org and d.professional_id = p_id
                                      and d.id::text = pg_catalog.substr(a.record_id, 38)),
                                  (select x.changed_fields ->> 'document_type_id' from public.audit_log x
                                    where x.table_name = 'professional_documents' and x.record_id = a.record_id
                                      and x.org_id = v_org and x.action in ('insert', 'delete')
                                    order by x.id desc
                                    limit 1))) dt on true
     order by a.id desc
     limit v_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- The reviewers' email says whether it is a first profile or an update (V19, P4-544)
-- -----------------------------------------------------------------------------
-- `professionals-submit` sends `submission.description`: « son profil » or « une mise à jour de son
-- profil », the in-app notice's words. Only the default changes (a clinic's own copy keeps its
-- text and may use the variable), and only while it still has the onboarding migration's text.
update public.email_template_defaults
   set subject = '{{professional.full_name}} a envoyé {{submission.description}}',
       body = E'Bonjour,\n\n'
              '{{professional.full_name}} a envoyé {{submission.description}}, à réviser dans son dossier.',
       description = 'Envoyé à l''équipe quand un professionnel envoie son profil ou une mise à jour à réviser. Le courriel dit lequel des deux.',
       variables = (
         select pg_catalog.jsonb_agg(v order by o)
           from (
             select v, o from pg_catalog.jsonb_array_elements(variables) with ordinality as e(v, o)
             union all
             select '{"path": "submission.description", "label": "Ce qui est envoyé (« son profil » ou « une mise à jour de son profil »)", "sample": "une mise à jour de son profil", "required": true, "kind": "text"}'::jsonb, 1.5
           ) x),
       updated_at = pg_catalog.now()
 where key = 'professionals.submission_received'
   and subject = '{{professional.full_name}} a envoyé son profil'
   and not variables @> '[{"path": "submission.description"}]';

select pg_catalog.set_config('app.audit_source', '', true);
