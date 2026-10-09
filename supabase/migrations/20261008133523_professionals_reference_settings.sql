-- =============================================================================
-- Professionnels: settings RPCs for the reference lists, cached catalogue, module settings
-- =============================================================================
-- Design:  docs/plans/2026-10-08-professionals-module-design.md §3.1–3.2, §5.6
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4a.2 (P4-7, P4-31, P4-32, P4-42)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * The eight lists of *_professionals_reference_data.sql are written only here, by security
--   definer RPCs gated by professionals.settings: save_<list> (create or update, returns the id),
--   set_professionals_reference_active (archive / restore), reorder_professionals_reference.
--   Static branches per list, no dynamic SQL.
-- * One settings writer per clinic: every write locks the org row (for no key update) before its
--   checks, so the name, key and dependency checks never race.
-- * Names are tidied like role names (private.valid_role_name): Unicode spaces stripped at both
--   ends, inner runs folded to one space, invisible or control characters refused with a French
--   P0001. Duplicates are compared as lower(normalize(name, NFKC)), the expression of the unique
--   indexes, so the friendly message fires exactly when the index would.
-- * System rows keep what other modules rely on: the 5 system clientèles are never archived and keep
--   their kind (age group or not), « Autre » always requires a note. Order acronyms are unique
--   per clinic, ignoring case.
-- * Keys are generated from the French name on create (private.reference_key, P4-31) with a
--   numeric suffix when taken, and never change (the 4a.1 freeze trigger backs this). Languages
--   take an ISO 639-1 code instead, validated on create and refused on change.
-- * A list holds at most 500 rows, archived ones included (~70 today): the catalogue is bounded.
-- * get_professionals_catalog: the eight lists in one jsonb payload for the client cache, archived
--   rows included (records still show them). Security definer with the policies' own predicate
--   (org and can_read_professionals_reference), evaluated once instead of once per list.
-- * Catalogue views (motifs_catalog, clienteles_catalog, languages_catalog): active rows, for
--   other modules (Demandes); security_invoker, so the lists' RLS applies.
-- * Module settings live in org_module_settings (module professionals): known keys with defaults
--   (collect_sin = false, P4-7), each value checked by its own rule in
--   private.validate_professionals_setting (later batches add their keys there). org_module_settings has an audit trigger: the RPC sets the audit
--   source rpc:set_professionals_settings around its write instead of a second, explicit row.
-- =============================================================================

create extension if not exists unaccent with schema extensions;

-- -----------------------------------------------------------------------------
-- Helpers (granted to no client: called by the RPCs below, owned by postgres)
-- -----------------------------------------------------------------------------
-- Key from a French name: lower ASCII snake_case, at most 50 characters, starts with a letter.
-- The two-argument unaccent names its dictionary: the one-argument form looks it up through the
-- search_path, which is empty here. unaccent maps « œ » to « oe » and « ß » to « ss ».
create function private.reference_key(p_name text)
returns text
language sql
stable
set search_path = ''
as $$
  with k as (
    select pg_catalog.btrim(
             pg_catalog.regexp_replace(
               pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_name, ''))),
               '[^a-z0-9]+', '_', 'g'),
             '_') as v
  )
  select case
           when k.v = '' then 'item'
           when k.v ~ '^[0-9]' then pg_catalog.rtrim(pg_catalog.left('k_' || k.v, 50), '_')
           else pg_catalog.rtrim(pg_catalog.left(k.v, 50), '_')
         end
    from k
$$;

