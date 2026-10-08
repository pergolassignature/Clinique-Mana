-- =============================================================================
-- Professionnels: permissions and per-clinic reference lists
-- =============================================================================
-- Design:  docs/plans/2026-10-08-professionals-module-design.md §3.1–3.2, §4
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4a.1 (P4-6, P4-28, P4-31, P4-32, P4-40, P4-42, P4-51)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Lists are per clinic, seeded by a trigger on organizations (like tax_rates)
--   and for existing clinics below. Keys are ASCII snake_case and frozen by a
--   trigger, like org_id (seeded rows keep their legacy keys, P4-31). Names are
--   French and editable.
-- * Soft delete only (is_active). is_system rows (clientèles, French, « Autre »)
--   cannot be archived: matching and creation rely on them (P4-42; enforced by
--   the settings RPCs of the next migration, the only writers).
-- * Read by anyone holding a professionals key: staff with view or any other staff
--   key (manage, matching, settings… by default or by override), providers with
--   self. Written only through the settings RPCs of the next migration. Each policy
--   keeps a permission term, so disabling the module hides every list.
-- * unique (org_id, id) on every list: rows that reference them use composite
--   FKs, so a row can never point at another clinic's list (P4-40).
-- * Names: no leading or trailing whitespace, no control or invisible character
--   (private.is_tidy_text), unique per clinic compared as lower(normalize(name, NFKC)),
--   like roles (core_editable_roles): two names that look the same are the same name.
-- * Seeded content is legacy-v1 (P4-21): the 72 motifs and 8 « sphères de vie »
--   categories, the 10 therapy_type approaches, the 8 legacy titles plus
--   « Nutritionniste » (P4-6). Legacy-archived rows are left out (D7, P4-28).
--   Motif and category labels are reworded in non-clinical terms and five legacy
--   typos fixed (P4-51); keys are unchanged, so the import maps them as before.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_reference_data', true);

-- -----------------------------------------------------------------------------
-- Permissions (4a keys) and role defaults (template; decision #40 propagates them)
-- -----------------------------------------------------------------------------
insert into public.permissions (key, module_key, description) values
  ('professionals.manage',            'professionals', 'Gérer les dossiers des professionnels'),
  ('professionals.matching',          'professionals', 'Modifier le profil de jumelage'),
  ('professionals.activate_override', 'professionals', 'Activer un dossier incomplet (avec une raison)'),
  ('professionals.settings',          'professionals', 'Modifier les listes du module Professionnels'),
  ('professionals.compensation',      'professionals', 'Voir et modifier la rémunération'),
  ('professionals.private',           'professionals', 'Voir et modifier les renseignements fiscaux et bancaires'),
  ('professionals.self',              'professionals', 'Accéder à son propre dossier')
on conflict do nothing;

-- The Task 2.20 trigger (role_permissions_propagate) copies each new template row into every
-- existing org's org_role_permissions; new orgs copy the whole template.
insert into public.role_permissions (role, permission_key) values
  ('admin', 'professionals.manage'), ('admin', 'professionals.matching'),
  ('admin', 'professionals.activate_override'), ('admin', 'professionals.settings'),
  ('admin', 'professionals.compensation'), ('admin', 'professionals.private'),
  ('admin', 'professionals.self'),
  ('admin_assistant', 'professionals.manage'), ('admin_assistant', 'professionals.matching'),
  ('counselor', 'professionals.matching'),
  ('provider', 'professionals.self')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Read access to the lists (one helper for the nine policies)
-- -----------------------------------------------------------------------------
-- One evaluation of the caller's permissions (current_permission_keys applies the module gate
-- and drops disabled users). Any professionals key reads the lists: view, or another staff key
-- a person may hold without view (by override), or self for providers. A later professionals
-- key whose holders need the lists is added to this array.
create function private.can_read_professionals_reference()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_permission_keys() && array[
    'professionals.view', 'professionals.manage', 'professionals.matching', 'professionals.activate_override',
    'professionals.settings', 'professionals.compensation', 'professionals.private', 'professionals.self'
  ]::text[]
$$;
revoke all on function private.can_read_professionals_reference() from public, anon;
grant execute on function private.can_read_professionals_reference() to authenticated;

