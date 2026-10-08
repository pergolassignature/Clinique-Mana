-- =============================================================================
-- Professionnels: permissions and per-clinic reference lists
-- =============================================================================
-- Design:  docs/plans/2026-10-08-professionals-module-design.md §3.1–3.2, §4
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4a.1 (P4-6, P4-28, P4-31, P4-32, P4-40, P4-42, P4-240–P4-246)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Lists are per clinic, seeded by a trigger on organizations (like tax_rates)
--   and for existing clinics below. Keys are ASCII snake_case and frozen by a
--   trigger, like org_id (seeded rows keep their legacy keys, P4-31). Names are
--   French and editable.
-- * Soft delete only (is_active). is_system rows (the five age and format clientèles
--   matching relies on, French, « Autre ») cannot be archived: matching and creation
--   rely on them (P4-42; enforced by the settings RPCs of the next migration, the
--   only writers).
-- * Read by anyone holding a professionals key: staff with view or any other staff
--   key (manage, matching, settings… by default or by override), providers with
--   self. Written only through the settings RPCs of the next migration. Each policy
--   keeps a permission term, so disabling the module hides every list.
-- * unique (org_id, id) on every list: rows that reference them use composite
--   FKs, so a row can never point at another clinic's list (P4-40).
-- * Names: no leading or trailing whitespace, no control or invisible character
--   (private.is_tidy_text), unique per clinic compared as lower(normalize(name, NFKC)),
--   like roles (core_editable_roles): two names that look the same are the same name.
-- * Seeded motifs, motif categories and clientèles are the clinic's own, from the
--   « Motifs de consultation » and « Clientèle » of the 43 profiles on
--   cliniquemana.com (Jonathan, 2026-10-08, P4-241–P4-245): 13 categories and 124
--   motifs in the site's order and wording (apostrophes ’, « / » spaced, the two
--   labels listed under two headings told apart), 8 clientèles. Titles are the 8
--   legacy titles plus « Nutritionniste » (P4-6). The seed is only a start: the
--   clinic edits, archives and reorders every list in Paramètres. There are no
--   therapeutic approaches (P4-240).
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
-- Read access to the lists (one helper for the eight policies)
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
-- motif_categories: display groups of motifs (the website's headings)
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
-- Privileges, RLS, triggers (same block for the eight lists)
-- -----------------------------------------------------------------------------
revoke all on public.professional_orders, public.profession_categories, public.profession_titles,
              public.clienteles, public.motif_categories, public.motifs,
              public.languages, public.deactivation_reasons
  from anon, authenticated;
grant select on public.professional_orders, public.profession_categories, public.profession_titles,
                public.clienteles, public.motif_categories, public.motifs,
                public.languages, public.deactivation_reasons
  to authenticated;

alter table public.professional_orders enable row level security;
alter table public.profession_categories enable row level security;
alter table public.profession_titles enable row level security;
alter table public.clienteles enable row level security;
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
-- function for the eight tables (a table without key or code reads null on both sides).
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
      ('opq',     'Ordre des psychologues du Québec', 'OPQ', null, 10),
      ('otstcfq', 'Ordre des travailleurs sociaux et des thérapeutes conjugaux et familiaux du Québec', 'OTSTCFQ', null, 20),
      -- OPPQ permits read NNNNN-AA on every profile of the website (P4-248).
      ('oppq',    'Ordre des psychoéducateurs et psychoéducatrices du Québec', 'OPPQ', '^[0-9]{5}-[0-9]{2}$', 30),
      ('opsq',    'Ordre professionnel des sexologues du Québec', 'OPSQ', null, 40),
      ('occoq',   'Ordre des conseillers et conseillères d''orientation du Québec', 'OCCOQ', null, 50),
      ('odnq',    'Ordre des diététistes-nutritionnistes du Québec', 'ODNQ', null, 60)
    ) as v(key, name, acronym, licence_pattern, sort_order)
  loop
    insert into public.professional_orders (org_id, key, name, acronym, licence_pattern, sort_order)
    values (p_org, r.key, r.name, r.acronym, r.licence_pattern, r.sort_order)
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

  -- The clientèles of the website's profiles (P4-244), in the site's order of age then format.
  -- The five legacy keys matching relies on stay (P4-31, P4-42) and are is_system; the three new
  -- ones (English like them) can be archived. Adultes has no upper bound: there are no Aînés.
  -- « Enfants (8+) » and « Femmes exclusivement » are per professional (matching profile, P4-245).
  insert into public.clienteles (org_id, key, name, min_age, max_age, is_system, sort_order) values
    (p_org, 'children', 'Enfants', 0, 12, true, 10), (p_org, 'adolescents', 'Adolescents', 13, 17, true, 20),
    (p_org, 'young_adults', 'Jeunes adultes', 18, 25, false, 30), (p_org, 'adults', 'Adultes', 18, null, true, 40),
    (p_org, 'couples', 'Couples', null, null, true, 50), (p_org, 'families', 'Familles', null, null, true, 60),
    (p_org, 'parents', 'Parents', null, null, false, 70), (p_org, 'athletes', 'Athlètes', null, null, false, 80)
  on conflict do nothing;

  -- Motif categories: the 13 headings of « Motifs de consultation » on the website, in its order
  -- (P4-241; « Gestion des écrans », on one profile only, after « Famille et parentalité »). The
  -- icons are ours (the site has none); no description.
  for r in
    select * from (values
      ('sante_mentale',       'Santé mentale / Troubles psychologiques',   'Brain',          10),
      ('personnalite',        'Personnalité et comportements',             'Compass',        20),
      ('dependances',         'Dépendances',                               'AlertTriangle',  30),
      ('neurodiversite',      'Neurodiversité / apprentissages',           'Sparkles',       40),
      ('couple_relationnel',  'Couple et relationnel',                     'Heart',          50),
      ('famille_parentalite', 'Famille et parentalité',                    'Home',           60),
      ('gestion_ecrans',      'Gestion des écrans et de l’ère numérique',  'Zap',            70),
      ('travail_carriere',    'Travail, carrière et organisation',         'Briefcase',      80),
      ('ecole_scolarite',     'École, scolarité',                          'GraduationCap',  90),
      ('violence_abus',       'Violence / abus / victimisation',           'Shield',         100),
      ('sante_physique',      'Santé physique et maladies',                'Activity',       110),
      ('sexualite_identite',  'Sexualité / identité / intimité',           'Fingerprint',    120),
      ('autres',              'Autres',                                    'Leaf',           130)
    ) as v(key, name, icon, sort_order)
  loop
    insert into public.motif_categories (org_id, key, name, icon, sort_order)
    values (p_org, r.key, r.name, r.icon, r.sort_order)
    on conflict do nothing;
    select x.id into v_id from public.motif_categories x
     where x.org_id = p_org
       and (x.key = r.key
            or pg_catalog.lower(pg_catalog.normalize(x.name, 'NFKC')) = pg_catalog.lower(pg_catalog.normalize(r.name, 'NFKC')))
     order by x.key = r.key desc
     limit 1;
    v_motif_categories := v_motif_categories || pg_catalog.jsonb_build_object(r.key, v_id);
  end loop;

  -- Motifs: the 122 labels of the 43 profiles (P4-241), 124 motifs: « Communication » and
  -- « Anxiété de performance » are under two headings each, so each gets two motifs (P4-242). In
  -- the site's order within each heading (alphabetical, as every profile lists them) and its
  -- wording, which the clinic chose (P4-243): straight apostrophes become ’, « / » is spaced and
  -- the site's trailing U+202F is dropped. Keys are French ASCII slugs (P4-31). None restricted.
  -- sort_order = 10 × the motif's rank in the whole list.
  insert into public.motifs (org_id, key, name, category_id, sort_order)
  select p_org, m.key, m.name, (v_motif_categories ->> m.category_key)::uuid, m.sort_order
    from (values
      ('anxiete',                                      'Anxiété',                                                                               'sante_mentale',         10),
      ('automutilation',                               'Automutilation',                                                                        'sante_mentale',         20),
      ('depression',                                   'Dépression',                                                                            'sante_mentale',         30),
      ('deuil_par_suicide',                            'Deuil par suicide',                                                                     'sante_mentale',         40),
      ('estime_de_soi',                                'Estime de soi',                                                                         'sante_mentale',         50),
      ('gestion_colere',                               'Gestion de la colère',                                                                  'sante_mentale',         60),
      ('gestion_des_emotions',                         'Gestion des émotions',                                                                  'sante_mentale',         70),
      ('gestion_du_stress',                            'Gestion du stress',                                                                     'sante_mentale',         80),
      ('hypersensibilite',                             'Hypersensibilité',                                                                      'sante_mentale',         90),
      ('idees_suicidaires',                            'Idées suicidaires',                                                                     'sante_mentale',        100),
      ('isolement_et_rejet_social',                    'Isolement et rejet social',                                                             'sante_mentale',        110),
      ('phobies',                                      'Phobies',                                                                               'sante_mentale',        120),
      ('situations_crises',                            'Situations de crise',                                                                   'sante_mentale',        130),
      ('trouble_humeur_bipolarite',                    'Trouble de l’humeur, bipolarité',                                                       'sante_mentale',        140),
      ('trouble_stress_post_traumatique_tspt',         'Trouble de stress post-traumatique (TSPT)',                                             'sante_mentale',        150),
      ('trouble_obsessionnel_compulsif',               'Trouble obsessionnel-compulsif (TOC)',                                                  'sante_mentale',        160),
      ('troubles_alimentaires',                        'Troubles alimentaires',                                                                 'sante_mentale',        170),
      ('troubles_anxieux',                             'Troubles anxieux',                                                                      'sante_mentale',        180),
      ('troubles_du_sommeil_insomnie',                 'Troubles du sommeil / insomnie',                                                        'sante_mentale',        190),
      ('difficultes_comportement',                     'Difficultés de comportement',                                                           'personnalite',         200),
      ('difficultes_comportement_enfant',              'Difficultés de comportement chez l’enfant',                                             'personnalite',         210),
      ('trouble_de_personnalite',                      'Trouble de personnalité',                                                               'personnalite',         220),
      ('trouble_personnalite_limite',                  'Trouble de personnalité limite (TPL)',                                                  'personnalite',         230),
      ('trouble_personnalite_narcissique',             'Trouble de personnalité narcissique (TPN)',                                             'personnalite',         240),
      ('trouble_conduites',                            'Trouble des conduites',                                                                 'personnalite',         250),
      ('trouble_oppositionnel_provocation',            'Trouble oppositionnel avec provocation (TOP)',                                          'personnalite',         260),
      ('dependance_affective',                         'Dépendance affective',                                                                  'dependances',          270),
      ('dependance_travail',                           'Dépendance au travail',                                                                 'dependances',          280),
      ('dependance_sexuelle',                          'Dépendance sexuelle',                                                                   'dependances',          290),
      ('dependances_alcool_drogue_medicament',         'Dépendances (alcool, drogue, médicament, vapotage)',                                    'dependances',          300),
      ('dependances_jeu_jeux_video_cyberdependance',   'Dépendances (jeu, jeux vidéo, cyberdépendance)',                                        'dependances',          310),
      ('adaptation_a_l_ecole',                         'Adaptation à l’école',                                                                  'neurodiversite',       320),
      ('deficience_intellectuelle',                    'Déficience intellectuelle',                                                             'neurodiversite',       330),
      ('deficit_attention_hyperactivite',              'Déficit de l’attention / hyperactivité (TDA/H)',                                        'neurodiversite',       340),
      ('difficultes_adaptation_neurodivergence',       'Difficultés d’adaptation liées à la neurodivergence',                                   'neurodiversite',       350),
      ('douance',                                      'Douance',                                                                               'neurodiversite',       360),
      ('soutien_parents_enfants_neuroatypiques',       'Soutien aux parents d’enfants neuroatypiques',                                          'neurodiversite',       370),
      ('syndrome_gilles_tourette',                     'Syndrome de Gilles de la Tourette',                                                     'neurodiversite',       380),
      ('trouble_d_adaptation',                         'Trouble d’adaptation',                                                                  'neurodiversite',       390),
      ('trouble_spectre_autisme',                      'Trouble du spectre de l’autisme',                                                       'neurodiversite',       400),
      ('troubles_difficultes_apprentissage',           'Troubles / difficultés d’apprentissage',                                                'neurodiversite',       410),
      ('troubles_neuropsychologiques',                 'Troubles neuropsychologiques',                                                          'neurodiversite',       420),
      ('communication_couple',                         'Communication (couple)',                                                                'couple_relationnel',   430),
      ('difficultes_conjugales',                       'Difficultés conjugales',                                                                'couple_relationnel',   440),
      ('difficultes_relationnelles_pairs',             'Difficultés relationnelles avec les pairs',                                             'couple_relationnel',   450),
      ('infidelite',                                   'Infidélité',                                                                            'couple_relationnel',   460),
      ('relations_amoureuses',                         'Relations amoureuses',                                                                  'couple_relationnel',   470),
      ('relations_interpersonnelles',                  'Relations interpersonnelles',                                                           'couple_relationnel',   480),
      ('separation_divorce',                           'Séparation, divorce',                                                                   'couple_relationnel',   490),
      ('troubles_de_l_attachement',                    'Troubles de l’attachement',                                                             'couple_relationnel',   500),
      ('adaptation_vie_enfant_besoins_particuliers',   'Adaptation à la vie avec un enfant ayant des besoins particuliers',                     'famille_parentalite',  510),
      ('adoption_internationale',                      'Adoption internationale',                                                               'famille_parentalite',  520),
      ('alienation_parentale',                         'Aliénation parentale',                                                                  'famille_parentalite',  530),
      ('coaching_parental',                            'Coaching parental',                                                                     'famille_parentalite',  540),
      ('communication_famille',                        'Communication (famille)',                                                               'famille_parentalite',  550),
      ('conflits_parent_enfant',                       'Conflits parent-enfant',                                                                'famille_parentalite',  560),
      ('coparentalite',                                'Coparentalité',                                                                         'famille_parentalite',  570),
      ('deuil_perinatal',                              'Deuil périnatal',                                                                       'famille_parentalite',  580),
      ('difficultes_familiales',                       'Difficultés familiales',                                                                'famille_parentalite',  590),
      ('discipline_encadrement',                       'Discipline / Encadrement',                                                              'famille_parentalite',  600),
      ('epuisement_parental',                          'Épuisement parental',                                                                   'famille_parentalite',  610),
      ('fertilite_procreation_assistee_infertilite',   'Fertilité, procréation assistée, infertilité',                                          'famille_parentalite',  620),
      ('garde_enfants',                                'Garde d’enfants',                                                                       'famille_parentalite',  630),
      ('monoparentalite_famille_recomposee',           'Monoparentalité, famille recomposée',                                                   'famille_parentalite',  640),
      ('opposition_gestion_comportements',             'Opposition et gestion des comportements',                                               'famille_parentalite',  650),
      ('perinatalite_grossesse_post_partum',           'Périnatalité, grossesse, post-partum',                                                  'famille_parentalite',  660),
      ('relations_familiales',                         'Relations familiales',                                                                  'famille_parentalite',  670),
      ('suivi_familial',                               'Suivi familial',                                                                        'famille_parentalite',  680),
      ('ecrans_usage_excessif',                        'Accompagnement pour usage excessif ou préoccupant des écrans',                          'gestion_ecrans',       690),
      ('ecrans_saines_habitudes',                      'Besoin d’outils pour instaurer de saines habitudes numériques',                         'gestion_ecrans',       700),
      ('ecrans_conflits_familiaux',                    'Conflits familiaux liés aux écrans',                                                    'gestion_ecrans',       710),
      ('ecrans_desaccord_parental',                    'Désaccord parental concernant l’encadrement',                                           'gestion_ecrans',       720),
      ('ecrans_limites',                               'Difficulté à établir ou faire respecter des limites',                                   'gestion_ecrans',       730),
      ('ecrans_autoregulation',                        'Difficulté d’autorégulation chez l’enfant ou l’adolescent',                             'gestion_ecrans',       740),
      ('ecrans_communication_parent_enfant',           'Difficulté de communication parent-enfant',                                             'gestion_ecrans',       750),
      ('ecrans_impacts_bien_etre',                     'Impacts sur le sommeil, l’humeur, la motivation, les apprentissages ou le bien-être',   'gestion_ecrans',       760),
      ('ecrans_reseaux_sociaux_jeux_ia',               'Questions liées aux réseaux sociaux, aux jeux vidéo ou à l’intelligence artificielle',  'gestion_ecrans',       770),
      ('ecrans_perte_controle',                        'Sentiment de perte de contrôle, d’impuissance ou de culpabilité',                       'gestion_ecrans',       780),
      ('climat_de_travail',                            'Climat de travail',                                                                     'travail_carriere',     790),
      ('difficultes_professionnelles',                 'Difficultés professionnelles',                                                          'travail_carriere',     800),
      ('epuisement_professionnel',                     'Épuisement professionnel / burnout',                                                    'travail_carriere',     810),
      ('gestion_de_carriere',                          'Gestion de carrière',                                                                   'travail_carriere',     820),
      ('orientation_scolaire_professionnelle',         'Orientation scolaire et professionnelle',                                               'travail_carriere',     830),
      ('sante_psychologique_au_travail',               'Santé psychologique au travail',                                                        'travail_carriere',     840),
      ('anxiete_de_performance',                       'Anxiété de performance',                                                                'ecole_scolarite',      850),
      ('demotivation',                                 'Démotivation',                                                                          'ecole_scolarite',      860),
      ('descolarisation',                              'Déscolarisation',                                                                       'ecole_scolarite',      870),
      ('intimidation',                                 'Intimidation',                                                                          'ecole_scolarite',      880),
      ('abus_sexuel_auteur',                           'Abus sexuel (auteur.e)',                                                                'violence_abus',        890),
      ('abus_sexuel_victime',                          'Abus sexuel (victime)',                                                                 'violence_abus',        900),
      ('harcelement_et_intimidation',                  'Harcèlement et intimidation',                                                           'violence_abus',        910),
      ('prevention_agressions_sexuelles',              'Prévention des agressions sexuelles',                                                   'violence_abus',        920),
      ('traumas',                                      'Traumas',                                                                               'violence_abus',        930),
      ('violence_auteur',                              'Violence (auteur.e)',                                                                   'violence_abus',        940),
      ('violence_victime',                             'Violence (victime)',                                                                    'violence_abus',        950),
      ('violence_conjugale_familiale',                 'Violence conjugale ou familiale',                                                       'violence_abus',        960),
      ('douleurs_chroniques',                          'Douleurs chroniques',                                                                   'sante_physique',       970),
      ('maladies_degeneratives',                       'Maladies dégénératives',                                                                'sante_physique',       980),
      ('maladies_physiques_handicaps',                 'Maladies physiques / handicaps',                                                        'sante_physique',       990),
      ('oncologie_soins_palliatifs',                   'Oncologie / soins palliatifs',                                                          'sante_physique',      1000),
      ('proche_aidance',                               'Proche aidance',                                                                        'sante_physique',      1010),
      ('vieillissement',                               'Vieillissement',                                                                        'sante_physique',      1020),
      ('anxiete_performance_sexuelle',                 'Anxiété de performance sexuelle',                                                       'sexualite_identite',  1030),
      ('comportements_sexuels_abusifs',                'Comportements sexuels abusifs',                                                         'sexualite_identite',  1040),
      ('comportements_sexuels_problematiques',         'Comportements sexuels inadéquats, préoccupants ou problématiques',                      'sexualite_identite',  1050),
      ('dysfonctions_sexuelles',                       'Dysfonctions sexuelles',                                                                'sexualite_identite',  1060),
      ('identite_diversite_orientation_lgbtq',         'Identité, diversité et orientation sexuelle, LGBTQ+',                                   'sexualite_identite',  1070),
      ('intimite',                                     'Intimité',                                                                              'sexualite_identite',  1080),
      ('sexualisation_precoce',                        'Sexualisation précoce',                                                                 'sexualite_identite',  1090),
      ('sexualite',                                    'Sexualité',                                                                             'sexualite_identite',  1100),
      ('soutien_parental_education_sexualite',         'Soutien parental pour l’éducation à la sexualité',                                      'sexualite_identite',  1110),
      ('transsexualite',                               'Transsexualité',                                                                        'sexualite_identite',  1120),
      ('troubles_sexuels',                             'Troubles sexuels',                                                                      'sexualite_identite',  1130),
      ('vie_amoureuse_sexuelle_insatisfaisante',       'Vie amoureuse / sexuelle insatisfaisante',                                              'sexualite_identite',  1140),
      ('communautes_culturelles_parcours_migratoire',  'Communautés culturelles et parcours migratoire',                                        'autres',              1150),
      ('crise_existentielle_perte_de_sens',            'Crise existentielle / perte de sens',                                                   'autres',              1160),
      ('cycle_de_vie',                                 'Cycle de vie',                                                                          'autres',              1170),
      ('defis_adaptation_sport_performance',           'Défis d’adaptation reliés au sport et à la performance',                                'autres',              1180),
      ('deuil',                                        'Deuil',                                                                                 'autres',              1190),
      ('developpement_cheminement_personnel',          'Développement et cheminement personnel',                                                'autres',              1200),
      ('problematiques_agriculteurs',                  'Problématiques propres aux agriculteurs',                                               'autres',              1210),
      ('psychologie_du_sport',                         'Psychologie du sport',                                                                  'autres',              1220),
      ('soutien_entrepreneurs_travailleurs_autonomes', 'Soutien aux entrepreneurs et travailleurs autonomes',                                   'autres',              1230),
      ('spiritualite',                                 'Spiritualité',                                                                          'autres',              1240)
    ) as m(key, name, category_key, sort_order)
  on conflict do nothing;

  insert into public.languages (org_id, code, name, is_system, sort_order) values
    (p_org, 'fr', 'Français', true, 10), (p_org, 'en', 'Anglais', false, 20), (p_org, 'es', 'Espagnol', false, 30),
    (p_org, 'ca', 'Catalan', false, 40)
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