-- p_base, or p_base cut to 46 characters + _2, _3… when taken. A list holds at most 500 rows,
-- so the suffix has at most three digits and the key stays within 50 characters.
create function private.unique_reference_key(p_base text, p_taken text[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text := p_base;
  v_n int := 1;
begin
  while v_key = any (p_taken) loop
    v_n := v_n + 1;
    v_key := pg_catalog.rtrim(pg_catalog.left(p_base, 46), '_') || '_' || v_n;
  end loop;
  return v_key;
end;
$$;

-- A label as stored, or a French P0001. Unicode whitespace (the class of valid_role_name) is
-- stripped at both ends and, when p_fold_spaces, each inner run becomes one space (a licence
-- pattern keeps its own). Blank: null, or « … est obligatoire. » when p_required. Then at most
-- p_max characters and private.is_tidy_text (no control or invisible character), the check
-- constraint of every label column. p_label names the field in the message (« Le nom »).
create function private.reference_text(p_value text, p_label text, p_max int, p_required boolean, p_fold_spaces boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_ws constant text := '[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+';
  v_text text;
begin
  v_text := pg_catalog.regexp_replace(coalesce(p_value, ''), '^' || v_ws || '|' || v_ws || '$', '', 'g');
  if p_fold_spaces then
    v_text := pg_catalog.regexp_replace(v_text, v_ws, ' ', 'g');
  end if;
  if v_text = '' then
    if p_required then
      raise exception '% est obligatoire.', p_label using errcode = 'P0001';
    end if;
    return null;
  end if;
  if pg_catalog.char_length(v_text) > p_max then
    raise exception '% ne peut pas dépasser % caractères.', p_label, p_max using errcode = 'P0001';
  end if;
  if not private.is_tidy_text(v_text) then
    raise exception '% contient des caractères invisibles ou non permis.', p_label using errcode = 'P0001';
  end if;
  return v_text;
end;
$$;

-- Bounds every list (and so the catalogue payload); renames and archives stay possible.
create function private.assert_reference_room(p_count bigint)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_count >= 500 then
    raise exception 'Cette liste compte déjà 500 éléments (archivés compris).' using errcode = 'P0001';
  end if;
end;
$$;

-- The caller's org, once professionals.settings is checked and the org row locked: one settings
-- writer per clinic at a time (see conventions §6, « Serialize read-check-write sequences »).
create function private.lock_for_professionals_settings()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('professionals.settings') then
    raise exception 'Permission refusée : professionals.settings' using errcode = '42501';
  end if;
  perform 1 from public.organizations o where o.id = v_org for no key update;
  return v_org;
end;
$$;

revoke all on function
  private.reference_key(text),
  private.unique_reference_key(text, text[]),
  private.reference_text(text, text, int, boolean, boolean),
  private.assert_reference_room(bigint),
  private.lock_for_professionals_settings()
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Save RPCs: p_id null creates (key generated, last in the list), otherwise updates the row of
-- the caller's clinic (key unchanged). A null flag keeps its value on update. Each returns the id.
-- -----------------------------------------------------------------------------
create function public.save_professional_order(p_id uuid, p_name text, p_acronym text, p_licence_label text, p_licence_pattern text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.lock_for_professionals_settings();
  v_name text := private.reference_text(p_name, 'Le nom', 120, true, true);
  -- Upper-cased as typed (the dialog does the same, Task 4a.7).
  v_acronym text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_acronym, ''), E' \t\r\n'));
  v_label text := coalesce(private.reference_text(p_licence_label, 'Le libellé du permis', 60, false, true), 'N° de permis');
  v_pattern text := private.reference_text(p_licence_pattern, 'Le format de permis', 200, false, false);
  v_id uuid;
begin
  if v_acronym !~ '^[A-Z]{2,10}$' then
    raise exception 'Sigle : 2 à 10 lettres majuscules.' using errcode = 'P0001';
  end if;
  if v_pattern is not null then
    begin
      perform '' ~ v_pattern;
    exception when invalid_regular_expression then
      raise exception 'Format de permis invalide.' using errcode = 'P0001';
    end;
  end if;
  if p_id is not null and not exists (select 1 from public.professional_orders x where x.id = p_id and x.org_id = v_org) then
    raise exception 'Ordre introuvable.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.professional_orders x
     where x.org_id = v_org and x.id is distinct from p_id
       and pg_catalog.lower(pg_catalog.normalize(x.name, 'NFKC')) = pg_catalog.lower(pg_catalog.normalize(v_name, 'NFKC'))
  ) then
    raise exception 'Un ordre porte déjà ce nom (il est peut-être archivé).' using errcode = 'P0001';
  end if;
  -- Acronyms are unique per clinic, archived orders included, ignoring case (a null acronym,
  -- should the column ever allow one, matches nothing). The org lock makes this check race-free.
  if exists (
    select 1 from public.professional_orders x
     where x.org_id = v_org and x.id is distinct from p_id
       and pg_catalog.upper(x.acronym) = v_acronym
  ) then
    raise exception 'Un ordre porte déjà ce sigle (il est peut-être archivé).' using errcode = 'P0001';
  end if;

  if p_id is null then
    perform private.assert_reference_room((select count(*) from public.professional_orders x where x.org_id = v_org));
    insert into public.professional_orders (org_id, key, name, acronym, licence_label, licence_pattern, sort_order)
    values (v_org,
            private.unique_reference_key(private.reference_key(v_name),
              array(select x.key from public.professional_orders x where x.org_id = v_org)),
            v_name, v_acronym, v_label, v_pattern,
            coalesce((select max(x.sort_order) from public.professional_orders x where x.org_id = v_org), 0) + 10)
    returning id into v_id;
  else
    update public.professional_orders x
       set name = v_name, acronym = v_acronym, licence_label = v_label, licence_pattern = v_pattern
     where x.id = p_id and x.org_id = v_org
    returning x.id into v_id;
  end if;
  return v_id;
