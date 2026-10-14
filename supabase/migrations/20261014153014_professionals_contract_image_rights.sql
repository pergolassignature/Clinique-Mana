-- =============================================================================
-- Professionnels: the service contract carries the image rights (its article 6.2)
-- =============================================================================
-- Asked:   Jonathan, 2026-10-14: the 2026 « Convention de prestation de services professionnels »
--          also carries the image-rights authorisation. Decisions P4-557 … P4-560
--          (docs/plans/2026-10-07-decisions-log.md), superseding P4-481's « second form for every
--          professional » for those who sign it.
-- Needs:   *_professionals_contract_2026.sql (the template's `grantsImageRights` mark),
--          *_professionals_consent_withdrawal_invitation_restore.sql (the readiness view,
--          get_professional_documents, the withdrawal), *_professionals_image_consent_one_source.sql
--          (submission_gaps), *_professionals_review_documenso_consent.sql (get_submission_review),
--          *_professionals_image_consent.sql (get_my_image_consent), *_professionals_onboarding.sql
--          (create_professional_submission), *_professionals_contract_paper_renew.sql (the contract
--          in force, P4-522)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * The mark (P4-557): a template version grants the image rights when its body says so at its top
--   level, `"grantsImageRights": true` (the PDF model's optional flag; the 2026 text has it). The
--   body is copied into each new version and kept by the editor, so the clinic's later versions
--   keep it; published versions never change, so a signed request's version says for good what
--   was signed. A paper contract grants nothing (its text is not known).
-- * The rights (P4-558): the professional's contract in force (P4-522: the latest of the signed
--   requests by completion and the paper contracts by upload) is a signed request on a version with
--   the mark → private.contract_image_rights(org) {professional_id, signed_at, in_force}; in force
--   unless a withdrawal took effect (below). They count as the image consent everywhere the consent
--   is read: private.professional_image_consent_valid_until (so submission_gaps, the
--   professional's « Signer le consentement » and the review), the readiness view (consent_ok,
--   documents_missing, documents_ok, ready: one rule for every reader and for the weekly job,
--   through private.professional_contract_image_rights(), a definer helper like
--   professional_signed_contracts), get_professional_documents (`image_rights_contract`, for the
--   Documents tab, « Mes documents », the fiche's photo and Profil public), get_my_image_consent
--   (`by_contract`) and get_submission_review (`current` {source: 'contract', signed_at}). A
--   separate image consent the professional signed keeps counting as before.
-- * The withdrawal (P4-559, consistent with P4-549): recorded on the professional,
--   professional_image_rights_withdrawals (one row each: the first day without the rights, a note,
--   who and when), by withdraw_professional_image_consent (same signature and permission), which
--   still marks the consent documents in force and now also counts the contract's rights. It wins
--   over every service contract, signed before or after (signing a renewal never grants again
--   what she withdrew); a separate consent signed later is a new document, in force again
--   (P4-549). A withdrawal still to come may be corrected; one that took effect stays. The table is
--   closed (definer RPCs only), audited (Historique), and backfilled from the withdrawals already
--   recorded on documents (before its audit trigger: those are already in Historique).
-- * Asking (P4-560): once the clinic's published « Contrat de service » has the mark
--   (private.service_contract_grants_image_rights), an invitation's questionnaire has no
--   « Consentement » step (create_professional_submission drops it for `onboarding`), a draft that
--   has one counts it complete (submission_gaps), and the app says the contract carries it
--   (`contract_grants_image_rights`, `contract_grants`). Staff can still send the separate form,
--   e.g. to a professional under an older contract.
-- * Additive: one table, four helpers, one view and seven functions replaced with the same
--   signatures and grants.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_contract_image_rights', true);

-- -----------------------------------------------------------------------------
-- The withdrawal, on the professional
-- -----------------------------------------------------------------------------
create table public.professional_image_rights_withdrawals (
  professional_id uuid not null,
  org_id uuid not null,
  -- The first day without the image rights (a calendar date, never converted, CLAUDE.md §9).
  withdrawn_on date not null,
  withdrawal_note text,
  withdrawn_at timestamptz not null default now(),
  withdrawn_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One per professional; the audit record id is the professional's id (P4-36), so Historique finds it.
  constraint professional_image_rights_withdrawals_pkey primary key (professional_id),
  constraint professional_image_rights_withdrawals_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_image_rights_withdrawals_withdrawn_by_fkey foreign key (withdrawn_by)
    references public.profiles (user_id) on delete set null,
  constraint professional_image_rights_withdrawals_withdrawn_on_check
    check (withdrawn_on between date '2000-01-01' and date '2100-12-31'),
  constraint professional_image_rights_withdrawals_note_check check (
    pg_catalog.char_length(withdrawal_note) <= 1000 and pg_catalog.btrim(withdrawal_note, E' \t\r\n') <> '')
);
create index professional_image_rights_withdrawals_org_idx on public.professional_image_rights_withdrawals (org_id, professional_id);
create index professional_image_rights_withdrawals_withdrawn_by_idx on public.professional_image_rights_withdrawals (withdrawn_by)
  where withdrawn_by is not null;

-- No client reads or writes it: withdraw_professional_image_consent writes it, the definer reads
-- return what each reader may see.
revoke all on public.professional_image_rights_withdrawals from anon, authenticated;
alter table public.professional_image_rights_withdrawals enable row level security;
create trigger professional_image_rights_withdrawals_set_updated_at
  before update on public.professional_image_rights_withdrawals
  for each row execute function private.set_updated_at();

-- The withdrawals already recorded on consent documents (P4-549): the latest one of each
-- professional who has no row yet. Returns how many rows it added. Idempotent.
create function private.professionals_image_rights_backfill()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  insert into public.professional_image_rights_withdrawals
    (professional_id, org_id, withdrawn_on, withdrawal_note, withdrawn_at, withdrawn_by)
  select distinct on (d.professional_id) d.professional_id, d.org_id, d.withdrawn_on, d.withdrawal_note, d.withdrawn_at, d.withdrawn_by
    from public.professional_documents d
    join public.document_types t on t.org_id = d.org_id and t.id = d.document_type_id and t.key = 'image_consent'
   where d.withdrawn_on is not null
   order by d.professional_id, d.withdrawn_at desc, d.id desc
  on conflict (professional_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.professionals_image_rights_backfill() from public, anon, authenticated, service_role;

select private.professionals_image_rights_backfill();

-- Audited from now on (the backfilled rows are already in Historique, on their documents).
create trigger professional_image_rights_withdrawals_audit
  after insert or update or delete on public.professional_image_rights_withdrawals
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- The helpers
-- -----------------------------------------------------------------------------
-- Whether the clinic's published « Contrat de service » grants the image rights (P4-560).
create function private.service_contract_grants_image_rights(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select v.body -> 'grantsImageRights' = 'true'::jsonb
                     from public.document_templates t
                     join public.document_template_versions v on v.template_id = t.id and v.status = 'published'
                    where t.org_id = p_org and t.key = 'professionals.service_contract' and t.is_active), false)
$$;
revoke all on function private.service_contract_grants_image_rights(uuid) from public, anon, authenticated, service_role;

-- The professionals of p_org (every clinic when null: the weekly job reads the readiness view
-- with no user) whose contract in force (P4-522) is a signed request on a version that grants the
-- image rights (P4-557): {org_id, professional_id, signed_at (its completion), in_force (no
-- withdrawal took effect on the clinic's today, P4-559)}. A paper contract grants nothing.
create function private.contract_image_rights(p_org uuid)
returns table (org_id uuid, professional_id uuid, signed_at timestamptz, in_force boolean)
language sql
stable
security definer
set search_path = ''
rows 50
as $$
  select c.org_id, c.professional_id, c.since,
         not exists (select 1 from public.professional_image_rights_withdrawals w
                      where w.professional_id = c.professional_id and w.org_id = c.org_id
                        and w.withdrawn_on <= private.clinic_today_for_org(c.org_id))
    from (select distinct on (x.professional_id) x.org_id, x.professional_id, x.since, x.grants
            from (select r.org_id, r.subject_id as professional_id, r.id,
                         coalesce(r.completed_at, r.completed_event_at, r.created_at) as since,
                         coalesce(v.body -> 'grantsImageRights' = 'true'::jsonb, false) as grants
                    from public.signature_requests r
                    join public.document_template_versions v on v.id = r.template_version_id
                   where (p_org is null or r.org_id = p_org)
                     and r.subject_type = 'professional'
                     and r.purpose = 'professionals.service_contract' and r.status = 'signed'
                  union all
                  select pc.org_id, pc.professional_id, pc.id, pc.created_at, false
                    from public.professional_paper_contracts pc
                   where p_org is null or pc.org_id = p_org) x
           order by x.professional_id, x.since desc, x.id desc) c
   where c.grants
$$;
revoke all on function private.contract_image_rights(uuid) from public, anon, authenticated, service_role;

-- For the invoker readiness view: the professionals whose contract's image rights are in force,
-- of the caller's clinic, filtered like professional_signed_contracts (every one for
-- professionals.view, else the caller's own file), so consent_ok is the same for every reader; with
-- no user at all (the weekly job, a definer function), every clinic's.
create function private.professional_contract_image_rights()
returns setof uuid
language sql
stable
security definer
set search_path = ''
rows 50
as $$
  select c.professional_id
    from private.contract_image_rights(case when (select auth.uid()) is null then null
                                            else coalesce((select private.current_user_org_id()),
                                                          '00000000-0000-0000-0000-000000000000'::uuid) end) c
   where c.in_force
     and ((select auth.uid()) is null
          or (c.org_id = (select private.current_user_org_id())
              and ((select private.has_permission('professionals.view'))
                   or (c.professional_id = (select private.current_professional_id())
                       and (select private.has_permission('professionals.self'))))))
$$;
-- Called by the invoker views with the reader's privileges (not service_role, as
-- professional_signed_contracts).
revoke all on function private.professional_contract_image_rights() from public, anon, authenticated, service_role;
grant execute on function private.professional_contract_image_rights() to authenticated;

-- In force: *_professionals_consent_withdrawal_invitation_restore.sql's, or the contract's rights
-- (P4-558). Same signature; its callers test `is not null`.
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
           or exists (select 1 from private.contract_image_rights(p_org) c where c.professional_id = p_pid and c.in_force)
         then date '2100-12-31' end
$$;

-- -----------------------------------------------------------------------------
-- Readiness: *_professionals_consent_withdrawal_invitation_restore.sql's view; the image consent
-- is also satisfied by the contract's rights (P4-558)
-- -----------------------------------------------------------------------------
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
                   (case when t.key = 'image_consent' and ir.id is not null then true
                         when t.expiry_rule = 'none'
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
              -- P4-558: a signed contract in force that grants the image rights, not withdrawn.
              left join private.professional_contract_image_rights() as ir(id) on ir.id = x.id
          ) s
         group by s.professional_id
      ) dc on dc.professional_id = p.id
  ) r;


-- -----------------------------------------------------------------------------
-- The Documents tab and « Mes documents »: *_professionals_consent_withdrawal_invitation_restore.sql's,
-- with the contract's rights, the withdrawal on the professional and the published contract's mark
-- -----------------------------------------------------------------------------
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
    -- P4-558: the contract in force grants the image rights (its signature, whether a withdrawal
    -- took effect), else null; never the contract itself (P4-527).
    'image_rights_contract', (
      select pg_catalog.jsonb_build_object('signed_at', c.signed_at, 'in_force', c.in_force)
        from private.contract_image_rights(v_org) c
       where c.professional_id = v_pid),
    -- P4-559: the withdrawal recorded on the professional (the name only for staff).
    'image_rights_withdrawal', (
      select pg_catalog.jsonb_build_object('withdrawn_on', x.withdrawn_on, 'withdrawal_note', x.withdrawal_note,
                                           'withdrawn_at', x.withdrawn_at, 'withdrawn_by_name', wb.display_name)
        from public.professional_image_rights_withdrawals x
        left join public.profiles wb on v_staff and wb.user_id = x.withdrawn_by and wb.org_id = v_org
       where x.professional_id = v_pid and x.org_id = v_org),
    -- P4-560: the clinic's published contract grants them (a new professional signs no separate form).
    'contract_grants_image_rights', private.service_contract_grants_image_rights(v_org),
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
-- « Retrait du consentement »: *_professionals_consent_withdrawal_invitation_restore.sql's, the
-- contract's rights too, recorded on the professional (P4-559). Returns how many consents it
-- marked (the documents, plus one for the contract). Same signature, permission and refusals.
-- -----------------------------------------------------------------------------
create or replace function public.withdraw_professional_image_consent(p_id uuid, p_withdrawn_on date, p_note text default null)
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
  v_contract boolean;
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
  -- The contract in force grants the rights and no withdrawal took effect yet (none, or one still
  -- to come: a correction of its date).
  v_contract := exists (select 1 from private.contract_image_rights(v_org) c
                         where c.professional_id = p_id
                           and not exists (select 1 from public.professional_image_rights_withdrawals x
                                            where x.professional_id = p_id and x.org_id = v_org
                                              and x.withdrawn_on <= v_today));
  if v_contract then
    v_count := v_count + 1;
  end if;
  if v_count = 0 then
    raise exception 'Aucun consentement au droit à l''image en vigueur dans ce dossier.' using errcode = 'P0001', hint = 'document';
  end if;
  -- On the professional (P4-559): it wins over every service contract, signed before or after; a
  -- withdrawal that took effect stays as it is (a later one only marks the new documents).
  insert into public.professional_image_rights_withdrawals as x
    (professional_id, org_id, withdrawn_on, withdrawal_note, withdrawn_at, withdrawn_by)
  values (p_id, v_org, p_withdrawn_on, v_note, pg_catalog.now(), auth.uid())
  on conflict (professional_id) do update
     set withdrawn_on = excluded.withdrawn_on, withdrawal_note = excluded.withdrawal_note,
         withdrawn_at = excluded.withdrawn_at, withdrawn_by = excluded.withdrawn_by
   where x.withdrawn_on > v_today;
  update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id and p.org_id = v_org;
  return v_count;
end;
$$;


-- -----------------------------------------------------------------------------
-- The questionnaire's gaps: *_professionals_image_consent_one_source.sql's (P4-560)
-- -----------------------------------------------------------------------------
create or replace function private.submission_gaps(p_sub public.professional_submissions)
returns text[]
language sql
stable
set search_path = ''
as $$
  with v as (select p_sub.submitted_values as j),
  sp as (select s.* from public.professional_submission_private s
          where s.submission_id = p_sub.id and s.org_id = p_sub.org_id),
  pp as (select x.* from public.professional_private x
          where x.professional_id = p_sub.professional_id and x.org_id = p_sub.org_id),
  bank as (
    select coalesce((select sp.bank_institution from sp), (select pp.bank_institution from pp)) is not null as has_institution,
           coalesce((select sp.bank_transit from sp), (select pp.bank_transit from pp)) is not null as has_transit,
           (exists (select 1 from sp where sp.bank_account is not null)
            or exists (select 1 from pp where pp.bank_account is not null)) as has_account
  )
  select coalesce(pg_catalog.array_agg(s.section order by s.ord), '{}')
    from pg_catalog.unnest(private.submission_sections()) with ordinality as s(section, ord), v, bank b
   where s.section = any (p_sub.requested_sections)
     and not coalesce(case s.section
       when 'personal' then
         v.j #>> '{personal,personal_phone}' is not null and v.j #>> '{personal,address_line1}' is not null
         and v.j #>> '{personal,city}' is not null and v.j #>> '{personal,province}' is not null
         and v.j #>> '{personal,postal_code}' is not null
       when 'professional' then pg_catalog.jsonb_array_length(coalesce(v.j #> '{professional,professions}', '[]')) > 0
       when 'portrait' then v.j #>> '{portrait,bio}' is not null
       when 'languages' then pg_catalog.jsonb_array_length(coalesce(v.j #> '{languages,language_ids}', '[]')) > 0
       when 'clienteles' then pg_catalog.jsonb_array_length(coalesce(v.j #> '{clienteles,clienteles}', '[]')) > 0
       when 'motifs' then pg_catalog.jsonb_array_length(coalesce(v.j #> '{motifs,motif_ids}', '[]')) > 0
       when 'availability' then v.j ? 'availability'
       when 'photo' then exists (
         select 1 from public.stored_files f
          where f.id = (v.j #>> '{photo,file_id}')::uuid and f.org_id = p_sub.org_id and f.status = 'ready'
            and f.subject_type = 'professional_submission' and f.subject_id = p_sub.id
            and (f.retain_until is null or f.retain_until > pg_catalog.now()))
       when 'insurance' then (v.j #>> '{insurance,expires_on}')::date >= private.clinic_today() and exists (
         select 1 from public.stored_files f
          where f.id = (v.j #>> '{insurance,file_id}')::uuid and f.org_id = p_sub.org_id and f.status = 'ready'
            and f.subject_type = 'professional_submission' and f.subject_id = p_sub.id
            and (f.retain_until is null or f.retain_until > pg_catalog.now()))
       when 'tax_bank' then exists (select 1 from sp)
         -- All three or none (P4-480).
         and b.has_institution = b.has_transit and b.has_transit = b.has_account
         and (not coalesce((private.professionals_setting(p_sub.org_id, 'collect_sin'))::boolean, false)
              or exists (select 1 from sp where sp.sin is not null) or exists (select 1 from pp where pp.sin is not null))
       -- P4-487, P4-507: a consent on file (signed through Documenso, or a paper one staff
       -- attached), or nothing to sign yet (no published form: the clinic sends it later, never a
       -- block). A draft's old e-consent answer no longer counts.
       -- P4-560: or the clinic's published contract carries it (nothing to sign here).
       when 'consent' then private.professional_image_consent_valid_until(p_sub.org_id, p_sub.professional_id) is not null
                           or private.published_image_consent_version(p_sub.org_id) is null
                           or private.service_contract_grants_image_rights(p_sub.org_id)
     end, false)
$$;


-- -----------------------------------------------------------------------------
-- The review sheet: *_professionals_review_documenso_consent.sql's, the contract on file (P4-558)
-- -----------------------------------------------------------------------------
create or replace function public.get_submission_review(p_submission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_sub public.professional_submissions;
  v_snapshot jsonb;
  v_available text[];
begin
  if not private.has_permission('professionals.review') then
    raise exception 'Permission refusée : professionals.review' using errcode = '42501';
  end if;
  select * into v_sub from public.professional_submissions s where s.id = p_submission_id and s.org_id = v_org;
  if not found then
    return null;
  end if;
  v_snapshot := private.professional_submission_snapshot(v_org, v_sub.professional_id);
  v_available := private.submission_available_fields(v_sub);

  return (
    with sp as (select pg_catalog.to_jsonb(x) as j from public.professional_submission_private x
                 where x.submission_id = v_sub.id and x.org_id = v_org),
    pp as (select pg_catalog.to_jsonb(x) as j from public.professional_private x
            where x.professional_id = v_sub.professional_id and x.org_id = v_org),
    -- The image consent's signatures through Documenso (P4-487): when the professional signed.
    signed as (
      select r.id, coalesce((select max(x.signed_at) from public.signature_request_signers x
                              where x.request_id = r.id and x.role = 'professional'), r.completed_at) as signed_at
        from public.signature_requests r
       where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = v_sub.professional_id
         and r.purpose = 'professionals.image_consent' and r.status = 'signed'),
    -- The consent on file (P4-507: the Documenso path only), the newest of: a signature through
    -- Documenso, a paper consent staff attached (verified). No end date (P4-504).
    consent_now as (
      select x.j
        from (select pg_catalog.jsonb_build_object('source', 'signature', 'request_id', signed.id, 'signed_at', signed.signed_at) as j,
                     signed.signed_at as at
                from signed
              union all
              select pg_catalog.jsonb_build_object('source', 'document', 'uploaded_at', d.uploaded_at), d.uploaded_at
                from public.professional_documents d
                join public.document_types t on t.org_id = d.org_id and t.id = d.document_type_id and t.key = 'image_consent'
               where d.professional_id = v_sub.professional_id and d.org_id = v_org and d.status = 'verified'
                 and d.signature_request_id is null
              -- P4-558: the contract in force that grants the image rights (not withdrawn).
              union all
              select pg_catalog.jsonb_build_object('source', 'contract', 'signed_at', ci.signed_at), ci.signed_at
                from private.contract_image_rights(v_org) ci
               where ci.professional_id = v_sub.professional_id and ci.in_force) x
       order by x.at desc nulls last
       limit 1),
    -- Signed through Documenso since this questionnaire opened: the « Consentement » step's answer.
    consent_here as (
      select pg_catalog.jsonb_build_object('source', 'signature', 'request_id', signed.id, 'signed_at', signed.signed_at) as j
        from signed
       where signed.signed_at >= v_sub.created_at
       order by signed.signed_at desc
       limit 1),
    f as (
      select x.section, x.field, x.kind, x.ord,
             case x.kind
               when 'plain' then nullif(v_snapshot -> x.section -> x.field, 'null'::jsonb)
               when 'set' then v_snapshot -> x.section -> x.field
               when 'consent' then (select consent_now.j from consent_now)
             end as cur,
             case x.kind
               when 'plain' then nullif(v_sub.submitted_values -> x.section -> x.field, 'null'::jsonb)
               when 'set' then v_sub.submitted_values -> x.section -> x.field
               when 'file' then v_sub.submitted_values -> x.section
               -- is_latest: still the latest published text (apply refuses it otherwise, P4-305), so the
               -- sheet can say so before « Appliquer » (P4-378).
               -- P4-505, P4-507: the step's answer is her Documenso signature (a draft's old
               -- e-consent answer is no longer read).
               when 'consent' then (select consent_here.j from consent_here)
             end as sub,
             (x.field = any (v_available)) as available
        from private.submission_fields() x
       where x.section = any (v_sub.requested_sections))
    select pg_catalog.jsonb_build_object(
      'submission', pg_catalog.jsonb_build_object(
        'id', v_sub.id, 'professional_id', v_sub.professional_id, 'kind', v_sub.kind, 'status', v_sub.status,
        'requested_sections', v_sub.requested_sections, 'submitted_at', v_sub.submitted_at,
        'reviewed_at', v_sub.reviewed_at,
        'reviewed_by_name', (select pr.display_name from public.profiles pr where pr.user_id = v_sub.reviewed_by and pr.org_id = v_org),
        'decision_note', v_sub.decision_note, 'applied_fields', v_sub.applied_fields,
        'private_saved_at', v_sub.private_saved_at),
      'sections', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('section', g.section, 'fields', g.fields) order by g.ord)
          from (select f.section, min(f.ord) as ord,
                       pg_catalog.jsonb_agg(
                         case when f.kind = 'private' then
                           pg_catalog.jsonb_build_object(
                             'field', f.field, 'label_key', 'modules.professionals.submission.fields.' || f.field, 'kind', f.kind,
                             'answered', f.available,
                             'changed', f.available and (f.field in ('bank_account', 'sin')
                                                         or (select sp.j -> f.field from sp) is distinct from (select pp.j -> f.field from pp)))
                         else
                           pg_catalog.jsonb_build_object(
                             'field', f.field, 'label_key', 'modules.professionals.submission.fields.' || f.field, 'kind', f.kind,
                             'answered', f.available, 'current', f.cur, 'submitted', f.sub,
                             'changed', f.available and case f.kind
                               when 'file' then true
                               when 'consent' then true
                               when 'set' then case when f.field = 'professions'
                                                    then private.canonical_professions(f.cur) is distinct from private.canonical_professions(f.sub)
                                                    else f.cur is distinct from f.sub end
                               else f.cur is distinct from f.sub end)
                         end order by f.ord) as fields
                  from f
                 group by f.section) g), '[]'))
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- The « Consentement » step: *_professionals_image_consent.sql's, with `by_contract` and
-- `contract_grants`
-- -----------------------------------------------------------------------------
create or replace function public.get_my_image_consent()
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
  v_pid := private.my_professional_id();
  if v_pid is null then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'available', private.published_image_consent_version(v_org) is not null,
    'valid_until', private.professional_image_consent_valid_until(v_org, v_pid),
    -- P4-558: in force through her signed contract (no separate form needed).
    'by_contract', exists (select 1 from private.contract_image_rights(v_org) c
                            where c.professional_id = v_pid and c.in_force),
    -- P4-560: the clinic's published contract carries it.
    'contract_grants', private.service_contract_grants_image_rights(v_org),
    'request', (select pg_catalog.jsonb_build_object(
                         'status', r.status, 'last_error', r.last_error, 'sent_at', r.sent_at,
                         'completed_at', r.completed_at,
                         -- Core's downloads of her signed PDF (her own file, P4-485): the names and N.
                         'title', r.title, 'signed_file_id', r.signed_file_id, 'source_file_id', r.source_file_id,
                         'page_count', r.page_count,
                         'signed_at', (select max(x.signed_at) from public.signature_request_signers x
                                        where x.request_id = r.id and x.role = 'professional'))
                  from public.signature_requests r
                 where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = v_pid
                   and r.purpose = 'professionals.image_consent'
                 order by r.created_at desc, r.id desc
                 limit 1));
end;
$$;


-- -----------------------------------------------------------------------------
-- A new questionnaire: *_professionals_onboarding.sql's, no « Consentement » step in an invitation
-- once the contract carries it (P4-560)
-- -----------------------------------------------------------------------------
create or replace function private.create_professional_submission(
  p_org uuid, p_id uuid, p_kind text, p_sections text[], p_link uuid, p_by uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_snapshot jsonb := private.professional_submission_snapshot(p_org, p_id);
  v_id uuid;
begin
  -- P4-560: once the clinic's published contract carries the image rights, an invitation's
  -- questionnaire has no « Consentement » step (an update staff ask for keeps it).
  if p_kind = 'onboarding' and private.service_contract_grants_image_rights(p_org) then
    p_sections := pg_catalog.array_remove(p_sections, 'consent');
  end if;
  insert into public.professional_submissions (org_id, professional_id, kind, requested_sections, prefill, secure_link_id, requested_by)
  values (p_org, p_id, p_kind, p_sections,
          coalesce((select pg_catalog.jsonb_object_agg(e.key, e.value)
                      from pg_catalog.jsonb_each(v_snapshot) e
                     where e.key = any (p_sections)), '{}'),
          p_link, p_by)
  returning id into v_id;
  return v_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- Historique reads the withdrawals (*_professionals_matching_exclusions.sql's list, widened)
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
               'professional_contract_snapshots',
               'professional_refused_motifs', 'professional_matching_priorities',
               'professional_image_rights_withdrawals']
$$;


select pg_catalog.set_config('app.audit_source', '', true);