-- -----------------------------------------------------------------------------
-- Labels (names, licence labels and patterns, descriptions)
-- -----------------------------------------------------------------------------
-- True unless the text starts or ends with Unicode whitespace or holds a control or invisible
-- character, so two labels that look the same compare equal under the NFKC unique indexes.
-- Null stays null (an optional column passes). The two classes are those of
-- core_editable_roles: Unicode White_Space with U+0020 (valid_role_name's v_ws) and
-- roles_name_no_control_chars, written as escapes; keep them equal. Inner whitespace is
-- allowed: NFKC folds no-break spaces to U+0020 for the comparison.
create function private.is_tidy_text(p_value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_value !~ '^[\t\n\v\f\r \u0085   -     　]|[\t\n\v\f\r \u0085   -     　]$'
     and p_value !~ '[[:cntrl:]\u0080-\u009F­͏؜ᅟᅠ᠎​-‏ - ⁠-⁤⁦-⁯ㅤ︀-️﻿ﾠ\U000E0000-\U000E007F]'
$$;
-- Check constraints run it with the writer's privileges: harmless, so any role that may write.
revoke all on function private.is_tidy_text(text) from public, anon;
grant execute on function private.is_tidy_text(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- professional_orders: the professional orders (licensing bodies)
-- -----------------------------------------------------------------------------
create table public.professional_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  acronym text not null,
  licence_label text not null default 'N° de permis',
  -- Validated as a regular expression by save_professional_order (next migration).
  licence_pattern text,
  is_system boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_orders_key_check check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint professional_orders_name_check check (char_length(name) between 1 and 120 and private.is_tidy_text(name)),
  constraint professional_orders_acronym_check check (acronym ~ '^[A-Z]{2,10}$'),
  constraint professional_orders_licence_label_check check (char_length(licence_label) between 1 and 60 and private.is_tidy_text(licence_label)),
  constraint professional_orders_licence_pattern_check check (char_length(licence_pattern) between 1 and 200 and private.is_tidy_text(licence_pattern)),
  constraint professional_orders_org_id_key_key unique (org_id, key),
  constraint professional_orders_org_id_id_key unique (org_id, id)
);
create unique index professional_orders_org_name_key on public.professional_orders (org_id, lower(normalize(name, NFKC)));
create index professional_orders_org_sort_idx on public.professional_orders (org_id, sort_order);

-- -----------------------------------------------------------------------------
-- profession_categories: groups of titles (Services et tarifs prices by category)
-- -----------------------------------------------------------------------------
create table public.profession_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  is_system boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profession_categories_key_check check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint profession_categories_name_check check (char_length(name) between 1 and 120 and private.is_tidy_text(name)),
  constraint profession_categories_org_id_key_key unique (org_id, key),
  constraint profession_categories_org_id_id_key unique (org_id, id)
);
create unique index profession_categories_org_name_key on public.profession_categories (org_id, lower(normalize(name, NFKC)));
create index profession_categories_org_sort_idx on public.profession_categories (org_id, sort_order);

-- -----------------------------------------------------------------------------
-- profession_titles: a title belongs to a category and, when regulated, to an order
-- -----------------------------------------------------------------------------
create table public.profession_titles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  category_id uuid not null,
  order_id uuid,                          -- null: not regulated, no licence required
  is_system boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profession_titles_key_check check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint profession_titles_name_check check (char_length(name) between 1 and 120 and private.is_tidy_text(name)),
  constraint profession_titles_org_id_key_key unique (org_id, key),
  constraint profession_titles_org_id_id_key unique (org_id, id),
  constraint profession_titles_category_fkey foreign key (org_id, category_id) references public.profession_categories (org_id, id),
  constraint profession_titles_order_fkey foreign key (org_id, order_id) references public.professional_orders (org_id, id)
);
create unique index profession_titles_org_name_key on public.profession_titles (org_id, lower(normalize(name, NFKC)));
create index profession_titles_org_sort_idx on public.profession_titles (org_id, sort_order);
create index profession_titles_org_category_idx on public.profession_titles (org_id, category_id);
create index profession_titles_org_order_idx on public.profession_titles (org_id, order_id);

-- -----------------------------------------------------------------------------
-- clienteles: the age groups and formats matching filters on (hard filter, P4-3)
-- -----------------------------------------------------------------------------
create table public.clienteles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  min_age smallint,                       -- null with max_age null: not an age group (couples, families, groups)
  max_age smallint,                       -- null with min_age set: no upper bound (seniors)
  is_system boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clienteles_key_check check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint clienteles_name_check check (char_length(name) between 1 and 120 and private.is_tidy_text(name)),
  constraint clienteles_min_age_check check (min_age between 0 and 120),
  -- An upper bound needs a lower one and is not below it.
  constraint clienteles_max_age_check check (max_age is null or (min_age is not null and max_age between min_age and 120)),
  constraint clienteles_org_id_key_key unique (org_id, key),
  constraint clienteles_org_id_id_key unique (org_id, id)
);
create unique index clienteles_org_name_key on public.clienteles (org_id, lower(normalize(name, NFKC)));
create index clienteles_org_sort_idx on public.clienteles (org_id, sort_order);