end;
$$;

create function public.save_profession_category(p_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.lock_for_professionals_settings();
  v_name text := private.reference_text(p_name, 'Le nom', 120, true, true);
  v_id uuid;
begin
  if p_id is not null and not exists (select 1 from public.profession_categories x where x.id = p_id and x.org_id = v_org) then
    raise exception 'Catégorie introuvable.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.profession_categories x
     where x.org_id = v_org and x.id is distinct from p_id
       and pg_catalog.lower(pg_catalog.normalize(x.name, 'NFKC')) = pg_catalog.lower(pg_catalog.normalize(v_name, 'NFKC'))
  ) then
    raise exception 'Une catégorie porte déjà ce nom (elle est peut-être archivée).' using errcode = 'P0001';
  end if;

  if p_id is null then
    perform private.assert_reference_room((select count(*) from public.profession_categories x where x.org_id = v_org));
    insert into public.profession_categories (org_id, key, name, sort_order)
    values (v_org,
            private.unique_reference_key(private.reference_key(v_name),
              array(select x.key from public.profession_categories x where x.org_id = v_org)),
            v_name,
            coalesce((select max(x.sort_order) from public.profession_categories x where x.org_id = v_org), 0) + 10)
    returning id into v_id;
  else
    update public.profession_categories x set name = v_name
     where x.id = p_id and x.org_id = v_org
    returning x.id into v_id;
  end if;
  return v_id;
end;
$$;

