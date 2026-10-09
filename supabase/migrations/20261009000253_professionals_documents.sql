-- =============================================================================
-- Professionnels: documents (types, uploads, review, expiry rules), readiness with documents,
-- the approval hook for the questionnaire's photo and insurance, notification kinds
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Tasks 4c.1 and 4c.2 (P4-1, P4-2,
--          P4-29, P4-36, P4-49, P4-50, P4-177, P4-271, P4-306; decisions P4-400 … P4-412)
-- Needs:   Phase 3 storage (upload_purposes, stored_files, attach_stored_file,
--          soft_delete_stored_file), notifications (private.notify), email templates;
--          *_professionals_onboarding.sql (submissions, consents, the staged photo and insurance)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * document_types is a per-clinic reference list (the 4a.1 pattern: key, name, is_system,
--   sort_order, is_active, composite FK target), edited in « Documents requis » through
--   save_document_type and the generic archive / reorder RPCs (replaced here with a
--   document_types branch). Seeded per clinic: photo, insurance and image_consent (is_system:
--   readiness and the job name them, they are never archived), cv, diploma, licence_attestation,
--   other. Never the word `license` (inconsistency 12: legacy `license` was the image consent).
--   A type says whether it is required, its expiry rule (`none`, `next_march_31`, `months_12`),
--   the accepted types and size (within the upload purposes' caps). Reminders (`reminder_days`,
--   `weekly_after_expiry`) exist for the insurance only: its notices and emails are the only ones
--   built (P4-402).
-- * Two upload purposes (bucket documents, 10 MB, staged 1 day: attach_professional_document
--   follows the upload at once): professional_document (staff, professionals.manage) and
--   professional_self_document (the provider, professionals.self, owner branch). Both are read
--   with professionals.view; once attached, the file's owner is the professional's account
--   (owner_permission professionals.self), so the provider reads every document of their own
--   record (P4-49). No storage policy.
-- * professional_documents: PK (professional_id, id) + unique (id) (P4-36), one row per file
--   (stored_file_id unique), status pending → verified | rejected, verified → expired (the job, or
--   a corrected date), expires_on = last valid day, a date (P4-2). Files are listed through these
--   rows, never through stored_files.subject_id (P4-49).
-- * Who: staff with professionals.manage attach (verified at once when they also hold
--   professionals.documents.review, P4-401), the provider attaches to their own record
--   (pending, a notice to the reviewers). professionals.documents.review verifies, rejects and
--   corrects a date; professionals.documents.delete deletes (soft-deletes the file). Nobody
--   verifies a document of their own record (as P4-304). Inactive files keep « Mes documents »
--   (P4-11): the provider may upload while inactive.
-- * A rejected document's file is soft-deleted at once (Loi 25: a wrong file, possibly someone
--   else's data, is not kept; core storage-cleanup purges it 30 days later). The row keeps the
--   reason for the provider (P4-404).
-- * The approval hook (P4-400): 4b.1's apply attaches the staged photo and insurance to the
--   professional; an AFTER UPDATE OF status trigger on professional_submissions creates their
--   professional_documents rows (verified: the reviewer approved them in the review sheet,
--   P4-401) when a submission becomes approved, and expires the « Profil à réviser » notice
--   whenever a submission leaves `submitted` (approved, sent back, cancelled: P4-271's pending
--   expiry). The onboarding migration is not edited: the 4b.5 lane edits apply_professional_
--   submission's messages in place, and a trigger keeps the two changes apart.
-- * Notifications (4c.1, P4-30): every module notice is created in SQL with private.notify, next
--   to the change it reports, so the French texts live in one place (P4-403): document_to_review
--   here, insurance_expiring / insurance_expired / documents_missing in the job's RPC
--   (*_professionals_insurance_expiry_job.sql). private.expire_notifications (core helper,
--   reviewed as such) closes a notice when its work is done: a verified, rejected or deleted
--   document, a settled insurance, a reviewed submission. Dates in bodies are date-only values
--   (private.format_date_fr, « 31 mars 2027 », the rule of _shared/format.ts formatDateOnly).
-- * Readiness (Q21's compliance list): `documents` — every required active type satisfied: a
--   verified document, unexpired for a type with a rule (expires_on >= the clinic's today), and
--   for image_consent a verified document or a signed e-consent still in force (not withdrawn,
--   not past expires_on). `missing` holds fixed keys (photo, insurance, insurance_expired,
--   image_consent, other_documents), never a clinic's type key (P4-405). `ready` requires it.
--   Directory insurance_status: valid / expiring (within the insurance's largest reminder) /
--   expired / missing (P4-406). The list gains documents_done, documents_required,
--   insurance_status, insurance_expires_on. The clinic's today is computed per row from
--   organizations.timezone, so the views answer the same for staff, providers and jobs.
-- * Retention (Loi 25): documents are the clinic's proof of coverage and consent for the period
--   of services; nothing purges them automatically in 4c (P4-411). Staged uploads never attached
--   are purged after a day (retain_days 1), rejected files after 30 days, deleted ones likewise.
-- * Locks: the professional, then the document (every writer here), then the file
--   (attach_stored_file / soft_delete_stored_file), as module RPCs attach files (core doc).
-- * Audit: document_types and professional_documents are audited (no redaction: no personal data
--   beyond the professional's own document metadata; the file name stays in stored_files, whose
--   audit redacts it). The history lists professional_documents.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_documents', true);

-- -----------------------------------------------------------------------------
-- Permissions (template rows; the Task 2.20 trigger copies them to every clinic)
-- -----------------------------------------------------------------------------
insert into public.permissions (key, module_key, description) values
  ('professionals.documents.review', 'professionals', 'Vérifier et refuser les documents des professionnels'),
  ('professionals.documents.delete', 'professionals', 'Supprimer les documents des professionnels')
on conflict do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin', 'professionals.documents.review'), ('admin', 'professionals.documents.delete'),
  ('admin_assistant', 'professionals.documents.review')
on conflict do nothing;

-- Same signature as *_professionals_onboarding.sql: the two document keys read the lists too.
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
    'professionals.invite', 'professionals.review', 'professionals.documents.review', 'professionals.documents.delete'
  ]::text[]
$$;

-- -----------------------------------------------------------------------------
-- Core helpers (Phase 3 notifications and the clinic date; reviewed as core changes)
-- -----------------------------------------------------------------------------
-- A clinic's local date, for service-role callers (jobs) that have no current user.
create function private.clinic_today_for_org(p_org uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (pg_catalog.now() at time zone o.timezone)::date from public.organizations o where o.id = p_org
$$;
revoke all on function private.clinic_today_for_org(uuid) from public, anon, authenticated, service_role;

-- Closes the open notices of a record: kinds p_kinds, subject (p_subject_type, p_subject_id) of
-- p_org, except those whose dedupe key is in p_keep_dedupe_keys (the notice that is still true).
-- An expired notice leaves every bell at once (the policy and the RPCs read expires_at) and is
-- purged 30 days later (core.notifications_purge). Returns how many it closed. Module RPCs call it
-- after their permission check (security invoker, granted to no role, like private.notify).
create function private.expire_notifications(
  p_org uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_kinds text[],
  p_keep_dedupe_keys text[] default '{}'
)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.notifications n
     set expires_at = pg_catalog.now()
   where n.org_id = p_org
     and n.subject_type = p_subject_type
     and n.subject_id = p_subject_id
     and n.kind = any (p_kinds)
     and (n.expires_at is null or n.expires_at > pg_catalog.now())
     and (n.dedupe_key is null or not (n.dedupe_key = any (coalesce(p_keep_dedupe_keys, '{}'::text[]))));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.expire_notifications(uuid, text, uuid, text[], text[]) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Dates (date-only values: no time zone, P4-2)
-- -----------------------------------------------------------------------------
-- The coming March 31: this year's when today is on or before it, else next year's (legacy rule,
-- _legacy getNextMarch31: insurance policies run to March 31).
create function private.next_march_31(p_today date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case when p_today <= pg_catalog.make_date(extract(year from p_today)::int, 3, 31)
              then pg_catalog.make_date(extract(year from p_today)::int, 3, 31)
              else pg_catalog.make_date(extract(year from p_today)::int + 1, 3, 31) end
$$;

-- The default last valid day of a document uploaded on p_today under p_rule; null for `none`.
-- months_12 follows the e-consent's rule (P4-273: the date + 12 months).
create function private.document_default_expiry(p_rule text, p_today date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_rule
           when 'next_march_31' then private.next_march_31(p_today)
           when 'months_12' then (p_today + interval '12 months')::date
         end
$$;

-- « 31 mars 2027 »: a date-only value in French, as _shared/format.ts formatDateOnly writes it.
create function private.format_date_fr(p_date date)
returns text
language sql
immutable
set search_path = ''
as $$
  select extract(day from p_date)::int::text || ' '
      || (array['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre',
                'octobre', 'novembre', 'décembre'])[extract(month from p_date)::int]
      || ' ' || extract(year from p_date)::int::text
$$;

revoke all on function
  private.next_march_31(date),
  private.document_default_expiry(text, date),
  private.format_date_fr(date)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- document_types: « Documents requis » (per clinic, the 4a.1 reference pattern)
-- -----------------------------------------------------------------------------
create table public.document_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  is_system boolean not null default false,
  -- Counts in readiness (« Documents requis »).
  required boolean not null default false,
  -- The default last valid day of an upload: none, the next March 31, or the date + 12 months.
  expiry_rule text not null default 'none',
  -- Days before the last valid day when the professional and staff are told (insurance only).
  reminder_days int[] not null default '{}',
  -- A reminder every week after the expiry until a valid one is verified (insurance only, P4-1).
  weekly_after_expiry boolean not null default false,
  -- Within the upload purposes' types and caps (checked again at attach).
  accepted_mime text[] not null,
  max_bytes int not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_types_key_check check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint document_types_name_check check (char_length(name) between 1 and 120 and private.is_tidy_text(name)),
  constraint document_types_expiry_rule_check check (expiry_rule in ('none', 'next_march_31', 'months_12')),
  constraint document_types_reminder_days_check check (
    pg_catalog.cardinality(reminder_days) <= 3 and pg_catalog.array_position(reminder_days, null) is null
    and 1 <= all (reminder_days) and 90 >= all (reminder_days)),
  -- Reminders need an expiry, and only the insurance has notices and emails (P4-402).
  constraint document_types_reminders_check check (
    (reminder_days = '{}' and not weekly_after_expiry) or (key = 'insurance' and expiry_rule <> 'none')),
  constraint document_types_accepted_mime_check check (
    pg_catalog.cardinality(accepted_mime) between 1 and 6
    and accepted_mime <@ array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword',
                               'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  -- The photo is printed on the fiche (react-pdf embeds PNG and JPEG only).
  constraint document_types_photo_mime_check check (key <> 'photo' or accepted_mime <@ array['image/jpeg', 'image/png']),
  constraint document_types_max_bytes_check check (max_bytes between 102400 and 10485760),
  constraint document_types_org_id_key_key unique (org_id, key),
  constraint document_types_org_id_id_key unique (org_id, id)
);
create unique index document_types_org_name_key on public.document_types (org_id, lower(normalize(name, NFKC)));
create index document_types_org_sort_idx on public.document_types (org_id, sort_order);

revoke all on public.document_types from anon, authenticated;
grant select on public.document_types to authenticated;
alter table public.document_types enable row level security;
create policy document_types_select on public.document_types
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.can_read_professionals_reference()));

create trigger document_types_freeze_identity before update on public.document_types
  for each row execute function private.freeze_reference_identity();
create trigger document_types_set_updated_at before update on public.document_types
  for each row execute function private.set_updated_at();
create trigger document_types_audit after insert or update or delete on public.document_types
  for each row execute function private.audit_trigger();

-- The seed (P4-2, the plan's list). Idempotent: a clinic's edits are never undone.
create function private.seed_professionals_document_types(p_org uuid)
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
    (p_org, 'image_consent', 'Consentement droit à l''image', true, true, 'months_12', '{}', false,
     array['application/pdf', 'image/jpeg', 'image/png'], 10485760, 30),
    (p_org, 'cv', 'CV', false, false, 'none', '{}', false, v_any, 10485760, 40),
    (p_org, 'diploma', 'Diplôme', false, false, 'none', '{}', false, v_any, 10485760, 50),
    (p_org, 'licence_attestation', 'Attestation de permis', false, false, 'none', '{}', false, v_any, 10485760, 60),
    (p_org, 'other', 'Autre', false, false, 'none', '{}', false, v_any, 10485760, 70)
  on conflict do nothing;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

create function private.seed_professionals_document_types_on_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_professionals_document_types(new.id);
  return null;
end;
$$;

create trigger organizations_seed_professionals_document_types
  after insert on public.organizations
  for each row execute function private.seed_professionals_document_types_on_org();

revoke all on function private.seed_professionals_document_types(uuid), private.seed_professionals_document_types_on_org()
  from public, anon, authenticated, service_role;

select private.seed_professionals_document_types(o.id) from public.organizations o;

-- -----------------------------------------------------------------------------
-- « Documents requis »: save, archive, reorder, catalogue
-- -----------------------------------------------------------------------------
-- p_id null creates (key from the name, last in the list, not system), otherwise updates the
-- clinic's row. A null argument keeps its value on update (create: not required, no expiry, no
-- reminder, every accepted type, 10 MB). Reminders: 1–90 days, at most 3, insurance only, with an
-- expiry rule; stored distinct, largest first. Returns the id.
create function public.save_document_type(
  p_id uuid,
  p_name text,
  p_required boolean default null,
  p_expiry_rule text default null,
  p_reminder_days int[] default null,
  p_weekly_after_expiry boolean default null,
  p_accepted_mime text[] default null,
  p_max_bytes int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.lock_for_professionals_settings();
  v_name text := private.reference_text(p_name, 'Le nom', 120, true, true);
  v_all constant text[] := array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword',
                                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  v_current public.document_types;
  v_key text;
  v_rule text;
  v_days int[];
  v_weekly boolean;
  v_mime text[];
  v_bytes int;
  v_id uuid;
begin
  if p_id is not null then
    select * into v_current from public.document_types x where x.id = p_id and x.org_id = v_org;
    if not found then
      raise exception 'Type de document introuvable.' using errcode = 'P0001';
    end if;
  end if;
  if p_expiry_rule is not null and p_expiry_rule not in ('none', 'next_march_31', 'months_12') then
    raise exception 'Échéance inconnue : %', p_expiry_rule using errcode = '22023';
  end if;
  if p_accepted_mime is not null and (pg_catalog.cardinality(p_accepted_mime) = 0 or not (p_accepted_mime <@ v_all)) then
    raise exception 'Types de fichiers invalides.' using errcode = '22023';
  end if;
  if p_reminder_days is not null and (pg_catalog.array_position(p_reminder_days, null) is not null) then
    raise exception 'Rappels invalides.' using errcode = '22023';
  end if;

  v_key := coalesce(v_current.key, '');
  v_rule := coalesce(p_expiry_rule, v_current.expiry_rule, 'none');
  v_days := coalesce(array(select distinct x from pg_catalog.unnest(coalesce(p_reminder_days, v_current.reminder_days, '{}')) x
                            order by x desc), '{}');
  v_weekly := coalesce(p_weekly_after_expiry, v_current.weekly_after_expiry, false);
  v_mime := coalesce(array(select distinct m from pg_catalog.unnest(coalesce(p_accepted_mime, v_current.accepted_mime, v_all)) m
                            order by m), v_all);
  v_bytes := coalesce(p_max_bytes, v_current.max_bytes, 10485760);

  if exists (select 1 from pg_catalog.unnest(v_days) x where x < 1 or x > 90) or pg_catalog.cardinality(v_days) > 3 then
    raise exception 'Les rappels vont de 1 à 90 jours avant l''échéance, trois au plus.' using errcode = 'P0001', hint = 'reminder_days';
  end if;
  if (pg_catalog.cardinality(v_days) > 0 or v_weekly) and v_key <> 'insurance' then
    raise exception 'Les rappels ne s''appliquent qu''à la preuve d''assurance.' using errcode = 'P0001', hint = 'reminder_days';
  end if;
  if (pg_catalog.cardinality(v_days) > 0 or v_weekly) and v_rule = 'none' then
    raise exception 'Les rappels demandent une échéance.' using errcode = 'P0001', hint = 'expiry_rule';
  end if;
  if v_key = 'photo' and not (v_mime <@ array['image/jpeg', 'image/png']) then
    raise exception 'La photo doit être une image JPEG ou PNG : elle figure sur la fiche.' using errcode = 'P0001', hint = 'accepted_mime';
  end if;
  if v_bytes not between 102400 and 10485760 then
    raise exception 'La taille maximale va de 100 Ko à 10 Mo.' using errcode = 'P0001', hint = 'max_bytes';
  end if;
  if exists (
    select 1 from public.document_types x
     where x.org_id = v_org and x.id is distinct from p_id
       and pg_catalog.lower(pg_catalog.normalize(x.name, 'NFKC')) = pg_catalog.lower(pg_catalog.normalize(v_name, 'NFKC'))
  ) then
    raise exception 'Un type de document porte déjà ce nom (il est peut-être archivé).' using errcode = 'P0001', hint = 'name';
  end if;

  if p_id is null then
    perform private.assert_reference_room((select count(*) from public.document_types x where x.org_id = v_org));
    insert into public.document_types
      (org_id, key, name, required, expiry_rule, reminder_days, weekly_after_expiry, accepted_mime, max_bytes, sort_order)
    values (v_org,
            private.unique_reference_key(private.reference_key(v_name),
              array(select x.key from public.document_types x where x.org_id = v_org)),
            v_name, coalesce(p_required, false), v_rule, v_days, v_weekly, v_mime, v_bytes,
            coalesce((select max(x.sort_order) from public.document_types x where x.org_id = v_org), 0) + 10)
    returning id into v_id;
  else
    update public.document_types x
       set name = v_name,
           required = coalesce(p_required, x.required),
           expiry_rule = v_rule,
           reminder_days = v_days,
           weekly_after_expiry = v_weekly,
           accepted_mime = v_mime,
           max_bytes = v_bytes
     where x.id = p_id and x.org_id = v_org
    returning x.id into v_id;
  end if;
  return v_id;
end;
$$;

-- Same signature, rules and grants as *_professionals_reference_settings.sql, plus document_types
-- (its system types — photo, insurance, image_consent — are never archived: readiness and the
-- job name them).
create or replace function public.set_professionals_reference_active(p_kind text, p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.lock_for_professionals_settings();
  v_system boolean;
begin
  if p_active is null then
    raise exception 'p_active est requis' using errcode = '22023';
  end if;

  case p_kind
    when 'professional_orders' then
      select x.is_system into v_system from public.professional_orders x where x.id = p_id and x.org_id = v_org;
    when 'profession_categories' then
      select x.is_system into v_system from public.profession_categories x where x.id = p_id and x.org_id = v_org;
    when 'profession_titles' then
      select x.is_system into v_system from public.profession_titles x where x.id = p_id and x.org_id = v_org;
    when 'clienteles' then
      select x.is_system into v_system from public.clienteles x where x.id = p_id and x.org_id = v_org;
    when 'motif_categories' then
      select x.is_system into v_system from public.motif_categories x where x.id = p_id and x.org_id = v_org;
    when 'motifs' then
      select x.is_system into v_system from public.motifs x where x.id = p_id and x.org_id = v_org;
    when 'languages' then
      select x.is_system into v_system from public.languages x where x.id = p_id and x.org_id = v_org;
    when 'deactivation_reasons' then
      select x.is_system into v_system from public.deactivation_reasons x where x.id = p_id and x.org_id = v_org;
    when 'document_types' then
      select x.is_system into v_system from public.document_types x where x.id = p_id and x.org_id = v_org;
    else
      raise exception 'Liste inconnue : %', p_kind using errcode = '22023';
  end case;
  if v_system is null then   -- is_system is not null: no row of the clinic has this id
    raise exception 'Élément introuvable.' using errcode = 'P0001';
  end if;

  if not p_active then
    if v_system and p_kind = 'document_types' then
      raise exception 'Ce document est suivi par l''application (dossier prêt, rappels) ; il ne peut pas être archivé. Vous pouvez le rendre facultatif.'
        using errcode = 'P0001';
    end if;
    if v_system then
      raise exception 'Cet élément est utilisé par le jumelage ou la création ; il ne peut pas être archivé.' using errcode = 'P0001';
    end if;
    if p_kind = 'professional_orders' and exists (
      select 1 from public.profession_titles t where t.org_id = v_org and t.order_id = p_id and t.is_active
    ) then
      raise exception 'Archivez d''abord les titres de cet ordre.' using errcode = 'P0001';
    end if;
    if p_kind = 'profession_categories' and exists (
      select 1 from public.profession_titles t where t.org_id = v_org and t.category_id = p_id and t.is_active
    ) then
      raise exception 'Archivez d''abord les titres de cette catégorie.' using errcode = 'P0001';
    end if;
  elsif p_kind = 'profession_titles' then
    if exists (
      select 1 from public.profession_titles t
        join public.profession_categories c on c.org_id = t.org_id and c.id = t.category_id
       where t.id = p_id and t.org_id = v_org and not c.is_active
    ) then
      raise exception 'Restaurez d''abord sa catégorie.' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.profession_titles t
        join public.professional_orders o on o.org_id = t.org_id and o.id = t.order_id
       where t.id = p_id and t.org_id = v_org and not o.is_active
    ) then
      raise exception 'Restaurez d''abord son ordre.' using errcode = 'P0001';
    end if;
  end if;

  case p_kind
    when 'professional_orders' then
      update public.professional_orders x set is_active = p_active where x.id = p_id and x.org_id = v_org and x.is_active <> p_active;
    when 'profession_categories' then
      update public.profession_categories x set is_active = p_active where x.id = p_id and x.org_id = v_org and x.is_active <> p_active;
    when 'profession_titles' then
      update public.profession_titles x set is_active = p_active where x.id = p_id and x.org_id = v_org and x.is_active <> p_active;
    when 'clienteles' then
      update public.clienteles x set is_active = p_active where x.id = p_id and x.org_id = v_org and x.is_active <> p_active;
    when 'motif_categories' then
      update public.motif_categories x set is_active = p_active where x.id = p_id and x.org_id = v_org and x.is_active <> p_active;
    when 'motifs' then
      update public.motifs x set is_active = p_active where x.id = p_id and x.org_id = v_org and x.is_active <> p_active;
    when 'languages' then
      update public.languages x set is_active = p_active where x.id = p_id and x.org_id = v_org and x.is_active <> p_active;
    when 'deactivation_reasons' then
      update public.deactivation_reasons x set is_active = p_active where x.id = p_id and x.org_id = v_org and x.is_active <> p_active;
    when 'document_types' then
      update public.document_types x set is_active = p_active where x.id = p_id and x.org_id = v_org and x.is_active <> p_active;
  end case;
end;
$$;

-- Same signature, rules and grants as *_professionals_reference_settings.sql, plus document_types.
create or replace function public.reorder_professionals_reference(p_kind text, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.lock_for_professionals_settings();
  v_count int := coalesce(pg_catalog.cardinality(p_ids), 0);
  v_found int;
begin
  if v_count = 0 or v_count > 500 or pg_catalog.array_position(p_ids, null) is not null
     or (select count(distinct x.id) from pg_catalog.unnest(p_ids) as x(id)) <> v_count then
    raise exception 'Liste d''éléments invalide (vide, en double ou trop longue).' using errcode = '22023';
  end if;

  case p_kind
    when 'professional_orders' then
      select count(*) into v_found from public.professional_orders t where t.org_id = v_org and t.id = any (p_ids);
    when 'profession_categories' then
      select count(*) into v_found from public.profession_categories t where t.org_id = v_org and t.id = any (p_ids);
    when 'profession_titles' then
      select count(*) into v_found from public.profession_titles t where t.org_id = v_org and t.id = any (p_ids);
    when 'clienteles' then
      select count(*) into v_found from public.clienteles t where t.org_id = v_org and t.id = any (p_ids);
    when 'motif_categories' then
      select count(*) into v_found from public.motif_categories t where t.org_id = v_org and t.id = any (p_ids);
    when 'motifs' then
      select count(*) into v_found from public.motifs t where t.org_id = v_org and t.id = any (p_ids);
    when 'languages' then
      select count(*) into v_found from public.languages t where t.org_id = v_org and t.id = any (p_ids);
    when 'deactivation_reasons' then
      select count(*) into v_found from public.deactivation_reasons t where t.org_id = v_org and t.id = any (p_ids);
    when 'document_types' then
      select count(*) into v_found from public.document_types t where t.org_id = v_org and t.id = any (p_ids);
    else
      raise exception 'Liste inconnue : %', p_kind using errcode = '22023';
  end case;
  if v_found <> v_count then
    raise exception 'Éléments inconnus.' using errcode = '22023';
  end if;

  case p_kind
    when 'professional_orders' then
      update public.professional_orders t set sort_order = x.ord * 10 from pg_catalog.unnest(p_ids) with ordinality as x(id, ord)
       where t.id = x.id and t.org_id = v_org and t.sort_order <> x.ord * 10;
    when 'profession_categories' then
      update public.profession_categories t set sort_order = x.ord * 10 from pg_catalog.unnest(p_ids) with ordinality as x(id, ord)
       where t.id = x.id and t.org_id = v_org and t.sort_order <> x.ord * 10;
    when 'profession_titles' then
      update public.profession_titles t set sort_order = x.ord * 10 from pg_catalog.unnest(p_ids) with ordinality as x(id, ord)
       where t.id = x.id and t.org_id = v_org and t.sort_order <> x.ord * 10;
    when 'clienteles' then
      update public.clienteles t set sort_order = x.ord * 10 from pg_catalog.unnest(p_ids) with ordinality as x(id, ord)
       where t.id = x.id and t.org_id = v_org and t.sort_order <> x.ord * 10;
    when 'motif_categories' then
      update public.motif_categories t set sort_order = x.ord * 10 from pg_catalog.unnest(p_ids) with ordinality as x(id, ord)
       where t.id = x.id and t.org_id = v_org and t.sort_order <> x.ord * 10;
    when 'motifs' then
      update public.motifs t set sort_order = x.ord * 10 from pg_catalog.unnest(p_ids) with ordinality as x(id, ord)
       where t.id = x.id and t.org_id = v_org and t.sort_order <> x.ord * 10;
    when 'languages' then
      update public.languages t set sort_order = x.ord * 10 from pg_catalog.unnest(p_ids) with ordinality as x(id, ord)
       where t.id = x.id and t.org_id = v_org and t.sort_order <> x.ord * 10;
    when 'deactivation_reasons' then
      update public.deactivation_reasons t set sort_order = x.ord * 10 from pg_catalog.unnest(p_ids) with ordinality as x(id, ord)
       where t.id = x.id and t.org_id = v_org and t.sort_order <> x.ord * 10;
    when 'document_types' then
      update public.document_types t set sort_order = x.ord * 10 from pg_catalog.unnest(p_ids) with ordinality as x(id, ord)
       where t.id = x.id and t.org_id = v_org and t.sort_order <> x.ord * 10;
  end case;
end;
$$;

-- Same signature and grants as *_professionals_reference_settings.sql, plus `document_types`.
create or replace function public.get_professionals_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as materialized (
    -- The policies' predicate, evaluated once for the nine lists.
    select private.current_user_org_id() as org_id
     where private.can_read_professionals_reference()
  )
  select pg_catalog.jsonb_build_object(
    'orders', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.professional_orders x join me on x.org_id = me.org_id), '[]'::jsonb),
    'categories', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.profession_categories x join me on x.org_id = me.org_id), '[]'::jsonb),
    'titles', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.profession_titles x join me on x.org_id = me.org_id), '[]'::jsonb),
    'clienteles', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.clienteles x join me on x.org_id = me.org_id), '[]'::jsonb),
    'motif_categories', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.motif_categories x join me on x.org_id = me.org_id), '[]'::jsonb),
    'motifs', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.motifs x join me on x.org_id = me.org_id), '[]'::jsonb),
    'languages', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.languages x join me on x.org_id = me.org_id), '[]'::jsonb),
    'deactivation_reasons', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.deactivation_reasons x join me on x.org_id = me.org_id), '[]'::jsonb),
    'document_types', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.document_types x join me on x.org_id = me.org_id), '[]'::jsonb)
  )
