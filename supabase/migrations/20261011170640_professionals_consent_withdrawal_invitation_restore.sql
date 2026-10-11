-- =============================================================================
-- Professionnels: a withdrawn image consent; a failed invitation reminder never kills the link
-- =============================================================================
-- Asked:   gap audit 2026-10-09 (docs/audit/2026-10-09-gap-audit.md) V5 and H7; decisions
--          P4-549, P4-550
-- Needs:   *_professionals_image_consent_one_source.sql (professionals_readiness,
--          get_professional_documents, private.professional_image_consent_valid_until),
--          *_professionals_invitation_delivery.sql (reissue_professional_invitation_for_service),
--          *_core_secure_links.sql (secure_links)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * V5, the withdrawal (P4-549). Consistent with P4-504 / P4-507: the consent never expires and
--   its one source is the verified « Consentement droit à l'image » document. A withdrawal is
--   recorded on that document, not on the retired professional_consents: `withdrawn_on` (the first
--   day it is no longer in force, a calendar date: today, an earlier day, or a later one for a
--   notice period), an optional `withdrawal_note`, and who recorded it and when (`withdrawn_by`,
--   `withdrawn_at`). The row is audited as before (its update is Historique's « a enregistré le
--   retrait du consentement … »). The document stays verified and its file is kept: it proves what
--   was consented to until then.
-- * withdraw_professional_image_consent(id, withdrawn_on, note) (`professionals.documents.review`,
--   never on one's own file, P4-304): marks every verified consent of the file still in force (or
--   whose withdrawal is still to come: a correction of its date); P0001 when there is none.
-- * From `withdrawn_on` on, the consent is no longer in force, wherever it is read:
--   private.professional_image_consent_valid_until (null: the professional and staff may have a new
--   one signed, `start_my_consent_signing` and the record's « Envoyer pour signature » no longer
--   say « déjà signé »), the readiness view (consent_ok, documents_missing `image_consent`, ready,
--   the list's « Documents 2 / 3 », the weekly notice), and the app's `imageConsentOnFile` (the
--   fiche prints the initials, P4-512; Profil public says so). A new consent signed or attached
--   later is a new document, not withdrawn: in force again.
-- * H7, the reminder (P4-550): reissue_professional_invitation_for_service also returns the link it
--   replaced (`previous_link_id`). When the reminder's email does not leave,
--   `professionals-invitation-reminders` calls restore_professional_invitation_for_service: the
--   new link (never opened nor used) is revoked and the previous one is live again, as long as it is
--   unused and not expired (its own lifetime: the reminder does not extend it); the draft
--   questionnaire points to it again. So a failed reminder never leaves her without a working
--   link. Core helper private.restore_secure_link (reviewed as a core change, as
--   private.issue_secure_link).
-- * Additive (nullable columns, a check, a new RPC), production-safe.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_consent_withdrawal_invitation_restore', true);

-- -----------------------------------------------------------------------------
-- V5: the withdrawal, on the consent's document
-- -----------------------------------------------------------------------------
alter table public.professional_documents
  add column withdrawn_on date,
  add column withdrawal_note text,
  add column withdrawn_at timestamptz,
  add column withdrawn_by uuid,
  add constraint professional_documents_withdrawn_by_fkey foreign key (withdrawn_by)
    references public.profiles (user_id) on delete set null,
  add constraint professional_documents_withdrawn_on_check
    check (withdrawn_on between date '2000-01-01' and date '2100-12-31'),
  add constraint professional_documents_withdrawal_note_check check (
    pg_catalog.char_length(withdrawal_note) <= 1000 and pg_catalog.btrim(withdrawal_note, E' \t\r\n') <> ''),
  -- The date and its recording go together; a note only with them; only a verified document.
  add constraint professional_documents_withdrawal_check check (
    (withdrawn_on is null) = (withdrawn_at is null)
    and (withdrawal_note is null or withdrawn_on is not null)
    and (withdrawn_on is null or status = 'verified'));
create index professional_documents_withdrawn_by_idx on public.professional_documents (withdrawn_by)
  where withdrawn_by is not null;

-- Records that the professional withdrew her image consent (gap audit V5, P4-549): every verified
-- « Consentement droit à l'image » of the file still in force, or whose withdrawal is still to come
-- (a correction of its date), gets `withdrawn_on` (no earlier than 2000-01-01, at most a year after
-- the clinic's today), the trimmed note (≤ 1000 characters) and who recorded it. Returns how many
-- documents it marked. P0001: none in force (HINT document), a date out of range (HINT
-- withdrawn_on), a note too long or with control characters (HINT note), one's own file.
create function public.withdraw_professional_image_consent(p_id uuid, p_withdrawn_on date, p_note text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_today date;
  v_note text := nullif(pg_catalog.btrim(p_note, E' \t\r\n'), '');
  v_count int;
begin
  if not private.has_permission('professionals.documents.review') then
    raise exception 'Permission refusée : professionals.documents.review' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'Professionnel requis.' using errcode = '22023';
  end if;
  perform private.lock_professional(p_id);
  if not exists (select 1 from public.professionals p where p.id = p_id and p.org_id = v_org) then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;
  perform private.assert_not_own_document(p_id);
  v_today := private.clinic_today();
  if p_withdrawn_on is null or p_withdrawn_on < date '2000-01-01' or p_withdrawn_on > v_today + 366 then
    raise exception 'Indiquez la date du retrait : au plus tard dans un an.' using errcode = 'P0001', hint = 'withdrawn_on';
  end if;
  if v_note is not null and (pg_catalog.char_length(v_note) > 1000 or v_note ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]') then
    raise exception 'La note compte 1000 caractères au maximum, sans caractères invisibles.' using errcode = 'P0001', hint = 'note';
  end if;

  update public.professional_documents d
     set withdrawn_on = p_withdrawn_on, withdrawal_note = v_note,
         withdrawn_at = pg_catalog.now(), withdrawn_by = auth.uid()
    from public.document_types t
   where t.org_id = d.org_id and t.id = d.document_type_id and t.key = 'image_consent'
     and d.professional_id = p_id and d.org_id = v_org and d.status = 'verified'
     and (d.withdrawn_on is null or d.withdrawn_on > v_today);
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Aucun consentement au droit à l''image en vigueur dans ce dossier.' using errcode = 'P0001', hint = 'document';
  end if;
  update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id and p.org_id = v_org;
  return v_count;
end;
$$;
revoke all on function public.withdraw_professional_image_consent(uuid, date, text) from public, anon;
grant execute on function public.withdraw_professional_image_consent(uuid, date, text) to authenticated;

-- In force: *_professionals_image_consent_one_source.sql's, a withdrawn consent no longer counts
-- from its `withdrawn_on` (the clinic's today). Same signature; its callers test `is not null`.
create or replace function private.professional_image_consent_valid_until(p_org uuid, p_pid uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
           select 1 from public.professional_documents x
             join public.document_types t on t.org_id = x.org_id and t.id = x.document_type_id and t.key = 'image_consent'
            where x.org_id = p_org and x.professional_id = p_pid and x.status = 'verified'
              and (x.withdrawn_on is null or x.withdrawn_on > private.clinic_today_for_org(p_org)))
         then date '2100-12-31' end
$$;

-- Readiness: *_professionals_image_consent_one_source.sql's view; a type without a rule counts a
-- verified document that is not withdrawn on the clinic's today (only an image consent ever is).
create or replace view public.professionals_readiness with (security_invoker = true) as
select r.professional_id, r.org_id, r.has_profession, r.licences_ok, r.restricted_motifs_ok, r.has_language,
       r.has_clientele, r.has_motif, r.matching_complete, r.email_matches_login,
       (r.matching_complete and r.account_created and r.submission_approved and r.documents_ok
        and r.contract_signed) as ready,
       r.account_created, r.submission_approved,
       r.photo_ok, r.insurance_ok, r.consent_ok, r.documents_ok, r.documents_done, r.documents_required,
       r.documents_missing, r.insurance_status, r.insurance_expires_on, r.contract_signed
  from (
    select p.id as professional_id,
           p.org_id,
           (pr.n is not null)                                                  as has_profession,
           (coalesce(pr.missing_licences, 0) = 0)                              as licences_ok,
           (not coalesce(m.has_restricted, false) or coalesce(pr.regulated, 0) > 0) as restricted_motifs_ok,
           (l.professional_id is not null)                                     as has_language,
           (c.professional_id is not null)                                     as has_clientele,
           (m.professional_id is not null)                                     as has_motif,
           (pr.n is not null and coalesce(pr.missing_licences, 0) = 0
            and (not coalesce(m.has_restricted, false) or coalesce(pr.regulated, 0) > 0)
            and l.professional_id is not null and c.professional_id is not null
            and m.professional_id is not null)                                 as matching_complete,
           (em.id is null)                                                     as email_matches_login,
           (p.profile_id is not null)                                          as account_created,
           (sa.professional_id is not null)                                    as submission_approved,
           coalesce(dc.photo_ok, false)                                        as photo_ok,
           coalesce(dc.insurance_ok, false)                                    as insurance_ok,
           coalesce(dc.consent_ok, false)                                      as consent_ok,
           (coalesce(dc.required_done, 0) = coalesce(dc.required_n, 0))        as documents_ok,
           coalesce(dc.required_done, 0)::int                                  as documents_done,
           coalesce(dc.required_n, 0)::int                                     as documents_required,
           pg_catalog.array_remove(array[
             case when dc.photo_missing then 'photo' end,
             case when dc.insurance_missing then
               case when dc.insurance_expires_on is null then 'insurance' else 'insurance_expired' end end,
             case when dc.consent_missing then 'image_consent' end,
             case when dc.other_missing then 'other_documents' end]::text[], null) as documents_missing,
           coalesce(dc.insurance_status, 'missing')                            as insurance_status,
           dc.insurance_expires_on,
           (sc.id is not null)                                                 as contract_signed
      from public.professionals p
      left join (select x.professional_id,
                        count(*) as n,
                        count(*) filter (where t.order_id is not null and x.licence_number is null) as missing_licences,
                        count(*) filter (where t.order_id is not null) as regulated
                   from public.professional_professions x
                   join public.profession_titles t on t.org_id = x.org_id and t.id = x.profession_title_id and t.is_active
                  group by x.professional_id) pr on pr.professional_id = p.id
      left join (select distinct x.professional_id from public.professional_languages x
                   join public.languages g on g.org_id = x.org_id and g.id = x.language_id and g.is_active) l on l.professional_id = p.id
      left join (select distinct x.professional_id from public.professional_clienteles x
                   join public.clienteles k on k.org_id = x.org_id and k.id = x.clientele_id and k.is_active) c on c.professional_id = p.id
      left join (select x.professional_id, bool_or(mo.is_restricted) as has_restricted
                   from public.professional_motifs x
                   join public.motifs mo on mo.org_id = x.org_id and mo.id = x.motif_id and mo.is_active
                  group by x.professional_id) m on m.professional_id = p.id
      left join (select distinct x.professional_id from public.professional_submissions x
                  where x.kind = 'onboarding' and x.status = 'approved') sa on sa.professional_id = p.id
      left join private.professional_login_email_mismatches() as em(id) on em.id = p.id
      left join private.professional_signed_contracts() as sc(id) on sc.id = p.id
      -- One row per professional and active type of the clinic: satisfied or not, on the clinic's
      -- today; then one row per professional (grouped once per statement).
      left join (
        select s.professional_id,
               count(*) filter (where s.required) as required_n,
               count(*) filter (where s.required and s.ok) as required_done,
               bool_or(s.key = 'photo' and s.ok) as photo_ok,
               bool_or(s.key = 'insurance' and s.ok) as insurance_ok,
               bool_or(s.key = 'image_consent' and s.ok) as consent_ok,
               bool_or(s.key = 'photo' and s.required and not s.ok) as photo_missing,
               bool_or(s.key = 'insurance' and s.required and not s.ok) as insurance_missing,
               bool_or(s.key = 'image_consent' and s.required and not s.ok) as consent_missing,
               bool_or(not s.is_system and s.required and not s.ok) as other_missing,
               max(s.last_known) filter (where s.key = 'insurance') as insurance_expires_on,
               max(s.insurance_status) filter (where s.key = 'insurance') as insurance_status
          from (
            select x.id as professional_id, t.key, t.is_system, t.required,
                   (case when t.expiry_rule = 'none'
                           then coalesce(d.any_verified_open, false) or coalesce(d.withdrawn_until > x.today, false)
                         else coalesce(d.valid_until >= x.today, false) end) as ok,
                   d.last_known,
                   case when t.key <> 'insurance' then null
                        when t.expiry_rule = 'none' then case when coalesce(d.any_verified, false) then 'valid' else 'missing' end
                        when d.valid_until >= x.today then
                          case when t.max_days > 0 and d.valid_until - x.today <= t.max_days then 'expiring' else 'valid' end
                        when d.last_known is not null then 'expired'
                        else 'missing'
                   end as insurance_status
              from (select p2.id, p2.org_id, (pg_catalog.now() at time zone o.timezone)::date as today
                      from public.professionals p2
                      join public.organizations o on o.id = p2.org_id) x
              join (select dt.*, coalesce((select max(n) from pg_catalog.unnest(dt.reminder_days) n), 0) as max_days
                      from public.document_types dt where dt.is_active) t on t.org_id = x.org_id
              left join (select y.professional_id, y.document_type_id,
                                bool_or(y.status = 'verified') as any_verified,
                                -- V5: a verified document never withdrawn, and the latest withdrawal
                                -- date of a withdrawn one (in force until the day before).
                                bool_or(y.status = 'verified' and y.withdrawn_on is null) as any_verified_open,
                                max(y.withdrawn_on) filter (where y.status = 'verified') as withdrawn_until,
                                max(y.expires_on) filter (where y.status = 'verified') as valid_until,
                                max(y.expires_on) filter (where y.status in ('verified', 'expired')) as last_known
                           from public.professional_documents y
                          group by y.professional_id, y.document_type_id) d
                     on d.professional_id = x.id and d.document_type_id = t.id
          ) s
         group by s.professional_id
      ) dc on dc.professional_id = p.id
  ) r;

-- The Documents tab and « Mes documents »: *_professionals_image_consent_one_source.sql's, each
-- document with its withdrawal (the date, the note, who recorded it and when; the professional
-- reads her own: Loi 25, as her deactivation note, P4-373; the name only for staff).
create or replace function public.get_professional_documents(p_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_staff boolean := private.has_permission('professionals.view');
  v_own uuid := private.current_professional_id();
  v_pid uuid := coalesce(p_id, v_own);
  v_profile uuid;
begin
  if v_pid is null or v_org is null
     or not (v_staff or (v_pid = v_own and private.has_permission('professionals.self'))) then
    return null;
  end if;
  select p.profile_id into v_profile from public.professionals p where p.id = v_pid and p.org_id = v_org;
  if not found then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'professional_id', v_pid,
    'today', private.clinic_today(),
    'photo', (
      select pg_catalog.jsonb_build_object('document_id', d.id, 'file_id', d.stored_file_id)
        from public.professional_public_profiles x
        join public.professional_documents d on d.professional_id = x.professional_id and d.id = x.photo_document_id
       where x.professional_id = v_pid and x.org_id = v_org),
    'documents', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id', d.id, 'type_id', d.document_type_id, 'type_key', t.key, 'status', d.status,
               'expires_on', d.expires_on, 'metadata', d.metadata, 'uploaded_at', d.uploaded_at,
               'uploaded_by_self', d.uploaded_by is not null and d.uploaded_by is not distinct from v_profile,
               'reviewed_at', d.reviewed_at, 'reviewed_by_name', rv.display_name,
               'rejection_reason', d.rejection_reason, 'submission_id', d.submission_id,
               'signature_request_id', d.signature_request_id,
               'withdrawn_on', d.withdrawn_on, 'withdrawal_note', d.withdrawal_note,
               'withdrawn_at', d.withdrawn_at, 'withdrawn_by_name', wb.display_name,
               'file', case when f.id is not null then pg_catalog.jsonb_build_object(
                         'id', f.id, 'name', f.original_name, 'mime_type', f.mime_type, 'size_bytes', f.size_bytes) end)
             order by d.created_at desc, d.id desc)
        from public.professional_documents d
        join public.document_types t on t.org_id = d.org_id and t.id = d.document_type_id
        left join public.stored_files f on f.id = d.stored_file_id and f.status = 'ready'
        left join public.profiles rv on v_staff and rv.user_id = d.reviewed_by and rv.org_id = v_org
        left join public.profiles wb on v_staff and wb.user_id = d.withdrawn_by and wb.org_id = v_org
       where d.professional_id = v_pid and d.org_id = v_org), '[]'::jsonb),
    -- P4-507: the former e-consent is no longer read; the key stays (null) until the table goes.
    'consent', null,
    'staged', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'type_key', x.type_key, 'kind', x.kind, 'submission_id', s.id, 'status', s.status,
               'submitted_at', s.submitted_at)
             order by x.ord)
        from public.professional_submissions s
       cross join lateral (values
               (1, 'photo', 'photo', s.submitted_values #>> '{photo,file_id}'),
               (2, 'insurance', 'insurance', s.submitted_values #>> '{insurance,file_id}'),
               (3, 'image_consent', 'consent', null)) as x(ord, type_key, kind, file_id)
       where s.professional_id = v_pid and s.org_id = v_org and s.status in ('draft', 'submitted')
         and x.kind = any (s.requested_sections)
         -- The consent: her signature through Documenso while the request awaits its completion
         -- (it becomes a document then, P4-487); a draft's old e-consent answer no longer counts.
         and case when x.kind = 'consent' then exists (select 1 from public.signature_requests r
                                 join public.signature_request_signers g on g.request_id = r.id and g.role = 'professional'
                                where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = v_pid
                                  and r.purpose = 'professionals.image_consent' and r.status in ('sent', 'viewed')
                                  and g.signed_at is not null)
                  else exists (
                    select 1 from public.stored_files f
                     where f.id = x.file_id::uuid and f.org_id = v_org and f.status = 'ready'
                       and f.purpose = 'professional_submission_file'
                       and f.subject_type = 'professional_submission' and f.subject_id = s.id
                       and (f.retain_until is null or f.retain_until > pg_catalog.now())
                       and (v_staff or f.uploaded_by = auth.uid())) end), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- H7: a failed reminder puts the previous link back
-- -----------------------------------------------------------------------------
-- Core helper (reviewed as a core change, as private.issue_secure_link): puts p_previous_id back in
-- place of p_link_id, two links of p_org for the same purpose and subject. Only when p_link_id is
-- live and was never opened nor used (nobody relies on it), and p_previous_id was revoked, never
-- used and has not expired (its own lifetime, unchanged): p_link_id is revoked (by nobody, as a
-- job's revocation), then p_previous_id is live again (one live link per subject: in that order,
-- under issue_secure_link's advisory lock). Returns whether it did; false changes nothing.
create function private.restore_secure_link(p_org uuid, p_link_id uuid, p_previous_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_new public.secure_links;
  v_old public.secure_links;
begin
  select * into v_new from public.secure_links l where l.id = p_link_id and l.org_id = p_org for update;
  select * into v_old from public.secure_links l where l.id = p_previous_id and l.org_id = p_org for update;
  if v_new.id is null or v_old.id is null or v_new.id = v_old.id
     or v_new.purpose <> v_old.purpose or v_new.subject_type <> v_old.subject_type or v_new.subject_id <> v_old.subject_id then
    return false;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_org::text || v_new.purpose || v_new.subject_type || v_new.subject_id::text, 0));
  if v_new.revoked_at is not null or v_new.use_count > 0 or v_new.last_opened_at is not null
     or v_old.revoked_at is null or v_old.use_count > 0 or v_old.expires_at <= pg_catalog.now() then
    return false;
  end if;
  update public.secure_links l set revoked_at = pg_catalog.now(), revoked_by = null where l.id = v_new.id;
  update public.secure_links l set revoked_at = null, revoked_by = null where l.id = v_old.id;
  return true;
end;
$$;
revoke all on function private.restore_secure_link(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- *_professionals_invitation_delivery.sql's, with `previous_link_id`: the link the reminder
-- replaced, for restore_professional_invitation_for_service.
create or replace function public.reissue_professional_invitation_for_service(p_org uuid, p_id uuid, p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.professionals;
  v_due_link uuid;
  v_inviter uuid;
  v_link uuid;
  v_expires timestamptz;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_org is null or p_id is null or p_token_hash is null or pg_catalog.length(p_token_hash) <> 32 then
    raise exception 'Arguments invalides : organisation, professionnel et empreinte de 32 octets attendus.' using errcode = '22023';
  end if;
  -- The professional's lock first (the order of every writer of these links), then the rule.
  select * into v_row from public.professionals p where p.id = p_id and p.org_id = p_org for no key update;
  if not found then
    return null;
  end if;
  select r.link_id, r.created_by into v_due_link, v_inviter
    from private.professional_invitations_due_for_reminder(p_org, p_id, 1) r;
  if v_due_link is null then
    return null;
  end if;

  perform pg_catalog.set_config('app.audit_source', 'job:professionals.invitation_reminders', true);
  perform pg_catalog.set_config('app.audit_actor', '', true);

  -- The original inviter stays the link's author: the acceptance re-checks her (P3-31). The
  -- clinic's lifetime and the file's address in the scope (P4-300): the acceptance refuses a
  -- professional_invite link without it.
  v_link := private.issue_professional_invitation_link(p_org, p_id, p_token_hash, v_inviter);
  insert into public.professional_invitation_deliveries (org_id, professional_id, link_id, method, created_by)
  values (p_org, p_id, v_link, 'email', null);
  update public.professional_submissions s
     set secure_link_id = v_link
   where s.professional_id = p_id and s.org_id = p_org and s.kind = 'onboarding' and s.status = 'draft';

  select l.expires_at into v_expires from public.secure_links l where l.id = v_link;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return pg_catalog.jsonb_build_object('link_id', v_link, 'previous_link_id', v_due_link,
                                       'email', v_row.email, 'first_name', v_row.first_name,
                                       'expires_at', v_expires,
                                       'clinic_name', (select o.name from public.organizations o where o.id = p_org));
end;
$$;

-- SERVICE ROLE (professionals-invitation-reminders): the reminder's email did not leave, so the
-- link it carried is revoked and the one it replaced is live again (private.restore_secure_link's
-- conditions: the new one never opened nor used, the previous one unused and unexpired); the
-- draft questionnaire points to it again. Under the professional's lock (the order of every writer
-- of these links). Returns whether it did; false (nothing changed) when the file is gone, has an
-- account, or a link was used, opened or expired meanwhile: the new link then stays.
create function public.restore_professional_invitation_for_service(p_org uuid, p_id uuid, p_link_id uuid, p_previous_link_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.professionals;
  v_done boolean;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_org is null or p_id is null or p_link_id is null or p_previous_link_id is null then
    raise exception 'Arguments invalides : organisation, professionnel et liens attendus.' using errcode = '22023';
  end if;
  select * into v_row from public.professionals p where p.id = p_id and p.org_id = p_org for no key update;
  if not found or v_row.profile_id is not null then
    return false;
  end if;
  if not exists (select 1 from public.secure_links l
                  where l.id = p_link_id and l.org_id = p_org and l.purpose = 'professional_invite'
                    and l.subject_type = 'professional' and l.subject_id = p_id) then
    return false;
  end if;

  perform pg_catalog.set_config('app.audit_source', 'job:professionals.invitation_reminders', true);
  perform pg_catalog.set_config('app.audit_actor', '', true);
  v_done := private.restore_secure_link(p_org, p_link_id, p_previous_link_id);
  if v_done then
    update public.professional_submissions s
       set secure_link_id = p_previous_link_id
     where s.professional_id = p_id and s.org_id = p_org and s.kind = 'onboarding' and s.status = 'draft'
       and s.secure_link_id = p_link_id;
  end if;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return v_done;
end;
$$;
revoke all on function public.restore_professional_invitation_for_service(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.restore_professional_invitation_for_service(uuid, uuid, uuid, uuid) to service_role;

select pg_catalog.set_config('app.audit_source', '', true);