-- A title's category must be active, and its order active or none (not regulated). A title may
-- keep the archived category or order it already has (renaming an archived title). Changing the
-- order does not touch existing licences: readiness flags the missing ones (4a.4). The feminine
-- and masculine forms are optional (blank: the name is shown, P4-340) and not unique: an epicene
-- title has the same word in both, and two titles may share a form.
create function public.save_profession_title(p_id uuid, p_name text, p_category_id uuid, p_order_id uuid,
                                             p_name_feminine text, p_name_masculine text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.lock_for_professionals_settings();
  v_name text := private.reference_text(p_name, 'Le nom', 120, true, true);
  v_feminine text := private.reference_text(p_name_feminine, 'La forme féminine', 120, false, true);
  v_masculine text := private.reference_text(p_name_masculine, 'La forme masculine', 120, false, true);
  v_current public.profession_titles;
  v_id uuid;
begin
  if p_category_id is null then
    raise exception 'Choisissez une catégorie.' using errcode = 'P0001';
  end if;
  if p_id is not null then
    select * into v_current from public.profession_titles x where x.id = p_id and x.org_id = v_org;
    if not found then
      raise exception 'Titre introuvable.' using errcode = 'P0001';
    end if;
  end if;
  if p_category_id is distinct from v_current.category_id and not exists (
    select 1 from public.profession_categories c where c.org_id = v_org and c.id = p_category_id and c.is_active
  ) then
    raise exception 'Catégorie introuvable ou archivée.' using errcode = 'P0001';
  end if;
  if p_order_id is not null and p_order_id is distinct from v_current.order_id and not exists (
    select 1 from public.professional_orders o where o.org_id = v_org and o.id = p_order_id and o.is_active
  ) then
    raise exception 'Ordre introuvable ou archivé.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.profession_titles x
     where x.org_id = v_org and x.id is distinct from p_id
       and pg_catalog.lower(pg_catalog.normalize(x.name, 'NFKC')) = pg_catalog.lower(pg_catalog.normalize(v_name, 'NFKC'))
  ) then
    raise exception 'Un titre porte déjà ce nom (il est peut-être archivé).' using errcode = 'P0001';
  end if;

  if p_id is null then
    perform private.assert_reference_room((select count(*) from public.profession_titles x where x.org_id = v_org));
    insert into public.profession_titles (org_id, key, name, name_feminine, name_masculine, category_id, order_id, sort_order)
    values (v_org,
            private.unique_reference_key(private.reference_key(v_name),
              array(select x.key from public.profession_titles x where x.org_id = v_org)),
            v_name, v_feminine, v_masculine, p_category_id, p_order_id,
            coalesce((select max(x.sort_order) from public.profession_titles x where x.org_id = v_org), 0) + 10)
    returning id into v_id;
  else
    update public.profession_titles x
       set name = v_name, name_feminine = v_feminine, name_masculine = v_masculine,
           category_id = p_category_id, order_id = p_order_id
     where x.id = p_id and x.org_id = v_org
    returning x.id into v_id;
  end if;
  return v_id;
end;
$$;

-- Ages are set as given (null = no bound): an age group has a minimum and maybe a maximum;
-- couples, families and groups have neither. System clientèles keep editable bounds (P4-42) but
-- not their kind, which matching relies on: an age group (min_age set) stays one, and a
-- clientèle seeded without bounds (couples, families, groups) gets none.
create function public.save_clientele(p_id uuid, p_name text, p_min_age int, p_max_age int)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.lock_for_professionals_settings();
  v_name text := private.reference_text(p_name, 'Le nom', 120, true, true);
  v_current public.clienteles;
  v_id uuid;
begin
  if p_min_age not between 0 and 120 or p_max_age not between 0 and 120 then
    raise exception 'Les âges vont de 0 à 120 ans.' using errcode = 'P0001';
  end if;
  if p_max_age is not null and p_min_age is null then
    raise exception 'Un âge maximum demande un âge minimum.' using errcode = 'P0001';
  end if;
  if p_max_age < p_min_age then
    raise exception 'L''âge maximum doit être supérieur ou égal à l''âge minimum.' using errcode = 'P0001';
  end if;
  if p_id is not null then
    select * into v_current from public.clienteles x where x.id = p_id and x.org_id = v_org;
    if not found then
      raise exception 'Clientèle introuvable.' using errcode = 'P0001';
    end if;
    if v_current.is_system and (v_current.min_age is null) <> (p_min_age is null) then
      raise exception 'Cette clientèle garde son type (groupe d''âge ou non).' using errcode = 'P0001';
    end if;
  end if;
  if exists (
    select 1 from public.clienteles x
     where x.org_id = v_org and x.id is distinct from p_id
       and pg_catalog.lower(pg_catalog.normalize(x.name, 'NFKC')) = pg_catalog.lower(pg_catalog.normalize(v_name, 'NFKC'))
  ) then
    raise exception 'Une clientèle porte déjà ce nom (elle est peut-être archivée).' using errcode = 'P0001';
  end if;

  if p_id is null then
    perform private.assert_reference_room((select count(*) from public.clienteles x where x.org_id = v_org));
    insert into public.clienteles (org_id, key, name, min_age, max_age, sort_order)
    values (v_org,
            private.unique_reference_key(private.reference_key(v_name),
              array(select x.key from public.clienteles x where x.org_id = v_org)),
            v_name, p_min_age, p_max_age,
            coalesce((select max(x.sort_order) from public.clienteles x where x.org_id = v_org), 0) + 10)
    returning id into v_id;
  else
    update public.clienteles x set name = v_name, min_age = p_min_age, max_age = p_max_age
     where x.id = p_id and x.org_id = v_org
    returning x.id into v_id;
  end if;
  return v_id;