-- -----------------------------------------------------------------------------
-- specialties: therapeutic approaches (soft scoring in matching)
-- -----------------------------------------------------------------------------
create table public.specialties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  is_system boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint specialties_key_check check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint specialties_name_check check (char_length(name) between 1 and 120 and private.is_tidy_text(name)),
  constraint specialties_org_id_key_key unique (org_id, key),
  constraint specialties_org_id_id_key unique (org_id, id)
);
create unique index specialties_org_name_key on public.specialties (org_id, lower(normalize(name, NFKC)));
create index specialties_org_sort_idx on public.specialties (org_id, sort_order);

-- -----------------------------------------------------------------------------
-- motif_categories: display groups of motifs (« sphères de vie »)
-- -----------------------------------------------------------------------------
create table public.motif_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  icon text not null default 'Brain',
  is_system boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint motif_categories_key_check check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint motif_categories_name_check check (char_length(name) between 1 and 120 and private.is_tidy_text(name)),
  constraint motif_categories_description_check check (char_length(description) between 1 and 300 and private.is_tidy_text(description)),
  -- The 20 Lucide icons of the categories editor (legacy category-editor-dialog.tsx).
  constraint motif_categories_icon_check check (icon in (
    'Brain', 'Users', 'AlertTriangle', 'Briefcase', 'GraduationCap', 'Fingerprint', 'Shield', 'Leaf', 'Heart', 'Activity',
    'Star', 'Zap', 'Cloud', 'Sun', 'Moon', 'Home', 'Target', 'Compass', 'Sparkles', 'MessageCircle')),
  constraint motif_categories_org_id_key_key unique (org_id, key),
  constraint motif_categories_org_id_id_key unique (org_id, id)
);
create unique index motif_categories_org_name_key on public.motif_categories (org_id, lower(normalize(name, NFKC)));
create index motif_categories_org_sort_idx on public.motif_categories (org_id, sort_order);

-- -----------------------------------------------------------------------------
-- motifs: consultation motifs (orientation tags, never diagnoses)
-- -----------------------------------------------------------------------------
create table public.motifs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  category_id uuid,                       -- null, or an archived category: shown under « Autres »
  is_restricted boolean not null default false,   -- needs a regulated profession (P4-16)
  is_system boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint motifs_key_check check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint motifs_name_check check (char_length(name) between 1 and 120 and private.is_tidy_text(name)),
  constraint motifs_org_id_key_key unique (org_id, key),
  constraint motifs_org_id_id_key unique (org_id, id),
  constraint motifs_category_fkey foreign key (org_id, category_id) references public.motif_categories (org_id, id)
);
create unique index motifs_org_name_key on public.motifs (org_id, lower(normalize(name, NFKC)));
create index motifs_org_category_idx on public.motifs (org_id, category_id);
create index motifs_org_sort_idx on public.motifs (org_id, sort_order);

-- -----------------------------------------------------------------------------
-- languages: languages of service; the ISO 639-1 code is the key
-- -----------------------------------------------------------------------------
create table public.languages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  is_system boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint languages_code_check check (code ~ '^[a-z]{2}$'),
  constraint languages_name_check check (char_length(name) between 1 and 120 and private.is_tidy_text(name)),
  constraint languages_org_id_code_key unique (org_id, code),
  constraint languages_org_id_id_key unique (org_id, id)
);
create unique index languages_org_name_key on public.languages (org_id, lower(normalize(name, NFKC)));
create index languages_org_sort_idx on public.languages (org_id, sort_order);

-- -----------------------------------------------------------------------------
-- deactivation_reasons: why a professional's file was deactivated
-- -----------------------------------------------------------------------------
create table public.deactivation_reasons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  requires_note boolean not null default false,
  disables_account boolean not null default false,   -- also disables the provider's login (P4-11)
  is_system boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deactivation_reasons_key_check check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint deactivation_reasons_name_check check (char_length(name) between 1 and 120 and private.is_tidy_text(name)),
  constraint deactivation_reasons_org_id_key_key unique (org_id, key),
  constraint deactivation_reasons_org_id_id_key unique (org_id, id)
);
create unique index deactivation_reasons_org_name_key on public.deactivation_reasons (org_id, lower(normalize(name, NFKC)));
create index deactivation_reasons_org_sort_idx on public.deactivation_reasons (org_id, sort_order);