$$;

-- -----------------------------------------------------------------------------
-- Upload purposes (Phase 3 catalogue; staged 1 day: attached at once by the RPC below)
-- -----------------------------------------------------------------------------
insert into public.upload_purposes
  (key, module_key, bucket, upload_permission, view_permission, owner_permission, max_bytes, mime_types,
   max_image_side, retain_days)
values
  ('professional_document', 'professionals', 'documents', 'professionals.manage', 'professionals.view', null, 10485760,
   array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], 4000, 1),
  ('professional_self_document', 'professionals', 'documents', 'professionals.self', 'professionals.view',
   'professionals.self', 10485760,
   array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], 4000, 1)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- professional_documents
-- -----------------------------------------------------------------------------
create table public.professional_documents (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  document_type_id uuid not null,
  stored_file_id uuid not null,
  -- pending (uploaded by the provider, or by staff without documents.review) → verified | rejected;
  -- verified → expired once its last valid day has passed (the job, or a corrected date).
  status text not null default 'pending',
  -- Last valid day (P4-2), for types with an expiry rule.
  expires_on date,
  -- Per type: insurance {insurer?, policy_number?}; {} otherwise.
  metadata jsonb not null default '{}',
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  rejection_reason text,
  -- The questionnaire that brought it (photo, insurance: P4-177).
  submission_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_documents_pkey primary key (professional_id, id),
  constraint professional_documents_id_key unique (id),
  constraint professional_documents_stored_file_id_key unique (stored_file_id),
  constraint professional_documents_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_documents_type_fkey foreign key (org_id, document_type_id)
    references public.document_types (org_id, id),
  constraint professional_documents_stored_file_fkey foreign key (stored_file_id)
    references public.stored_files (id),
  constraint professional_documents_uploaded_by_fkey foreign key (uploaded_by)
    references public.profiles (user_id) on delete set null,
  constraint professional_documents_reviewed_by_fkey foreign key (reviewed_by)
    references public.profiles (user_id) on delete set null,
  constraint professional_documents_submission_fkey foreign key (professional_id, submission_id)
    references public.professional_submissions (professional_id, id) on delete set null (submission_id),
  constraint professional_documents_status_check check (status in ('pending', 'verified', 'rejected', 'expired')),
  constraint professional_documents_expires_on_check check (expires_on between date '2000-01-01' and date '2100-12-31'),
  constraint professional_documents_metadata_check check (
    pg_catalog.jsonb_typeof(metadata) = 'object' and pg_catalog.pg_column_size(metadata) <= 2048),
  constraint professional_documents_rejection_reason_check check (
    pg_catalog.char_length(rejection_reason) <= 1000 and pg_catalog.btrim(rejection_reason, E' \t\r\n') <> ''),
  constraint professional_documents_rejected_check check (status <> 'rejected' or rejection_reason is not null),
  constraint professional_documents_reviewed_check check (status not in ('verified', 'rejected') or reviewed_at is not null)
);
-- The job (by type, status and day), the list's aggregates, the composite FKs' org lead.
create index professional_documents_org_type_status_idx
  on public.professional_documents (org_id, document_type_id, status, expires_on);
