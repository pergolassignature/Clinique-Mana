-- =============================================================================
-- Professionnels: the image consent never expires, and has one source (Documenso)
-- =============================================================================
-- Asked:   Jonathan, 2026-10-09: « Le consentement au droit à l'image n'expire pas » (decision
--          P4-504, superseding the 12-month rule of P4-273 and P4-481 – P4-488 wherever they set
--          it); the coordinator's database audit, 2026-10-09: one source of truth, the Documenso
--          path (decision P4-507)
-- Needs:   *_professionals_documents.sql (document types, their seed, document_default_expiry),
--          *_professionals_onboarding.sql (professional_consents, the review and apply),
--          *_professionals_contracts.sql (the readiness view), *_professionals_image_consent.sql
--          (the Documenso template, the signed consent's document, the questionnaire's gaps,
--          get_professional_documents, professional_image_consent_valid_until),
--          *_professionals_drop_sign_my_consent.sql
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * No expiry (P4-504). The type « Consentement droit à l'image » has no expiry rule (`none`) in
--   every clinic, seeded so for a new one, and a check keeps it so
--   (`document_types_image_consent_no_expiry`; « Documents requis » no longer offers a rule for
--   it). So the P4-485 trigger files a signed consent with no end date
--   (document_default_expiry('none') is null; the document is verified), staff attach a paper one
--   without a date (attach_professional_document refuses a date for a rule-less type), « Modifier
--   l'échéance » is not offered, and the insurance job never marks one expired (it marks verified
--   documents past a last day; these have none). No notice or reminder ever concerned it (P4-402).
-- * One source (P4-507). The consent in force is a verified « Consentement droit à l'image »
--   document: the one the P4-485 trigger files when the Documenso request is signed, or a paper
--   consent staff attached. The retired in-app e-consent (professional_consents, consent_versions;
--   sign_my_consent already dropped) is no longer read nor written; the tables stay until a
--   cleanup migration drops them. So:
--   - professional_image_consent_valid_until: a verified document → 2100-12-31 (« no end », as
--     for any document without one), else null (the withdrawal columns, never written, are no
--     longer read);
--   - the readiness view (consent_ok, documents_missing: the list, the directory, « À
--     surveiller », the job's « documents manquants » notice): the document only;
--   - submission_gaps: the consent section is complete when a consent is on file or no form is
--     published; a draft's old e-consent answer no longer counts;
--   - submission_available_fields: the consent is never an applicable field, and
--     apply_professional_submission no longer refuses nor writes it (its latest definitions,
--     otherwise unchanged);
--   - get_professional_documents: `consent` is always null (the key stays for the clients still
--     parsing it) and the staged consent is her Documenso signature awaiting completion only.
--   get_submission_review is redefined by *_professionals_review_documenso_consent.sql.
-- * Data, idempotent (private.professionals_image_consent_no_expiry, run once below):
--   - image_consent documents lose their end date; one marked `expired` by the old rule is
--     verified again;
--   - the Documenso template `professionals.image_consent`: its default (section 3 « Durée »:
--     « valide sans limite de durée à compter de la date de signature, sauf retrait de ma part »)
--     and, in each clinic, the seeded clause (« 12 mois … renouvelé automatiquement … ») where it
--     still stands verbatim: a draft is corrected in place; a published version is never edited:
--     a new version (the published one with the corrected clause) is published as « Publier »
--     would (the previous one archived first), when the clinic has no draft (a draft holds the
--     clinic's own next edits: it is corrected, and the published one is reported, never
--     published over). Any other wording that still mentions « 12 mois » or « renouvel » is left
--     to the clinic and reported (a NOTICE).
-- * Nothing else changes: the insurance and the other types keep their rules.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_image_consent_one_source', true);

-- -----------------------------------------------------------------------------
-- The type: no expiry, for every new clinic (the existing ones: the data fix below)
-- -----------------------------------------------------------------------------
create or replace function private.seed_professionals_document_types(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_any constant text[] := array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword',
                                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
begin
  perform pg_catalog.set_config('app.audit_source', 'seed:professionals_document_types', true);
  insert into public.document_types
    (org_id, key, name, is_system, required, expiry_rule, reminder_days, weekly_after_expiry, accepted_mime, max_bytes, sort_order)
  values
    (p_org, 'photo', 'Photo professionnelle', true, true, 'none', '{}', false, array['image/jpeg', 'image/png'], 5242880, 10),
    (p_org, 'insurance', 'Preuve d''assurance responsabilité', true, true, 'next_march_31', '{7}', true,
     array['application/pdf', 'image/jpeg', 'image/png'], 10485760, 20),
    (p_org, 'image_consent', 'Consentement droit à l''image', true, true, 'none', '{}', false,
     array['application/pdf', 'image/jpeg', 'image/png'], 10485760, 30),
    (p_org, 'cv', 'CV', false, false, 'none', '{}', false, v_any, 10485760, 40),
    (p_org, 'diploma', 'Diplôme', false, false, 'none', '{}', false, v_any, 10485760, 50),
    (p_org, 'licence_attestation', 'Attestation de permis', false, false, 'none', '{}', false, v_any, 10485760, 60),
    (p_org, 'other', 'Autre', false, false, 'none', '{}', false, v_any, 10485760, 70)
  on conflict do nothing;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

-- -----------------------------------------------------------------------------
-- The Documenso template's default text (section 3 « Durée »: no time limit)
-- -----------------------------------------------------------------------------
create or replace function private.professionals_image_consent_template()
returns jsonb
language sql
immutable
set search_path = ''
as $tpl$
  select $json${
  "body": {
    "title": "Consentement au droit à l’image",
    "header": {"text": "Consentement au droit à l’image"},
    "footer": {"text": "Formulaire de consentement au droit à l’image"},
    "blocks": [
      {"type": "paragraph", "runs": [{"text": "Texte à faire valider par la direction avant publication", "bold": true}]},
      {"type": "heading", "level": 1, "text": "Formulaire de consentement au droit à l’image"},
      {"type": "paragraph", "runs": [{"text": "Je, soussigné(e), "}, {"text": "{{professional.full_name}}", "bold": true}, {"text": ", consens à ce qui suit."}]},
      {"type": "heading", "level": 2, "text": "1. Objet"},
      {"type": "paragraph", "runs": [{"text": "Par la présente, j’autorise {{clinic.name}} à utiliser ma photo professionnelle à des fins de présentation de mon profil sur le site web et les supports de communication de la clinique."}]},
      {"type": "heading", "level": 2, "text": "2. Utilisation autorisée"},
      {"type": "paragraph", "runs": [{"text": "J’accepte que ma photo soit utilisée pour :"}]},
      {"type": "list", "ordered": false, "items": [
        [{"text": "Mon profil professionnel sur le site web de {{clinic.name}}"}],
        [{"text": "La fiche professionnelle qui me sera attribuée"}],
        [{"text": "Les communications internes de la clinique"}]
      ]},
      {"type": "heading", "level": 2, "text": "3. Durée"},
      {"type": "paragraph", "runs": [{"text": "Ce consentement est valide "}, {"text": "sans limite de durée", "bold": true}, {"text": " à compter de la date de signature, sauf retrait de ma part."}]},
      {"type": "heading", "level": 2, "text": "4. Droit de retrait"},
      {"type": "paragraph", "runs": [{"text": "Je comprends que je peux retirer mon consentement à tout moment en envoyant un préavis écrit de "}, {"text": "3 mois", "bold": true}, {"text": " à l’administration de {{clinic.name}}."}]},
      {"type": "heading", "level": 2, "text": "5. Protection des données"},
      {"type": "paragraph", "runs": [{"text": "Ma photo sera traitée conformément à la politique de confidentialité de {{clinic.name}} et ne sera jamais vendue à des tiers."}]},
      {"type": "paragraph", "runs": [{"text": "Je signe le présent formulaire électroniquement. Formulaire préparé le {{today}}."}]},
      {"type": "signaturePage", "signers": [{"role": "professional", "label": "Le Professionnel : {{professional.full_name}}"}]}
    ]
  },
  "variables": [
    {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
    {"path": "professional.full_name", "label": "Nom du professionnel", "sample": "Camille Exemple", "required": true, "kind": "text"},
    {"path": "professional.first_name", "label": "Prénom du professionnel", "sample": "Camille", "required": true, "kind": "text"},
    {"path": "today", "label": "Date du jour", "sample": "2026-10-09", "required": true, "kind": "date"}
  ],
  "signers": [{"role": "professional", "label": "Professionnel", "order": 1, "required": true}],
  "email_subject": "Votre consentement au droit à l’image pour {{clinic.name}}",
  "email_message": "Bonjour {{professional.first_name}},\n\nVoici le formulaire de consentement au droit à l’image de {{clinic.name}} : il autorise la clinique à utiliser votre photo professionnelle sur son site web, sur votre fiche et dans ses communications internes. Prenez le temps de le lire, puis signez-le.\n\nPour toute question, communiquez avec la clinique.\n\nMerci!"
}$json$::jsonb
$tpl$;

-- A template body with the seeded 12-month clause (a paragraph whose text is exactly the old
-- seed's) replaced by the default's; unchanged otherwise.
create function private.image_consent_body_without_expiry(p_body jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when pg_catalog.jsonb_typeof(p_body -> 'blocks') is distinct from 'array' then p_body
              else pg_catalog.jsonb_set(p_body, '{blocks}', (
                select coalesce(pg_catalog.jsonb_agg(
                         case when b ->> 'type' = 'paragraph'
                                   and pg_catalog.jsonb_typeof(b -> 'runs') = 'array'
                                   and (select pg_catalog.string_agg(r ->> 'text', '' order by o)
                                          from pg_catalog.jsonb_array_elements(b -> 'runs') with ordinality as x(r, o))
                                       = 'Ce consentement est valide pour une période de 12 mois à compter de la date de signature et sera '
                                         || 'renouvelé automatiquement pour des périodes successives de 12 mois, sauf retrait de ma part.'
                              then pg_catalog.jsonb_build_object('type', 'paragraph', 'runs',
                                     '[{"text": "Ce consentement est valide "}, {"text": "sans limite de durée", "bold": true}, {"text": " à compter de la date de signature, sauf retrait de ma part."}]'::jsonb)
                              else b end
                         order by i), '[]'::jsonb)
                  from pg_catalog.jsonb_array_elements(p_body -> 'blocks') with ordinality as y(b, i)))
         end
$$;
revoke all on function private.image_consent_body_without_expiry(jsonb) from public, anon, authenticated, service_role;

-- The data fix (header). Idempotent; run once below (and by the pgTAP test).
create function private.professionals_image_consent_no_expiry()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_fixed jsonb;
  v_draft uuid;
  v_new uuid;
begin
  update public.document_types t set expiry_rule = 'none'
   where t.key = 'image_consent' and t.expiry_rule <> 'none';

  update public.professional_documents d
     set expires_on = null,
         status = case when d.status = 'expired' then 'verified' else d.status end,
         reviewed_at = case when d.status = 'expired' then coalesce(d.reviewed_at, d.updated_at) else d.reviewed_at end
    from public.document_types t
   where t.org_id = d.org_id and t.id = d.document_type_id and t.key = 'image_consent'
     and (d.expires_on is not null or d.status = 'expired');

  -- Drafts first (corrected in place), then published versions.
  for v in
    select x.id, x.template_id, x.org_id, x.version, x.status, x.body
      from public.document_template_versions x
      join public.document_templates t on t.id = x.template_id and t.org_id = x.org_id
     where t.key = 'professionals.image_consent' and x.status in ('draft', 'published')
     order by x.org_id, (x.status = 'published'), x.version
  loop
    v_fixed := private.image_consent_body_without_expiry(v.body);
    if v_fixed is distinct from v.body then
      if v.status = 'draft' then
        update public.document_template_versions x set body = v_fixed where x.id = v.id;
        raise notice 'image consent template (org %): draft version % corrected in place', v.org_id, v.version;
      else
        v_draft := null;
        select x.id into v_draft from public.document_template_versions x
         where x.template_id = v.template_id and x.status = 'draft';
        if v_draft is not null then
          raise notice 'image consent template (org %): published version % keeps the 12-month clause until the clinic publishes its (corrected) draft',
            v.org_id, v.version;
        else
          insert into public.document_template_versions as n
            (template_id, org_id, version, body, variables, signers, email_subject, email_message)
          select x.template_id, x.org_id,
                 (select pg_catalog.max(y.version) from public.document_template_versions y where y.template_id = x.template_id) + 1,
                 v_fixed, x.variables, x.signers, x.email_subject, x.email_message
            from public.document_template_versions x where x.id = v.id
          returning n.id into v_new;
          update public.document_template_versions x set status = 'archived', archived_at = pg_catalog.now()
           where x.template_id = v.template_id and x.status = 'published';
          update public.document_template_versions x set status = 'published', published_at = pg_catalog.now()
           where x.id = v_new;
          raise notice 'image consent template (org %): published version % archived, the corrected copy published',
            v.org_id, v.version;
        end if;
      end if;
    elsif v.body::text ~ '12 mois|renouvel' then
      raise notice 'image consent template (org %): % version % mentions « 12 mois » or « renouvel » in the clinic''s own words: left as it is',
        v.org_id, v.status, v.version;
    end if;
  end loop;
end;
$$;
revoke all on function private.professionals_image_consent_no_expiry() from public, anon, authenticated, service_role;

select private.professionals_image_consent_no_expiry();

alter table public.document_types
  add constraint document_types_image_consent_no_expiry check (key <> 'image_consent' or expiry_rule = 'none');

-- -----------------------------------------------------------------------------
-- In force: a verified document, with no end (header)
-- -----------------------------------------------------------------------------
-- The last day the professional's image consent is in force: 2100-12-31 (« no end ») when the
-- file holds a verified « Consentement droit à l'image » document (signed through Documenso, or a
-- paper one), else null. Same signature; its callers test `is not null`.
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
            where x.org_id = p_org and x.professional_id = p_pid and x.status = 'verified')
         then date '2100-12-31' end
$$;

-- -----------------------------------------------------------------------------
-- Readiness: *_professionals_contracts.sql's view, the consent from its document only
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
                   (case when t.expiry_rule = 'none' then coalesce(d.any_verified, false)
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
                                max(y.expires_on) filter (where y.status = 'verified') as valid_until,
                                max(y.expires_on) filter (where y.status in ('verified', 'expired')) as last_known
                           from public.professional_documents y
                          group by y.professional_id, y.document_type_id) d
                     on d.professional_id = x.id and d.document_type_id = t.id
          ) s
         group by s.professional_id
      ) dc on dc.professional_id = p.id
  ) r;