-- -----------------------------------------------------------------------------
-- Privileges, RLS, triggers (same block for the nine lists)
-- -----------------------------------------------------------------------------
revoke all on public.professional_orders, public.profession_categories, public.profession_titles,
              public.clienteles, public.specialties, public.motif_categories, public.motifs,
              public.languages, public.deactivation_reasons
  from anon, authenticated;
grant select on public.professional_orders, public.profession_categories, public.profession_titles,
                public.clienteles, public.specialties, public.motif_categories, public.motifs,
                public.languages, public.deactivation_reasons
  to authenticated;

alter table public.professional_orders enable row level security;
alter table public.profession_categories enable row level security;
alter table public.profession_titles enable row level security;
alter table public.clienteles enable row level security;
alter table public.specialties enable row level security;
alter table public.motif_categories enable row level security;
alter table public.motifs enable row level security;
alter table public.languages enable row level security;
alter table public.deactivation_reasons enable row level security;

create policy professional_orders_select on public.professional_orders
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.can_read_professionals_reference()));
create policy profession_categories_select on public.profession_categories
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.can_read_professionals_reference()));
create policy profession_titles_select on public.profession_titles
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.can_read_professionals_reference()));
create policy clienteles_select on public.clienteles
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.can_read_professionals_reference()));
create policy specialties_select on public.specialties
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.can_read_professionals_reference()));
create policy motif_categories_select on public.motif_categories
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.can_read_professionals_reference()));
create policy motifs_select on public.motifs
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.can_read_professionals_reference()));
create policy languages_select on public.languages
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.can_read_professionals_reference()));
create policy deactivation_reasons_select on public.deactivation_reasons
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.can_read_professionals_reference()));

-- A row's identity never changes: its key (code for languages) is what imports, matching and
-- the settings RPCs refer to, and its org scopes it. Like private.roles_freeze_identity; one
-- function for the nine tables (a table without key or code reads null on both sides).
create function private.freeze_reference_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := pg_catalog.to_jsonb(new);
  v_old jsonb := pg_catalog.to_jsonb(old);
begin
  if v_new -> 'org_id' is distinct from v_old -> 'org_id'
     or v_new -> 'key' is distinct from v_old -> 'key'
     or v_new -> 'code' is distinct from v_old -> 'code' then
    raise exception 'La clé et la clinique d''un élément de liste ne changent pas : %',
      coalesce(v_old ->> 'key', v_old ->> 'code')
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.freeze_reference_identity() from public, anon, authenticated, service_role;

create trigger professional_orders_freeze_identity before update on public.professional_orders
  for each row execute function private.freeze_reference_identity();
create trigger profession_categories_freeze_identity before update on public.profession_categories
  for each row execute function private.freeze_reference_identity();
create trigger profession_titles_freeze_identity before update on public.profession_titles
  for each row execute function private.freeze_reference_identity();
create trigger clienteles_freeze_identity before update on public.clienteles
  for each row execute function private.freeze_reference_identity();
create trigger specialties_freeze_identity before update on public.specialties
  for each row execute function private.freeze_reference_identity();
create trigger motif_categories_freeze_identity before update on public.motif_categories
  for each row execute function private.freeze_reference_identity();
create trigger motifs_freeze_identity before update on public.motifs
  for each row execute function private.freeze_reference_identity();
create trigger languages_freeze_identity before update on public.languages
  for each row execute function private.freeze_reference_identity();
create trigger deactivation_reasons_freeze_identity before update on public.deactivation_reasons
  for each row execute function private.freeze_reference_identity();

create trigger professional_orders_set_updated_at before update on public.professional_orders
  for each row execute function private.set_updated_at();
create trigger professional_orders_audit after insert or update or delete on public.professional_orders
  for each row execute function private.audit_trigger();
create trigger profession_categories_set_updated_at before update on public.profession_categories
  for each row execute function private.set_updated_at();
create trigger profession_categories_audit after insert or update or delete on public.profession_categories
  for each row execute function private.audit_trigger();
create trigger profession_titles_set_updated_at before update on public.profession_titles
  for each row execute function private.set_updated_at();
create trigger profession_titles_audit after insert or update or delete on public.profession_titles
  for each row execute function private.audit_trigger();
create trigger clienteles_set_updated_at before update on public.clienteles
  for each row execute function private.set_updated_at();
create trigger clienteles_audit after insert or update or delete on public.clienteles
  for each row execute function private.audit_trigger();