create index professional_documents_uploaded_by_idx on public.professional_documents (uploaded_by) where uploaded_by is not null;
create index professional_documents_reviewed_by_idx on public.professional_documents (reviewed_by) where reviewed_by is not null;

revoke all on public.professional_documents from anon, authenticated;
grant select on public.professional_documents to authenticated;
alter table public.professional_documents enable row level security;
create policy professional_documents_select_staff on public.professional_documents
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));
create policy professional_documents_select_self on public.professional_documents
  for select to authenticated
  using (professional_id = (select private.current_professional_id()) and (select private.has_permission('professionals.self')));

create trigger professional_documents_set_updated_at before update on public.professional_documents
  for each row execute function private.set_updated_at();
create trigger professional_documents_audit after insert or update or delete on public.professional_documents
  for each row execute function private.audit_trigger();

-- The photo the fiche and the record show: the newest verified photo (set by the RPCs below).
alter table public.professional_public_profiles
  add column photo_document_id uuid,
  add constraint professional_public_profiles_photo_fkey foreign key (professional_id, photo_document_id)
    references public.professional_documents (professional_id, id) on delete set null (photo_document_id);

-- -----------------------------------------------------------------------------
-- What follows a document change (photo, insurance notices)
-- -----------------------------------------------------------------------------
-- The professional's insurance as the job sees it on p_today (one professional, or every one of
-- p_org with a null p_pid): the latest insurance document (verified or expired, latest last day),
-- its state — `expiring` (0 to the largest reminder day left), `expired` (past its last day), null
-- otherwise —, the notice that state raises (dedupe key: the date is in the expiring key, so a
-- corrected date raises a new notice, Task 3.12 review), the reminder step's first day, whether a
-- newer insurance waits for review, and the weekly reminder switch. One statement for the job and
-- the RPCs.
create function private.professional_insurance_state(p_org uuid, p_today date, p_pid uuid)
returns table (
  professional_id uuid, document_id uuid, expires_on date, state text, dedupe_key text, step_start date,
  has_pending boolean, weekly_after_expiry boolean
)
language sql
stable
set search_path = ''
as $$
  with t as (
    select dt.id, dt.reminder_days, dt.weekly_after_expiry,
           coalesce((select max(n) from pg_catalog.unnest(dt.reminder_days) n), 0) as max_days
      from public.document_types dt
     where dt.org_id = p_org and dt.key = 'insurance'
  ),
  latest as (
    select distinct on (d.professional_id) d.professional_id, d.id, d.expires_on
      from public.professional_documents d
      join t on t.id = d.document_type_id
     where d.org_id = p_org and (p_pid is null or d.professional_id = p_pid)
       and d.status in ('verified', 'expired') and d.expires_on is not null
     order by d.professional_id, d.expires_on desc, d.created_at desc, d.id desc
  )
  select l.professional_id, l.id, l.expires_on, s.state,
         case s.state
           when 'expired' then 'insurance:' || l.id || ':expired'
           when 'expiring' then 'insurance:' || l.id || ':' || pg_catalog.to_char(l.expires_on, 'YYYY-MM-DD') || ':expiring'
         end,
         case when s.state = 'expiring'
              then l.expires_on - (select min(n) from pg_catalog.unnest(t.reminder_days) n where n >= l.expires_on - p_today) end,
         exists (select 1 from public.professional_documents q
                  where q.org_id = p_org and q.professional_id = l.professional_id and q.document_type_id = t.id
                    and q.status = 'pending'),
         t.weekly_after_expiry
    from latest l
   cross join t
   cross join lateral (
     select case when l.expires_on < p_today then 'expired'
                 when t.max_days > 0 and l.expires_on - p_today <= t.max_days then 'expiring'
            end as state) s