-- -----------------------------------------------------------------------------
-- The questionnaire's gaps: *_professionals_image_consent.sql's, the consent on file only
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
       when 'consent' then private.professional_image_consent_valid_until(p_sub.org_id, p_sub.professional_id) is not null
                           or private.published_image_consent_version(p_sub.org_id) is null
     end, false)
$$;
-- -----------------------------------------------------------------------------
-- The review's applicable fields: *_professionals_onboarding.sql's, never the consent
-- -----------------------------------------------------------------------------
create or replace function private.submission_available_fields(p_sub public.professional_submissions)
returns text[]
language sql
stable
set search_path = ''
as $$
  with sp as (select pg_catalog.to_jsonb(x) as j from public.professional_submission_private x
               where x.submission_id = p_sub.id and x.org_id = p_sub.org_id)
  select coalesce(pg_catalog.array_agg(f.field order by f.ord), '{}')
    from private.submission_fields() f
   where f.section = any (p_sub.requested_sections)
     and case f.kind
           when 'plain' then coalesce((p_sub.submitted_values -> f.section) ? f.field, false)
                             and not (f.field in ('province', 'women_only', 'accepting_new_clients')
                                      and coalesce(p_sub.submitted_values -> f.section -> f.field, 'null'::jsonb) = 'null'::jsonb)
           when 'set' then coalesce((p_sub.submitted_values -> f.section) ? f.field, false)
           when 'file' then (p_sub.submitted_values -> f.section ->> 'file_id') is not null
           -- P4-507: the consent is never applied (it is on file once signed through Documenso).
           when 'consent' then false
           when 'private' then coalesce((select (sp.j -> f.field) <> 'null'::jsonb from sp), false)
                               and (f.field <> 'sin'
                                    or coalesce((private.professionals_setting(p_sub.org_id, 'collect_sin'))::boolean, false))
         end
