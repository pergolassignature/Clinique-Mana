-- =============================================================================
-- Professionnels: « Dépôt direct » is optional in the questionnaire (P4-480, décidée par Jonathan,
-- 2026-10-09; reverses the deposit part of P4-173)
-- =============================================================================
-- « Fiscalité et banque » is complete with the three bank values (institution, transit, account)
-- all empty, or all three present — entered in the questionnaire or already on file, as before.
-- One or two of them is a gap: a partial deposit is useless. The rest of the rule is unchanged: the
-- step saved, and the SIN while collect_sin is on.
--
-- Only private.submission_gaps (read by submit_my_submission) required the deposit:
-- save_my_submission_private already accepted blanks (its format checks stay as they are),
-- apply_professional_submission applies only the values entered, the staff « Banque » card accepts
-- partial data (P4-141), readiness never read the deposit, and the service contract neither prints
-- nor requires it. Encryption and redaction are untouched (ADR 0004).
-- =============================================================================

-- The requested sections that are not complete, in questionnaire order. A section is complete when
-- saved with what the clinic needs: phone and address; a title; a presentation; a language, a
-- clientèle, a motif; the availability saved; a photo and an insurance (file still staged, expiry
-- not passed); the step « Fiscalité et banque » saved, with a deposit that is either empty or whole
-- (institution, transit and account, entered here or already on file; P4-480), and the SIN while
-- collect_sin is on; the latest published consent signed.
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
       when 'consent' then (v.j #>> '{consent,consent_version_id}')::uuid
                           = private.current_consent_version(p_sub.org_id, 'image_rights')
     end, false)
$$;
revoke all on function private.submission_gaps(public.professional_submissions) from public, anon, authenticated, service_role;