$$;

-- After any change to a professional's documents (attach, verify, reject, delete, a corrected date,
-- an approved questionnaire): the public profile's photo is the newest verified photo, and of the
-- professional's insurance notices only the one still true today stays open (a newer valid
-- insurance, a corrected date or a removed document closes the others; the job raises what is due).
create function private.after_professional_documents_change(p_org uuid, p_pid uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_photo uuid;
  v_keep text;
begin
  select d.id into v_photo
    from public.professional_documents d
    join public.document_types t on t.org_id = d.org_id and t.id = d.document_type_id and t.key = 'photo'
   where d.professional_id = p_pid and d.org_id = p_org and d.status = 'verified'
   order by d.reviewed_at desc nulls last, d.created_at desc, d.id desc
   limit 1;
  update public.professional_public_profiles x
     set photo_document_id = v_photo
   where x.professional_id = p_pid and x.org_id = p_org and x.photo_document_id is distinct from v_photo;

  select s.dedupe_key into v_keep
    from private.professional_insurance_state(p_org, private.clinic_today_for_org(p_org), p_pid) s;
  perform private.expire_notifications(p_org, 'professional', p_pid,
    array['professionals.insurance_expiring', 'professionals.insurance_expired'], array_remove(array[v_keep], null));
end;
$$;

revoke all on function
  private.professional_insurance_state(uuid, date, uuid),
  private.after_professional_documents_change(uuid, uuid)
from public, anon, authenticated, service_role;

-- The document's professional, locked (the module's order: professional, then document), and the
-- document, locked; « Document introuvable. » outside the caller's clinic.
create function private.lock_professional_document(p_doc_id uuid)
returns public.professional_documents
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pid uuid;
  v_doc public.professional_documents;