create trigger specialties_set_updated_at before update on public.specialties
  for each row execute function private.set_updated_at();
create trigger specialties_audit after insert or update or delete on public.specialties
  for each row execute function private.audit_trigger();
create trigger motif_categories_set_updated_at before update on public.motif_categories
  for each row execute function private.set_updated_at();
create trigger motif_categories_audit after insert or update or delete on public.motif_categories
  for each row execute function private.audit_trigger();
create trigger motifs_set_updated_at before update on public.motifs
  for each row execute function private.set_updated_at();
create trigger motifs_audit after insert or update or delete on public.motifs
  for each row execute function private.audit_trigger();
create trigger languages_set_updated_at before update on public.languages
  for each row execute function private.set_updated_at();
create trigger languages_audit after insert or update or delete on public.languages
  for each row execute function private.audit_trigger();
create trigger deactivation_reasons_set_updated_at before update on public.deactivation_reasons
  for each row execute function private.set_updated_at();
create trigger deactivation_reasons_audit after insert or update or delete on public.deactivation_reasons
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- Seeding: one function, called by a trigger on new organizations and once below
-- for existing ones. Idempotent (on conflict do nothing): a clinic's edits, renames
-- and archives are never undone, and a row the clinic already holds is not re-added.
-- A seeded row whose key is absent but whose name (compared like the unique indexes,
-- lower(normalize(…, NFKC))) is already taken by another row is not added: that row
-- stands for it, and titles and motifs attach to it: a title is never skipped and a
-- motif never loses its category because the clinic holds a seeded order or category
-- under another key (e.g. one it created before a reseed).
-- -----------------------------------------------------------------------------
create function private.seed_professionals_reference(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  -- Seeded key → id of the clinic's row that stands for it (same key, else same name).
  v_orders jsonb := '{}';
  v_categories jsonb := '{}';
  v_motif_categories jsonb := '{}';
  r record;
  v_id uuid;
begin
  perform pg_catalog.set_config('app.audit_source', 'seed:professionals_reference', true);

  for r in
    select * from (values
      ('opq',     'Ordre des psychologues du Québec', 'OPQ', 10),
      ('otstcfq', 'Ordre des travailleurs sociaux et des thérapeutes conjugaux et familiaux du Québec', 'OTSTCFQ', 20),
      ('oppq',    'Ordre des psychoéducateurs et psychoéducatrices du Québec', 'OPPQ', 30),
      ('opsq',    'Ordre professionnel des sexologues du Québec', 'OPSQ', 40),
      ('occoq',   'Ordre des conseillers et conseillères d''orientation du Québec', 'OCCOQ', 50),
      ('odnq',    'Ordre des diététistes-nutritionnistes du Québec', 'ODNQ', 60)
    ) as v(key, name, acronym, sort_order)
  loop
    insert into public.professional_orders (org_id, key, name, acronym, sort_order)
    values (p_org, r.key, r.name, r.acronym, r.sort_order)
    on conflict do nothing;
    select x.id into v_id from public.professional_orders x
     where x.org_id = p_org
       and (x.key = r.key
            or pg_catalog.lower(pg_catalog.normalize(x.name, 'NFKC')) = pg_catalog.lower(pg_catalog.normalize(r.name, 'NFKC')))
     order by x.key = r.key desc
     limit 1;
    v_orders := v_orders || pg_catalog.jsonb_build_object(r.key, v_id);
  end loop;

  for r in
    select * from (values
      ('psychologie', 'Psychologie', 10), ('psychotherapie', 'Psychothérapie', 20),
      ('travail_social', 'Travail social', 30), ('psychoeducation', 'Psychoéducation', 40),
      ('sexologie', 'Sexologie', 50), ('naturopathie', 'Naturopathie', 60),
      ('orientation', 'Orientation', 70), ('coaching_professionnel', 'Coaching professionnel', 80),
      ('nutrition', 'Nutrition', 90)
    ) as v(key, name, sort_order)
  loop
    insert into public.profession_categories (org_id, key, name, sort_order)
    values (p_org, r.key, r.name, r.sort_order)
    on conflict do nothing;
    select x.id into v_id from public.profession_categories x
     where x.org_id = p_org
       and (x.key = r.key
            or pg_catalog.lower(pg_catalog.normalize(x.name, 'NFKC')) = pg_catalog.lower(pg_catalog.normalize(r.name, 'NFKC')))
     order by x.key = r.key desc
     limit 1;
    v_categories := v_categories || pg_catalog.jsonb_build_object(r.key, v_id);
  end loop;

  -- The 8 legacy titles plus « Nutritionniste » (P4-6); naturopathe and coach belong to no order.
  insert into public.profession_titles (org_id, key, name, category_id, order_id, sort_order)
  select p_org, t.key, t.name, (v_categories ->> t.category_key)::uuid, (v_orders ->> t.order_key)::uuid, t.sort_order
    from (values
      ('psychologue',            'Psychologue',                       'psychologie',            'opq',     10),
      ('psychotherapeute',       'Psychothérapeute',                  'psychotherapie',         'opq',     20),
      ('travailleur_social',     'Travailleur.euse social.e',         'travail_social',         'otstcfq', 30),
      ('psychoeducateur',        'Psychoéducateur.trice',             'psychoeducation',        'oppq',    40),
      ('sexologue',              'Sexologue',                         'sexologie',              'opsq',    50),
      ('naturopathe',            'Naturopathe',                       'naturopathie',           null,      60),
      ('conseiller_orientation', 'Conseiller.ère en orientation',     'orientation',            'occoq',   70),
      ('coach_professionnel',    'Coach professionnel.le certifié.e', 'coaching_professionnel', null,      80),
      ('nutritionniste',         'Nutritionniste',                    'nutrition',              'odnq',    90)
    ) as t(key, name, category_key, order_key, sort_order)
  on conflict do nothing;

  -- Keys matching relies on (P4-42); lgbtq, indigenous and newcomers are not re-seeded (D7).
  insert into public.clienteles (org_id, key, name, min_age, max_age, is_system, sort_order) values
    (p_org, 'children', 'Enfants', 0, 12, true, 10), (p_org, 'adolescents', 'Adolescents', 13, 17, true, 20),
    (p_org, 'adults', 'Adultes', 18, 64, true, 30), (p_org, 'seniors', 'Aînés', 65, null, true, 40),
    (p_org, 'couples', 'Couples', null, null, true, 50), (p_org, 'families', 'Familles', null, null, true, 60),
    (p_org, 'groups', 'Groupes', null, null, true, 70)
  on conflict do nothing;

  -- Approaches: the legacy therapy_type rows, keys and names unchanged
  -- (_legacy/supabase/migrations/20260118000003_professionals_schema.sql, lines 352–361).
  insert into public.specialties (org_id, key, name, sort_order) values
    (p_org, 'cbt', 'Thérapie cognitivo-comportementale (TCC)', 10), (p_org, 'psychodynamic', 'Thérapie psychodynamique', 20),
    (p_org, 'humanistic', 'Approche humaniste', 30), (p_org, 'systemic', 'Thérapie systémique', 40),
    (p_org, 'gestalt', 'Gestalt-thérapie', 50), (p_org, 'emdr', 'EMDR', 60),
    (p_org, 'act', 'Thérapie d''acceptation et d''engagement (ACT)', 70),
    (p_org, 'dbt', 'Thérapie comportementale dialectique (DBT)', 80),
    (p_org, 'art_therapy', 'Art-thérapie', 90), (p_org, 'play_therapy', 'Thérapie par le jeu', 100)
  on conflict do nothing;

  -- Motif categories: legacy 20260127000002_motif_categories_seed.sql (keys, names, icons;
  -- display_order 1–8 becomes sort_order 10–80); three descriptions reworded (P4-51).
  for r in
    select * from (values
      ('inner_life',    'Vie intérieure',       'Anxiété, dépression, estime de soi et bien-être émotionnel', 'Brain',         10),
      ('relationships', 'Relations et famille', 'Relations amoureuses, familiales et interpersonnelles',      'Users',         20),
      ('dependencies',  'Dépendances',          'Dépendances comportementales et substances',                 'AlertTriangle', 30),
      ('work',          'Vie professionnelle',  'Carrière, épuisement et difficultés au travail',             'Briefcase',     40),
      ('development',   'Développement',        'Apprentissage, attention et développement',                  'GraduationCap', 50),
      ('identity',      'Identité',             'Genre, orientation sexuelle et identité personnelle',        'Fingerprint',   60),
      ('trauma',        'Trauma',               'Abus, violence et expériences traumatiques',                 'Shield',        70),
      ('life_changes',  'Changements de vie',   'Deuil, santé et transitions de vie',                         'Leaf',          80)
    ) as v(key, name, description, icon, sort_order)
  loop
    insert into public.motif_categories (org_id, key, name, description, icon, sort_order)
    values (p_org, r.key, r.name, r.description, r.icon, r.sort_order)
    on conflict do nothing;
    select x.id into v_id from public.motif_categories x
     where x.org_id = p_org
       and (x.key = r.key
            or pg_catalog.lower(pg_catalog.normalize(x.name, 'NFKC')) = pg_catalog.lower(pg_catalog.normalize(r.name, 'NFKC')))
     order by x.key = r.key desc
     limit 1;
    v_motif_categories := v_motif_categories || pg_catalog.jsonb_build_object(r.key, v_id);
  end loop;

  -- Motifs: the 72 keys of legacy 20260118000008_motifs_seed.sql (P4-21) with the category of
  -- 20260127000003_motif_category_assignments.sql (every motif has one). Names as there, except
  -- the non-clinical rewordings and typo fixes of P4-51. sort_order = 10 × the row's rank by
  -- name (accents and case ignored).
  insert into public.motifs (org_id, key, name, category_id, sort_order)
  select p_org, m.key, m.name, (v_motif_categories ->> m.category_key)::uuid, m.sort_order
    from (values
      ('abus_sexuel',                           'Abus sexuel',                                                'trauma',         10),
      ('accumulation_compulsive',               'Accumulation compulsive',                                    'inner_life',     20),
      ('adoption',                              'Adoption',                                                   'relationships',  30),
      ('anxiete',                               'Anxiété',                                                    'inner_life',     40),
      ('automutilation',                        'Automutilation',                                             'inner_life',     50),
      ('trouble_bipolaire',                     'Bipolarité',                                                 'inner_life',     60),
      ('comportement_sexuels_abusif',           'Comportements sexuels abusifs',                              'trauma',         70),
      ('consommation_alcool',                   'Consommation d''alcool',                                     'dependencies',   80),
      ('consommation_drogue',                   'Consommation de drogue',                                     'dependencies',   90),
      ('cyberdependance',                       'Cyberdépendance',                                            'dependencies',  100),
      ('deficience_intellectuelle',             'Déficience intellectuelle',                                  'development',   110),
      ('deficit_attention_hyperactivite',       'Déficit de l''attention / hyperactivité (TDA, TDAH)',        'development',   120),
      ('dependance',                            'Dépendance',                                                 'dependencies',  130),
      ('dependance_affective',                  'Dépendance affective',                                       'relationships', 140),
      ('dependance_jeu',                        'Dépendance au jeu',                                          'dependencies',  150),
      ('dependance_medicament',                 'Dépendance au médicament',                                   'dependencies',  160),
      ('dependance_travail',                    'Dépendance au travail',                                      'dependencies',  170),
      ('dependance_jeux_video',                 'Dépendance aux jeux vidéo',                                  'dependencies',  180),
      ('dependance_sexuelle',                   'Dépendance sexuelle',                                        'dependencies',  190),
      ('depression',                            'Dépression',                                                 'inner_life',    200),
      ('deuil',                                 'Deuil',                                                      'life_changes',  210),
      ('difficultes_apprentissage',             'Difficultés d''apprentissage',                               'development',   220),
      ('difficultes_comportement',              'Difficultés de comportement',                                'development',   230),
      ('trouble_conduites',                     'Difficultés de conduite',                                    'development',   240),
      ('difficultes_language',                  'Difficultés de langage',                                     'development',   250),
      ('trouble_sommeil',                       'Difficultés de sommeil',                                     'inner_life',    260),
      ('difficultes_professionnelles',          'Difficultés professionnelles',                               'work',          270),
      ('dysfonctions_sexuelle',                 'Difficultés sexuelles',                                      'identity',      280),
      ('douance',                               'Douance',                                                    'development',   290),
      ('dyslexie',                              'Dyslexie',                                                   'development',   300),
      ('epuisement_professionnel',              'Épuisement professionnel',                                   'work',          310),
      ('estime_de_soi',                         'Estime de soi',                                              'inner_life',    320),
      ('famille_recomposee',                    'Famille recomposée',                                         'relationships', 330),
      ('gestion_colere',                        'Gestion de la colère',                                       'inner_life',    340),
      ('grossesse_prenatal_post_partum',        'Grossesse, Prénatal, Post-partum',                           'relationships', 350),
      ('guerre_conflit_arme_veterans',          'Guerre / Conflit armé (Vétérans)',                           'trauma',        360),
      ('guerre_conflit_arme_victimes_civiles',  'Guerre / Conflit armé (Victimes civiles)',                   'trauma',        370),
      ('idees_suicidaires',                     'Idées suicidaires',                                          'inner_life',    380),
      ('identite_genre',                        'Identité de genre',                                          'identity',      390),
      ('identite_orientation_sexuelle',         'Identité et Orientation sexuelle',                           'identity',      400),
      ('identite_raciale',                      'Identité raciale',                                           'identity',      410),
      ('infertilite',                           'Infertilité',                                                'relationships', 420),
      ('infidelite',                            'Infidélité',                                                 'relationships', 430),
      ('insomnie',                              'Insomnie',                                                   'inner_life',    440),
      ('intimidation',                          'Intimidation',                                               'relationships', 450),
      ('maladies_degeneratives',                'Maladies dégénératives',                                     'life_changes',  460),
      ('monoparentalite',                       'Monoparentalité',                                            'relationships', 470),
      ('trouble_obsessionnel_compulsif',        'Obsessions et compulsions (TOC)',                            'inner_life',    480),
      ('trouble_oppositionnel_provocation',     'Opposition et provocation (TOP)',                            'development',   490),
      ('orientation_professionnelle',           'Orientation professionnelle',                                'work',          500),
      ('trouble_personnalite_limite',           'Personnalité limite (TPL)',                                  'inner_life',    510),
      ('problemes_financiers',                  'Problèmes financiers',                                       'work',          520),
      ('psychose',                              'Psychose',                                                   'inner_life',    530),
      ('readaptation_professionnelle',          'Réadaptation professionnelle',                               'work',          540),
      ('troubles_alimentaires',                 'Relation à l''alimentation',                                 'dependencies',  550),
      ('relations_amoureuses',                  'Relations amoureuses',                                       'relationships', 560),
      ('relations_familiales',                  'Relations familiales',                                       'relationships', 570),
      ('relations_interpersonnelles',           'Relations interpersonnelles',                                'relationships', 580),
      ('retard_developpement',                  'Retard de développement',                                    'development',   590),
      ('retard_global_developpement',           'Retard global de développement (RGD)',                       'development',   600),
      ('separation_divorce',                    'Séparation, Divorce',                                        'relationships', 610),
      ('sexualite',                             'Sexualité',                                                  'identity',      620),
      ('situations_crises',                     'Situations de crise',                                        'inner_life',    630),
      ('trouble_spectre_autisme',               'Spectre de l''autisme (TSA)',                                'development',   640),
      ('syndrome_gilles_tourette',              'Syndrome de Gilles de la Tourette',                          'development',   650),
      ('trouble_personnalite_narcissique',      'Traits narcissiques',                                        'inner_life',    660),
      ('transsexualite',                        'Transidentité',                                              'identity',      670),
      ('traumatisme_cranio_cerebral',           'Traumatisme cranio-cérébral (TCC)',                          'trauma',        680),
      ('traumatisme_stress_post_traumatique',   'Traumatisme et stress post-traumatique',                     'inner_life',    690),
      ('victime_agression_sexuelle',            'Victime d''agression sexuelle',                              'trauma',        700),
      ('victime_violence',                      'Victime de violence',                                        'trauma',        710),
      ('violence_conjugale_familiale',          'Violence conjugale ou familiale',                            'relationships', 720)
    ) as m(key, name, category_key, sort_order)
  on conflict do nothing;

  insert into public.languages (org_id, code, name, is_system, sort_order) values
    (p_org, 'fr', 'Français', true, 10), (p_org, 'en', 'Anglais', false, 20), (p_org, 'es', 'Espagnol', false, 30)
  on conflict do nothing;

  insert into public.deactivation_reasons (org_id, key, name, requires_note, disables_account, is_system, sort_order) values
    (p_org, 'leave', 'Congé', false, false, false, 10),
    (p_org, 'collaboration_ended', 'Fin de collaboration', false, true, false, 20),
    (p_org, 'insurance_expired', 'Assurance expirée', false, false, false, 30),
    (p_org, 'other', 'Autre', true, false, true, 40)
  on conflict do nothing;

  -- set_config(…, true) lasts until the end of the transaction: give the caller's source back.
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

create function private.seed_professionals_reference_on_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_professionals_reference(new.id);
  return null;
end;
$$;

create trigger organizations_seed_professionals_reference
  after insert on public.organizations
  for each row execute function private.seed_professionals_reference_on_org();

revoke all on function private.seed_professionals_reference(uuid), private.seed_professionals_reference_on_org()
  from public, anon, authenticated, service_role;

-- Existing organizations (staging).
select private.seed_professionals_reference(o.id) from public.organizations o;

select pg_catalog.set_config('app.audit_source', '', true);