end;
$$;

-- The description is set as given (blank clears it); a null icon keeps the current one (Brain
-- on create).
create function public.save_motif_category(p_id uuid, p_name text, p_description text, p_icon text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.lock_for_professionals_settings();
  v_name text := private.reference_text(p_name, 'Le nom', 120, true, true);
  v_description text := private.reference_text(p_description, 'La description', 300, false, true);
  v_id uuid;
begin
  -- Keep equal to motif_categories_icon_check (the 20 icons of the categories editor).
  if p_icon is not null and p_icon not in (
    'Brain', 'Users', 'AlertTriangle', 'Briefcase', 'GraduationCap', 'Fingerprint', 'Shield', 'Leaf', 'Heart', 'Activity',
    'Star', 'Zap', 'Cloud', 'Sun', 'Moon', 'Home', 'Target', 'Compass', 'Sparkles', 'MessageCircle'
  ) then
    raise exception 'Icône inconnue.' using errcode = 'P0001';
  end if;
  if p_id is not null and not exists (select 1 from public.motif_categories x where x.id = p_id and x.org_id = v_org) then
    raise exception 'Catégorie introuvable.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.motif_categories x
     where x.org_id = v_org and x.id is distinct from p_id
       and pg_catalog.lower(pg_catalog.normalize(x.name, 'NFKC')) = pg_catalog.lower(pg_catalog.normalize(v_name, 'NFKC'))
  ) then
    raise exception 'Une catégorie porte déjà ce nom (elle est peut-être archivée).' using errcode = 'P0001';
  end if;

  if p_id is null then
    perform private.assert_reference_room((select count(*) from public.motif_categories x where x.org_id = v_org));
    insert into public.motif_categories (org_id, key, name, description, icon, sort_order)
    values (v_org,
            private.unique_reference_key(private.reference_key(v_name),
              array(select x.key from public.motif_categories x where x.org_id = v_org)),
            v_name, v_description, coalesce(p_icon, 'Brain'),
            coalesce((select max(x.sort_order) from public.motif_categories x where x.org_id = v_org), 0) + 10)
    returning id into v_id;
  else
    update public.motif_categories x
       set name = v_name, description = v_description, icon = coalesce(p_icon, x.icon)
     where x.id = p_id and x.org_id = v_org
    returning x.id into v_id;
  end if;
  return v_id;
end;
$$;

-- The representative save RPC. p_category_id null: « Sans catégorie ». A new category must be active; a
-- motif may keep the archived category it has (its motifs then show under « Sans catégorie »).
create function public.save_motif(p_id uuid, p_name text, p_category_id uuid, p_is_restricted boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.lock_for_professionals_settings();
  v_name text := private.reference_text(p_name, 'Le nom', 120, true, true);
  v_current public.motifs;
  v_id uuid;
begin
  if p_id is not null then
    select * into v_current from public.motifs x where x.id = p_id and x.org_id = v_org;
    if not found then
      raise exception 'Motif introuvable.' using errcode = 'P0001';
    end if;
  end if;
  if p_category_id is not null and p_category_id is distinct from v_current.category_id and not exists (
    select 1 from public.motif_categories c where c.org_id = v_org and c.id = p_category_id and c.is_active
  ) then
    raise exception 'Catégorie introuvable ou archivée.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.motifs x
     where x.org_id = v_org and x.id is distinct from p_id
       and pg_catalog.lower(pg_catalog.normalize(x.name, 'NFKC')) = pg_catalog.lower(pg_catalog.normalize(v_name, 'NFKC'))
  ) then
    raise exception 'Un motif porte déjà ce nom (il est peut-être archivé).' using errcode = 'P0001';
  end if;

  if p_id is null then
    perform private.assert_reference_room((select count(*) from public.motifs x where x.org_id = v_org));
    insert into public.motifs (org_id, key, name, category_id, is_restricted, sort_order)
    values (v_org,
            private.unique_reference_key(private.reference_key(v_name),
              array(select x.key from public.motifs x where x.org_id = v_org)),
            v_name, p_category_id, coalesce(p_is_restricted, false),
            coalesce((select max(x.sort_order) from public.motifs x where x.org_id = v_org), 0) + 10)
    returning id into v_id;
  else
    update public.motifs x
       set name = v_name, category_id = p_category_id, is_restricted = coalesce(p_is_restricted, x.is_restricted)
     where x.id = p_id and x.org_id = v_org
    returning x.id into v_id;
  end if;
  return v_id;