begin
  select d.professional_id into v_pid from public.professional_documents d where d.id = p_doc_id and d.org_id = v_org;
  if not found then
    raise exception 'Document introuvable.' using errcode = 'P0001', hint = 'document';
  end if;
  perform private.lock_professional(v_pid);
  select * into v_doc from public.professional_documents d
   where d.professional_id = v_pid and d.id = p_doc_id and d.org_id = v_org
     for update;
  if not found then
    raise exception 'Document introuvable.' using errcode = 'P0001', hint = 'document';
  end if;
  return v_doc;
end;
$$;

-- Nobody verifies, refuses or redates a document of their own record (as P4-304).
create function private.assert_not_own_document(p_pid uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if exists (select 1 from public.professionals p where p.id = p_pid and p.profile_id = auth.uid()) then
    raise exception 'Vous ne pouvez pas réviser vos propres documents.' using errcode = 'P0001', hint = 'document';
  end if;
end;
$$;

revoke all on function
  private.lock_professional_document(uuid),
  private.assert_not_own_document(uuid)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------
-- Attaches an uploaded file to a professional as a document of type p_type_key (active type of the
-- clinic). Staff (professionals.manage): a file of purpose professional_document, verified at once
-- when the caller also holds professionals.documents.review and the record is not their own
-- (P4-401), else pending. The provider (professionals.self, their own record only, even inactive:
-- P4-11): their own upload of purpose professional_self_document, always pending, and a notice to
-- the reviewers. The file must match the type's accepted types and size. Expiry: none for a type
-- without a rule; otherwise p_expires_on, or the rule's default from the clinic's today, and never
-- before today. Metadata: insurance {insurer?, policy_number?} (1–120 characters each), {} for
-- other types. At most 200 documents per professional. Returns the document's id.
create function public.attach_professional_document(
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
      v_org, 'professionals', 'professionals.document_to_review', 'normal', 'Document à vérifier',
      v_row.first_name || ' ' || v_row.last_name || ' a téléversé un document : ' || v_type.name || '.',
      '/professionnels/' || p_id || '/documents', 'professional_document', v_id,
      'professionals.documents.review', null, 'document:' || v_id || ':uploaded', null);
  end if;
  return v_id;
end;
$$;

-- « Vérifier » (professionals.documents.review): a pending document becomes verified, with its
-- last valid day (types with a rule: p_expires_on, else the date given at upload, else the rule's
-- default; a past day makes it expired at once). Not on one's own record.
create function public.verify_professional_document(p_doc_id uuid, p_expires_on date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_doc public.professional_documents;
  v_type public.document_types;
  v_today date;
  v_expires date;
begin
  if not private.has_permission('professionals.documents.review') then
    raise exception 'Permission refusée : professionals.documents.review' using errcode = '42501';
  end if;
  v_doc := private.lock_professional_document(p_doc_id);
  perform private.assert_not_own_document(v_doc.professional_id);
  if v_doc.status <> 'pending' then
    raise exception 'Ce document n''attend pas de vérification.' using errcode = 'P0001', hint = 'status';
  end if;
  select * into v_type from public.document_types t where t.org_id = v_org and t.id = v_doc.document_type_id;
  v_today := private.clinic_today();
  if v_type.expiry_rule = 'none' then
    if p_expires_on is not null then
      raise exception 'Ce type de document n''a pas d''échéance.' using errcode = 'P0001', hint = 'expires_on';
    end if;
  else
    v_expires := coalesce(p_expires_on, v_doc.expires_on, private.document_default_expiry(v_type.expiry_rule, v_today));
    if v_expires not between date '2000-01-01' and date '2100-12-31' then
      raise exception 'Cette date d''échéance n''est pas valide.' using errcode = 'P0001', hint = 'expires_on';
    end if;
  end if;

  update public.professional_documents d
     set status = case when v_expires < v_today then 'expired' else 'verified' end,
         expires_on = v_expires,
         reviewed_by = auth.uid(),
         reviewed_at = pg_catalog.now()
   where d.professional_id = v_doc.professional_id and d.id = v_doc.id;

  perform private.expire_notifications(v_org, 'professional_document', v_doc.id, array['professionals.document_to_review']);
  perform private.after_professional_documents_change(v_org, v_doc.professional_id);
end;
$$;

-- « Refuser » (professionals.documents.review): a pending or verified document becomes rejected
-- with a reason (1–1000 characters, read by the provider). Its file is soft-deleted at once
-- (P4-404). The email to the professional (professionals.document_rejected) is sent by the
-- function of Task 4c.3, not here. Not on one's own record.
create function public.reject_professional_document(p_doc_id uuid, p_reason text)
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
    raise exception 'La raison compte au plus 1000 caractères.' using errcode = 'P0001', hint = 'reason';
  end if;
  v_doc := private.lock_professional_document(p_doc_id);
  perform private.assert_not_own_document(v_doc.professional_id);
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

-- « Modifier l'échéance » (professionals.documents.review, audited, P4-2): the last valid day of a
-- document whose type has a rule (pending, verified or expired); a verified or expired document
-- becomes verified or expired by the new date. Not on one's own record.
create function public.set_professional_document_expiry(p_doc_id uuid, p_expires_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_doc public.professional_documents;
  v_rule text;
  v_today date;
begin
  if not private.has_permission('professionals.documents.review') then
    raise exception 'Permission refusée : professionals.documents.review' using errcode = '42501';
  end if;
  if p_expires_on is null or p_expires_on not between date '2000-01-01' and date '2100-12-31' then
    raise exception 'Cette date d''échéance n''est pas valide.' using errcode = 'P0001', hint = 'expires_on';
  end if;
  v_doc := private.lock_professional_document(p_doc_id);
  perform private.assert_not_own_document(v_doc.professional_id);
  select t.expiry_rule into v_rule from public.document_types t where t.org_id = v_org and t.id = v_doc.document_type_id;
  if v_rule = 'none' then
    raise exception 'Ce type de document n''a pas d''échéance.' using errcode = 'P0001', hint = 'expires_on';
  end if;
  if v_doc.status = 'rejected' then
    raise exception 'Ce document a été refusé.' using errcode = 'P0001', hint = 'status';
  end if;
  v_today := private.clinic_today();

  update public.professional_documents d
     set expires_on = p_expires_on,
         status = case when d.status = 'pending' then 'pending'
                       when p_expires_on < v_today then 'expired' else 'verified' end
   where d.professional_id = v_doc.professional_id and d.id = v_doc.id
     and (d.expires_on is distinct from p_expires_on
          or d.status <> case when d.status = 'pending' then 'pending' when p_expires_on < v_today then 'expired' else 'verified' end);

  perform private.after_professional_documents_change(v_org, v_doc.professional_id);
end;
$$;

-- « Supprimer » (professionals.documents.delete): the row is deleted (the audit keeps it: P4-36)
-- and its file soft-deleted (core storage-cleanup purges the object 30 days later).
create function public.delete_professional_document(p_doc_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_doc public.professional_documents;
begin
  if not private.has_permission('professionals.documents.delete') then
    raise exception 'Permission refusée : professionals.documents.delete' using errcode = '42501';
  end if;
  v_doc := private.lock_professional_document(p_doc_id);

  delete from public.professional_documents d where d.professional_id = v_doc.professional_id and d.id = v_doc.id;
  perform private.soft_delete_stored_file(v_doc.stored_file_id, auth.uid());

  perform private.expire_notifications(v_org, 'professional_document', v_doc.id, array['professionals.document_to_review']);
  perform private.after_professional_documents_change(v_org, v_doc.professional_id);
end;
$$;

-- The Documents tab and « Mes documents » in one payload: staff with professionals.view for any
-- professional of the clinic; the provider for their own record (p_id null = their own). Null
-- when the caller cannot read it. Newest first; `file` is null once the file is gone (rejected,
-- deleted); `reviewed_by_name` for staff only; `consent` is the latest e-consent; `photo` the
-- public profile's photo (document and file ids, for storage-sign). `today` is the clinic's date
-- (cards compare expires_on with it, never with the browser's).
create function public.get_professional_documents(p_id uuid default null)
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
               'file', case when f.id is not null then pg_catalog.jsonb_build_object(
                         'id', f.id, 'name', f.original_name, 'mime_type', f.mime_type, 'size_bytes', f.size_bytes) end)
             order by d.created_at desc, d.id desc)
        from public.professional_documents d
        join public.document_types t on t.org_id = d.org_id and t.id = d.document_type_id
        left join public.stored_files f on f.id = d.stored_file_id and f.status = 'ready'
        left join public.profiles rv on v_staff and rv.user_id = d.reviewed_by and rv.org_id = v_org
       where d.professional_id = v_pid and d.org_id = v_org), '[]'::jsonb),
    'consent', (
      select pg_catalog.jsonb_build_object(
               'id', k.id, 'version', cv.version, 'signer_name', k.signer_name, 'signed_at', k.signed_at,
               'expires_on', k.expires_on, 'withdrawn_at', k.withdrawn_at, 'withdrawal_effective_on', k.withdrawal_effective_on)
        from public.professional_consents k
        join public.consent_versions cv on cv.org_id = k.org_id and cv.id = k.consent_version_id
       where k.professional_id = v_pid and k.org_id = v_org
       order by k.signed_at desc, k.id desc
       limit 1)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- The approval hook (P4-400): the questionnaire's photo and insurance become documents
-- -----------------------------------------------------------------------------
-- After a submission's status changes: leaving `submitted` closes its « Profil à réviser » notice
-- (approved, sent back or cancelled: one open submission per professional, so the professional's
-- notices of that kind); becoming `approved` creates a verified document for each staged file the
-- review applied (`photo`, `insurance` in applied_fields), which apply_professional_submission has
-- just attached to the professional (P4-177), with the insurance's last valid day as submitted
-- (P4-305 checked it), reviewed by the approver (P4-401). Idempotent on the file.
create function private.professional_submissions_documents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.document_types;
begin
  if old.status = 'submitted' then
    perform private.expire_notifications(new.org_id, 'professional', new.professional_id,
      array['professionals.submission_received']);
  end if;
  if new.status = 'approved' then
    for v_type in
      select t.* from public.document_types t
       where t.org_id = new.org_id and t.key in ('photo', 'insurance') and t.key = any (coalesce(new.applied_fields, '{}'))
    loop
      insert into public.professional_documents
        (org_id, professional_id, document_type_id, stored_file_id, status, expires_on, uploaded_by, uploaded_at,
         reviewed_by, reviewed_at, submission_id)
      select new.org_id, new.professional_id, v_type.id, f.id, 'verified',
             case when v_type.expiry_rule <> 'none' then (new.submitted_values #>> array[v_type.key, 'expires_on'])::date end,
             f.uploaded_by, coalesce(f.confirmed_at, f.created_at), new.reviewed_by, coalesce(new.reviewed_at, pg_catalog.now()), new.id
        from public.stored_files f
       where f.id = (new.submitted_values #>> array[v_type.key, 'file_id'])::uuid
         and f.org_id = new.org_id and f.status = 'ready'
         and f.subject_type = 'professional' and f.subject_id = new.professional_id
      on conflict (stored_file_id) do nothing;
    end loop;
    perform private.after_professional_documents_change(new.org_id, new.professional_id);
  end if;
  return null;
end;
$$;
revoke all on function private.professional_submissions_documents() from public, anon, authenticated, service_role;

create trigger professional_submissions_documents
  after update of status on public.professional_submissions
  for each row when (old.status is distinct from new.status)
  execute function private.professional_submissions_documents();

-- -----------------------------------------------------------------------------
-- Readiness: « Documents requis » (4b.1's view replaced, columns appended)
-- -----------------------------------------------------------------------------
create or replace view public.professionals_readiness with (security_invoker = true) as
select r.professional_id, r.org_id, r.has_profession, r.licences_ok, r.restricted_motifs_ok, r.has_language,
       r.has_clientele, r.has_motif, r.matching_complete, r.email_matches_login,
       (r.matching_complete and r.account_created and r.submission_approved and r.documents_ok) as ready,
       r.account_created, r.submission_approved,
       r.photo_ok, r.insurance_ok, r.consent_ok, r.documents_ok, r.documents_done, r.documents_required,
       r.documents_missing, r.insurance_status, r.insurance_expires_on
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
           dc.insurance_expires_on
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
                         else coalesce(d.valid_until >= x.today, false) end
                    or (t.key = 'image_consent' and coalesce(k.valid_until >= x.today, false))) as ok,
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
              -- An e-consent is in force until its last day, or the day before its withdrawal takes effect.
              left join (select z.professional_id,
                                max(case when z.withdrawal_effective_on is null then z.expires_on
                                         else least(z.expires_on, z.withdrawal_effective_on - 1) end) as valid_until
                           from public.professional_consents z
                          group by z.professional_id) k
                     on t.key = 'image_consent' and k.professional_id = x.id
          ) s
         group by s.professional_id
      ) dc on dc.professional_id = p.id
  ) r;

