-- =============================================================================
-- Professionnels: reviewers see their work on Accueil
-- =============================================================================
-- Asked:   gap audit 2026-10-09 (docs/audit/2026-10-09-gap-audit.md, V11), decision P4-506
-- Needs:   *_professionals_submission_access.sql (submit_my_submission), *_professionals_image_consent.sql
--          (attach_professional_document), Phase 3 notifications (P3-15, P3-24)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Accueil « À surveiller » shows the caller's unread **important** notices, reloaded when the
--   bell's polled count of important notices changes (P3-24: no timer of its own). « Profil à
--   réviser » / « Mise à jour à réviser » (professionals.submission_received) and « Document à
--   vérifier » (professionals.document_to_review) were `normal`, so a reviewer saw her work only
--   in the bell. They become `important`: the notifier decides a notice's importance (P3-15), so
--   Accueil, the bell's count and its refresh need no change and core learns no module kind (a
--   filter by kind would have needed a core list and count per kind, ADR 0003). Their recipients
--   are unchanged (professionals.review, professionals.documents.review), so only reviewers see them.
-- * submit_my_submission and attach_professional_document: their latest definitions
--   (*_professionals_submission_access.sql, *_professionals_image_consent.sql) with 'important'
--   in that one notify call; nothing else changes.
-- * Data: the unread-or-not notices of those two kinds still in force become important, so the
--   reviews already waiting show on Accueil at once (notifications are an operational log, not
--   audited). Idempotent.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_review_notices_important', true);

-- -----------------------------------------------------------------------------
-- « Envoyer mon profil »: *_professionals_submission_access.sql's, the notice important
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
  perform private.notify(
    v_org, 'professionals', 'professionals.submission_received', 'important',
    case v_sub.kind when 'onboarding' then 'Profil à réviser' else 'Mise à jour à réviser' end,
    v_row.first_name || ' ' || v_row.last_name
      || case v_sub.kind when 'onboarding' then ' a envoyé son profil.' else ' a envoyé une mise à jour de son profil.' end,
    '/professionnels/' || v_pid || '/documents', 'professional', v_pid, 'professionals.review', null,
    'submission:' || v_sub.id || ':' || pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSUS'), null);
end;
$$;

-- -----------------------------------------------------------------------------
-- A document to verify: *_professionals_image_consent.sql's attach_professional_document, the
-- notice important
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
    perform private.notify(
      v_org, 'professionals', 'professionals.document_to_review', 'important', 'Document à vérifier',
      v_row.first_name || ' ' || v_row.last_name || ' a téléversé un document : ' || v_type.name || '.',
      '/professionnels/' || p_id || '/documents', 'professional_document', v_id,
      'professionals.documents.review', null, 'document:' || v_id || ':uploaded', null);
  end if;
  return v_id;
end;
$$;

-- The notices already waiting (header).
update public.notifications n
   set importance = 'important'
 where n.kind in ('professionals.submission_received', 'professionals.document_to_review')
   and n.importance = 'normal'
   and (n.expires_at is null or n.expires_at > pg_catalog.now());

select pg_catalog.set_config('app.audit_source', '', true);