end;
$$;

-- The ISO 639-1 code is the key: lower-cased and validated on create, never changed (an update
-- may resend the same code, in any case, or none).
create function public.save_language(p_id uuid, p_name text, p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.lock_for_professionals_settings();
  v_name text := private.reference_text(p_name, 'Le nom', 120, true, true);
  v_code text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_code, ''), E' \t\r\n')), '');
  v_current_code text;
  v_id uuid;
begin
  if p_id is null then
    if v_code is null or v_code !~ '^[a-z]{2}$' then
      raise exception 'Code de langue : deux lettres (ISO 639-1).' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.languages x where x.org_id = v_org and x.code = v_code) then
      raise exception 'Cette langue existe déjà.' using errcode = 'P0001';
    end if;
  else
    select x.code into v_current_code from public.languages x where x.id = p_id and x.org_id = v_org;
    if not found then
      raise exception 'Langue introuvable.' using errcode = 'P0001';
    end if;
    if v_code is distinct from v_current_code and v_code is not null then
      raise exception 'Le code d''une langue ne change pas.' using errcode = 'P0001';
    end if;
  end if;
  if exists (
    select 1 from public.languages x
     where x.org_id = v_org and x.id is distinct from p_id
       and pg_catalog.lower(pg_catalog.normalize(x.name, 'NFKC')) = pg_catalog.lower(pg_catalog.normalize(v_name, 'NFKC'))
  ) then
    raise exception 'Une langue porte déjà ce nom (elle est peut-être archivée).' using errcode = 'P0001';
  end if;

  if p_id is null then
    perform private.assert_reference_room((select count(*) from public.languages x where x.org_id = v_org));
    insert into public.languages (org_id, code, name, sort_order)
    values (v_org, v_code, v_name,
            coalesce((select max(x.sort_order) from public.languages x where x.org_id = v_org), 0) + 10)
    returning id into v_id;
  else
    update public.languages x set name = v_name
     where x.id = p_id and x.org_id = v_org
    returning x.id into v_id;
  end if;
  return v_id;
end;
$$;

