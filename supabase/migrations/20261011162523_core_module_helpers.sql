-- =============================================================================
-- Core: helpers a module calls instead of touching core tables
-- =============================================================================
-- Asked:   gap audit 2026-10-09 (docs/audit/2026-10-09-gap-audit.md, T1 and C5)
-- Needs:   *_core_email.sql (email_log), *_core_notifications.sql (notifications), *_core_storage.sql
--          (stored_files), *_core_tax_rates.sql (add_tax_rate), *_professionals_documents.sql (where
--          expire_notifications and format_date_fr were first written)
-- Rules:   docs/standards/database-conventions.md; docs/modules/core.md « How a module plugs in »
--
-- Key choices
-- * Core owns email_log, notifications and stored_files: a module reads or writes them only
--   through these helpers, called from its own definer RPCs after their permission check
--   (security invoker, EXECUTE granted to no role, like private.notify and latest_subject_email).
-- * private.expire_notifications and private.format_date_fr were written in a module migration
--   (*_professionals_documents.sql) although they are core's: their home is now here (create or
--   replace, the same signature and body, so nothing that calls them changes). A core function
--   may call them (add_tax_rate below) without depending on a module.
-- * New: expire_notifications_for_subjects (the same close, for several subjects at once),
--   last_subject_emails (per subject and template, the newest email that did not fail for sure:
--   « failed » with « provider_unavailable » is « Résultat inconnu » and counts as sent, so a job
--   never sends twice), set_stored_files_owner (re-own files: only rows that differ, never a purged
--   or another clinic's file; the same owner rules as attach_stored_file) and
--   extend_stored_files_retention (keep a subject's staged files longer: never shortens a hold,
--   never limits a file kept forever).
-- * Dates in French (C5, decision C-3): a document's deadline is long (« 31 mars 2027 »,
--   format_date_fr, the app's formatDateOnly); every other calendar date, such as the start of a
--   rate, a grid or an agreement, is short (« 1 nov. 2026 », format_date_short_fr, the app's
--   formatDateOnlyShort: date-fns fr 'd MMM yyyy'). Never ISO in a French text.
-- * add_tax_rate: its latest definition (*_core_tax_rates.sql) with the refusal's date short
--   (« 1 juil. 2031 », not « 2031-07-01 »). Same signature, same privileges.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:core_module_helpers', true);

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------
-- Closes the open notices of a record: kinds p_kinds, subject (p_subject_type, p_subject_id) of
-- p_org, except those whose dedupe key is in p_keep_dedupe_keys (the notice that is still true).
-- An expired notice leaves every bell at once (the policy and the RPCs read expires_at) and is
-- purged 30 days later (core.notifications_purge). Returns how many it closed.
create or replace function private.expire_notifications(
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

-- The same close for every subject of p_subject_ids (e.g. the notices of the files no longer
-- active). Returns how many it closed.
create function private.expire_notifications_for_subjects(
  p_org uuid,
  p_subject_type text,
  p_subject_ids uuid[],
  p_kinds text[]
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
     and n.subject_id = any (p_subject_ids)
     and n.kind = any (p_kinds)
     and (n.expires_at is null or n.expires_at > pg_catalog.now());
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.expire_notifications_for_subjects(uuid, text, uuid[], text[])
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Emails
-- -----------------------------------------------------------------------------
-- Per subject of p_subject_ids and template of p_template_keys, the time of the newest email
-- created at or after p_since that did not fail for sure (any status but `failed`, or `failed`
-- with `provider_unavailable`: « Résultat inconnu », emailStatusLabel). No row for a pair with
-- none. For a job that must not send the same email twice. Served by email_log_subject_idx.
create function private.last_subject_emails(
  p_org uuid,
  p_subject_type text,
  p_subject_ids uuid[],
  p_template_keys text[],
  p_since timestamptz
)
returns table (subject_id uuid, template_key text, created_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select e.subject_id, e.template_key, max(e.created_at)
    from public.email_log e
   where e.org_id = p_org and e.subject_type = p_subject_type and e.subject_id = any (p_subject_ids)
     and e.template_key = any (p_template_keys) and e.created_at >= p_since
     and (e.status <> 'failed' or e.error_code = 'provider_unavailable')
   group by e.subject_id, e.template_key
$$;
revoke all on function private.last_subject_emails(uuid, text, uuid[], text[], timestamptz)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Stored files
-- -----------------------------------------------------------------------------
-- Gives the files p_file_ids of p_org to p_owner_profile_id with p_owner_permission (both null:
-- no owner), as attach_stored_file would: an owner needs an owner permission (22023), and a
-- module's file names only its module's permissions (22023). Purged files are left as they are;
-- only rows whose owner differs are written (one audited update each). Returns how many changed.
create function private.set_stored_files_owner(
  p_org uuid,
  p_file_ids uuid[],
  p_owner_profile_id uuid,
  p_owner_permission text
)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  if (p_owner_profile_id is null) <> (p_owner_permission is null) then
    raise exception 'An owner needs an owner permission' using errcode = '22023';
  end if;
  if p_owner_permission is not null and exists (
       select 1 from public.stored_files f
        where f.org_id = p_org and f.id = any (p_file_ids) and f.module_key <> 'core'
          and not private.permission_in_module(p_owner_permission, f.module_key)) then
    raise exception 'A module''s file can only name permissions of its module' using errcode = '22023';
  end if;
  update public.stored_files f
     set owner_profile_id = p_owner_profile_id,
         owner_permission = p_owner_permission
   where f.org_id = p_org and f.id = any (p_file_ids) and f.status <> 'purged'
     and (f.owner_profile_id is distinct from p_owner_profile_id or f.owner_permission is distinct from p_owner_permission);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.set_stored_files_owner(uuid, uuid[], uuid, text) from public, anon, authenticated, service_role;

-- Keeps the ready files p_file_ids of p_org (purpose p_purpose, attached to p_subject_type /
-- p_subject_id) until p_until at least: only a file with a limit that ends earlier is written;
-- a file kept forever (retain_until null), a pending one or another subject's is left alone.
-- Returns how many changed.
create function private.extend_stored_files_retention(
  p_org uuid,
  p_purpose text,
  p_subject_type text,
  p_subject_id uuid,
  p_file_ids uuid[],
  p_until timestamptz
)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.stored_files f
     set retain_until = p_until
   where f.org_id = p_org and f.purpose = p_purpose
     and f.subject_type = p_subject_type and f.subject_id = p_subject_id
     and f.id = any (p_file_ids)
     and f.status = 'ready' and f.retain_until is not null and f.retain_until < p_until;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.extend_stored_files_retention(uuid, text, text, uuid, uuid[], timestamptz)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Dates in French (C5)
-- -----------------------------------------------------------------------------
-- « 31 mars 2027 »: a date-only value in French, as _shared/format.ts formatDateOnly writes it.
-- For P0001 messages and notice texts that name a document's deadline.
create or replace function private.format_date_fr(p_date date)
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
revoke all on function private.format_date_fr(date) from public, anon, authenticated, service_role;

-- « 1 nov. 2026 »: a calendar date in short French, as the app's formatDateOnlyShort writes it
-- (date-fns fr 'd MMM yyyy': janv., févr., mars, avr., mai, juin, juil., août, sept., oct., nov.,
-- déc.). For the dates of refusals that are not a document's deadline.
create function private.format_date_short_fr(p_date date)
returns text
language sql
immutable
set search_path = ''
as $$
  select extract(day from p_date)::int::text || ' '
      || (array['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.',
                'oct.', 'nov.', 'déc.'])[extract(month from p_date)::int]
      || ' ' || extract(year from p_date)::int::text
$$;
revoke all on function private.format_date_short_fr(date) from public, anon, authenticated, service_role;

-- *_core_tax_rates.sql's add_tax_rate, the refusal's date in short French.
create or replace function public.add_tax_rate(p_tax text, p_rate numeric, p_effective_from date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_open public.tax_rates;
  v_id uuid;
  -- Rounded first, so the check below sees the value the numeric(7,6) column stores
  -- (0.9999995 would otherwise pass and fail the table check as 23514).
  v_rate numeric := round(p_rate, 6);
begin
  if not private.has_permission('settings.manage') then
    raise exception 'Permission refusée : settings.manage' using errcode = '42501';
  end if;
  if p_tax is null or p_tax not in ('gst', 'qst') then
    raise exception 'Taxe inconnue : %', p_tax using errcode = '22023';
  end if;
  if v_rate is null or v_rate < 0 or v_rate >= 1 then
    raise exception 'Le taux doit être d''au moins 0 %% et de moins de 100 %%.' using errcode = 'P0001';
  end if;
  if p_effective_from is null then
    raise exception 'La date d''entrée en vigueur est requise.' using errcode = 'P0001';
  end if;

  -- One writer per org at a time.
  perform 1 from public.organizations o where o.id = v_org for no key update;

  select * into v_open
    from public.tax_rates t
   where t.org_id = v_org and t.tax = p_tax and t.effective_to is null;

  if v_open.id is not null then
    if p_effective_from <= v_open.effective_from then
      raise exception 'Le nouveau taux doit commencer après le %.', private.format_date_short_fr(v_open.effective_from)
        using errcode = 'P0001';
    end if;
    update public.tax_rates t set effective_to = p_effective_from where t.id = v_open.id;
  end if;

  insert into public.tax_rates (org_id, tax, rate, effective_from, created_by)
  values (v_org, p_tax, v_rate, p_effective_from, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
