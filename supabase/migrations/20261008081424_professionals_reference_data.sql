-- =============================================================================
-- Professionnels: permissions and per-clinic reference lists
-- =============================================================================
-- Design:  docs/plans/2026-10-08-professionals-module-design.md §3.1–3.2, §4
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4a.1 (P4-6, P4-28, P4-31, P4-32, P4-40, P4-42)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Lists are per clinic, seeded by a trigger on organizations (like tax_rates)
--   and for existing clinics below. Keys are immutable ASCII snake_case; seeded
--   rows keep their legacy keys (P4-31). Names are French and editable.
-- * Soft delete only (is_active). is_system rows (clientèles, French, « Autre »)
--   cannot be archived: matching and creation rely on them (P4-42; enforced by
--   the settings RPCs of the next migration, the only writers).
-- * Read by staff (professionals.view) and providers (professionals.self);
--   written only through the settings RPCs of the next migration. Each policy
--   keeps a permission term, so disabling the module hides every list.
-- * unique (org_id, id) on every list: rows that reference them use composite
--   FKs, so a row can never point at another clinic's list (P4-40).
-- * Names are unique per clinic ignoring case (unique index on lower(name)).
-- * Seeded content is legacy-v1 (P4-21): the 72 motifs and 8 « sphères de vie »
--   categories, the 10 therapy_type approaches, the 8 legacy titles plus
--   « Nutritionniste » (P4-6). Legacy-archived rows are left out (D7, P4-28).
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
-- One evaluation of the caller's permissions (current_permission_keys applies the module gate).
create function private.can_read_professionals_reference()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_permission_keys() && array['professionals.view', 'professionals.self']::text[]
$$;
revoke all on function private.can_read_professionals_reference() from public, anon;
grant execute on function private.can_read_professionals_reference() to authenticated;

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
  constraint professional_orders_name_check check (length(btrim(name, E' \t\r\n')) between 1 and 120 and name = btrim(name, E' \t\r\n')),
  constraint professional_orders_acronym_check check (acronym ~ '^[A-Z]{2,10}$'),
  constraint professional_orders_licence_label_check check (length(btrim(licence_label, E' \t\r\n')) between 1 and 60 and licence_label = btrim(licence_label, E' \t\r\n')),
  constraint professional_orders_licence_pattern_check check (length(btrim(licence_pattern, E' \t\r\n')) between 1 and 200),
  constraint professional_orders_org_id_key_key unique (org_id, key),
  constraint professional_orders_org_id_id_key unique (org_id, id)
);
create unique index professional_orders_org_name_key on public.professional_orders (org_id, lower(name));
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
  constraint profession_categories_name_check check (length(btrim(name, E' \t\r\n')) between 1 and 120 and name = btrim(name, E' \t\r\n')),
  constraint profession_categories_org_id_key_key unique (org_id, key),
  constraint profession_categories_org_id_id_key unique (org_id, id)
);
create unique index profession_categories_org_name_key on public.profession_categories (org_id, lower(name));
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
  constraint profession_titles_name_check check (length(btrim(name, E' \t\r\n')) between 1 and 120 and name = btrim(name, E' \t\r\n')),
  constraint profession_titles_org_id_key_key unique (org_id, key),
  constraint profession_titles_org_id_id_key unique (org_id, id),
  constraint profession_titles_category_fkey foreign key (org_id, category_id) references public.profession_categories (org_id, id),
  constraint profession_titles_order_fkey foreign key (org_id, order_id) references public.professional_orders (org_id, id)
);
create unique index profession_titles_org_name_key on public.profession_titles (org_id, lower(name));
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
  constraint clienteles_name_check check (length(btrim(name, E' \t\r\n')) between 1 and 120 and name = btrim(name, E' \t\r\n')),
  constraint clienteles_min_age_check check (min_age between 0 and 120),
  -- An upper bound needs a lower one and is not below it.
  constraint clienteles_max_age_check check (max_age is null or (min_age is not null and max_age between min_age and 120)),
  constraint clienteles_org_id_key_key unique (org_id, key),
  constraint clienteles_org_id_id_key unique (org_id, id)
);
create unique index clienteles_org_name_key on public.clienteles (org_id, lower(name));
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
  constraint specialties_name_check check (length(btrim(name, E' \t\r\n')) between 1 and 120 and name = btrim(name, E' \t\r\n')),
  constraint specialties_org_id_key_key unique (org_id, key),
  constraint specialties_org_id_id_key unique (org_id, id)
);
create unique index specialties_org_name_key on public.specialties (org_id, lower(name));
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
  constraint motif_categories_name_check check (length(btrim(name, E' \t\r\n')) between 1 and 120 and name = btrim(name, E' \t\r\n')),
  constraint motif_categories_description_check check (length(btrim(description, E' \t\r\n')) between 1 and 300),
  -- The 20 Lucide icons of the categories editor (legacy category-editor-dialog.tsx).
  constraint motif_categories_icon_check check (icon in (
    'Brain', 'Users', 'AlertTriangle', 'Briefcase', 'GraduationCap', 'Fingerprint', 'Shield', 'Leaf', 'Heart', 'Activity',
    'Star', 'Zap', 'Cloud', 'Sun', 'Moon', 'Home', 'Target', 'Compass', 'Sparkles', 'MessageCircle')),
  constraint motif_categories_org_id_key_key unique (org_id, key),
  constraint motif_categories_org_id_id_key unique (org_id, id)
);
create unique index motif_categories_org_name_key on public.motif_categories (org_id, lower(name));
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
  constraint motifs_name_check check (length(btrim(name, E' \t\r\n')) between 1 and 120 and name = btrim(name, E' \t\r\n')),
  constraint motifs_org_id_key_key unique (org_id, key),
  constraint motifs_org_id_id_key unique (org_id, id),
  constraint motifs_category_fkey foreign key (org_id, category_id) references public.motif_categories (org_id, id)
);
create unique index motifs_org_name_key on public.motifs (org_id, lower(name));
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
  constraint languages_name_check check (length(btrim(name, E' \t\r\n')) between 1 and 120 and name = btrim(name, E' \t\r\n')),
  constraint languages_org_id_code_key unique (org_id, code),
  constraint languages_org_id_id_key unique (org_id, id)
);
create unique index languages_org_name_key on public.languages (org_id, lower(name));
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
  constraint deactivation_reasons_name_check check (length(btrim(name, E' \t\r\n')) between 1 and 120 and name = btrim(name, E' \t\r\n')),
  constraint deactivation_reasons_org_id_key_key unique (org_id, key),
  constraint deactivation_reasons_org_id_id_key unique (org_id, id)
);
create unique index deactivation_reasons_org_name_key on public.deactivation_reasons (org_id, lower(name));
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
-- -----------------------------------------------------------------------------
create function private.seed_professionals_reference(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform pg_catalog.set_config('app.audit_source', 'seed:professionals_reference', true);

  insert into public.professional_orders (org_id, key, name, acronym, sort_order) values
    (p_org, 'opq',     'Ordre des psychologues du Québec', 'OPQ', 10),
    (p_org, 'otstcfq', 'Ordre des travailleurs sociaux et des thérapeutes conjugaux et familiaux du Québec', 'OTSTCFQ', 20),
    (p_org, 'oppq',    'Ordre des psychoéducateurs et psychoéducatrices du Québec', 'OPPQ', 30),
    (p_org, 'opsq',    'Ordre professionnel des sexologues du Québec', 'OPSQ', 40),
    (p_org, 'occoq',   'Ordre des conseillers et conseillères d''orientation du Québec', 'OCCOQ', 50),
    (p_org, 'odnq',    'Ordre des diététistes-nutritionnistes du Québec', 'ODNQ', 60)
  on conflict do nothing;

  insert into public.profession_categories (org_id, key, name, sort_order) values
    (p_org, 'psychologie', 'Psychologie', 10), (p_org, 'psychotherapie', 'Psychothérapie', 20),
    (p_org, 'travail_social', 'Travail social', 30), (p_org, 'psychoeducation', 'Psychoéducation', 40),
    (p_org, 'sexologie', 'Sexologie', 50), (p_org, 'naturopathie', 'Naturopathie', 60),
    (p_org, 'orientation', 'Orientation', 70), (p_org, 'coaching_professionnel', 'Coaching professionnel', 80),
    (p_org, 'nutrition', 'Nutrition', 90)
  on conflict do nothing;

  -- The 8 legacy titles plus « Nutritionniste » (P4-6); naturopathe and coach belong to no order.
  insert into public.profession_titles (org_id, key, name, category_id, order_id, sort_order)
  select p_org, t.key, t.name, c.id, o.id, t.sort_order
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
    join public.profession_categories c on c.org_id = p_org and c.key = t.category_key
    left join public.professional_orders o on o.org_id = p_org and o.key = t.order_key
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

  -- Motif categories: legacy 20260127000002_motif_categories_seed.sql (keys, names,
  -- descriptions, icons; display_order 1–8 becomes sort_order 10–80).
  insert into public.motif_categories (org_id, key, name, description, icon, sort_order) values
    (p_org, 'inner_life',    'Vie intérieure',       'Anxiété, dépression, estime de soi et santé mentale',     'Brain',         10),
    (p_org, 'relationships', 'Relations et famille', 'Relations amoureuses, familiales et interpersonnelles',   'Users',         20),
    (p_org, 'dependencies',  'Dépendances',          'Dépendances comportementales et substances',              'AlertTriangle', 30),
    (p_org, 'work',          'Vie professionnelle',  'Carrière, épuisement et difficultés au travail',          'Briefcase',     40),
    (p_org, 'development',   'Développement',        'Troubles d''apprentissage, TDAH et neurodéveloppement',   'GraduationCap', 50),
    (p_org, 'identity',      'Identité',             'Genre, orientation sexuelle et identité personnelle',     'Fingerprint',   60),
    (p_org, 'trauma',        'Trauma',               'Abus, violence et expériences traumatiques',              'Shield',        70),
    (p_org, 'life_changes',  'Changements de vie',   'Deuil, maladies et transitions de vie',                   'Leaf',          80)
  on conflict do nothing;

  -- Motifs: the 72 rows of legacy 20260118000008_motifs_seed.sql (keys and names exactly as
  -- there, P4-21), with the category of 20260127000003_motif_category_assignments.sql (every
  -- motif has one) and sort_order = 10 × the row's rank by name (accents and case ignored).
  insert into public.motifs (org_id, key, name, category_id, sort_order)
  select p_org, m.key, m.name, c.id, m.sort_order
    from (values
      ('abus_sexuel',                          'Abus sexuel',                                               'trauma',         10),
      ('accumulation_compulsive',              'Accumulation compulsive',                                   'inner_life',     20),
      ('adoption',                             'Adoption',                                                  'relationships',  30),
      ('anxiete',                              'Anxiété',                                                   'inner_life',     40),
      ('automutilation',                       'Automutilation',                                            'inner_life',     50),
      ('comportement_sexuels_abusif',          'Comportement sexuels abusif',                               'trauma',         60),
      ('consommation_alcool',                  'Consommation d''alcool',                                    'dependencies',   70),
      ('consommation_drogue',                  'Consommation de drogue',                                    'dependencies',   80),
      ('cyberdependance',                      'Cyberdépendance',                                           'dependencies',   90),
      ('deficience_intellectuelle',            'Déficience intellectuelle',                                 'development',   100),
      ('deficit_attention_hyperactivite',      'Déficit de l''attention / hyperactivité (TDA, TDAH)',       'development',   110),
      ('dependance',                           'Dépendance',                                                'dependencies',  120),
      ('dependance_affective',                 'Dépendance affective',                                      'relationships', 130),
      ('dependance_jeu',                       'Dépendance au jeu',                                         'dependencies',  140),
      ('dependance_medicament',                'Dépendance au médicament',                                  'dependencies',  150),
      ('dependance_travail',                   'Dépendance au travail',                                     'dependencies',  160),
      ('dependance_jeux_video',                'Dépendance aux jeux vidéo',                                 'dependencies',  170),
      ('dependance_sexuelle',                  'Dépendance sexuelle',                                       'dependencies',  180),
      ('depression',                           'Dépression',                                                'inner_life',    190),
      ('deuil',                                'Deuil',                                                     'life_changes',  200),
      ('difficultes_apprentissage',            'Difficultés d''apprentissage',                              'development',   210),
      ('difficultes_comportement',             'Difficultés de comportement',                               'development',   220),
      ('difficultes_language',                 'Difficultés de language',                                   'development',   230),
      ('difficultes_professionnelles',         'Difficultés professionnelles',                              'work',          240),
      ('douance',                              'Douance',                                                   'development',   250),
      ('dysfonctions_sexuelle',                'Dysfonctions sexuelle',                                     'identity',      260),
      ('dyslexie',                             'Dyslexie',                                                  'development',   270),
      ('epuisement_professionnel',             'Épuisement professionnel',                                  'work',          280),
      ('estime_de_soi',                        'Estime de soi',                                             'inner_life',    290),
      ('famille_recomposee',                   'Famille recomposée',                                        'relationships', 300),
      ('gestion_colere',                       'Gestion de la colère',                                      'inner_life',    310),
      ('grossesse_prenatal_post_partum',       'Grossesse, Prénatal, Post-partum',                          'relationships', 320),
      ('guerre_conflit_arme_veterans',         'Guerre / Conflit armé (Vétérans)',                          'trauma',        330),
      ('guerre_conflit_arme_victimes_civiles', 'Guerre / Conflit armé (Victimes civiles)',                  'trauma',        340),
      ('idees_suicidaires',                    'Idées suicidaires',                                         'inner_life',    350),
      ('identite_genre',                       'Identité de genre',                                         'identity',      360),
      ('identite_orientation_sexuelle',        'Identité et Orientation sexuelle',                          'identity',      370),
      ('identite_raciale',                     'Identité raciale',                                          'identity',      380),
      ('infertilite',                          'Infertilité',                                               'relationships', 390),
      ('infidelite',                           'Infidélité',                                                'relationships', 400),
      ('insomnie',                             'Insomnie',                                                  'inner_life',    410),
      ('intimidation',                         'Intimidation',                                              'relationships', 420),
      ('maladies_degeneratives',               'Maladies dégénératives',                                    'life_changes',  430),
      ('monoparentalite',                      'Monoparentalité',                                           'relationships', 440),
      ('orientation_professionnelle',          'Orientation professionnelle',                               'work',          450),
      ('problemes_financiers',                 'Problèmes financiers',                                      'work',          460),
      ('psychose',                             'Psychose',                                                  'inner_life',    470),
      ('readaptation_professionnelle',         'Réadaption Professionnelle',                                'work',          480),
      ('relations_amoureuses',                 'Relations amoureuses',                                      'relationships', 490),
      ('relations_familiales',                 'Relations familiales',                                      'relationships', 500),
      ('relations_interpersonnelles',          'Relations interpersonnelles',                               'relationships', 510),
      ('retard_developpement',                 'Retard de développement',                                   'development',   520),
      ('retard_global_developpement',          'Retard global de développement (RGD)',                      'development',   530),
      ('separation_divorce',                   'Séparation, Divorce',                                       'relationships', 540),
      ('sexualite',                            'Sexualité',                                                 'identity',      550),
      ('situations_crises',                    'Situations de crises',                                      'inner_life',    560),
      ('syndrome_gilles_tourette',             'Syndrome de Gilles de la Tourette',                         'development',   570),
      ('transsexualite',                       'Transsexualité',                                            'identity',      580),
      ('traumatisme_cranio_cerebral',          'Traumatisme cranio-cérébral (TCC)',                         'trauma',        590),
      ('traumatisme_stress_post_traumatique',  'Traumatisme et Trouble de stress post-traumatique (TSPT)',  'inner_life',    600),
      ('trouble_bipolaire',                    'Trouble bipolaire',                                         'inner_life',    610),
      ('trouble_personnalite_limite',          'Trouble de personnalité limite (TPL)',                      'inner_life',    620),
      ('trouble_personnalite_narcissique',     'Trouble de personnalité narcissique (TPN)',                 'inner_life',    630),
      ('trouble_conduites',                    'Trouble des conduites',                                     'development',   640),
      ('trouble_sommeil',                      'Trouble du sommeil',                                        'inner_life',    650),
      ('trouble_spectre_autisme',              'Trouble du spectre de l''autisme',                          'development',   660),
      ('trouble_obsessionnel_compulsif',       'Trouble obsessionnel-compulsif (TOC)',                      'inner_life',    670),
      ('trouble_oppositionnel_provocation',    'Trouble oppositionnel avec provocation (TOP)',              'development',   680),
      ('troubles_alimentaires',                'Troubles alimentaires',                                     'dependencies',  690),
      ('victime_agression_sexuelle',           'Victime d''aggression sexuelle',                            'trauma',        700),
      ('victime_violence',                     'Victime de violence',                                       'trauma',        710),
      ('violence_conjugale_familiale',         'Violence conjugale ou familiale',                           'relationships', 720)
    ) as m(key, name, category_key, sort_order)
    -- left join: a category the clinic already holds under its name was not re-added; its
    -- motifs then land under « Autres » rather than being skipped.
    left join public.motif_categories c on c.org_id = p_org and c.key = m.category_key
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