-- A null flag keeps its value on update. The system reason « Autre » (key other) keeps
-- requires_note = true.
create function public.save_deactivation_reason(p_id uuid, p_name text, p_requires_note boolean, p_disables_account boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.lock_for_professionals_settings();
  v_name text := private.reference_text(p_name, 'Le nom', 120, true, true);
  v_current public.deactivation_reasons;
  v_id uuid;
begin
  if p_id is not null then
    select * into v_current from public.deactivation_reasons x where x.id = p_id and x.org_id = v_org;
    if not found then
      raise exception 'Raison introuvable.' using errcode = 'P0001';
    end if;
    -- The system reason « Autre » is pinned to requires_note: it says nothing without a note.
    if v_current.is_system and v_current.key = 'other' and not coalesce(p_requires_note, true) then
      raise exception 'La raison « Autre » demande toujours une note.' using errcode = 'P0001';
    end if;
  end if;
  if exists (
    select 1 from public.deactivation_reasons x
     where x.org_id = v_org and x.id is distinct from p_id
       and pg_catalog.lower(pg_catalog.normalize(x.name, 'NFKC')) = pg_catalog.lower(pg_catalog.normalize(v_name, 'NFKC'))
  ) then
    raise exception 'Une raison porte déjà ce nom (elle est peut-être archivée).' using errcode = 'P0001';
  end if;

  if p_id is null then
    perform private.assert_reference_room((select count(*) from public.deactivation_reasons x where x.org_id = v_org));
    insert into public.deactivation_reasons (org_id, key, name, requires_note, disables_account, sort_order)
    values (v_org,
            private.unique_reference_key(private.reference_key(v_name),
              array(select x.key from public.deactivation_reasons x where x.org_id = v_org)),
            v_name, coalesce(p_requires_note, false), coalesce(p_disables_account, false),
            coalesce((select max(x.sort_order) from public.deactivation_reasons x where x.org_id = v_org), 0) + 10)
    returning id into v_id;
  else
    update public.deactivation_reasons x
       set name = v_name,
           requires_note = coalesce(p_requires_note, x.requires_note),
           disables_account = coalesce(p_disables_account, x.disables_account)
     where x.id = p_id and x.org_id = v_org
    returning x.id into v_id;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Archive / restore. p_kind is the table name. Rules:
-- * is_system rows (the 5 system clientèles, French, the reason « Autre ») are never archived (P4-42);
-- * an order or a profession category is archived only once no active title uses it, so an
--   active title always has an active category and order; a title is restored only once both are;
-- * motifs, motif categories (their motifs show under « Sans catégorie »), titles: free.
-- A row already in the requested state is left untouched (no audit row, no updated_at bump).
-- -----------------------------------------------------------------------------
create function public.set_professionals_reference_active(p_kind text, p_id uuid, p_active boolean)
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
    else
      raise exception 'Liste inconnue : %', p_kind using errcode = '22023';
  end case;
  if v_system is null then   -- is_system is not null: no row of the clinic has this id
    raise exception 'Élément introuvable.' using errcode = 'P0001';
  end if;

  if not p_active then
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
  end case;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reorder: the given rows get sort_order 10, 20, 30… in the array's order; rows left out keep
-- theirs. Every id must be a row of the caller's clinic in that list, once (1 to 500 ids).
-- Only rows whose order changes are written: resending the current order writes nothing.
-- API contract: wherever the order is global (one sort_order across the whole list, active and
-- archived rows alike, as the catalogue sorts it: every list today), callers send the FULL list,
-- archived rows included, in its new order. Sending only the visible (active) rows would
-- renumber them from 10 over the archived rows' orders, which then collide or interleave.
-- -----------------------------------------------------------------------------
create function public.reorder_professionals_reference(p_kind text, p_ids uuid[])
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
  end case;
end;
$$;

-- -----------------------------------------------------------------------------
-- Catalogue: the eight lists of the caller's clinic in one payload (cached by the client, 5 min),
-- each in its sort order, archived rows included and flagged by is_active. Rows carry every
-- column but org_id, created_at and updated_at. Callers without a professionals key (or with the
-- module off) get eight empty lists, as the tables' policies would show them.
-- -----------------------------------------------------------------------------
create function public.get_professionals_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as materialized (
    -- The policies' predicate, evaluated once for the eight lists.
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
        from public.deactivation_reasons x join me on x.org_id = me.org_id), '[]'::jsonb)
  )
$$;

-- -----------------------------------------------------------------------------
-- Published catalogue views (other modules: Demandes). Active rows only; a motif whose category
-- is archived has no category (shown under « Sans catégorie »). security_invoker: the lists' RLS applies.
-- -----------------------------------------------------------------------------
create view public.motifs_catalog with (security_invoker = true) as
  select m.id, m.org_id, m.key, m.name, m.is_restricted, m.sort_order,
         c.id as category_id, c.key as category_key, c.name as category_name,
         c.sort_order as category_sort_order, c.icon as category_icon
    from public.motifs m
    left join public.motif_categories c
      on c.org_id = m.org_id and c.id = m.category_id and c.is_active
   where m.is_active;

create view public.clienteles_catalog with (security_invoker = true) as
  select c.id, c.org_id, c.key, c.name, c.min_age, c.max_age, c.sort_order
    from public.clienteles c
   where c.is_active;

create view public.languages_catalog with (security_invoker = true) as
  select l.id, l.org_id, l.code, l.name, l.sort_order
    from public.languages l
   where l.is_active;

revoke all on public.motifs_catalog, public.clienteles_catalog, public.languages_catalog from anon, authenticated;
grant select on public.motifs_catalog, public.clienteles_catalog, public.languages_catalog to authenticated;