-- {complete, done, total, items, warnings}: 4b.1's items, then `documents` (missing: photo,
-- insurance, insurance_expired, image_consent, other_documents; P4-405).
create or replace function public.get_professional_readiness(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'complete', r.ready,
           'done', r.matching_complete::int + r.account_created::int + r.submission_approved::int + r.documents_ok::int,
           'total', 4,
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
                                           'missing', pg_catalog.to_jsonb(r.documents_missing))),
           'warnings', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
             case when not r.email_matches_login then 'login_email_mismatch' end], null)))
    from public.professionals_readiness r
   where r.professional_id = p_id
$$;

-- -----------------------------------------------------------------------------
-- Read models: the list gains the documents' counts and the insurance; the directory's
-- insurance_status is real (P4-406)
-- -----------------------------------------------------------------------------
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
       r.insurance_expires_on
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

-- Same columns, joins and filter as *_professionals_places_and_note.sql (4b.6: new_client_places,
-- new_client_places_set_at, matching_note last); insurance_status comes from readiness now
-- (valid / expiring / expired / missing), never 'unknown'.
create or replace view public.professionals_directory with (security_invoker = true) as
select p.id, p.org_id, p.status,
       mp.accepting_new_clients,
       mp.availability_periods,
       mp.min_client_age,
       mp.women_only,
       p.first_name || ' ' || p.last_name    as display_name,
       pp.profession_title_id                as primary_title_id,
       pt.key                                as primary_title_key,
       pt.name                               as primary_title_name,
       private.profession_title_label(pt.name, pt.name_feminine, pt.name_masculine, p.gender)
                                             as primary_title_label,
       pc.key                                as category_key,
       po.acronym                            as order_acronym,
       pp.licence_number,
       coalesce(pr.items, '[]')              as professions,
       coalesce(l.codes, '{}')               as language_codes,
       coalesce(c.items, '[]')               as clienteles,
       coalesce(m.ids, '{}')                 as motif_ids,
       coalesce(m.keys, '{}')                as motif_keys,
       p.years_experience,
       p.gender,
       coalesce(r.insurance_status, 'missing') as insurance_status,
       r.ready,
       greatest(p.updated_at, mp.updated_at) as updated_at,
       mp.new_client_places,
       mp.new_client_places_set_at,
       n.note                                as matching_note
  from public.professionals p
  left join public.professional_matching_profiles mp on mp.professional_id = p.id
  left join public.professional_matching_notes n on n.professional_id = p.id
  left join public.professional_professions pp on pp.professional_id = p.id and pp.is_primary
  left join public.profession_titles pt on pt.org_id = pp.org_id and pt.id = pp.profession_title_id
  left join public.profession_categories pc on pc.org_id = pt.org_id and pc.id = pt.category_id
  left join public.professional_orders po on po.org_id = pt.org_id and po.id = pt.order_id
  left join public.professionals_readiness r on r.professional_id = p.id
  left join (select x.professional_id,
                    jsonb_agg(jsonb_build_object('id', x.id, 'title_id', t.id, 'title_key', t.key, 'title_name', t.name,
                                                 'title_label', private.profession_title_label(t.name, t.name_feminine, t.name_masculine, xp.gender),
                                                 'category_key', tc.key, 'order_acronym', o.acronym,
                                                 'licence_number', x.licence_number, 'is_primary', x.is_primary)
                              order by x.is_primary desc, x.created_at, x.id) as items
               from public.professional_professions x
               join public.professionals xp on xp.id = x.professional_id
               join public.profession_titles t on t.org_id = x.org_id and t.id = x.profession_title_id
               join public.profession_categories tc on tc.org_id = t.org_id and tc.id = t.category_id
               left join public.professional_orders o on o.org_id = t.org_id and o.id = t.order_id
              group by x.professional_id) pr on pr.professional_id = p.id
  left join (select x.professional_id, array_agg(g.code order by g.sort_order, g.code) as codes
               from public.professional_languages x
               join public.languages g on g.org_id = x.org_id and g.id = x.language_id
              group by x.professional_id) l on l.professional_id = p.id
  left join (select x.professional_id,
                    jsonb_agg(jsonb_build_object('id', x.clientele_id, 'key', k.key, 'specialized', x.is_specialized,
                                                 'min_age', k.min_age, 'max_age', k.max_age)
                              order by k.sort_order, k.key) as items
               from public.professional_clienteles x
               join public.clienteles k on k.org_id = x.org_id and k.id = x.clientele_id
              group by x.professional_id) c on c.professional_id = p.id
  left join (select x.professional_id, array_agg(x.motif_id order by k.key) as ids, array_agg(k.key order by k.key) as keys
               from public.professional_motifs x
               join public.motifs k on k.org_id = x.org_id and k.id = x.motif_id
              group by x.professional_id) m on m.professional_id = p.id
 where (select private.has_permission('professionals.view'));

