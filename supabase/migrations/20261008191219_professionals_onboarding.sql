-- =============================================================================
-- Professionnels: invitation, questionnaire submissions, consents, review and apply
-- =============================================================================
-- Design:  docs/plans/2026-10-08-professionals-module-design.md §3.4, §3.7, §5.4–§5.6
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4b.1 (P4-37, P4-38, P4-43, P4-44,
--          P4-50, P4-170 … P4-179, P4-270 … P4-276)
-- Needs:   Phase 3 secure links (…_core_secure_links.sql, ADR 0007), the staff invitation actor
--          model (…_core_staff_invitations.sql, Task 3.18), email templates, notifications, storage
-- Rules:   docs/standards/database-conventions.md (§7 audit, §8 encrypted columns and key versions)
--
-- Key choices
-- * The invitation is a Phase 3 secure link of purpose `professional_invite` (subject
--   `professional`). create_professional_invitation is SERVICE ROLE ONLY and takes the actor
--   explicitly (Task 3.18): the professionals-invite function verifies the user, generates the token
--   in memory and passes only its SHA-256, so the inviter never learns the token and cannot accept
--   the invitation herself. The RPC re-checks the actor (an active member holding
--   professionals.invite, through private.permission_keys_for: the module gate included), takes the
--   org from her profile and names her in the audit (app.audit_actor). Any file without an account
--   except an inactive one can be invited (imported active files get their account this way,
--   P4-171); a draft becomes `invited`. Revoking, or deactivating the file, revokes the live link.
-- * The purpose's handlers (P3-16): resolve_professional_invitation (what /invitation shows) and
--   link_professional_account (accept-invite's accept_rpc). The accept handler reads the link's
--   professional unlocked, locks the professional, then consumes the link (the same order as every
--   writer here: professional, then link), re-checks the inviter's standing (P3-31) and the
--   account's address, and creates the profile with the role provider (this module owns it,
--   decision #28) in one transaction. A refused re-check rolls the consumption back (P4-172).
-- * Submissions (P4-37): one row per questionnaire, `onboarding` (all eleven sections) or `update`
--   (the sections asked, P4-44: no link). There are no « Approches » (P4-240, P4-276): no
--   section, no helper, not in the history list; get_professional_record is left as 4a built it.
--   No motif or clientèle key is named here.
--   Status draft → submitted → approved; a rejection returns the submission to draft with the
--   reviewer's note (P4-170); `cancelled` closes it without review (P4-301). At most one open
--   (draft or submitted) submission per professional. `prefill` is a snapshot of the record at creation; `submitted_values`
--   holds the provider's answers per section, normalised, never a SIN or an account number.
-- * Private answers (P4-38) are encrypted at once in professional_submission_private, under the
--   rules of conventions §8: one key version per row (a save re-encrypts the kept ciphertexts from
--   the row's version to private.pii_current_key_version() in the same statement), a clean P0001
--   with a HINT for a kept value that does not decrypt, every value column redacted from the audit,
--   no privilege for any API role (service_role included), and both columns listed in
--   private.pii_encrypted_values() (row key submission_id), so the health check and the rotation see
--   them. On approval the chosen values move to professional_private (bytes copied when both rows
--   are on the write version, re-encrypted inside the database otherwise: never returned), and the
--   submission's private row is deleted (Loi 25: no second copy, P4-176).
-- * Draft validation runs the staff write paths (P4-174): four set RPCs of 4a.3 are split into
--   private.apply_* helpers called by both; a draft section is applied to the record inside a block
--   that always rolls back (SQLSTATE PRDRY), so the questionnaire gets exactly the staff refusals and
--   HINTs. The restricted-motif rule is checked once on the combined professions and motifs.
-- * Review: get_submission_review returns, per requested section and field, the current and
--   submitted values (ids, as get_professional_record) and whether they differ; private fields only
--   say whether something was entered. apply_professional_submission applies every field or the
--   chosen ones in one transaction through the same helpers; any refusal rolls back everything.
-- * Readiness grows (4a.4's rule): `account_created` and `submission_approved` are appended and
--   `ready` now requires both. Files imported or seeded before 4b are therefore activated with the
--   override reason (P4-20, P4-179).
-- * Every statement is scoped to the caller's clinic (or the actor's, or the link's); arguments are
--   validated before any lock; messages never repeat a value; dates are bounded.
-- * Locks: professional, then its open submission, then links (issue / revoke / consume). The accept
--   handler creates the profile after locking the professional: no other transaction can hold that
--   new row, so 4a.4's « profile, then professional » order is kept.
-- * Audit: every table is audited. professional_submissions redacts `prefill` and `submitted_values`
--   (phone and address, as professionals does); the private step shows through `private_saved_at`.
--   The history adds submissions and consents, never the private table; list_professional_history
--   leaves out the draft saves (rows that change only the answers or the link) and names each
--   submission row's kind (4b.3 review).
-- * Security review (P4-300 … P4-308):
--   - The invitation is bound to the file's address: the link's scope holds {"email": …} (lower
--     case, private.issue_professional_invitation_link, which 4b.2's re-issue calls too); both
--     handlers refuse a link whose address is no longer the file's (resolve: null; accept:
--     link_invalid, the consumption rolled back), and set_professional_email (4a) revokes the live
--     link (P4-300).
--   - Private answers never outlive the submission (Loi 25, P4-301, P4-302): an open submission is
--     closed as `cancelled` (its private row deleted) when the invitation is revoked, the file is
--     deactivated or its account is removed; the maintenance job professionals.submission_private_purge
--     deletes the private row of a draft not saved for 90 days.
--   - A save stores only the keys it was given, merged into the section; a field is answered only
--     when its key is present, and applying never touches a field that was not answered (P4-176).
--   - Inactive files: the provider RPCs, update requests, apply and acceptance refuse (P4-303).
--     Self-review is refused (P4-304). Apply re-checks the consent version and the insurance's
--     expiry (P4-305); the SIN is not an available field while collect_sin is off (P4-272).
--   - Staged files must belong to this submission (subject), drafts of the consent text are read
--     by staff only, and the reminder must leave before the link expires (P4-306 … P4-308).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_onboarding', true);

-- -----------------------------------------------------------------------------
-- Permissions (template rows; the Task 2.20 trigger copies them to every clinic)
-- -----------------------------------------------------------------------------
insert into public.permissions (key, module_key, description) values
  ('professionals.invite', 'professionals', 'Inviter les professionnels et demander des mises à jour'),
  ('professionals.review', 'professionals', 'Réviser et appliquer les soumissions')
on conflict do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin', 'professionals.invite'), ('admin', 'professionals.review'),
  ('admin_assistant', 'professionals.invite'), ('admin_assistant', 'professionals.review')
on conflict do nothing;

-- Same signature and grants as *_professionals_reference_data.sql: the two new staff keys read the
-- lists too (a reviewer reads the ids of a submission against the catalogue).
create or replace function private.can_read_professionals_reference()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_permission_keys() && array[
    'professionals.view', 'professionals.manage', 'professionals.matching', 'professionals.activate_override',
    'professionals.settings', 'professionals.compensation', 'professionals.private', 'professionals.self',
    'professionals.invite', 'professionals.review'
  ]::text[]
$$;

-- -----------------------------------------------------------------------------
-- Module settings: invitation lifetime and reminder (4a.2's two functions, kept in step)
-- -----------------------------------------------------------------------------
create or replace function private.professionals_settings_defaults()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"collect_sin": false, "invitation_expiry_days": 7, "invitation_reminder_after_days": 3}'::jsonb
$$;

create or replace function private.validate_professionals_setting(p_key text, p_value jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := coalesce(p_value, 'null'::jsonb);
begin
  case p_key
    when 'collect_sin' then   -- boolean, never null
      if pg_catalog.jsonb_typeof(v) <> 'boolean' then
        raise exception 'Réglage collect_sin invalide : true ou false attendu.' using errcode = '22023';
      end if;
    when 'invitation_expiry_days' then   -- whole days, 1 to 30 (the purpose's max_ttl), never null
      if pg_catalog.jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 1 and 30
         or (v #>> '{}')::numeric <> pg_catalog.trunc((v #>> '{}')::numeric) then
        raise exception 'Réglage invitation_expiry_days invalide : un nombre entier de 1 à 30 attendu.' using errcode = '22023';
      end if;
    when 'invitation_reminder_after_days' then   -- whole days, 1 to 29, or null (no reminder)
      if pg_catalog.jsonb_typeof(v) <> 'null'
         and (pg_catalog.jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 1 and 29
              or (v #>> '{}')::numeric <> pg_catalog.trunc((v #>> '{}')::numeric)) then
        raise exception 'Réglage invitation_reminder_after_days invalide : un nombre entier de 1 à 29, ou null, attendu.'
          using errcode = '22023';
      end if;
    else
      raise exception 'Réglage inconnu : %', coalesce(p_key, '(null)') using errcode = '22023';
  end case;
end;
$$;

-- The rules that span keys, on the effective settings a patch would leave (P4-308): a reminder
-- leaves before the link expires (otherwise it would re-issue an already expired invitation). A
-- user-facing P0001 with the field as HINT: each value is valid alone, the pair is not.
create function private.validate_professionals_settings(p_settings jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if pg_catalog.jsonb_typeof(p_settings -> 'invitation_reminder_after_days') = 'number'
     and (p_settings ->> 'invitation_reminder_after_days')::numeric >= (p_settings ->> 'invitation_expiry_days')::numeric then
    raise exception 'Le rappel doit partir avant la fin de validité du lien : choisissez un délai plus court que sa durée de validité.'
      using errcode = 'P0001', hint = 'invitation_reminder_after_days';
  end if;
end;
$$;
revoke all on function private.validate_professionals_settings(jsonb) from public, anon, authenticated, service_role;

-- 4a.2's RPC (same signature, grants, checks and result), plus the rules across keys checked on
-- the merged result under the org row's lock (two patches cannot each pass alone).
create or replace function public.set_professionals_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  r record;
begin
  if not private.has_permission('professionals.settings') then
    raise exception 'Permission refusée : professionals.settings' using errcode = '42501';
  end if;
  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Réglages invalides : objet JSON attendu' using errcode = '22023';
  end if;
  for r in select e.key, e.value from pg_catalog.jsonb_each(p_patch) e loop
    perform private.validate_professionals_setting(r.key, r.value);
  end loop;
  if p_patch ? 'collect_sin' and not private.has_permission('professionals.private') then
    raise exception 'Permission refusée : professionals.private' using errcode = '42501';
  end if;

  if p_patch <> '{}'::jsonb then
    perform 1 from public.organizations o where o.id = v_org for no key update;
    perform private.validate_professionals_settings(private.professionals_settings(v_org) || p_patch);
    -- The table's audit trigger records the change under this RPC's name.
    perform pg_catalog.set_config('app.audit_source', 'rpc:set_professionals_settings', true);
    insert into public.org_module_settings as s (org_id, module_key, settings, updated_by)
    values (v_org, 'professionals', p_patch, auth.uid())
    on conflict (org_id, module_key) do update
      set settings = s.settings || excluded.settings,
          updated_by = excluded.updated_by;
    perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  end if;
  return private.professionals_settings(v_org);
end;
$$;

-- -----------------------------------------------------------------------------
-- Secure link purpose (Phase 3 catalogue; handlers below; 020 checks their contract)
-- -----------------------------------------------------------------------------
insert into public.secure_link_purposes
  (key, module_key, default_ttl, max_ttl, max_uses, requires_session, creates_account, resolve_rpc, accept_rpc, view_permission)
values ('professional_invite', 'professionals', interval '7 days', interval '30 days', 1, false, true,
        'resolve_professional_invitation', 'link_professional_account', 'professionals.view')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Upload purpose for the questionnaire's photo and insurance (Task 3.24 is merged; P3-17 staging)
-- -----------------------------------------------------------------------------
-- Staged 60 days: an upload the review never attaches is purged by core storage-cleanup.
insert into public.upload_purposes
  (key, module_key, bucket, upload_permission, view_permission, owner_permission, max_bytes, mime_types,
   max_image_side, retain_days)
values ('professional_submission_file', 'professionals', 'documents', 'professionals.self', 'professionals.review',
        'professionals.self', 10485760, array['application/pdf', 'image/jpeg', 'image/png'], 4000, 60)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Email templates (P4-50; Phase 3 catalogue, FR, vous, no clinical word)
-- -----------------------------------------------------------------------------
insert into public.email_template_defaults
  (key, module_key, label, description, why_line, subject, body, button_label, variables, view_permission)
values
  ('professionals.invite', 'professionals',
   'Invitation d''un professionnel',
   'Envoyé quand la clinique invite un professionnel à créer son accès et à compléter son profil.',
   'Vous recevez ce courriel parce que la clinique vous invite à rejoindre son équipe de professionnels.',
   'Bienvenue dans l''équipe de {{clinic.name}}',
   E'Bonjour {{professional.first_name}},\n\n'
   'Nous sommes heureux de vous accueillir dans l''équipe de {{clinic.name}}. Pour commencer, créez votre accès, '
   'puis complétez votre profil : il nous aide à vous proposer des clients qui vous correspondent.\n\n'
   'Ce lien est personnel et reste valide jusqu''au {{invitation.expires_at}}.\n\n'
   'Si vous n''attendiez pas cette invitation, vous pouvez ignorer ce courriel.',
   'Créer mon accès',
   '[
     {"path": "professional.first_name", "label": "Prénom du professionnel", "sample": "Nadia", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "invitation.expires_at", "label": "Fin de validité de l''invitation", "sample": "15 octobre 2026 à 14 h 30", "required": true, "kind": "datetime"}
   ]',
   'professionals.view'),
  ('professionals.invite_reminder', 'professionals',
   'Rappel d''invitation d''un professionnel',
   'Envoyé automatiquement quand une invitation n''a pas été ouverte après quelques jours.',
   'Vous recevez ce courriel parce que la clinique vous a envoyé une invitation à rejoindre son équipe de professionnels.',
   'Votre invitation vous attend',
   E'Bonjour {{professional.first_name}},\n\n'
   'Votre invitation à rejoindre l''équipe de {{clinic.name}} vous attend toujours. Créez votre accès et '
   'complétez votre profil quand vous aurez un moment.\n\n'
   'Ce nouveau lien est personnel et reste valide jusqu''au {{invitation.expires_at}}.',
   'Créer mon accès',
   '[
     {"path": "professional.first_name", "label": "Prénom du professionnel", "sample": "Nadia", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "invitation.expires_at", "label": "Fin de validité de l''invitation", "sample": "15 octobre 2026 à 14 h 30", "required": true, "kind": "datetime"}
   ]',
   'professionals.view'),
  ('professionals.profile_update', 'professionals',
   'Demande de mise à jour du profil',
   'Envoyé quand la clinique demande à un professionnel de revoir certaines sections de son profil.',
   'Vous recevez ce courriel parce que la clinique vous demande de mettre votre profil à jour.',
   'Une petite mise à jour de votre profil',
   E'Bonjour {{professional.first_name}},\n\n'
   'L''équipe de {{clinic.name}} vous demande de revoir quelques sections de votre profil. '
   'Cela ne prend que quelques minutes.\n\n'
   'Connectez-vous pour voir les sections à mettre à jour.',
   'Mettre mon profil à jour',
   '[
     {"path": "professional.first_name", "label": "Prénom du professionnel", "sample": "Nadia", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"}
   ]',
   'professionals.view'),
  ('professionals.submission_received', 'professionals',
   'Profil reçu d''un professionnel',
   'Envoyé à l''équipe quand un professionnel envoie son profil ou une mise à jour à réviser.',
   'Vous recevez ce courriel parce que vous révisez les profils des professionnels de la clinique.',
   '{{professional.full_name}} a envoyé son profil',
   E'Bonjour,\n\n'
   '{{professional.full_name}} a envoyé son profil. Il est prêt à être révisé dans son dossier.',
   'Réviser le dossier',
   '[
     {"path": "professional.full_name", "label": "Nom du professionnel", "sample": "Nadia Côté", "required": true, "kind": "text"}
   ]',
   'professionals.view')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- The eleven sections and their fields (one list for drafts, completeness, review and apply)
-- -----------------------------------------------------------------------------
-- kind: plain (a column), set (a set RPC's input), file (a staged upload), private (an encrypted or
-- plain value of professional_submission_private), consent (the signature). A field's value is
-- submitted_values -> section -> field, except file and consent fields, whose value is the
-- section's whole object. The client limits (min_client_age, women_only: P4-245) belong to the
-- clientèles section: they qualify who the professional sees.
create function private.submission_fields()
returns table (section text, field text, kind text, ord int)
language sql
immutable
set search_path = ''
as $$
  select x.section, x.field, x.kind, x.ord::int from (values
    ('personal', 'personal_phone', 'plain', 1), ('personal', 'address_line1', 'plain', 2),
    ('personal', 'address_line2', 'plain', 3), ('personal', 'city', 'plain', 4),
    ('personal', 'province', 'plain', 5), ('personal', 'postal_code', 'plain', 6),
    ('professional', 'professions', 'set', 7), ('professional', 'years_experience', 'plain', 8),
    ('portrait', 'bio', 'plain', 9), ('portrait', 'approach', 'plain', 10),
    ('portrait', 'public_email', 'plain', 11), ('portrait', 'public_phone', 'plain', 12),
    ('languages', 'language_ids', 'set', 13),
    ('clienteles', 'clienteles', 'set', 14), ('clienteles', 'min_client_age', 'plain', 15),
    ('clienteles', 'women_only', 'plain', 16),
    ('motifs', 'motif_ids', 'set', 17),
    ('availability', 'accepting_new_clients', 'plain', 18), ('availability', 'availability_periods', 'plain', 19),
    ('availability', 'availability_note', 'plain', 20),
    ('photo', 'photo', 'file', 21),
    ('insurance', 'insurance', 'file', 22),
    ('tax_bank', 'business_number', 'private', 23), ('tax_bank', 'gst_number', 'private', 24),
    ('tax_bank', 'qst_number', 'private', 25), ('tax_bank', 'bank_institution', 'private', 26),
    ('tax_bank', 'bank_transit', 'private', 27), ('tax_bank', 'bank_account', 'private', 28),
    ('tax_bank', 'sin', 'private', 29),
    ('consent', 'consent', 'consent', 30)
  ) as x(section, field, kind, ord)
$$;

-- The eleven section keys, in questionnaire order (no « Approches »: removed from the app, P4-240, P4-276).
create function private.submission_sections()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['personal', 'professional', 'portrait', 'languages', 'clienteles', 'motifs',
               'availability', 'photo', 'insurance', 'tax_bank', 'consent']
$$;

-- A requested-sections argument as stored: distinct, in questionnaire order, at least one. 22023
-- for anything else (never echoed).
create function private.normalize_submission_sections(p_sections text[])
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_all constant text[] := private.submission_sections();
  v text[];
begin
  if p_sections is null or pg_catalog.cardinality(p_sections) = 0 or pg_catalog.cardinality(p_sections) > 50
     or not (p_sections <@ v_all) then
    raise exception 'Sections invalides : au moins une des onze sections attendue.' using errcode = '22023';
  end if;
  select pg_catalog.array_agg(s order by pg_catalog.array_position(v_all, s)) into v
    from (select distinct x as s from pg_catalog.unnest(p_sections) as x) d;
  return v;
end;
$$;

revoke all on function
  private.submission_fields(),
  private.submission_sections(),
  private.normalize_submission_sections(text[])
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- professional_submissions
-- -----------------------------------------------------------------------------
create table public.professional_submissions (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  kind text not null,
  status text not null default 'draft',
  requested_sections text[] not null,
  -- The record's values for the requested sections when the submission was created (P4-37).
  prefill jsonb not null default '{}',
  -- The provider's answers, one object per section, normalised; never a SIN or an account (P4-38).
  submitted_values jsonb not null default '{}',
  -- The onboarding invitation's current link; null for an update, or once the link is purged.
  secure_link_id uuid,
  -- When the provider last saved the private step (professional_submission_private): the history
  -- reads it as « Renseignements fiscaux ou bancaires transmis » without any value (P4-178).
  private_saved_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  -- The reviewer's note when the submission was sent back (the provider reads it, Loi 25).
  decision_note text,
  -- The fields applied on approval (P4-176).
  applied_fields text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_submissions_pkey primary key (professional_id, id),
  constraint professional_submissions_id_key unique (id),
  constraint professional_submissions_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_submissions_secure_link_fkey foreign key (secure_link_id)
    references public.secure_links (id) on delete set null,
  constraint professional_submissions_reviewed_by_fkey foreign key (reviewed_by)
    references public.profiles (user_id) on delete set null,
  constraint professional_submissions_kind_check check (kind in ('onboarding', 'update')),
  -- cancelled: closed without review (invitation revoked, file deactivated, account removed, P4-301).
  constraint professional_submissions_status_check check (status in ('draft', 'submitted', 'approved', 'cancelled')),
  constraint professional_submissions_requested_sections_check check (
    pg_catalog.cardinality(requested_sections) between 1 and 11
    and requested_sections <@ array['personal', 'professional', 'portrait', 'languages', 'clienteles',
                                    'motifs', 'availability', 'photo', 'insurance', 'tax_bank', 'consent']
    and private.has_no_duplicates(requested_sections)),
  constraint professional_submissions_prefill_check check (
    pg_catalog.jsonb_typeof(prefill) = 'object' and pg_catalog.pg_column_size(prefill) <= 65536),
  constraint professional_submissions_submitted_values_check check (
    pg_catalog.jsonb_typeof(submitted_values) = 'object' and pg_catalog.pg_column_size(submitted_values) <= 65536
    and not (submitted_values ? 'tax_bank')),
  constraint professional_submissions_decision_note_check check (
    pg_catalog.char_length(decision_note) <= 1000 and pg_catalog.btrim(decision_note, E' \t\r\n') <> ''),
  constraint professional_submissions_applied_fields_check check (
    applied_fields <@ array['personal_phone', 'address_line1', 'address_line2', 'city', 'province', 'postal_code',
                            'professions', 'years_experience', 'bio', 'approach', 'public_email', 'public_phone',
                            'language_ids', 'clienteles', 'min_client_age', 'women_only', 'motif_ids', 'accepting_new_clients',
                            'availability_periods', 'availability_note', 'photo', 'insurance', 'business_number',
                            'gst_number', 'qst_number', 'bank_institution', 'bank_transit', 'bank_account', 'sin',
                            'consent']),
  constraint professional_submissions_submitted_check check (status in ('draft', 'cancelled') or submitted_at is not null),
  constraint professional_submissions_approved_check check (
    status <> 'approved' or (reviewed_at is not null and applied_fields is not null))
);
-- One open submission per professional (P4-37).
create unique index professional_submissions_open_key on public.professional_submissions (professional_id)
  where status in ('draft', 'submitted');
-- The org FK, RLS and the list's states (one scan of the clinic).
create index professional_submissions_org_idx on public.professional_submissions (org_id, professional_id);
-- Readiness: « Questionnaire approuvé ».
create index professional_submissions_approved_onboarding_idx on public.professional_submissions (professional_id)
  where kind = 'onboarding' and status = 'approved';
create index professional_submissions_secure_link_idx on public.professional_submissions (secure_link_id)
  where secure_link_id is not null;
create index professional_submissions_reviewed_by_idx on public.professional_submissions (reviewed_by)
  where reviewed_by is not null;

revoke all on public.professional_submissions from anon, authenticated;
grant select on public.professional_submissions to authenticated;
alter table public.professional_submissions enable row level security;
create policy professional_submissions_select_staff on public.professional_submissions
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));
create policy professional_submissions_select_self on public.professional_submissions
  for select to authenticated
  using (professional_id = (select private.current_professional_id()) and (select private.has_permission('professionals.self')));

create trigger professional_submissions_set_updated_at before update on public.professional_submissions
  for each row execute function private.set_updated_at();
-- The answers hold the phone and the address, redacted from professionals' own audit (Loi 25).
create trigger professional_submissions_audit after insert or update or delete on public.professional_submissions
  for each row execute function private.audit_trigger('prefill', 'submitted_values');

-- -----------------------------------------------------------------------------
-- professional_submission_private (P4-38; conventions §8)
-- -----------------------------------------------------------------------------
create table public.professional_submission_private (
  submission_id uuid primary key,
  org_id uuid not null,
  professional_id uuid not null,
  sin bytea,
  sin_last3 text,
  business_number text,
  gst_number text,
  qst_number text,
  bank_institution text,
  bank_transit text,
  bank_account bytea,
  bank_account_last4 text,
  key_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_submission_private_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_submission_private_submission_fkey foreign key (professional_id, submission_id)
    references public.professional_submissions (professional_id, id) on delete cascade,
  constraint professional_submission_private_sin_last3_check check (sin_last3 ~ '^[0-9]{3}$'),
  constraint professional_submission_private_business_number_check check (business_number ~ '^[0-9]{9}$'),
  constraint professional_submission_private_gst_number_check check (gst_number ~ '^[0-9]{9}RT[0-9]{4}$'),
  constraint professional_submission_private_qst_number_check check (qst_number ~ '^[0-9]{10}TQ[0-9]{4}$'),
  constraint professional_submission_private_bank_institution_check check (bank_institution ~ '^[0-9]{3}$'),
  constraint professional_submission_private_bank_transit_check check (bank_transit ~ '^[0-9]{5}$'),
  constraint professional_submission_private_bank_account_last4_check check (bank_account_last4 ~ '^[0-9]{4}$'),
  constraint professional_submission_private_key_version_check check (key_version >= 1),
  constraint professional_submission_private_sin_pair_check check ((sin is null) = (sin_last3 is null)),
  constraint professional_submission_private_bank_account_pair_check check ((bank_account is null) = (bank_account_last4 is null))
);
create index professional_submission_private_org_idx on public.professional_submission_private (org_id, professional_id);
create index professional_submission_private_professional_idx on public.professional_submission_private (professional_id, submission_id);

revoke all on public.professional_submission_private from anon, authenticated;
revoke all on public.professional_submission_private from service_role;
alter table public.professional_submission_private enable row level security;
-- No policy and no grant on purpose: only the SECURITY DEFINER RPCs below touch it.

create trigger professional_submission_private_set_updated_at before update on public.professional_submission_private
  for each row execute function private.set_updated_at();
create trigger professional_submission_private_audit after insert or update or delete on public.professional_submission_private
  for each row execute function private.audit_trigger(
    'sin', 'sin_last3', 'business_number', 'gst_number', 'qst_number',
    'bank_institution', 'bank_transit', 'bank_account', 'bank_account_last4');

-- The list of encrypted columns (4a.16): professional_submission_private's two branches added.
-- Same signature, grants (none) and contract as *_core_pii_key_versions.sql.
create or replace function private.pii_encrypted_values()
returns table (table_name text, column_name text, row_key text, key_version integer, ciphertext bytea)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'organization_bank_details'::text, 'account_number'::text, b.org_id::text, b.key_version::integer, b.account_number
    from public.organization_bank_details b
   where b.account_number is not null
  union all
  select 'professional_private'::text, 'sin'::text, p.professional_id::text, p.key_version::integer, p.sin
    from public.professional_private p
   where p.sin is not null
  union all
  select 'professional_private'::text, 'bank_account'::text, p.professional_id::text, p.key_version::integer, p.bank_account
    from public.professional_private p
   where p.bank_account is not null
  union all
  select 'professional_submission_private'::text, 'sin'::text, s.submission_id::text, s.key_version::integer, s.sin
    from public.professional_submission_private s
   where s.sin is not null
  union all
  select 'professional_submission_private'::text, 'bank_account'::text, s.submission_id::text, s.key_version::integer, s.bank_account
    from public.professional_submission_private s
   where s.bank_account is not null
$$;

-- -----------------------------------------------------------------------------
-- Private answers never outlive the submission (Loi 25; P4-301, P4-302)
-- -----------------------------------------------------------------------------
-- Closes the professional's open submission without review: status `cancelled`, its private row
-- deleted (audited, every value redacted). Called with the professional locked, by
-- revoke_professional_invitation, deactivate_professional and the account-removal trigger. Returns
-- the submission's id, or null when none was open. The answers in submitted_values stay (the
-- record's own data; redacted from the audit).
create function private.cancel_open_submission(p_org uuid, p_pid uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.professional_submissions s set status = 'cancelled'
   where s.professional_id = p_pid and s.org_id = p_org and s.status in ('draft', 'submitted')
  returning s.id into v_id;
  if v_id is not null then
    delete from public.professional_submission_private sp where sp.submission_id = v_id and sp.org_id = p_org;
  end if;
  return v_id;
end;
$$;

-- An account removed (profiles row deleted: professionals.profile_id set null by its FK) abandons
-- the open submission: whoever gets the next invitation must never see the previous person's
-- answers or masks. The FK action locks the profile, then the professional (4a.4's order).
create function private.professionals_cancel_submission_on_unlink()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.cancel_open_submission(new.org_id, new.id);
  return null;
end;
$$;
create trigger professionals_cancel_submission_on_unlink
  after update on public.professionals
  for each row when (old.profile_id is not null and new.profile_id is null)
  execute function private.professionals_cancel_submission_on_unlink();

-- Maintenance (Phase 3 jobs, run database-wide by private.run_sql_job): deletes the private row of
-- every draft not saved for 90 days (the submission's updated_at, which every save moves) and,
-- as a safety net, of any submission no longer open (approval and cancellation delete theirs). The
-- draft stays; its private step is empty again (private_saved_at cleared) and the provider enters
-- it anew. Returns a count only.
create function private.job_professionals_submission_private_purge()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  with gone as (
    delete from public.professional_submission_private sp
     using public.professional_submissions s
     where s.id = sp.submission_id and s.professional_id = sp.professional_id
       and (s.status not in ('draft', 'submitted')
            or (s.status = 'draft' and greatest(s.updated_at, sp.updated_at) < pg_catalog.now() - interval '90 days'))
    returning sp.submission_id
  )
  select coalesce(pg_catalog.array_agg(gone.submission_id), '{}') into v_ids from gone;
  update public.professional_submissions s set private_saved_at = null
   where s.id = any (v_ids) and s.status = 'draft' and s.private_saved_at is not null;
  return 'deleted=' || pg_catalog.cardinality(v_ids);
end;
$$;

revoke all on function
  private.cancel_open_submission(uuid, uuid),
  private.professionals_cancel_submission_on_unlink(),
  private.job_professionals_submission_private_purge()
from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, sql_function, cron_job_name, is_maintenance)
values
  ('professionals.submission_private_purge', 'professionals', 'Purge des renseignements fiscaux non envoyés',
   'Supprime les renseignements fiscaux et bancaires saisis dans un questionnaire resté en brouillon 90 jours sans '
   || 'enregistrement. Le brouillon reste : la personne les saisira de nouveau.',
   'sql', 'private.job_professionals_submission_private_purge', 'professionals.submission_private_purge', true)
on conflict do nothing;

select cron.schedule('professionals.submission_private_purge', '10 9 * * *',
  $$select private.run_sql_job('professionals.submission_private_purge')$$);

-- -----------------------------------------------------------------------------
-- consent_versions: the image-rights text, versioned per clinic (4c.3 edits it)
-- -----------------------------------------------------------------------------
create table public.consent_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  version int not null,
  title text not null,
  body text not null,
  -- Null while a draft (4c.3); signing always uses the latest published version.
  published_at timestamptz,
  published_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consent_versions_org_id_id_key unique (org_id, id),
  constraint consent_versions_org_key_version_key unique (org_id, key, version),
  constraint consent_versions_key_check check (key in ('image_rights')),
  constraint consent_versions_version_check check (version between 1 and 1000),
  constraint consent_versions_title_check check (char_length(title) between 1 and 200 and private.is_tidy_text(title)),
  constraint consent_versions_body_check check (char_length(body) between 1 and 20000 and btrim(body, E' \t\r\n') <> '')
);
create index consent_versions_published_by_idx on public.consent_versions (published_by) where published_by is not null;

revoke all on public.consent_versions from anon, authenticated;
grant select on public.consent_versions to authenticated;
alter table public.consent_versions enable row level security;
-- The text is not secret: whoever reads the lists reads it (staff and the provider who signs). A
-- draft version (4c.3) is read by staff only (professionals.view), never by the provider (P4-307).
create policy consent_versions_select on public.consent_versions
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.can_read_professionals_reference())
         and (published_at is not null or (select private.has_permission('professionals.view'))));

create trigger consent_versions_set_updated_at before update on public.consent_versions
  for each row execute function private.set_updated_at();
create trigger consent_versions_audit after insert or update or delete on public.consent_versions
  for each row execute function private.audit_trigger();

-- Version 1 of « Consentement au droit à l'image » (legacy text, adapted to vous), per clinic.
create function private.seed_professionals_consent(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform pg_catalog.set_config('app.audit_source', 'seed:professionals_consent', true);
  insert into public.consent_versions (org_id, key, version, title, body, published_at)
  select o.id, 'image_rights', 1, 'Consentement au droit à l''image',
         pg_catalog.replace(
           E'1. Objet\n'
           'En signant ce formulaire, vous autorisez {{clinique}} à utiliser votre photo professionnelle pour '
           'présenter votre profil sur son site web et dans ses communications.\n\n'
           '2. Utilisation autorisée\n'
           'Votre photo peut être utilisée pour :\n'
           '– votre profil professionnel sur le site web de la clinique ;\n'
           '– la fiche qui présente votre profil aux clients ;\n'
           '– les communications internes de la clinique.\n\n'
           '3. Durée\n'
           'Ce consentement est valide 12 mois à compter de la date de signature. Il est renouvelé '
           'automatiquement pour des périodes successives de 12 mois, sauf si vous le retirez.\n\n'
           '4. Droit de retrait\n'
           'Vous pouvez retirer votre consentement en tout temps, par un préavis écrit de 3 mois adressé à '
           'l\'administration de la clinique.\n\n'
           '5. Protection des renseignements\n'
           'Votre photo est traitée conformément à la politique de confidentialité de la clinique et n\'est '
           'jamais vendue à des tiers.',
           '{{clinique}}', o.name),
         pg_catalog.now()
    from public.organizations o
   where o.id = p_org
     and not exists (select 1 from public.consent_versions c where c.org_id = p_org and c.key = 'image_rights');
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

create function private.seed_professionals_consent_on_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_professionals_consent(new.id);
  return null;
end;
$$;

create trigger organizations_seed_professionals_consent
  after insert on public.organizations
  for each row execute function private.seed_professionals_consent_on_org();

revoke all on function private.seed_professionals_consent(uuid), private.seed_professionals_consent_on_org()
  from public, anon, authenticated, service_role;

-- Existing organizations (staging).
select private.seed_professionals_consent(o.id) from public.organizations o;

-- The latest published version of a consent in a clinic (signing uses it).
create function private.current_consent_version(p_org uuid, p_key text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select c.id from public.consent_versions c
   where c.org_id = p_org and c.key = p_key and c.published_at is not null
   order by c.version desc
   limit 1
$$;
revoke all on function private.current_consent_version(uuid, text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- professional_consents: signed consents (one row per signature)
-- -----------------------------------------------------------------------------
create table public.professional_consents (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  consent_version_id uuid not null,
  signer_name text not null,
  signed_at timestamptz not null,
  -- Last valid day (clinic date of the signature + 12 months); renewal is 4c's.
  expires_on date not null,
  withdrawn_at timestamptz,
  -- Withdrawal notice of 3 months (A3.5).
  withdrawal_effective_on date,
  submission_id uuid,
  created_at timestamptz not null default now(),
  constraint professional_consents_pkey primary key (professional_id, id),
  constraint professional_consents_id_key unique (id),
  constraint professional_consents_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_consents_version_fkey foreign key (org_id, consent_version_id)
    references public.consent_versions (org_id, id),
  constraint professional_consents_submission_fkey foreign key (professional_id, submission_id)
    references public.professional_submissions (professional_id, id) on delete set null (submission_id),
  constraint professional_consents_signer_name_check check (
    char_length(signer_name) between 1 and 161 and private.is_tidy_text(signer_name)),
  constraint professional_consents_expires_on_check check (expires_on > (signed_at at time zone 'UTC')::date),
  constraint professional_consents_withdrawal_check check ((withdrawn_at is null) = (withdrawal_effective_on is null))
);
create index professional_consents_org_idx on public.professional_consents (org_id, professional_id);
create index professional_consents_version_idx on public.professional_consents (org_id, consent_version_id);

revoke all on public.professional_consents from anon, authenticated;
grant select on public.professional_consents to authenticated;
alter table public.professional_consents enable row level security;
create policy professional_consents_select_staff on public.professional_consents
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));
create policy professional_consents_select_self on public.professional_consents
  for select to authenticated
  using (professional_id = (select private.current_professional_id()) and (select private.has_permission('professionals.self')));

create trigger professional_consents_audit after insert or update or delete on public.professional_consents
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- The set write paths, shared by the staff RPCs and the questionnaire (P4-174)
-- -----------------------------------------------------------------------------
-- Each private.apply_* helper runs after its caller checked the permission and locked the
-- professional (of p_org): it validates the ids against the clinic's lists (22023 for an unknown
-- id), refuses to add an archived row (one already held may stay), replaces the set with at most
-- three statements, and bumps the professional's updated_at when it touched a row. With
-- p_check_restricted false the restricted-motif rule (P4-16) is left to the caller, which checks
-- it once on the combined result (private.assert_restricted_motifs_ok).

-- The restricted-motif rule (P4-16) on what the professional holds now.
create function private.assert_restricted_motifs_ok(p_org uuid, p_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_bad text;
begin
  select m.name into v_bad
    from public.professional_motifs pm
    join public.motifs m on m.org_id = pm.org_id and m.id = pm.motif_id
   where pm.professional_id = p_id and pm.org_id = p_org and m.is_restricted
     and not exists (
       select 1 from public.professional_professions pp
         join public.profession_titles t on t.org_id = pp.org_id and t.id = pp.profession_title_id
        where pp.professional_id = p_id and pp.org_id = p_org and t.order_id is not null)
   order by m.sort_order, m.name
   limit 1;
  if v_bad is not null then
    raise exception 'Le motif « % » est réservé aux professions réglementées.', v_bad using errcode = 'P0001';
  end if;
end;
$$;

create function private.apply_professional_motifs(p_org uuid, p_id uuid, p_ids uuid[], p_check_restricted boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_bad text;
  v_rows int;
  v_n int;
begin
  if exists (select 1 from pg_catalog.unnest(p_ids) as x
              where not exists (select 1 from public.motifs m where m.org_id = p_org and m.id = x)) then
    raise exception 'Motif inconnu.' using errcode = '22023';
  end if;

  -- An archived motif may stay where it already is, never be added.
  select m.name into v_bad
    from pg_catalog.unnest(p_ids) as x
    join public.motifs m on m.org_id = p_org and m.id = x
   where not m.is_active
     and not exists (select 1 from public.professional_motifs pm
                      where pm.professional_id = p_id and pm.org_id = p_org and pm.motif_id = x)
   order by m.sort_order, m.name
   limit 1;
  if v_bad is not null then
    raise exception 'Le motif « % » est archivé.', v_bad using errcode = 'P0001';
  end if;

  -- A restricted motif needs a regulated profession (P4-16).
  if p_check_restricted then
    select m.name into v_bad
      from pg_catalog.unnest(p_ids) as x
      join public.motifs m on m.org_id = p_org and m.id = x
     where m.is_restricted
       and not exists (
         select 1 from public.professional_professions pp
           join public.profession_titles t on t.org_id = pp.org_id and t.id = pp.profession_title_id
          where pp.professional_id = p_id and pp.org_id = p_org and t.order_id is not null)
     order by m.sort_order, m.name
     limit 1;
    if v_bad is not null then
      raise exception 'Le motif « % » est réservé aux professions réglementées.', v_bad using errcode = 'P0001';
    end if;
  end if;

  delete from public.professional_motifs pm
   where pm.professional_id = p_id and pm.org_id = p_org and pm.motif_id <> all (p_ids);
  get diagnostics v_rows = row_count;
  insert into public.professional_motifs (org_id, professional_id, motif_id)
  select p_org, p_id, x from pg_catalog.unnest(p_ids) as x
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_rows := v_rows + v_n;
  if v_rows > 0 then
    update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id and p.org_id = p_org;
  end if;
end;
$$;

create function private.apply_professional_clienteles(p_org uuid, p_id uuid, p_ids uuid[], p_flags boolean[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_bad text;
  v_rows int;
  v_n int;
begin
  if exists (select 1 from pg_catalog.unnest(p_ids) as x(id)
              where not exists (select 1 from public.clienteles c where c.org_id = p_org and c.id = x.id)) then
    raise exception 'Clientèle inconnue.' using errcode = '22023';
  end if;
  select c.name into v_bad
    from pg_catalog.unnest(p_ids) as x(id)
    join public.clienteles c on c.org_id = p_org and c.id = x.id
   where not c.is_active
     and not exists (select 1 from public.professional_clienteles pc
                      where pc.professional_id = p_id and pc.org_id = p_org and pc.clientele_id = x.id)
   order by c.sort_order, c.name
   limit 1;
  if v_bad is not null then
    raise exception 'La clientèle « % » est archivée.', v_bad using errcode = 'P0001';
  end if;

  delete from public.professional_clienteles pc
   where pc.professional_id = p_id and pc.org_id = p_org and pc.clientele_id <> all (p_ids);
  get diagnostics v_rows = row_count;
  -- Only flags that change are written (no audit noise).
  update public.professional_clienteles pc set is_specialized = x.flag
    from unnest(p_ids, p_flags) as x(id, flag)
   where pc.professional_id = p_id and pc.org_id = p_org and pc.clientele_id = x.id and pc.is_specialized <> x.flag;
  get diagnostics v_n = row_count;
  v_rows := v_rows + v_n;
  insert into public.professional_clienteles (org_id, professional_id, clientele_id, is_specialized)
  select p_org, p_id, x.id, x.flag from unnest(p_ids, p_flags) as x(id, flag)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_rows := v_rows + v_n;
  if v_rows > 0 then
    update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id and p.org_id = p_org;
  end if;
end;
$$;

create function private.apply_professional_languages(p_org uuid, p_id uuid, p_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_bad text;
  v_rows int;
  v_n int;
begin
  if pg_catalog.cardinality(p_ids) = 0 then
    raise exception 'Au moins une langue est requise.' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_catalog.unnest(p_ids) as x
              where not exists (select 1 from public.languages l where l.org_id = p_org and l.id = x)) then
    raise exception 'Langue inconnue.' using errcode = '22023';
  end if;
  select l.name into v_bad
    from pg_catalog.unnest(p_ids) as x
    join public.languages l on l.org_id = p_org and l.id = x
   where not l.is_active
     and not exists (select 1 from public.professional_languages pl
                      where pl.professional_id = p_id and pl.org_id = p_org and pl.language_id = x)
   order by l.sort_order, l.name
   limit 1;
  if v_bad is not null then
    raise exception 'La langue « % » est archivée.', v_bad using errcode = 'P0001';
  end if;

  delete from public.professional_languages pl
   where pl.professional_id = p_id and pl.org_id = p_org and pl.language_id <> all (p_ids);
  get diagnostics v_rows = row_count;
  insert into public.professional_languages (org_id, professional_id, language_id)
  select p_org, p_id, x from pg_catalog.unnest(p_ids) as x
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_rows := v_rows + v_n;
  if v_rows > 0 then
    update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id and p.org_id = p_org;
  end if;
end;
$$;

-- [{"title_id": uuid, "licence_number"?: text, "is_primary"?: boolean}], 0 to 2 items: the checks
-- that need no lock (shape, count, a title chosen twice, two primaries). The flagged item is
-- primary, else the first. Refusals about one title carry HINT title and DETAIL its id (P4-91).
create function private.parse_profession_items(p_items jsonb, out titles uuid[], out licences text[], out primary_flags boolean[])
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_count int;
  v_tid uuid;
begin
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'Liste invalide : tableau JSON attendu.' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_items) as e(v)
     where pg_catalog.jsonb_typeof(e.v) <> 'object'
        or pg_catalog.jsonb_typeof(e.v -> 'title_id') is distinct from 'string'
        or (e.v ->> 'title_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'  -- before the cast below: 22023, not 22P02
        or coalesce(pg_catalog.jsonb_typeof(e.v -> 'licence_number'), 'null') not in ('string', 'null')
        or coalesce(pg_catalog.jsonb_typeof(e.v -> 'is_primary'), 'null') not in ('boolean', 'null')
  ) then
    raise exception 'Élément invalide : {"title_id": uuid, "licence_number": texte, "is_primary": booléen} attendu.'
      using errcode = '22023';
  end if;
  v_count := pg_catalog.jsonb_array_length(p_items);
  if v_count > 2 then
    raise exception 'Un professionnel a au plus deux titres.' using errcode = 'P0001';
  end if;
  select coalesce(pg_catalog.array_agg((e.v ->> 'title_id')::uuid order by e.ord), '{}'),
         coalesce(pg_catalog.array_agg(e.v ->> 'licence_number' order by e.ord), '{}'),
         coalesce(pg_catalog.array_agg(coalesce((e.v ->> 'is_primary')::boolean, false) order by e.ord), '{}')
    into titles, licences, primary_flags
    from pg_catalog.jsonb_array_elements(p_items) with ordinality as e(v, ord);
  select x.tid into v_tid from pg_catalog.unnest(titles) as x(tid) group by x.tid having count(*) > 1 limit 1;
  if v_tid is not null then
    raise exception 'Un titre ne peut être choisi qu''une fois.' using errcode = 'P0001', hint = 'title', detail = v_tid::text;
  end if;
  if (select count(*) from pg_catalog.unnest(primary_flags) as f where f) > 1 then
    raise exception 'Un seul titre principal.' using errcode = 'P0001';
  end if;
  if v_count > 0 and not (true = any (primary_flags)) then
    primary_flags[1] := true;
  end if;
end;
$$;

-- Order of writes: removed titles → rows losing the primary flag → upsert by title (row ids survive;
-- the one-primary index never sees two at once; the deferred check sees one primary at commit).
create function private.apply_professional_professions(
  p_org uuid, p_id uuid, p_titles uuid[], p_licences text[], p_primary boolean[], p_check_restricted boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tid uuid;
  v_bad text;
  v_rows int;
  v_n int;
begin
  if exists (select 1 from pg_catalog.unnest(p_titles) as x(tid)
              where not exists (select 1 from public.profession_titles t where t.org_id = p_org and t.id = x.tid)) then
    raise exception 'Titre inconnu.' using errcode = '22023';
  end if;
  select x.tid into v_tid
    from pg_catalog.unnest(p_titles) as x(tid)
    join public.profession_titles t on t.org_id = p_org and t.id = x.tid
   where not t.is_active
     and not exists (select 1 from public.professional_professions pp
                      where pp.professional_id = p_id and pp.org_id = p_org and pp.profession_title_id = x.tid)
   limit 1;
  if v_tid is not null then
    raise exception 'Ce titre est archivé.' using errcode = 'P0001', hint = 'title', detail = v_tid::text;
  end if;

  -- Restricted motifs keep a regulated profession (P4-16): the last one cannot go while held.
  if p_check_restricted
     and not exists (select 1 from pg_catalog.unnest(p_titles) as x(tid)
                       join public.profession_titles t on t.org_id = p_org and t.id = x.tid
                      where t.order_id is not null) then
    select pg_catalog.string_agg(m.name, ', ' order by m.sort_order, m.name) into v_bad
      from public.professional_motifs pm
      join public.motifs m on m.org_id = pm.org_id and m.id = pm.motif_id
     where pm.professional_id = p_id and pm.org_id = p_org and m.is_restricted;
    if v_bad is not null then
      raise exception 'Retirez d''abord les motifs réservés aux professions réglementées : %.', v_bad using errcode = 'P0001';
    end if;
  end if;

  delete from public.professional_professions pp
   where pp.professional_id = p_id and pp.org_id = p_org and pp.profession_title_id <> all (p_titles);
  get diagnostics v_rows = row_count;
  update public.professional_professions pp set is_primary = false
    from unnest(p_titles, p_primary) as x(tid, primary_flag)
   where pp.professional_id = p_id and pp.org_id = p_org and pp.profession_title_id = x.tid
     and pp.is_primary and not x.primary_flag;
  get diagnostics v_n = row_count;
  v_rows := v_rows + v_n;
  -- Counts inserted rows and rows the DO UPDATE changed (its WHERE skips the others).
  insert into public.professional_professions as pp (org_id, professional_id, profession_title_id, licence_number, is_primary)
  select p_org, p_id, x.tid, x.licence, x.primary_flag
    from unnest(p_titles, p_licences, p_primary) as x(tid, licence, primary_flag)
  on conflict on constraint professional_professions_title_key do update
    set licence_number = excluded.licence_number, is_primary = excluded.is_primary
  where (pp.licence_number, pp.is_primary) is distinct from (excluded.licence_number, excluded.is_primary);
  get diagnostics v_n = row_count;
  v_rows := v_rows + v_n;
  if v_rows > 0 then
    update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id and p.org_id = p_org;
  end if;
end;
$$;

revoke all on function
  private.assert_restricted_motifs_ok(uuid, uuid),
  private.apply_professional_motifs(uuid, uuid, uuid[], boolean),
  private.apply_professional_clienteles(uuid, uuid, uuid[], boolean[]),
  private.apply_professional_languages(uuid, uuid, uuid[]),
  private.parse_profession_items(jsonb),
  private.apply_professional_professions(uuid, uuid, uuid[], text[], boolean[], boolean)
from public, anon, authenticated, service_role;

-- Four set RPCs of *_professionals_core.sql, now thin wrappers (no approaches: P4-240, P4-276)
-- (same signatures, grants, order of checks, refusals and results).
create or replace function public.set_professional_motifs(p_id uuid, p_motif_ids uuid[])
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_ids uuid[];
begin
  if not private.has_permission('professionals.matching') then
    raise exception 'Permission refusée : professionals.matching' using errcode = '42501';
  end if;
  v_ids := private.distinct_ids(p_motif_ids);
  perform private.lock_professional(p_id);
  perform private.apply_professional_motifs(v_org, p_id, v_ids, true);
  return query select pm.motif_id from public.professional_motifs pm
                where pm.professional_id = p_id and pm.org_id = v_org order by pm.motif_id;
end;
$$;

create or replace function public.set_professional_clienteles(p_id uuid, p_items jsonb)
returns table (clientele_id uuid, is_specialized boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_ids uuid[];
  v_flags boolean[];
begin
  if not private.has_permission('professionals.matching') then
    raise exception 'Permission refusée : professionals.matching' using errcode = '42501';
  end if;
  select x.ids, x.flags into v_ids, v_flags from private.parse_specialized_items(p_items) x;
  perform private.lock_professional(p_id);
  perform private.apply_professional_clienteles(v_org, p_id, v_ids, v_flags);
  return query select pc.clientele_id, pc.is_specialized from public.professional_clienteles pc
                where pc.professional_id = p_id and pc.org_id = v_org order by pc.clientele_id;
end;
$$;

create or replace function public.set_professional_languages(p_id uuid, p_language_ids uuid[])
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_ids uuid[];
begin
  if not private.has_permission('professionals.matching') then
    raise exception 'Permission refusée : professionals.matching' using errcode = '42501';
  end if;
  v_ids := private.distinct_ids(p_language_ids);
  perform private.lock_professional(p_id);
  perform private.apply_professional_languages(v_org, p_id, v_ids);
  return query select pl.language_id from public.professional_languages pl
                where pl.professional_id = p_id and pl.org_id = v_org order by pl.language_id;
end;
$$;

create or replace function public.set_professional_professions(p_id uuid, p_items jsonb)
returns table (id uuid, profession_title_id uuid, licence_number text, is_primary boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_items record;
begin
  if not private.has_permission('professionals.manage') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  select * into v_items from private.parse_profession_items(p_items);
  perform private.lock_professional(p_id);
  perform private.apply_professional_professions(v_org, p_id, v_items.titles, v_items.licences, v_items.primary_flags, true);
  return query select pp.id, pp.profession_title_id, pp.licence_number, pp.is_primary
                 from public.professional_professions pp
                where pp.professional_id = p_id and pp.org_id = v_org
                order by pp.is_primary desc, pp.created_at, pp.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Snapshot of a record in the questionnaire's shape (prefill, and « Actuel » in the review)
-- -----------------------------------------------------------------------------
-- Sets are sorted as the questionnaire stores them (ids ascending; periods in their fixed order);
-- professions keep the record's order (primary first). Photo, insurance, private data and consent
-- have no snapshot here (4c, never values, professional_consents).
create function private.professional_submission_snapshot(p_org uuid, p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'personal', pg_catalog.jsonb_build_object(
      'personal_phone', p.personal_phone, 'address_line1', p.address_line1, 'address_line2', p.address_line2,
      'city', p.city, 'province', p.province, 'postal_code', p.postal_code),
    'professional', pg_catalog.jsonb_build_object(
      'professions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                        'title_id', x.profession_title_id, 'licence_number', x.licence_number,
                                        'is_primary', x.is_primary)
                                      order by x.is_primary desc, x.created_at, x.id)
                                 from public.professional_professions x
                                where x.professional_id = p.id and x.org_id = p.org_id), '[]'),
      'years_experience', p.years_experience),
    'portrait', pg_catalog.jsonb_build_object(
      'bio', pp.bio, 'approach', pp.approach, 'public_email', pp.public_email, 'public_phone', pp.public_phone),
    'languages', pg_catalog.jsonb_build_object(
      'language_ids', coalesce((select pg_catalog.jsonb_agg(x.language_id order by x.language_id)
                                  from public.professional_languages x
                                 where x.professional_id = p.id and x.org_id = p.org_id), '[]')),
    'clienteles', pg_catalog.jsonb_build_object(
      'clienteles', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.clientele_id, 'specialized', x.is_specialized)
                                     order by x.clientele_id)
                                from public.professional_clienteles x
                               where x.professional_id = p.id and x.org_id = p.org_id), '[]'),
      'min_client_age', mp.min_client_age, 'women_only', mp.women_only),
    'motifs', pg_catalog.jsonb_build_object(
      'motif_ids', coalesce((select pg_catalog.jsonb_agg(x.motif_id order by x.motif_id)
                               from public.professional_motifs x
                              where x.professional_id = p.id and x.org_id = p.org_id), '[]')),
    'availability', pg_catalog.jsonb_build_object(
      'accepting_new_clients', mp.accepting_new_clients,
      'availability_periods', coalesce((select pg_catalog.jsonb_agg(x order by pg_catalog.array_position(array['am', 'pm', 'end_of_day', 'evening', 'weekend'], x))
                                          from pg_catalog.unnest(mp.availability_periods) as x), '[]'),
      'availability_note', mp.availability_note))
    from public.professionals p
    left join public.professional_public_profiles pp on pp.professional_id = p.id and pp.org_id = p.org_id
    left join public.professional_matching_profiles mp on mp.professional_id = p.id and mp.org_id = p.org_id
   where p.id = p_id and p.org_id = p_org
$$;

-- Professions compared regardless of their order (the review's « changed »).
create function private.canonical_professions(p_items jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce((select pg_catalog.jsonb_agg(e.v order by e.v ->> 'title_id')
                     from pg_catalog.jsonb_array_elements(
                            case when pg_catalog.jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) as e(v)),
                  '[]'::jsonb)
$$;

-- Creates a submission with its prefill (the requested sections of the snapshot) and returns its id.
create function private.create_professional_submission(
  p_org uuid, p_id uuid, p_kind text, p_sections text[], p_link uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_snapshot jsonb := private.professional_submission_snapshot(p_org, p_id);
  v_id uuid;
begin
  insert into public.professional_submissions (org_id, professional_id, kind, requested_sections, prefill, secure_link_id)
  values (p_org, p_id, p_kind, p_sections,
          coalesce((select pg_catalog.jsonb_object_agg(e.key, e.value)
                      from pg_catalog.jsonb_each(v_snapshot) e
                     where e.key = any (p_sections)), '{}'),
          p_link)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function
  private.professional_submission_snapshot(uuid, uuid),
  private.canonical_professions(jsonb),
  private.create_professional_submission(uuid, uuid, text, text[], uuid)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Questionnaire values: normalisation of one section (before any lock) and the dry run
-- -----------------------------------------------------------------------------
-- p_values -> p_key as text (null for a missing key or JSON null); 22023 for any other JSON type.
create function private.submission_string(p_values jsonb, p_key text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.jsonb_typeof(p_values -> p_key), 'null') not in ('string', 'null') then
    raise exception 'Valeur invalide : texte attendu.' using errcode = '22023', hint = p_key;
  end if;
  return p_values ->> p_key;
end;
$$;

-- A one-line label as the reference lists store it (private.reference_text), with the field's HINT.
create function private.submission_label(p_value text, p_label text, p_max int, p_hint text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  return private.reference_text(p_value, p_label, p_max, false, true);
exception when sqlstate 'P0001' then
  raise exception using message = sqlerrm, errcode = 'P0001', hint = p_hint;
end;
$$;

-- A free text as the table stores it (paragraphs allowed): trimmed, blank = null, at most p_max.
create function private.submission_long_text(p_value text, p_label text, p_max int, p_hint text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(pg_catalog.btrim(p_value, E' \t\r\n'), '');
begin
  if pg_catalog.char_length(v) > p_max then
    raise exception '% ne peut pas dépasser % caractères.', p_label, p_max using errcode = 'P0001', hint = p_hint;
  end if;
  return v;
end;
$$;

-- A North American phone as stored (+1 and ten digits); spaces, dots, dashes and parentheses ignored.
create function private.submission_phone(p_value text, p_hint text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(pg_catalog.regexp_replace(coalesce(p_value, ''), '[ \t\r\n().-]', '', 'g'), '');
begin
  if v ~ '^[0-9]{10}$' then
    v := '+1' || v;
  elsif v ~ '^1[0-9]{10}$' then
    v := '+' || v;
  end if;
  if v !~ '^\+1[0-9]{10}$' then
    raise exception 'Numéro de téléphone invalide : 10 chiffres attendus.' using errcode = 'P0001', hint = p_hint;
  end if;
  return v;
end;
$$;

-- An optional uuid (string or null); 22023 otherwise.
create function private.submission_uuid(p_value jsonb, p_hint text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if pg_catalog.jsonb_typeof(p_value) <> 'string'
     or (p_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Identifiant invalide.' using errcode = '22023', hint = p_hint;
  end if;
  return (p_value #>> '{}')::uuid;
end;
$$;

-- An array of at most 500 uuids (null = empty), distinct and sorted; 22023 otherwise.
create function private.submission_uuid_array(p_value jsonb, p_hint text)
returns uuid[]
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value) = 'null' then
    return '{}';
  end if;
  if pg_catalog.jsonb_typeof(p_value) <> 'array' or pg_catalog.jsonb_array_length(p_value) > 500
     or exists (select 1 from pg_catalog.jsonb_array_elements(p_value) as e(v)
                 where pg_catalog.jsonb_typeof(e.v) <> 'string'
                    or (e.v #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'Liste invalide : tableau de 500 identifiants au plus attendu.' using errcode = '22023', hint = p_hint;
  end if;
  return coalesce((select pg_catalog.array_agg(distinct (e.v #>> '{}')::uuid)
                     from pg_catalog.jsonb_array_elements(p_value) as e(v)), '{}');
end;
$$;

-- A staged upload of the questionnaire: the provider's own (p_uploader), of the purpose
-- professional_submission_file, uploaded for this submission (its subject, P4-306: a file staged for
-- another submission, or already attached to the record, is not reused), ready and not past its
-- retain_until, of the clinic, and of the accepted types and size. « Fichier introuvable » reveals
-- nothing about another file.
create function private.assert_submission_file(
  p_org uuid, p_uploader uuid, p_submission_id uuid, p_file_id uuid, p_mime_types text[], p_max_bytes int,
  p_hint text, p_message text)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_mime text;
  v_size int;
begin
  select f.mime_type, f.size_bytes into v_mime, v_size
    from public.stored_files f
   where f.id = p_file_id and f.org_id = p_org and f.purpose = 'professional_submission_file'
     and f.subject_type = 'professional_submission' and f.subject_id = p_submission_id
     and f.uploaded_by = p_uploader and f.status = 'ready'
     and (f.retain_until is null or f.retain_until > pg_catalog.now());
  if not found then
    raise exception 'Fichier introuvable. Téléversez-le de nouveau.' using errcode = 'P0001', hint = p_hint;
  end if;
  if not (v_mime = any (p_mime_types)) or v_size > p_max_bytes then
    raise exception '%', p_message using errcode = 'P0001', hint = p_hint;
  end if;
end;
$$;

-- One section's answers as stored: only the keys given (a key absent is a field not answered,
-- P4-176; the save merges them into the section), every key known to the section, every value of
-- the right JSON type (22023 otherwise, without echoing it), every rule the record's forms and
-- tables apply (P0001 with the field's HINT). Needs no lock; the sets' rules against the clinic's
-- lists run in the dry run below, the files' against stored_files in save_my_submission_draft
-- (private.assert_submission_file, under the lock). tax_bank and consent have their own RPCs.
create function private.normalize_submission_section(p_section text, p_values jsonb)
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
        raise exception 'Cette assurance est déjà échue : joignez une preuve en vigueur.' using errcode = 'P0001', hint = 'expires_on';
      end if;
      if v_date > date '2100-12-31' then
        raise exception 'La date doit être au plus tard le 2100-12-31.' using errcode = 'P0001', hint = 'expires_on';
      end if;
    end if;
    v_out := pg_catalog.jsonb_build_object('file_id', v_file, 'expires_on', v_date);
  end case;
  -- Only the keys given: a field left out keeps whatever the section already holds (P4-176).
  return coalesce((select pg_catalog.jsonb_object_agg(e.key, e.value) from pg_catalog.jsonb_each(v_out) e
                    where p_values ? e.key), '{}'::jsonb);
end;
$$;

-- Applies the answered set fields of p_values (a would-be submitted_values) to the professional with the
-- staff write paths, checks the restricted-motif rule once on the result, then rolls everything back
-- (SQLSTATE PRDRY). Only p_sections are run: the section being saved, plus professions with motifs
-- (the rule spans both). Any refusal of those paths propagates as is (P4-174). Call it with the
-- professional locked.
create function private.dry_run_submission_sets(p_org uuid, p_id uuid, p_values jsonb, p_sections text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_items record;
  v_ids uuid[];
  v_flags boolean[];
begin
  begin
    if 'professional' = any (p_sections) and (p_values -> 'professional') ? 'professions' then
      select * into v_items from private.parse_profession_items(coalesce(p_values #> '{professional,professions}', '[]'));
      perform private.apply_professional_professions(p_org, p_id, v_items.titles, v_items.licences, v_items.primary_flags, false);
    end if;
    if 'languages' = any (p_sections) and (p_values -> 'languages') ? 'language_ids' then
      perform private.apply_professional_languages(p_org, p_id,
        private.submission_uuid_array(p_values #> '{languages,language_ids}', 'language_ids'));
    end if;
    if 'clienteles' = any (p_sections) and (p_values -> 'clienteles') ? 'clienteles' then
      select x.ids, x.flags into v_ids, v_flags from private.parse_specialized_items(coalesce(p_values #> '{clienteles,clienteles}', '[]')) x;
      perform private.apply_professional_clienteles(p_org, p_id, v_ids, v_flags);
    end if;
    if 'motifs' = any (p_sections) and (p_values -> 'motifs') ? 'motif_ids' then
      perform private.apply_professional_motifs(p_org, p_id,
        private.submission_uuid_array(p_values #> '{motifs,motif_ids}', 'motif_ids'), false);
    end if;
    if p_sections && array['professional', 'motifs'] then
      perform private.assert_restricted_motifs_ok(p_org, p_id);
    end if;
    raise exception using errcode = 'PRDRY';
  exception when sqlstate 'PRDRY' then
    null;
  end;
end;
$$;

revoke all on function
  private.submission_string(jsonb, text),
  private.submission_label(text, text, int, text),
  private.submission_long_text(text, text, int, text),
  private.submission_phone(text, text),
  private.submission_uuid(jsonb, text),
  private.submission_uuid_array(jsonb, text),
  private.assert_submission_file(uuid, uuid, uuid, uuid, text[], int, text, text),
  private.normalize_submission_section(text, jsonb),
  private.dry_run_submission_sets(uuid, uuid, jsonb, text[])
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Completeness (submit) — P4-173
-- -----------------------------------------------------------------------------
-- The requested sections that are not complete, in questionnaire order. A section is complete when
-- saved with what the clinic needs: phone and address; a title; a presentation; a language, a
-- clientèle, a motif; the availability saved; a photo and an insurance (file still
-- staged, expiry not passed); institution, transit and account (and the SIN while collect_sin is
-- on), entered here or already on file; the latest published consent signed.
create function private.submission_gaps(p_sub public.professional_submissions)
returns text[]
language sql
stable
set search_path = ''
as $$
  with v as (select p_sub.submitted_values as j),
  sp as (select s.* from public.professional_submission_private s
          where s.submission_id = p_sub.id and s.org_id = p_sub.org_id),
  pp as (select x.* from public.professional_private x
          where x.professional_id = p_sub.professional_id and x.org_id = p_sub.org_id)
  select coalesce(pg_catalog.array_agg(s.section order by s.ord), '{}')
    from pg_catalog.unnest(private.submission_sections()) with ordinality as s(section, ord), v
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
         and coalesce((select sp.bank_institution from sp), (select pp.bank_institution from pp)) is not null
         and coalesce((select sp.bank_transit from sp), (select pp.bank_transit from pp)) is not null
         and (exists (select 1 from sp where sp.bank_account is not null) or exists (select 1 from pp where pp.bank_account is not null))
         and (not coalesce((private.professionals_setting(p_sub.org_id, 'collect_sin'))::boolean, false)
              or exists (select 1 from sp where sp.sin is not null) or exists (select 1 from pp where pp.sin is not null))
       when 'consent' then (v.j #>> '{consent,consent_version_id}')::uuid
                           = private.current_consent_version(p_sub.org_id, 'image_rights')
     end, false)
$$;
revoke all on function private.submission_gaps(public.professional_submissions) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Invitation states (list and record; A2.5 precedence)
-- -----------------------------------------------------------------------------
-- Per professional of p_org (one, or all when p_id is null), in one statement: the state of the
-- invitation link that matters — used > revoked > expired > opened > sent —, its times, the open
-- submission and whether an onboarding was approved. Rows only for professionals with a link or a
-- submission. The link that matters, deterministically: the used one (the account came from it),
-- else the live one (at most one: secure_links_live_key), else the newest; links issued in one
-- transaction share created_at, so the id breaks the last tie.
create function private.professional_onboarding_states(p_org uuid, p_id uuid)
returns table (
  professional_id uuid, state text, sent_at timestamptz, expires_at timestamptz, opened_at timestamptz,
  used_at timestamptz, submission_id uuid, submission_kind text, submission_status text,
  submitted_at timestamptz, onboarding_approved boolean
)
language sql
stable
set search_path = ''
as $$
  with l as (
    select distinct on (x.subject_id) x.subject_id as pid, x.created_at, x.expires_at, x.last_opened_at,
           x.used_at, x.revoked_at, x.use_count
      from public.secure_links x
     where x.org_id = p_org and x.purpose = 'professional_invite' and x.subject_type = 'professional'
       and (p_id is null or x.subject_id = p_id)
     order by x.subject_id, (x.use_count > 0) desc, (x.revoked_at is null) desc, x.created_at desc, x.id desc
  ), s as (
    select x.professional_id as pid, x.id, x.kind, x.status, x.submitted_at
      from public.professional_submissions x
     where x.org_id = p_org and x.status in ('draft', 'submitted') and (p_id is null or x.professional_id = p_id)
  ), a as (
    select distinct x.professional_id as pid
      from public.professional_submissions x
     where x.org_id = p_org and x.kind = 'onboarding' and x.status = 'approved' and (p_id is null or x.professional_id = p_id)
  )
  select p.id,
         case when l.pid is null then null
              when l.use_count > 0 then 'used'
              when l.revoked_at is not null then 'revoked'
              when l.expires_at <= pg_catalog.now() then 'expired'
              when l.last_opened_at is not null then 'opened'
              else 'sent' end,
         l.created_at, l.expires_at, l.last_opened_at, l.used_at,
         s.id, s.kind, s.status, s.submitted_at, a.pid is not null
    from public.professionals p
    left join l on l.pid = p.id
    left join s on s.pid = p.id
    left join a on a.pid = p.id
   where p.org_id = p_org and (p_id is null or p.id = p_id)
     and (l.pid is not null or s.pid is not null or a.pid is not null)
$$;
revoke all on function private.professional_onboarding_states(uuid, uuid) from public, anon, authenticated, service_role;

-- The record's onboarding line, requested with the record (same tick, no waterfall): the latest
-- link's state and times, the open submission and whether an onboarding was approved; null when the
-- file has neither a link nor a submission. professionals.view; another clinic's id reads null.
-- Not folded into get_professional_record yet (P4-270): 4b.3 may fold it in.
create function public.get_professional_onboarding(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  return (
    select pg_catalog.jsonb_build_object(
             'invitation', case when s.state is not null then pg_catalog.jsonb_build_object(
                                  'state', s.state, 'sent_at', s.sent_at, 'expires_at', s.expires_at,
                                  'opened_at', s.opened_at, 'used_at', s.used_at) end,
             'submission', case when s.submission_id is not null then pg_catalog.jsonb_build_object(
                                  'id', s.submission_id, 'kind', s.submission_kind, 'status', s.submission_status,
                                  'submitted_at', s.submitted_at) end,
             'onboarding_approved', s.onboarding_approved)
      from private.professional_onboarding_states(private.current_user_org_id(), p_id) s);
end;
$$;

-- « À surveiller » and P4-43 for the whole list, in one request (4b.3 joins it in memory).
create function public.list_professional_invitation_states()
returns table (
  professional_id uuid, state text, sent_at timestamptz, expires_at timestamptz, opened_at timestamptz,
  used_at timestamptz, submission_id uuid, submission_kind text, submission_status text,
  submitted_at timestamptz, onboarding_approved boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  return query select * from private.professional_onboarding_states(private.current_user_org_id(), null);
end;
$$;

-- -----------------------------------------------------------------------------
-- Readiness: « Compte créé » and « Questionnaire approuvé » (4a.4's view replaced, columns appended)
-- -----------------------------------------------------------------------------
create or replace view public.professionals_readiness with (security_invoker = true) as
select r.professional_id, r.org_id, r.has_profession, r.licences_ok, r.restricted_motifs_ok, r.has_language,
       r.has_clientele, r.has_motif, r.matching_complete, r.email_matches_login,
       (r.matching_complete and r.account_created and r.submission_approved) as ready,
       r.account_created, r.submission_approved
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
           (sa.professional_id is not null)                                    as submission_approved
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
  ) r;

-- {complete, done, total, items: [{key, done, missing}], warnings}: 4a.4's item, then
-- account_created and submission_approved (missing is empty: the key names the gap, P4-179).
create or replace function public.get_professional_readiness(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'complete', r.ready,
           'done', r.matching_complete::int + r.account_created::int + r.submission_approved::int,
           'total', 3,
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
             pg_catalog.jsonb_build_object('key', 'submission_approved', 'done', r.submission_approved, 'missing', '[]'::jsonb)),
           'warnings', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
             case when not r.email_matches_login then 'login_email_mismatch' end], null)))
    from public.professionals_readiness r
   where r.professional_id = p_id
$$;

-- -----------------------------------------------------------------------------
-- History: submissions and consents (never the private table); « Approches » no longer listed (P4-276)
-- -----------------------------------------------------------------------------
create or replace function private.professional_history_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['professionals', 'professional_public_profiles', 'professional_matching_profiles',
               'professional_professions', 'professional_clienteles',
               'professional_motifs', 'professional_languages', 'professional_payer_numbers',
               'professional_private', 'professional_retention', 'professional_session_counts',
               'professional_client_agreements', 'professional_submissions', 'professional_consents']
$$;

-- Same signature, grants, checks and paging as *_professionals_compensation_private.sql (private rows
-- without values, compensation rows for professionals.compensation only), and two changes for the
-- questionnaire (4b.3 review):
-- * a submission row that changes only draft content (`submitted_values`, redacted: the provider's
--   autosave and consent signature; `secure_link_id`: the link the draft points at) is left out:
--   a page of autosaves would otherwise show nothing, and these are not events;
-- * every other submission row carries the submission's `kind` ('onboarding' or 'update') in
--   changed_fields (an update row only lists what changed), so the history says « mise à jour »
--   for an update request. The column never changes, so the key never clashes with a change.
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
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  if not private.has_permission('professionals.compensation') then
    v_tables := array(select t from pg_catalog.unnest(v_tables) t
                       where t <> all (private.professional_compensation_history_tables()));
  end if;
  return query
    select a.id, a.created_at, a.table_name, a.record_id, a.action,
           case
             when a.table_name = 'professional_submissions' and a.action <> 'insert' and sk.kind is not null
                  and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
               then a.changed_fields || pg_catalog.jsonb_build_object('kind', sk.kind)
             when a.table_name <> 'professional_private' then a.changed_fields
             when a.action = 'read' and pg_catalog.jsonb_typeof(a.changed_fields -> 'fields') = 'array'
               then pg_catalog.jsonb_build_object('fields', (
                      select coalesce(pg_catalog.jsonb_agg(f.value order by f.ord), '[]'::jsonb)
                        from pg_catalog.jsonb_array_elements(a.changed_fields -> 'fields') with ordinality as f(value, ord)
                       where f.value in ('"sin"'::jsonb, '"bank_account"'::jsonb)))
           end,
           a.actor_id, pr.display_name, a.actor_role, a.source
      from public.audit_log a
      left join public.profiles pr on pr.user_id = a.actor_id and pr.org_id = a.org_id
      -- record_id is '<professional_id>:<submission id>' (the primary key's columns).
      left join lateral (select s.kind from public.professional_submissions s
                          where a.table_name = 'professional_submissions'
                            and s.professional_id = p_id and s.org_id = v_org
                            and s.id::text = pg_catalog.substr(a.record_id, 38)) sk on true
     where a.org_id = v_org
       and left(a.record_id, 36) = v_prefix
       and a.id < v_before
       and a.table_name = any (v_tables)
       and not (a.table_name = 'professional_submissions' and a.action = 'update'
                and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
                and not exists (select 1 from pg_catalog.jsonb_object_keys(a.changed_fields) k(key)
                                 where k.key not in ('submitted_values', 'secure_link_id')))
     order by a.id desc
     limit v_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- Deactivation revokes the open invitation link (4a.4 / 4a.14 « for later tasks ») and closes the
-- open submission (P4-301)
-- -----------------------------------------------------------------------------
-- Same signature, grants, checks and result as *_professionals_lifecycle.sql, plus the revocation
-- and the cancellation (professional, then links and submission: the module's lock order).
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
    raise exception 'La note compte au plus 500 caractères.' using errcode = 'P0001', hint = 'note';
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

-- -----------------------------------------------------------------------------
-- Invitation RPCs
-- -----------------------------------------------------------------------------
-- Issues a file's invitation link (P4-300): the clinic's lifetime (invitation_expiry_days), the
-- file's address bound in the scope ({"email": …}, lower case) and the previous live link revoked
-- (issue_secure_link). The handlers refuse the link once the file's address differs. Call it with
-- the professional locked; every issuer of professional_invite links goes through it (4b.2's
-- re-issue for the reminders too).
create function private.issue_professional_invitation_link(p_org uuid, p_id uuid, p_token_hash bytea, p_created_by uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_email text;
begin
  select pg_catalog.lower(p.email) into v_email from public.professionals p where p.id = p_id and p.org_id = p_org;
  if v_email is null then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;
  return private.issue_secure_link(p_org, 'professional_invite', 'professional', p_id, p_token_hash, p_created_by,
    pg_catalog.make_interval(days => (private.professionals_setting(p_org, 'invitation_expiry_days'))::int),
    pg_catalog.jsonb_build_object('email', v_email));
end;
$$;
revoke all on function private.issue_professional_invitation_link(uuid, uuid, bytea, uuid)
  from public, anon, authenticated, service_role;

-- Locks one professional of the caller's clinic (private.lock_professional) and returns the locked
-- row; P0001 HINT status when the file is inactive (P4-303): nothing is asked of, sent by or
-- applied to an inactive file. p_self picks the provider's wording. Read after the lock, so a
-- deactivation committed meanwhile is seen.
create function private.lock_active_professional(p_id uuid, p_self boolean)
returns public.professionals
language plpgsql
set search_path = ''
as $$
declare
  v_row public.professionals;
begin
  perform private.lock_professional(p_id);
  select * into v_row from public.professionals p where p.id = p_id;
  if v_row.status = 'inactive' then
    if p_self then
      raise exception 'Votre dossier est inactif : communiquez avec la clinique pour le réactiver.'
        using errcode = 'P0001', hint = 'status';
    end if;
    raise exception 'Ce dossier est inactif : réactivez-le d''abord.' using errcode = 'P0001', hint = 'status';
  end if;
  return v_row;
end;
$$;
revoke all on function private.lock_active_professional(uuid, boolean) from public, anon, authenticated, service_role;

-- Service role only (professionals-invite, p_actor = the verified caller): issues a link for a file
-- of the actor's clinic without an account (any status but inactive, P4-171), revoking the previous
-- one, with the clinic's lifetime (invitation_expiry_days) and the file's address bound (P4-300); a
-- draft becomes `invited`; the onboarding
-- submission is created (prefill from the record) or reused, pointed at the new link. Returns what
-- the email needs: {link_id, submission_id, email, first_name, expires_at}.
create function public.create_professional_invitation(p_actor uuid, p_id uuid, p_token_hash bytea)
returns jsonb
language plpgsql
security definer
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

  perform pg_catalog.set_config('app.audit_source', 'rpc:create_professional_invitation', true);
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);

  v_link := private.issue_professional_invitation_link(v_org, p_id, p_token_hash, p_actor);
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
    raise exception 'Une soumission est déjà en cours.' using errcode = 'P0001', hint = 'submission';
  else
    v_sub := private.create_professional_submission(v_org, p_id, 'onboarding', private.submission_sections(), v_link);
  end if;

  select l.expires_at into v_expires from public.secure_links l where l.id = v_link;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return pg_catalog.jsonb_build_object('link_id', v_link, 'submission_id', v_sub, 'email', v_row.email,
                                       'first_name', v_row.first_name, 'expires_at', v_expires);
end;
$$;

-- « Révoquer l'invitation »: the live link stops working; an invited file without an account is
-- « À inviter » again (P4-171). Its open submission is closed (`cancelled`, private answers
-- deleted, P4-301); the next link starts a new onboarding draft.
create function public.revoke_professional_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.professionals;
begin
  if not private.has_permission('professionals.invite') then
    raise exception 'Permission refusée : professionals.invite' using errcode = '42501';
  end if;
  perform private.lock_professional(p_id);
  select * into v_row from public.professionals p where p.id = p_id and p.org_id = v_org;
  if private.revoke_secure_links(v_org, 'professional_invite', 'professional', p_id, auth.uid()) = 0 then
    raise exception 'Aucune invitation en cours.' using errcode = 'P0001', hint = 'invitation';
  end if;
  if v_row.status = 'invited' and v_row.profile_id is null then
    update public.professionals p
       set status = 'draft', status_changed_at = pg_catalog.now(), status_changed_by = auth.uid()
     where p.id = p_id and p.org_id = v_org;
  end if;
  perform private.cancel_open_submission(v_org, p_id);
end;
$$;

-- « Demander une mise à jour » (P4-44: no link; the email opens the questionnaire behind sign-in).
-- Returns what the email needs: {submission_id, email, first_name}.
create function public.request_professional_update(p_id uuid, p_sections text[])
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
    raise exception 'Une soumission est déjà en cours.' using errcode = 'P0001', hint = 'submission';
  end if;
  v_sub := private.create_professional_submission(v_org, p_id, 'update', v_sections, null);
  return pg_catalog.jsonb_build_object('submission_id', v_sub, 'email', v_row.email, 'first_name', v_row.first_name);
end;
$$;

-- -----------------------------------------------------------------------------
-- Purpose handlers (service role: resolve-link, accept-invite; P3-16)
-- -----------------------------------------------------------------------------
-- What /invitation shows for a live link: the clinic, the professional's own name and address (the
-- token proves the address), the expiry. Null when the link is no longer live, the file already
-- has an account, is inactive, or no longer has the address the link was sent to (P4-300) —
-- resolve-link then answers link_invalid.
create function public.resolve_professional_invitation(p_link_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'clinic_name', o.name,
           'display_name', pg_catalog.rtrim(pg_catalog.left(p.first_name || ' ' || p.last_name, 80)),
           'email', p.email,
           'expires_at', l.expires_at)
    from public.secure_links l
    join public.professionals p on p.id = l.subject_id and p.org_id = l.org_id
    join public.organizations o on o.id = l.org_id
   where l.id = p_link_id and l.purpose = 'professional_invite' and l.subject_type = 'professional'
     and l.revoked_at is null and l.use_count < l.max_uses and l.expires_at > pg_catalog.now()
     and p.profile_id is null and p.status <> 'inactive'
     and l.scope ->> 'email' = pg_catalog.lower(p.email)
$$;

-- accept-invite's accept_rpc, after it created p_user_id with the address resolve returned. One
-- transaction: lock the professional, consume the link, re-check the inviter (P3-31) and the
-- address, create the profile (active, role provider) and link it. Answers
--   {"status": "accepted", "org_id": …, "redirect": "/mon-profil/questionnaire"}
--   {"status": "link_used" | "link_expired" | "link_invalid"}   the function deletes the user
-- link_invalid also when the inviter no longer holds professionals.invite in the clinic, when the
-- file's address is no longer the one the link was sent to (P4-300) and when the file is inactive
-- (P4-303): the consumption is rolled back; staff re-send it. A file that has meanwhile got an account answers
-- link_used (its link is spent). 22023 (all rolled back) when p_user_id is not an auth user with the
-- professional's address; 23505 when it already has a profile. p_payload is unused.
create function public.link_professional_account(p_token_hash bytea, p_user_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_pid uuid;
  v_row public.professionals;
  v_link public.secure_links%rowtype;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_user_id is null then
    raise exception 'Compte manquant' using errcode = '22023';
  end if;
  -- The link's professional unlocked, then the professional's lock, then the consumption: the
  -- order of every writer of these links (professional, then link).
  select l.org_id, l.subject_id into v_org, v_pid from public.secure_links l
   where l.token_hash = p_token_hash and l.purpose = 'professional_invite' and l.subject_type = 'professional';
  if not found then
    return '{"status": "link_invalid"}'::jsonb;
  end if;
  select * into v_row from public.professionals p where p.id = v_pid and p.org_id = v_org for no key update;
  if not found then
    return '{"status": "link_invalid"}'::jsonb;
  end if;

  -- A block, so that a failed inviter re-check rolls the consumption back.
  begin
    v_link := private.consume_secure_link(p_token_hash, 'professional_invite');
    if v_link.id is null then
      -- Expired, used or revoked since the function's peek: answer what peek would now.
      return pg_catalog.jsonb_build_object('status',
        case public.peek_secure_link(p_token_hash, false) ->> 'state'
          when 'used' then 'link_used' when 'expired' then 'link_expired' else 'link_invalid' end);
    end if;
    if not ('professionals.invite' = any (private.permission_keys_for(v_link.created_by)))
       or not exists (select 1 from public.profiles p where p.user_id = v_link.created_by and p.org_id = v_org) then
      raise exception 'Inviter without professionals.invite' using errcode = 'P0001';
    end if;
    -- The address the link was sent to must still be the file's (read under the lock above).
    if (v_link.scope ->> 'email') is distinct from pg_catalog.lower(v_row.email) then
      raise exception 'Invitation sent to another address' using errcode = 'P0001';
    end if;
    if v_row.status = 'inactive' then
      raise exception 'Inactive file' using errcode = 'P0001';
    end if;
  exception
    when raise_exception then
      return '{"status": "link_invalid"}'::jsonb;
  end;

  if v_row.profile_id is not null then
    return '{"status": "link_used"}'::jsonb;
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id and pg_catalog.lower(u.email) = v_row.email) then
    raise exception 'Le compte ne correspond pas à l''invitation' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('app.audit_source', 'rpc:link_professional_account', true);
  perform pg_catalog.set_config('app.audit_actor', p_user_id::text, true);
  -- profiles.email is copied from auth.users by profiles_email_from_auth.
  insert into public.profiles (user_id, org_id, display_name, email, status)
  values (p_user_id, v_org, pg_catalog.rtrim(pg_catalog.left(v_row.first_name || ' ' || v_row.last_name, 80)), v_row.email, 'active');
  insert into public.user_roles (user_id, org_id, role) values (p_user_id, v_org, 'provider');
  update public.professionals p set profile_id = p_user_id where p.id = v_pid and p.org_id = v_org;
  -- The orphan marker has done its job (as accept_staff_invitation).
  begin
    update auth.users u set raw_app_meta_data = u.raw_app_meta_data - 'invite_link_id'
     where u.id = p_user_id and u.raw_app_meta_data ? 'invite_link_id';
  exception
    when insufficient_privilege then
      null;
  end;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);

  return pg_catalog.jsonb_build_object('status', 'accepted', 'org_id', v_org, 'redirect', '/mon-profil/questionnaire');
end;
$$;

-- -----------------------------------------------------------------------------
-- Provider RPCs (professionals.self, own record only)
-- -----------------------------------------------------------------------------
-- The caller's professional id, or 42501 / P0001.
create function private.my_professional_id()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_permission('professionals.self') then
    raise exception 'Permission refusée : professionals.self' using errcode = '42501';
  end if;
  v_id := private.current_professional_id();
  if v_id is null then
    raise exception 'Aucun dossier de professionnel n''est lié à votre compte.' using errcode = 'P0001';
  end if;
  return v_id;
end;
$$;

-- The caller's open submission, locked, which must be a draft (call with the professional locked).
create function private.lock_my_draft(p_org uuid, p_id uuid)
returns public.professional_submissions
language plpgsql
set search_path = ''
as $$
declare
  v_sub public.professional_submissions;
begin
  select * into v_sub from public.professional_submissions s
   where s.professional_id = p_id and s.org_id = p_org and s.status in ('draft', 'submitted')
     for update;
  if not found then
    raise exception 'Aucun questionnaire à compléter.' using errcode = 'P0001', hint = 'submission';
  end if;
  if v_sub.status = 'submitted' then
    raise exception 'Votre profil a déjà été envoyé.' using errcode = 'P0001', hint = 'submitted';
  end if;
  return v_sub;
end;
$$;

revoke all on function private.my_professional_id(), private.lock_my_draft(uuid, uuid)
  from public, anon, authenticated, service_role;

-- The open submission (null when none: « Rien à compléter »): requested sections, prefill, answers,
-- the private step as masks, the consent text to sign, collect_sin and the name to type.
create function public.get_my_submission()
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
             'collect_sin', coalesce((private.professionals_setting(v_org, 'collect_sin'))::boolean, false),
             'professional', pg_catalog.jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name, 'email', p.email))
      from public.professional_submissions s
      join public.professionals p on p.id = s.professional_id and p.org_id = s.org_id
     where s.professional_id = v_pid and s.org_id = v_org and s.status in ('draft', 'submitted'));
end;
$$;

-- Saves one section of the draft (autosave): the values are normalised and checked as the staff
-- forms and RPCs would (sets through a rolled-back run of the staff write paths, P4-174), then
-- merged into the section: only the keys given are stored, the others keep what the section holds
-- (P4-176: a key never sent is a field not answered). A file must be the provider's own upload for
-- this submission (P4-306). Returns the submission's updated_at.
create function public.save_my_submission_draft(p_section text, p_values jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pid uuid;
  v_sub public.professional_submissions;
  v_values jsonb;
  v_all jsonb;
  v_file uuid;
  v_updated timestamptz;
begin
  v_pid := private.my_professional_id();
  if p_section is null or not (p_section = any (private.submission_sections())) then
    raise exception 'Section inconnue.' using errcode = '22023';
  end if;
  v_values := private.normalize_submission_section(p_section, p_values);

  perform private.lock_active_professional(v_pid, true);
  v_sub := private.lock_my_draft(v_org, v_pid);
  if not (p_section = any (v_sub.requested_sections)) then
    raise exception 'Cette section n''est pas demandée.' using errcode = '22023';
  end if;
  v_file := (v_values ->> 'file_id')::uuid;
  if v_file is not null and p_section = 'photo' then
    perform private.assert_submission_file(v_org, auth.uid(), v_sub.id, v_file, array['image/jpeg', 'image/png'], 5242880,
      'photo', 'La photo doit être une image JPEG ou PNG de 5 Mo au plus.');
  elsif v_file is not null and p_section = 'insurance' then
    perform private.assert_submission_file(v_org, auth.uid(), v_sub.id, v_file, array['application/pdf', 'image/jpeg', 'image/png'],
      10485760, 'insurance', 'La preuve d''assurance doit être un fichier PDF, JPEG ou PNG de 10 Mo au plus.');
  end if;
  v_all := v_sub.submitted_values
           || pg_catalog.jsonb_build_object(p_section, coalesce(v_sub.submitted_values -> p_section, '{}'::jsonb) || v_values);
  if p_section in ('professional', 'languages', 'clienteles', 'motifs') then
    perform private.dry_run_submission_sets(v_org, v_pid, v_all,
      case when p_section in ('professional', 'motifs') then array['professional', 'motifs'] else array[p_section] end);
  end if;

  update public.professional_submissions s set submitted_values = v_all
   where s.id = v_sub.id and s.org_id = v_org
  returning s.updated_at into v_updated;
  return v_updated;
end;
$$;

-- The private step (P4-38): encrypted at once, never in submitted_values. Plain numbers as given
-- (blank clears), the SIN and the account kept when blank. Same tidying and messages as the staff
-- cards (4a.17), with the field as HINT; a SIN only while collect_sin is on (P4-272). One key
-- version per row (conventions §8).
create function public.save_my_submission_private(
  p_sin text,
  p_business_number text,
  p_gst_number text,
  p_qst_number text,
  p_bank_institution text,
  p_bank_transit text,
  p_bank_account text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_strip constant text := '[ \t\r\n-]';
  v_sin text := nullif(pg_catalog.regexp_replace(coalesce(p_sin, ''), v_strip, '', 'g'), '');
  v_bn text := nullif(pg_catalog.regexp_replace(coalesce(p_business_number, ''), v_strip, '', 'g'), '');
  v_gst text := nullif(pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_gst_number, ''), v_strip, '', 'g')), '');
  v_qst text := nullif(pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_qst_number, ''), v_strip, '', 'g')), '');
  v_institution text := nullif(pg_catalog.regexp_replace(coalesce(p_bank_institution, ''), v_strip, '', 'g'), '');
  v_transit text := nullif(pg_catalog.regexp_replace(coalesce(p_bank_transit, ''), v_strip, '', 'g'), '');
  v_account text := nullif(pg_catalog.regexp_replace(coalesce(p_bank_account, ''), v_strip, '', 'g'), '');
  v_pid uuid;
  v_sub public.professional_submissions;
  v_version integer;
  v_bad text;
begin
  v_pid := private.my_professional_id();
  -- Validation first: the table's checks are a backstop only (their error would print the row).
  if v_bn is not null and v_bn !~ '^[0-9]{9}$' then
    raise exception 'Le numéro d''entreprise (NE) compte 9 chiffres.' using errcode = 'P0001', hint = 'business_number';
  end if;
  if v_gst is not null and v_gst !~ '^[0-9]{9}RT[0-9]{4}$' then
    raise exception 'Numéro de TPS : format attendu 123456789 RT 0001.' using errcode = 'P0001', hint = 'gst_number';
  end if;
  if v_qst is not null and v_qst !~ '^[0-9]{10}TQ[0-9]{4}$' then
    raise exception 'Numéro de TVQ : format attendu 1234567890 TQ 0001.' using errcode = 'P0001', hint = 'qst_number';
  end if;
  if v_institution is not null and v_institution !~ '^[0-9]{3}$' then
    raise exception 'Le numéro d''institution compte 3 chiffres.' using errcode = 'P0001', hint = 'bank_institution';
  end if;
  if v_transit is not null and v_transit !~ '^[0-9]{5}$' then
    raise exception 'Le numéro de transit compte 5 chiffres.' using errcode = 'P0001', hint = 'bank_transit';
  end if;
  if v_account is not null and v_account !~ '^[0-9]{7,12}$' then
    raise exception 'Le numéro de compte compte de 7 à 12 chiffres.' using errcode = 'P0001', hint = 'bank_account';
  end if;
  if v_sin is not null then
    if not coalesce((private.professionals_setting(v_org, 'collect_sin'))::boolean, false) then
      raise exception 'La collecte du NAS n''est pas activée.' using errcode = 'P0001', hint = 'sin';
    end if;
    if not private.is_valid_sin(v_sin) then
      raise exception 'NAS invalide.' using errcode = 'P0001', hint = 'sin';
    end if;
  end if;

  perform private.lock_active_professional(v_pid, true);
  v_sub := private.lock_my_draft(v_org, v_pid);
  if not ('tax_bank' = any (v_sub.requested_sections)) then
    raise exception 'Cette section n''est pas demandée.' using errcode = '22023';
  end if;
  v_version := private.pii_current_key_version();

  begin
    insert into public.professional_submission_private as sp
      (submission_id, org_id, professional_id, business_number, gst_number, qst_number, bank_institution, bank_transit,
       bank_account, bank_account_last4, sin, sin_last3, key_version)
    values (v_sub.id, v_org, v_pid, v_bn, v_gst, v_qst, v_institution, v_transit,
            private.encrypt_pii(v_account, v_version), pg_catalog.right(v_account, 4),
            private.encrypt_pii(v_sin, v_version), pg_catalog.right(v_sin, 3), v_version)
    on conflict (submission_id) do update
      set business_number = excluded.business_number,
          gst_number = excluded.gst_number,
          qst_number = excluded.qst_number,
          bank_institution = excluded.bank_institution,
          bank_transit = excluded.bank_transit,
          bank_account = case when v_account is not null then excluded.bank_account
                              when sp.key_version = v_version then sp.bank_account
                              else private.encrypt_pii(private.decrypt_pii(sp.bank_account, sp.key_version), v_version) end,
          bank_account_last4 = coalesce(excluded.bank_account_last4, sp.bank_account_last4),
          sin = case when v_sin is not null then excluded.sin
                     when sp.key_version = v_version then sp.sin
                     else private.encrypt_pii(private.decrypt_pii(sp.sin, sp.key_version), v_version) end,
          sin_last3 = coalesce(excluded.sin_last3, sp.sin_last3),
          key_version = excluded.key_version
      where sp.org_id = v_org;
  exception
    -- 39000: pgcrypto (wrong key or corrupt data); 55000: decrypt_pii (the row's key is missing).
    when sqlstate '39000' or sqlstate '55000' then
      v_bad := private.unreadable_submission_field(v_sub.id, v_org, v_sin is null, v_account is null);
      if v_bad is null then
        perform private.raise_unreadable_private_value(null);   -- the write key itself: 55000
      end if;
      raise exception '% enregistré précédemment ne peut pas être lu avec la clé de cet environnement.',
        case v_bad when 'sin' then 'Le NAS' else 'Le numéro de compte' end
        using errcode = 'P0001', hint = 'Saisissez-le de nouveau au complet : il remplacera celui qui est enregistré.';
  end;

  update public.professional_submissions s set private_saved_at = pg_catalog.now()
   where s.id = v_sub.id and s.org_id = v_org;
end;
$$;

-- Which kept ciphertext of a submission's private row does not decrypt: 'sin', 'bank_account' or
-- null. Called only after a write failed with 39000 / 55000, to name the field.
create function private.unreadable_submission_field(p_submission_id uuid, p_org uuid, p_check_sin boolean, p_check_account boolean)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_row public.professional_submission_private;
begin
  select * into v_row from public.professional_submission_private sp
   where sp.submission_id = p_submission_id and sp.org_id = p_org;
  if p_check_sin and v_row.sin is not null then
    begin
      perform private.decrypt_pii(v_row.sin, v_row.key_version);
    exception when sqlstate '39000' or sqlstate '55000' then
      return 'sin';
    end;
  end if;
  if p_check_account and v_row.bank_account is not null then
    begin
      perform private.decrypt_pii(v_row.bank_account, v_row.key_version);
    exception when sqlstate '39000' or sqlstate '55000' then
      return 'bank_account';
    end;
  end if;
  return null;
end;
$$;
revoke all on function private.unreadable_submission_field(uuid, uuid, boolean, boolean)
  from public, anon, authenticated, service_role;

-- Signs the latest published consent (P4-273): the typed name must be the file's « Prénom Nom »,
-- accents, case and spaces aside. Stored in the draft with the server's time; professional_consents
-- receives it on approval.
create function public.sign_my_consent(p_version_id uuid, p_signer_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_name text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_signer_name, ''), E' \t\r\n'), '\s+', ' ', 'g');
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
           'consent_version_id', p_version_id, 'signer_name', v_name, 'signed_at', pg_catalog.now()))
   where s.id = v_sub.id and s.org_id = v_org;
end;
$$;

-- « Envoyer mon profil »: every requested section complete (P4-173) and the sets still accepted by
-- the staff paths; onboarding moves a draft or invited file to in_review; the reviewers get a notice
-- (the email is the professionals-submit function's, 4b.2).
create function public.submit_my_submission()
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
     set status = 'submitted', submitted_at = v_now, decision_note = null
   where s.id = v_sub.id and s.org_id = v_org;
  select * into v_row from public.professionals p where p.id = v_pid and p.org_id = v_org;
  if v_sub.kind = 'onboarding' and v_row.status in ('draft', 'invited') then
    update public.professionals p
       set status = 'in_review', status_changed_at = v_now, status_changed_by = auth.uid()
     where p.id = v_pid and p.org_id = v_org;
  end if;

  -- One notice per sending (a resubmission after a refusal notifies again, P4-271): the key holds the
  -- clock time, not the transaction's, so two sendings never share it.
  perform private.notify(
    v_org, 'professionals', 'professionals.submission_received', 'normal',
    case v_sub.kind when 'onboarding' then 'Profil à réviser' else 'Mise à jour à réviser' end,
    v_row.first_name || ' ' || v_row.last_name
      || case v_sub.kind when 'onboarding' then ' a envoyé son profil.' else ' a envoyé une mise à jour de son profil.' end,
    '/professionnels/' || v_pid || '/documents', 'professional', v_pid, 'professionals.review', null,
    'submission:' || v_sub.id || ':' || pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSUS'), null);
end;
$$;

-- « Mon profil »: the caller's private data, masked (never a reveal).
create function public.get_my_professional_private()
returns table (
  sin_last3 text,
  business_number text,
  gst_number text,
  qst_number text,
  bank_institution text,
  bank_transit text,
  bank_account_last4 text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_pid uuid;
begin
  v_pid := private.my_professional_id();
  return query
    select pp.sin_last3, pp.business_number, pp.gst_number, pp.qst_number, pp.bank_institution,
           pp.bank_transit, pp.bank_account_last4, pp.updated_at
      from (select 1) one
      left join public.professional_private pp on pp.professional_id = v_pid and pp.org_id = v_org;
end;
$$;

-- « Proposer une modification »: an update submission for the sections the provider chose.
create function public.start_my_profile_update(p_sections text[])
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
    raise exception 'Une soumission est déjà en cours.' using errcode = 'P0001', hint = 'submission';
  end if;
  return private.create_professional_submission(v_org, v_pid, 'update', v_sections, null);
end;
$$;

-- -----------------------------------------------------------------------------
-- Review (professionals.review)
-- -----------------------------------------------------------------------------
-- The fields a submission can apply, in registry order: a plain or set field whose key was saved
-- (P4-176: a key never sent is no answer; a null answer for province, women_only or
-- accepting_new_clients is none either: their columns are never null), a file with a file id, a signed consent, a private
-- value entered (the SIN only while collect_sin is on, P4-272).
create function private.submission_available_fields(p_sub public.professional_submissions)
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
           when 'consent' then p_sub.submitted_values ? 'consent'
           when 'private' then coalesce((select (sp.j -> f.field) <> 'null'::jsonb from sp), false)
                               and (f.field <> 'sin'
                                    or coalesce((private.professionals_setting(p_sub.org_id, 'collect_sin'))::boolean, false))
         end
$$;
revoke all on function private.submission_available_fields(public.professional_submissions)
  from public, anon, authenticated, service_role;

-- Per requested section, per field: {field, label_key, kind, answered, current, submitted, changed};
-- private fields only {field, label_key, kind, answered, changed} (never a value, P4-175). answered:
-- the field can be applied (its key was saved, P4-176); an unanswered field is never applied. Ids as the record gives
-- them (labels from the cached catalogue). Null for another clinic's or an unknown submission.
create function public.get_submission_review(p_submission_id uuid)
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
    consent_now as (
      select pg_catalog.jsonb_build_object('consent_version_id', c.consent_version_id, 'version', cv.version,
                                           'signed_at', c.signed_at, 'expires_on', c.expires_on) as j
        from public.professional_consents c
        join public.consent_versions cv on cv.org_id = c.org_id and cv.id = c.consent_version_id
       where c.professional_id = v_sub.professional_id and c.org_id = v_org and c.withdrawn_at is null
       order by c.signed_at desc
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
               when 'consent' then v_sub.submitted_values -> 'consent'
                                   || pg_catalog.jsonb_build_object('version', (
                                        select cv.version from public.consent_versions cv
                                         where cv.org_id = v_org and cv.id = (v_sub.submitted_values #>> '{consent,consent_version_id}')::uuid))
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

-- Moves the chosen private values of a submission to professional_private (P4-176): a value entered
-- replaces the stored one, nothing else changes; the whole row ends on the write version (bytes
-- copied when already on it, re-encrypted inside the database otherwise); the SIN only while
-- collect_sin is on (P4-272). A value that does not decrypt raises a clean P0001.
create function private.apply_submission_private(p_org uuid, p_pid uuid, p_submission_id uuid, p_fields text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  s public.professional_submission_private;
  v_version integer := private.pii_current_key_version();
  v_bn boolean := 'business_number' = any (p_fields);
  v_gst boolean := 'gst_number' = any (p_fields);
  v_qst boolean := 'qst_number' = any (p_fields);
  v_inst boolean := 'bank_institution' = any (p_fields);
  v_transit boolean := 'bank_transit' = any (p_fields);
  v_account boolean := 'bank_account' = any (p_fields);
  v_sin boolean := 'sin' = any (p_fields);
  v_new_account bytea;
  v_new_sin bytea;
begin
  select * into s from public.professional_submission_private sp where sp.submission_id = p_submission_id and sp.org_id = p_org;
  if not found or not (v_bn or v_gst or v_qst or v_inst or v_transit or v_account or v_sin) then
    return;
  end if;
  v_account := v_account and s.bank_account is not null;
  v_sin := v_sin and s.sin is not null;
  if v_sin and not coalesce((private.professionals_setting(p_org, 'collect_sin'))::boolean, false) then
    raise exception 'La collecte du NAS n''est pas activée.' using errcode = 'P0001', hint = 'sin';
  end if;

  -- The submission's own ciphertexts, on the write version.
  begin
    v_new_account := case when not v_account then null
                          when s.key_version = v_version then s.bank_account
                          else private.encrypt_pii(private.decrypt_pii(s.bank_account, s.key_version), v_version) end;
    v_new_sin := case when not v_sin then null
                      when s.key_version = v_version then s.sin
                      else private.encrypt_pii(private.decrypt_pii(s.sin, s.key_version), v_version) end;
  exception when sqlstate '39000' or sqlstate '55000' then
    raise exception 'Les renseignements transmis ne peuvent pas être lus avec la clé de cet environnement.'
      using errcode = 'P0001', hint = 'Refusez la soumission : le professionnel saisira ces renseignements de nouveau.';
  end;

  begin
    insert into public.professional_private as pp
      (professional_id, org_id, business_number, gst_number, qst_number, bank_institution, bank_transit,
       bank_account, bank_account_last4, sin, sin_last3, key_version, updated_by)
    values (p_pid, p_org,
            case when v_bn then s.business_number end, case when v_gst then s.gst_number end,
            case when v_qst then s.qst_number end, case when v_inst then s.bank_institution end,
            case when v_transit then s.bank_transit end,
            v_new_account, case when v_account then s.bank_account_last4 end,
            v_new_sin, case when v_sin then s.sin_last3 end,
            v_version, auth.uid())
    on conflict (professional_id) do update
      set business_number = case when v_bn and s.business_number is not null then s.business_number else pp.business_number end,
          gst_number = case when v_gst and s.gst_number is not null then s.gst_number else pp.gst_number end,
          qst_number = case when v_qst and s.qst_number is not null then s.qst_number else pp.qst_number end,
          bank_institution = case when v_inst and s.bank_institution is not null then s.bank_institution else pp.bank_institution end,
          bank_transit = case when v_transit and s.bank_transit is not null then s.bank_transit else pp.bank_transit end,
          bank_account = case when v_account then v_new_account
                              when pp.key_version = v_version then pp.bank_account
                              else private.encrypt_pii(private.decrypt_pii(pp.bank_account, pp.key_version), v_version) end,
          bank_account_last4 = case when v_account then s.bank_account_last4 else pp.bank_account_last4 end,
          sin = case when v_sin then v_new_sin
                     when pp.key_version = v_version then pp.sin
                     else private.encrypt_pii(private.decrypt_pii(pp.sin, pp.key_version), v_version) end,
          sin_last3 = case when v_sin then s.sin_last3 else pp.sin_last3 end,
          key_version = v_version,
          updated_by = auth.uid()
      where pp.org_id = p_org;
  exception
    when sqlstate '39000' or sqlstate '55000' then
      perform private.raise_unreadable_private_value(private.unreadable_private_field(p_pid, p_org, not v_sin, not v_account));
  end;
end;
$$;
revoke all on function private.apply_submission_private(uuid, uuid, uuid, text[])
  from public, anon, authenticated, service_role;

-- « Appliquer la sélection »: every available field (p_fields null) or the chosen ones, in one
-- transaction through the staff write paths (P4-174, P4-176): a refusal of any field rolls back the
-- whole call; a field never answered is never applied (its column keeps its value). Professions and
-- motifs skip the restricted-motif rule, checked once on the result. The staged photo and insurance
-- are attached to the professional (4c creates their documents); the consent becomes a
-- professional_consents row. Then approved, with the fields applied; the submission's private row
-- is deleted. An empty selection approves without changing the record. Refused: an inactive file
-- (P4-303), the reviewer's own file (P4-304), a consent signed on a version that is no longer the
-- latest published one and an insurance that has expired since it was sent (P4-305), the SIN while
-- collect_sin is off (P4-272).
create function public.apply_professional_submission(p_submission_id uuid, p_fields text[] default null)
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
  v_tz text;
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
  if 'consent' = any (v_fields)
     and (v_values #>> '{consent,consent_version_id}')::uuid is distinct from private.current_consent_version(v_org, 'image_rights') then
    raise exception 'Le texte du consentement a changé depuis la signature.'
      using errcode = 'P0001', hint = 'Refusez la soumission : le professionnel signera la nouvelle version.';
  end if;
  if 'insurance' = any (v_fields) and (v_values #>> '{insurance,expires_on}')::date < private.clinic_today() then
    raise exception 'Cette assurance est échue depuis l''envoi du profil.'
      using errcode = 'P0001', hint = 'Refusez la soumission : le professionnel joindra une preuve en vigueur.';
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

  -- The consent: valid 12 months from the clinic date of the signature.
  if 'consent' = any (v_fields) then
    select o.timezone into v_tz from public.organizations o where o.id = v_org;
    insert into public.professional_consents (org_id, professional_id, consent_version_id, signer_name, signed_at, expires_on, submission_id)
    values (v_org, v_pid, (v_values #>> '{consent,consent_version_id}')::uuid, v_values #>> '{consent,signer_name}',
            (v_values #>> '{consent,signed_at}')::timestamptz,
            (((v_values #>> '{consent,signed_at}')::timestamptz at time zone v_tz)::date + interval '12 months')::date,
            v_sub.id);
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

-- « Refuser »: the submission goes back to the provider as a draft with the note (P4-170); a
-- refused onboarding puts an in_review file back to invited (completing its questionnaire). Not
-- for the reviewer's own file (P4-304).
create function public.reject_professional_submission(p_submission_id uuid, p_note text)
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
    raise exception 'La note compte au plus 1000 caractères.' using errcode = 'P0001', hint = 'note';
  end if;

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

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
-- Service role only: the actor RPC and the purpose handlers (020 checks the handlers' contract).
revoke all on function
  public.create_professional_invitation(uuid, uuid, bytea),
  public.resolve_professional_invitation(uuid),
  public.link_professional_account(bytea, uuid, jsonb)
from public, anon, authenticated;
grant execute on function
  public.create_professional_invitation(uuid, uuid, bytea),
  public.resolve_professional_invitation(uuid),
  public.link_professional_account(bytea, uuid, jsonb)
to service_role;

-- Authenticated only: they act for the calling user (service_role revoked from Supabase's defaults).
revoke all on function
  public.revoke_professional_invitation(uuid),
  public.request_professional_update(uuid, text[]),
  public.list_professional_invitation_states(),
  public.get_professional_onboarding(uuid),
  public.get_my_submission(),
  public.save_my_submission_draft(text, jsonb),
  public.save_my_submission_private(text, text, text, text, text, text, text),
  public.sign_my_consent(uuid, text),
  public.submit_my_submission(),
  public.get_my_professional_private(),
  public.start_my_profile_update(text[]),
  public.get_submission_review(uuid),
  public.apply_professional_submission(uuid, text[]),
  public.reject_professional_submission(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function
  public.revoke_professional_invitation(uuid),
  public.request_professional_update(uuid, text[]),
  public.list_professional_invitation_states(),
  public.get_professional_onboarding(uuid),
  public.get_my_submission(),
  public.save_my_submission_draft(text, jsonb),
  public.save_my_submission_private(text, text, text, text, text, text, text),
  public.sign_my_consent(uuid, text),
  public.submit_my_submission(),
  public.get_my_professional_private(),
  public.start_my_profile_update(text[]),
  public.get_submission_review(uuid),
  public.apply_professional_submission(uuid, text[]),
  public.reject_professional_submission(uuid, text)
to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
