-- =============================================================================
-- Professionnels: the questionnaire's consent answer (review of 4b.4)
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4b.4 (P4-273, P4-336)
-- Needs:   *_professionals_onboarding.sql (4b.1: sign_my_consent, get_my_submission, consent_versions)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * `sign_my_consent` answers the signature's time (the server's, as stored in the draft), so the
--   « Consentement » step shows it instead of the browser's clock. The return type changes: the
--   function is dropped and created again with the same body and the same grants (authenticated only).
-- * `get_my_submission` adds `signed_consent_version`: the version number of the text the draft's
--   signature names (null when unsigned), so a profile sent before the clinic published a newer text
--   reads « Signé (version n) », not « Pas encore signé ». Compared as text: the draft holds JSON.
-- =============================================================================

drop function public.sign_my_consent(uuid, text);

-- Signs the latest published consent (P4-273): the typed name must be the file's « Prénom Nom »,
-- accents, case and spaces aside. Stored in the draft with the server's time, which it returns;
-- professional_consents receives it on approval.
create function public.sign_my_consent(p_version_id uuid, p_signer_name text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_name text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_signer_name, ''), E' \t\r\n'), '\s+', ' ', 'g');
  v_now timestamptz := pg_catalog.now();
  v_pid uuid;
  v_sub public.professional_submissions;
  v_row public.professionals;
begin
  v_pid := private.my_professional_id();
  if v_name = '' then
    raise exception 'Saisissez votre nom complet.' using errcode = 'P0001', hint = 'signer_name';
  end if;
  if pg_catalog.char_length(v_name) > 161 or not private.is_tidy_text(v_name) then
    raise exception 'Le nom saisi ne correspond pas au nom du dossier.' using errcode = 'P0001', hint = 'signer_name';
  end if;

  perform private.lock_active_professional(v_pid, true);
  v_sub := private.lock_my_draft(v_org, v_pid);
  if not ('consent' = any (v_sub.requested_sections)) then
    raise exception 'Cette section n''est pas demandée.' using errcode = '22023';
  end if;
  if p_version_id is distinct from private.current_consent_version(v_org, 'image_rights') then
    raise exception 'Le texte du consentement a changé. Relisez-le avant de signer.' using errcode = 'P0001', hint = 'consent_version';
  end if;
  select * into v_row from public.professionals p where p.id = v_pid and p.org_id = v_org;
  if pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, v_name))
     <> pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary,
                                             pg_catalog.regexp_replace(v_row.first_name || ' ' || v_row.last_name, '\s+', ' ', 'g'))) then
    raise exception 'Le nom saisi ne correspond pas au nom du dossier.' using errcode = 'P0001', hint = 'signer_name';
  end if;

  update public.professional_submissions s
     set submitted_values = s.submitted_values || pg_catalog.jsonb_build_object('consent', pg_catalog.jsonb_build_object(
           'consent_version_id', p_version_id, 'signer_name', v_name, 'signed_at', v_now))
   where s.id = v_sub.id and s.org_id = v_org;
  return v_now;
end;
$$;

revoke all on function public.sign_my_consent(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.sign_my_consent(uuid, text) to authenticated;

-- The open submission (null when none: « Rien à compléter »): requested sections, prefill, answers,
-- the private step as masks, the consent text to sign, the version signed, collect_sin and the name
-- to type.
create or replace function public.get_my_submission()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pid uuid;
begin
  if not private.has_permission('professionals.self') then
    raise exception 'Permission refusée : professionals.self' using errcode = '42501';
  end if;
  v_pid := private.current_professional_id();
  return (
    select pg_catalog.jsonb_build_object(
             'id', s.id, 'kind', s.kind, 'status', s.status, 'requested_sections', s.requested_sections,
             'prefill', s.prefill, 'values', s.submitted_values, 'decision_note', s.decision_note,
             'submitted_at', s.submitted_at, 'updated_at', s.updated_at, 'private_saved_at', s.private_saved_at,
             'private', (select pg_catalog.jsonb_build_object(
                                  'business_number', sp.business_number, 'gst_number', sp.gst_number,
                                  'qst_number', sp.qst_number, 'bank_institution', sp.bank_institution,
                                  'bank_transit', sp.bank_transit, 'bank_account_last4', sp.bank_account_last4,
                                  'sin_last3', sp.sin_last3)
                           from public.professional_submission_private sp
                          where sp.submission_id = s.id and sp.org_id = v_org),
             'on_file', (select pg_catalog.jsonb_build_object('has_sin', pp.sin is not null,
                                                              'has_bank_account', pp.bank_account is not null)
                           from public.professional_private pp
                          where pp.professional_id = v_pid and pp.org_id = v_org),
             'consent', (select pg_catalog.jsonb_build_object('id', c.id, 'version', c.version, 'title', c.title, 'body', c.body)
                           from public.consent_versions c
                          where c.id = private.current_consent_version(v_org, 'image_rights') and c.org_id = v_org),
             'signed_consent_version', (select c.version
                                          from public.consent_versions c
                                         where c.org_id = v_org
                                           and c.id::text = s.submitted_values -> 'consent' ->> 'consent_version_id'),
             'collect_sin', coalesce((private.professionals_setting(v_org, 'collect_sin'))::boolean, false),
             'professional', pg_catalog.jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name, 'email', p.email))
      from public.professional_submissions s
      join public.professionals p on p.id = s.professional_id and p.org_id = s.org_id
     where s.professional_id = v_pid and s.org_id = v_org and s.status in ('draft', 'submitted'));
end;
$$;