$$;
-- -----------------------------------------------------------------------------
-- « Appliquer »: *_professionals_onboarding.sql's, without the e-consent (no refusal, no row)
-- -----------------------------------------------------------------------------
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
    raise exception 'Soumission introuvable.' using errcode = 'P0001';
  end if;
  v_row := private.lock_active_professional(v_pid, false);
  if v_row.profile_id = auth.uid() then
    raise exception 'Vous ne pouvez pas réviser votre propre profil.' using errcode = 'P0001', hint = 'submission';
  end if;
  select * into v_sub from public.professional_submissions s
   where s.id = p_submission_id and s.org_id = v_org and s.professional_id = v_pid
     for update;
  if v_sub.status <> 'submitted' then
    raise exception 'Cette soumission n''attend pas de révision.' using errcode = 'P0001', hint = 'status';
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
    raise exception 'Cette assurance est échue depuis l''envoi du profil.'
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
-- -----------------------------------------------------------------------------
-- The Documents tab and « Mes documents »: *_professionals_image_consent.sql's, without the e-consent
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
               'file', case when f.id is not null then pg_catalog.jsonb_build_object(
                         'id', f.id, 'name', f.original_name, 'mime_type', f.mime_type, 'size_bytes', f.size_bytes) end)
             order by d.created_at desc, d.id desc)
        from public.professional_documents d
        join public.document_types t on t.org_id = d.org_id and t.id = d.document_type_id
        left join public.stored_files f on f.id = d.stored_file_id and f.status = 'ready'
        left join public.profiles rv on v_staff and rv.user_id = d.reviewed_by and rv.org_id = v_org
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

select pg_catalog.set_config('app.audit_source', '', true);