-- -----------------------------------------------------------------------------
-- History: documents (*_professionals_places_and_note.sql's list, plus professional_documents)
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
               'professional_documents']
$$;

-- -----------------------------------------------------------------------------
-- Email templates (P4-50; FR, vous, no clinical word). Sent to the professional (subject
-- `professional`); the button opens « Mes documents » (4c.6), behind sign-in, no token (P4-44).
-- -----------------------------------------------------------------------------
insert into public.email_template_defaults
  (key, module_key, label, description, why_line, subject, body, button_label, variables, view_permission)
values
  ('professionals.document_rejected', 'professionals',
   'Document à reprendre',
   'Envoyé au professionnel quand la clinique refuse un document qu''il a transmis, avec la raison.',
   'Vous recevez ce courriel parce que vous avez transmis un document à la clinique.',
   'Un document est à reprendre',
   E'Bonjour {{professional.first_name}},\n\n'
   'L''équipe de {{clinic.name}} a examiné le document « {{document.type_name}} » que vous avez transmis et vous '
   'demande de le reprendre :\n\n'
   '{{document.rejection_reason}}\n\n'
   'Vous pouvez téléverser une nouvelle version dans votre espace.',
   'Voir mes documents',
   '[
     {"path": "professional.first_name", "label": "Prénom du professionnel", "sample": "Nadia", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "document.type_name", "label": "Type de document", "sample": "Photo professionnelle", "required": true, "kind": "text"},
     {"path": "document.rejection_reason", "label": "Raison du refus", "sample": "La photo est floue.", "required": true, "kind": "text"}
   ]',
   'professionals.view'),
  ('professionals.document_expiring', 'professionals',
   'Assurance bientôt échue',
   'Envoyé au professionnel quelques jours avant la fin de sa preuve d''assurance (réglage « Documents requis »).',
   'Vous recevez ce courriel parce que la clinique garde votre preuve d''assurance responsabilité à jour.',
   'Votre assurance prend fin le {{document.expires_on}}',
   E'Bonjour {{professional.first_name}},\n\n'
   'La preuve d''assurance responsabilité professionnelle que {{clinic.name}} a à votre dossier prend fin le '
   '{{document.expires_on}}.\n\n'
   'Dès que vous recevez votre nouvelle attestation, téléversez-la dans votre espace, ou transmettez-la à la clinique.',
   'Téléverser ma preuve',
   '[
     {"path": "professional.first_name", "label": "Prénom du professionnel", "sample": "Nadia", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "document.expires_on", "label": "Fin de l''assurance", "sample": "31 mars 2027", "required": true, "kind": "date"}
   ]',
   'professionals.view'),
  ('professionals.document_expired', 'professionals',
   'Assurance échue',
   'Envoyé au professionnel le lendemain de la fin de sa preuve d''assurance.',
   'Vous recevez ce courriel parce que la clinique garde votre preuve d''assurance responsabilité à jour.',
   'Votre assurance est échue',
   E'Bonjour {{professional.first_name}},\n\n'
   'La preuve d''assurance responsabilité professionnelle que {{clinic.name}} a à votre dossier a pris fin le '
   '{{document.expires_on}}.\n\n'
   'Votre dossier reste actif. Tant que la clinique n''a pas reçu votre nouvelle attestation, chaque nouveau client '
   'qui vous est proposé demande une confirmation de sa part.\n\n'
   'Téléversez votre nouvelle attestation dans votre espace dès que possible, ou transmettez-la à la clinique.',
   'Téléverser ma preuve',
   '[
     {"path": "professional.first_name", "label": "Prénom du professionnel", "sample": "Nadia", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "document.expires_on", "label": "Fin de l''assurance", "sample": "31 mars 2027", "required": true, "kind": "date"}
   ]',
   'professionals.view'),
  ('professionals.document_expired_reminder', 'professionals',
   'Rappel : assurance échue',
   'Envoyé chaque semaine au professionnel dont la preuve d''assurance est échue, jusqu''à ce qu''une nouvelle soit vérifiée.',
   'Vous recevez ce courriel parce que la clinique garde votre preuve d''assurance responsabilité à jour.',
   'Rappel : votre preuve d''assurance est attendue',
   E'Bonjour {{professional.first_name}},\n\n'
   'Votre preuve d''assurance responsabilité professionnelle a pris fin le {{document.expires_on}} et '
   '{{clinic.name}} n''a pas encore reçu la nouvelle.\n\n'
   'Téléversez-la dans votre espace, ou transmettez-la à la clinique. Si vous l''avez déjà envoyée, '
   'vous pouvez ignorer ce rappel.',
   'Téléverser ma preuve',
   '[
     {"path": "professional.first_name", "label": "Prénom du professionnel", "sample": "Nadia", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "document.expires_on", "label": "Fin de l''assurance", "sample": "31 mars 2027", "required": true, "kind": "date"}
   ]',
   'professionals.view')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Privileges: the user RPCs act for the calling user (service_role revoked from the defaults)
-- -----------------------------------------------------------------------------
revoke all on function
  public.save_document_type(uuid, text, boolean, text, int[], boolean, text[], int),
  public.attach_professional_document(uuid, text, uuid, date, jsonb),
  public.verify_professional_document(uuid, date),
  public.reject_professional_document(uuid, text),
  public.set_professional_document_expiry(uuid, date),
  public.delete_professional_document(uuid),
  public.get_professional_documents(uuid)
from public, anon, authenticated, service_role;
grant execute on function
  public.save_document_type(uuid, text, boolean, text, int[], boolean, text[], int),
  public.attach_professional_document(uuid, text, uuid, date, jsonb),
  public.verify_professional_document(uuid, date),
  public.reject_professional_document(uuid, text),
  public.set_professional_document_expiry(uuid, date),
  public.delete_professional_document(uuid),
  public.get_professional_documents(uuid)
to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