-- -----------------------------------------------------------------------------
-- Module settings (org_module_settings, module professionals)
-- -----------------------------------------------------------------------------
-- Every known key with its default. Later batches (4b, 4c) create or replace this function to
-- add theirs, together with private.validate_professionals_setting (keep the two in step).
create function private.professionals_settings_defaults()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"collect_sin": false}'::jsonb
$$;

-- The clinic's effective settings: each known key, stored value else default.
create function private.professionals_settings(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_object_agg(d.key, coalesce(s.settings -> d.key, d.value)), '{}'::jsonb)
    from pg_catalog.jsonb_each(private.professionals_settings_defaults()) d
    left join public.org_module_settings s on s.org_id = p_org and s.module_key = 'professionals'
$$;

-- One effective setting, for module RPCs (set_professional_private reads collect_sin, 4a.17).
create function private.professionals_setting(p_org uuid, p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.professionals_settings(p_org) -> p_key
$$;

-- The rule of each known key: returns when p_value is valid for p_key, otherwise raises 22023
-- with a message naming the key and what it takes. An unknown key is refused. p_value is the
-- patch's JSON value (a JSON null is 'null'::jsonb; an SQL null is treated the same).
-- Later batches (4b, 4c) `create or replace` this function to add their keys, each with its own
-- `when` branch, and add the same keys to private.professionals_settings_defaults(). For
-- example 4b adds invitation_expiry_days (an integer from 1 to 30, never null) and
-- invitation_reminder_after_days (an integer from 1 to 29, or null: no reminder).
create function private.validate_professionals_setting(p_key text, p_value jsonb)
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
    else
      raise exception 'Réglage inconnu : %', coalesce(p_key, '(null)') using errcode = '22023';
  end case;
end;
$$;

revoke all on function
  private.professionals_settings_defaults(),
  private.professionals_settings(uuid),
  private.professionals_setting(uuid, text),
  private.validate_professionals_setting(text, jsonb)
from public, anon, authenticated, service_role;

create function public.get_professionals_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_read_professionals_reference() then
    raise exception 'Accès refusé aux réglages des professionnels.' using errcode = '42501';
  end if;
  return private.professionals_settings(private.current_user_org_id());
end;
$$;

-- Merges a patch of known keys, each value checked by private.validate_professionals_setting;
-- returns the effective settings. collect_sin also needs professionals.private: it opens the
-- collection of SINs (P4-7).
create function public.set_professionals_settings(p_patch jsonb)
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
-- Privileges (service_role: none, no edge function needs these yet)
-- -----------------------------------------------------------------------------
revoke all on function
  public.save_professional_order(uuid, text, text, text, text),
  public.save_profession_category(uuid, text),
  public.save_profession_title(uuid, text, uuid, uuid, text, text),
  public.save_clientele(uuid, text, int, int),
  public.save_motif_category(uuid, text, text, text),
  public.save_motif(uuid, text, uuid, boolean),
  public.save_language(uuid, text, text),
  public.save_deactivation_reason(uuid, text, boolean, boolean),
  public.set_professionals_reference_active(text, uuid, boolean),
  public.reorder_professionals_reference(text, uuid[]),
  public.get_professionals_catalog(),
  public.get_professionals_settings(),
  public.set_professionals_settings(jsonb)
from public, anon, authenticated;
grant execute on function
  public.save_professional_order(uuid, text, text, text, text),
  public.save_profession_category(uuid, text),
  public.save_profession_title(uuid, text, uuid, uuid, text, text),
  public.save_clientele(uuid, text, int, int),
  public.save_motif_category(uuid, text, text, text),
  public.save_motif(uuid, text, uuid, boolean),
  public.save_language(uuid, text, text),
  public.save_deactivation_reason(uuid, text, boolean, boolean),
  public.set_professionals_reference_active(text, uuid, boolean),
  public.reorder_professionals_reference(text, uuid[]),
  public.get_professionals_catalog(),
  public.get_professionals_settings(),
  public.set_professionals_settings(jsonb)
to authenticated;
