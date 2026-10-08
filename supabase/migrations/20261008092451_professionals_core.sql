-- =============================================================================
-- Professionnels: the professional record, its matching sets, the provider link
-- =============================================================================
-- Design:  docs/plans/2026-10-08-professionals-module-design.md §3.3, §3.7, §3.9
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4a.3 (P4-33, P4-34, P4-35, P4-36, P4-40)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Child rows' primary keys start with professional_id, so audit record ids start with it and
--   list_professional_history (4a.4) finds every child row, deleted ones included (P4-36).
-- * Every reference from a professional's row is a composite FK (org_id, <x>_id) (P4-40): a row
--   of one clinic never points at another clinic's list.
-- * Plain fields: column grants + RLS (professionals.manage for identity and the public profile,
--   professionals.matching for the matching profile). Sets, email, status: security definer RPCs
--   that check their permission, then lock the professional row (for no key update), so set
--   replacements on one professional never interleave.
-- * A set RPC replaces a set in three statements (delete, update, insert), never one per item,
--   and writes only what changes: re-sending a set leaves no audit row. When a statement touched
--   a row, it bumps professionals.updated_at (a removed row leaves nothing to read), so the
--   directory's updated_at follows every set change; audit_trigger skips an updated_at-only
--   change, so the bump writes no audit row.
-- * Professions: at most two, exactly one primary (deferred check: the RPC moves it), a licence
--   when the title belongs to an order, in the order's format (P4-35, P4-36). Upserted by title,
--   so row ids survive for Services et tarifs' FKs.
-- * Restricted motifs need a regulated profession (P4-16), both ways: set_professional_motifs
--   refuses them without one, set_professional_professions refuses to remove the last one while
--   they are held.
-- * Email: lower-cased, unique among the clinic's professionals and profiles only (P4-34). Once
--   the account exists, profiles.email (from auth.users) is the source: a trigger copies it,
--   unless an unlinked professional of the clinic already uses the address (then it is left as
--   is: the login change must succeed and reveal nothing, decision #38).
-- * Providers read their own record through private.current_professional_id() and
--   professionals.self; every policy keeps a permission term (module gate). That includes
--   deactivation_note and activation_override_reason (Loi 25 right of access): staff write
--   those notes knowing the professional can read them.
-- * Audit redaction (Loi 25): the home address, personal phone and gender of professionals.
--   No SIN or bank data here (4a.17, professional_private).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_core', true);

-- -----------------------------------------------------------------------------
-- Helpers for check constraints (run with the writer's privileges: granted to writers)
-- -----------------------------------------------------------------------------
-- True when no value repeats (null stays null). A check constraint cannot hold a subquery.
create function private.has_no_duplicates(p_values text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.cardinality(p_values) = (select count(distinct x) from pg_catalog.unnest(p_values) as x)
$$;
revoke all on function private.has_no_duplicates(text[]) from public, anon;
grant execute on function private.has_no_duplicates(text[]) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- professionals: the record
-- -----------------------------------------------------------------------------
create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid,                        -- null until the invitation is accepted (4b)
  first_name text not null,
  last_name text not null,
  email text not null,                    -- login and invitation; from the profile once linked
  personal_phone text,
  address_line1 text,
  address_line2 text,
  city text,
  province text not null default 'QC',
  postal_code text,
  country text not null default 'CA',
  years_experience smallint,
  gender text,                            -- staff only, for the client's preference (P4-5)
  status text not null default 'draft',
  status_changed_at timestamptz not null default now(),
  status_changed_by uuid references public.profiles(user_id) on delete set null,
  deactivation_reason_id uuid,
  -- Both notes are readable by the professional (professionals_select_self, Loi 25 right of
  -- access): staff write them as the professional may read them.
  deactivation_note text,
  deactivation_disabled_account boolean not null default false,
  activation_override_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint professionals_org_id_id_key unique (org_id, id),
  constraint professionals_profile_id_key unique (profile_id),
  constraint professionals_profile_fkey foreign key (profile_id, org_id)
    references public.profiles (user_id, org_id) on delete set null (profile_id),
  constraint professionals_deactivation_reason_fkey foreign key (org_id, deactivation_reason_id)
    references public.deactivation_reasons (org_id, id),
  constraint professionals_first_name_check check (length(btrim(first_name, E' \t\r\n')) between 1 and 80 and first_name = btrim(first_name, E' \t\r\n')),
  constraint professionals_last_name_check check (length(btrim(last_name, E' \t\r\n')) between 1 and 80 and last_name = btrim(last_name, E' \t\r\n')),
  constraint professionals_email_check check (email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint professionals_personal_phone_check check (personal_phone ~ '^\+1[0-9]{10}$'),
  constraint professionals_address_line1_check check (length(btrim(address_line1, E' \t\r\n')) between 1 and 200),
  constraint professionals_address_line2_check check (length(btrim(address_line2, E' \t\r\n')) between 1 and 200),
  constraint professionals_city_check check (length(btrim(city, E' \t\r\n')) between 1 and 100),
  constraint professionals_province_check check (province in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),
  constraint professionals_postal_code_check check (postal_code ~ '^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$'),
  constraint professionals_country_check check (country = 'CA'),
  constraint professionals_years_experience_check check (years_experience between 0 and 60),
  constraint professionals_gender_check check (gender in ('female', 'male', 'unspecified')),
  constraint professionals_status_check check (status in ('draft', 'invited', 'in_review', 'active', 'inactive')),
  constraint professionals_deactivation_check check ((status = 'inactive') = (deactivation_reason_id is not null)),
  constraint professionals_deactivation_note_check check (length(btrim(deactivation_note, E' \t\r\n')) between 1 and 500),
  constraint professionals_activation_override_reason_check check (length(btrim(activation_override_reason, E' \t\r\n')) between 5 and 500)
);
-- Email unique per clinic (also the duplicate check of create / set_professional_email); list
-- sort and status filter (4a.4 list view); actor FKs.
create unique index professionals_org_email_key on public.professionals (org_id, email);
create index professionals_org_name_idx on public.professionals (org_id, last_name, first_name);
create index professionals_org_status_idx on public.professionals (org_id, status);
create index professionals_status_changed_by_idx on public.professionals (status_changed_by);
create index professionals_created_by_idx on public.professionals (created_by);

revoke all on public.professionals from anon, authenticated;
grant select on public.professionals to authenticated;
grant update (first_name, last_name, personal_phone, address_line1, address_line2, city, province,
              postal_code, years_experience, gender) on public.professionals to authenticated;
alter table public.professionals enable row level security;

-- The caller's own professional row (null unless the caller's profile is active).
-- Published contract: Clients, Demandes and Rendez-vous policies call it too.
create function private.current_professional_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.professionals p
   where p.profile_id = auth.uid() and p.org_id = private.current_user_org_id()
$$;
revoke all on function private.current_professional_id() from public, anon;
grant execute on function private.current_professional_id() to authenticated;

create policy professionals_select_staff on public.professionals
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));
create policy professionals_select_self on public.professionals
  for select to authenticated
  using (id = (select private.current_professional_id()) and (select private.has_permission('professionals.self')));
create policy professionals_update on public.professionals
  for update to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.manage')))
  with check (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.manage')));

create trigger professionals_set_updated_at before update on public.professionals
  for each row execute function private.set_updated_at();
-- Personal data stays out of audit_log (Loi 25: the log outlives the record and its readers).
-- The history shows that the field changed, not its values. Province and years of experience
-- are not personal enough to hide; names and email are what the history is about.
create trigger professionals_audit after insert or update or delete on public.professionals
  for each row execute function private.audit_trigger('personal_phone', 'address_line1', 'address_line2', 'city',
                                                      'postal_code', 'gender');

-- Lock one professional of the caller's clinic, or say it does not exist there.
create function private.lock_professional(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.professionals p
   where p.id = p_id and p.org_id = private.current_user_org_id()
     for no key update;
  if not found then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function private.lock_professional(uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1:1 tables: public profile (professionals.manage) and matching profile (professionals.matching)
-- -----------------------------------------------------------------------------
create table public.professional_public_profiles (
  professional_id uuid primary key,
  org_id uuid not null,
  bio text,
  approach text,
  public_email text,
  public_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_public_profiles_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_public_profiles_bio_check check (char_length(bio) <= 4000 and btrim(bio, E' \t\r\n') <> ''),
  constraint professional_public_profiles_approach_check check (char_length(approach) <= 4000 and btrim(approach, E' \t\r\n') <> ''),
  constraint professional_public_profiles_public_email_check check (public_email = lower(btrim(public_email)) and length(public_email) <= 254 and public_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint professional_public_profiles_public_phone_check check (public_phone ~ '^\+1[0-9]{10}$')
);
create index professional_public_profiles_org_idx on public.professional_public_profiles (org_id);

create table public.professional_matching_profiles (
  professional_id uuid primary key,
  org_id uuid not null,
  accepting_new_clients boolean not null default true,
  -- General periods until Rendez-vous brings slots (P4-4); same values as a demande's preferences.
  availability_periods text[] not null default '{}',
  availability_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_matching_profiles_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_matching_profiles_availability_periods_check check (
    availability_periods <@ array['am', 'pm', 'evening', 'weekend'] and private.has_no_duplicates(availability_periods)),
  constraint professional_matching_profiles_availability_note_check check (char_length(availability_note) <= 500 and btrim(availability_note, E' \t\r\n') <> '')
);
create index professional_matching_profiles_org_idx on public.professional_matching_profiles (org_id);

revoke all on public.professional_public_profiles, public.professional_matching_profiles from anon, authenticated;
grant select on public.professional_public_profiles, public.professional_matching_profiles to authenticated;
grant update (bio, approach, public_email, public_phone) on public.professional_public_profiles to authenticated;
grant update (accepting_new_clients, availability_periods, availability_note) on public.professional_matching_profiles to authenticated;
alter table public.professional_public_profiles enable row level security;
alter table public.professional_matching_profiles enable row level security;

create policy professional_public_profiles_select_staff on public.professional_public_profiles
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));
create policy professional_public_profiles_select_self on public.professional_public_profiles
  for select to authenticated
  using (professional_id = (select private.current_professional_id()) and (select private.has_permission('professionals.self')));
create policy professional_public_profiles_update on public.professional_public_profiles
  for update to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.manage')))
  with check (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.manage')));

create policy professional_matching_profiles_select_staff on public.professional_matching_profiles
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));
create policy professional_matching_profiles_select_self on public.professional_matching_profiles
  for select to authenticated
  using (professional_id = (select private.current_professional_id()) and (select private.has_permission('professionals.self')));
create policy professional_matching_profiles_update on public.professional_matching_profiles
  for update to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.matching')))
  with check (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.matching')));

create trigger professional_public_profiles_set_updated_at before update on public.professional_public_profiles
  for each row execute function private.set_updated_at();
create trigger professional_public_profiles_audit after insert or update or delete on public.professional_public_profiles
  for each row execute function private.audit_trigger();
create trigger professional_matching_profiles_set_updated_at before update on public.professional_matching_profiles
  for each row execute function private.set_updated_at();
create trigger professional_matching_profiles_audit after insert or update or delete on public.professional_matching_profiles
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- professional_professions: titles and licences (P4-36)
-- -----------------------------------------------------------------------------
create table public.professional_professions (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  profession_title_id uuid not null,
  licence_number text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_professions_pkey primary key (professional_id, id),
  constraint professional_professions_id_key unique (id),          -- target of Services et tarifs' FK
  constraint professional_professions_title_key unique (professional_id, profession_title_id),
  constraint professional_professions_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_professions_title_fkey foreign key (org_id, profession_title_id)
    references public.profession_titles (org_id, id),
  constraint professional_professions_licence_number_check check (licence_number ~ '^[A-Za-z0-9][A-Za-z0-9 -]{0,29}$')
);
create unique index professional_professions_one_primary on public.professional_professions (professional_id) where is_primary;
create index professional_professions_org_title_idx on public.professional_professions (org_id, profession_title_id);

-- Licence trimmed, required for regulated titles, in the base format and the order's (HINT
-- licence); at most two titles (HINT title). DETAIL is the row's title id, so a form of several
-- titles puts the refusal under that title's row. The count ignores the row's own title, so an
-- upsert that re-sends an existing title (its BEFORE INSERT fires before the conflict is found) is
-- not counted twice.
create function private.professional_professions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_pattern text;
  v_title text;
begin
  new.licence_number := nullif(pg_catalog.btrim(new.licence_number, E' \t\r\n'), '');
  select t.order_id, o.licence_pattern, t.name into v_order, v_pattern, v_title
    from public.profession_titles t
    left join public.professional_orders o on o.org_id = t.org_id and o.id = t.order_id
   where t.org_id = new.org_id and t.id = new.profession_title_id;
  if v_order is not null and new.licence_number is null then
    raise exception 'Le numéro de permis est requis pour ce titre.'
      using errcode = 'P0001', hint = 'licence', detail = new.profession_title_id::text;
  end if;
  if new.licence_number !~ '^[A-Za-z0-9][A-Za-z0-9 -]{0,29}$' then
    raise exception 'Numéro de permis invalide : lettres, chiffres, espaces et traits d''union (30 caractères au plus).'
      using errcode = 'P0001', hint = 'licence', detail = new.profession_title_id::text;
  end if;
  if v_pattern is not null and new.licence_number is not null and new.licence_number !~ v_pattern then
    raise exception 'Le numéro de permis pour % n''a pas le bon format.', v_title
      using errcode = 'P0001', hint = 'licence', detail = new.profession_title_id::text;
  end if;
  if tg_op = 'INSERT' and (
    select count(*) from public.professional_professions pp
     where pp.professional_id = new.professional_id and pp.profession_title_id <> new.profession_title_id
  ) >= 2 then
    raise exception 'Un professionnel a au plus deux titres.'
      using errcode = 'P0001', hint = 'title', detail = new.profession_title_id::text;
  end if;
  return new;
end;
$$;
create trigger professional_professions_guard
  before insert or update on public.professional_professions
  for each row execute function private.professional_professions_guard();

-- Exactly one primary whenever titles exist (checked at commit: set RPCs move it).
create function private.professional_professions_check_primary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pid uuid := coalesce(new.professional_id, old.professional_id);
begin
  if exists (select 1 from public.professional_professions pp where pp.professional_id = v_pid)
     and not exists (select 1 from public.professional_professions pp where pp.professional_id = v_pid and pp.is_primary) then
    raise exception 'Un des titres doit être le titre principal.' using errcode = 'P0001';
  end if;
  return null;
end;
$$;
create constraint trigger professional_professions_primary
  after insert or update or delete on public.professional_professions
  deferrable initially deferred
  for each row execute function private.professional_professions_check_primary();

revoke all on function private.professional_professions_guard(), private.professional_professions_check_primary()
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Junctions (matching sets) and IVAC numbers
-- -----------------------------------------------------------------------------
create table public.professional_clienteles (
  org_id uuid not null,
  professional_id uuid not null,
  clientele_id uuid not null,
  is_specialized boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_clienteles_pkey primary key (professional_id, clientele_id),
  constraint professional_clienteles_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_clienteles_clientele_fkey foreign key (org_id, clientele_id) references public.clienteles (org_id, id)
);

create table public.professional_specialties (
  org_id uuid not null,
  professional_id uuid not null,
  specialty_id uuid not null,
  is_specialized boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_specialties_pkey primary key (professional_id, specialty_id),
  constraint professional_specialties_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_specialties_specialty_fkey foreign key (org_id, specialty_id) references public.specialties (org_id, id)
);

create table public.professional_motifs (
  org_id uuid not null,
  professional_id uuid not null,
  motif_id uuid not null,
  created_at timestamptz not null default now(),
  constraint professional_motifs_pkey primary key (professional_id, motif_id),
  constraint professional_motifs_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_motifs_motif_fkey foreign key (org_id, motif_id) references public.motifs (org_id, id)
);

create table public.professional_languages (
  org_id uuid not null,
  professional_id uuid not null,
  language_id uuid not null,
  created_at timestamptz not null default now(),
  constraint professional_languages_pkey primary key (professional_id, language_id),
  constraint professional_languages_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_languages_language_fkey foreign key (org_id, language_id) references public.languages (org_id, id)
);

create table public.professional_payer_numbers (
  org_id uuid not null,
  professional_id uuid not null,
  payer_type text not null,
  number text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_payer_numbers_pkey primary key (professional_id, payer_type),
  -- Leading org_id: also serves the FK to professionals.
  constraint professional_payer_numbers_org_type_number_key unique (org_id, payer_type, number),
  constraint professional_payer_numbers_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_payer_numbers_payer_type_check check (payer_type in ('ivac')),
  -- Upper-case (set_professional_payer_number upper-cases), so the unique key ignores case.
  constraint professional_payer_numbers_number_check check (number ~ '^[A-Z0-9-]{3,30}$')
);

-- Leading org_id: serve the composite FKs, RLS, the usage counts and the matching lookups
-- (« who holds this motif / clientèle / approach / language ») with the professional's id from the
-- index; the primary keys serve « this professional's set ».
create index professional_clienteles_org_clientele_idx on public.professional_clienteles (org_id, clientele_id) include (professional_id);
create index professional_specialties_org_specialty_idx on public.professional_specialties (org_id, specialty_id) include (professional_id);
create index professional_motifs_org_motif_idx on public.professional_motifs (org_id, motif_id) include (professional_id);
create index professional_languages_org_language_idx on public.professional_languages (org_id, language_id) include (professional_id);

revoke all on public.professional_professions, public.professional_clienteles, public.professional_specialties,
              public.professional_motifs, public.professional_languages, public.professional_payer_numbers
  from anon, authenticated;
grant select on public.professional_professions, public.professional_clienteles, public.professional_specialties,
                public.professional_motifs, public.professional_languages, public.professional_payer_numbers
  to authenticated;
alter table public.professional_professions enable row level security;
alter table public.professional_clienteles enable row level security;
alter table public.professional_specialties enable row level security;
alter table public.professional_motifs enable row level security;
alter table public.professional_languages enable row level security;
alter table public.professional_payer_numbers enable row level security;

create policy professional_professions_select_staff on public.professional_professions
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));
create policy professional_professions_select_self on public.professional_professions
  for select to authenticated
  using (professional_id = (select private.current_professional_id()) and (select private.has_permission('professionals.self')));
create policy professional_clienteles_select_staff on public.professional_clienteles
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));
create policy professional_clienteles_select_self on public.professional_clienteles
  for select to authenticated
  using (professional_id = (select private.current_professional_id()) and (select private.has_permission('professionals.self')));
create policy professional_specialties_select_staff on public.professional_specialties
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));
create policy professional_specialties_select_self on public.professional_specialties
  for select to authenticated
  using (professional_id = (select private.current_professional_id()) and (select private.has_permission('professionals.self')));
create policy professional_motifs_select_staff on public.professional_motifs
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));
create policy professional_motifs_select_self on public.professional_motifs
  for select to authenticated
  using (professional_id = (select private.current_professional_id()) and (select private.has_permission('professionals.self')));
create policy professional_languages_select_staff on public.professional_languages
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));
create policy professional_languages_select_self on public.professional_languages
  for select to authenticated
  using (professional_id = (select private.current_professional_id()) and (select private.has_permission('professionals.self')));
create policy professional_payer_numbers_select_staff on public.professional_payer_numbers
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));
create policy professional_payer_numbers_select_self on public.professional_payer_numbers
  for select to authenticated
  using (professional_id = (select private.current_professional_id()) and (select private.has_permission('professionals.self')));

create trigger professional_professions_set_updated_at before update on public.professional_professions
  for each row execute function private.set_updated_at();
create trigger professional_professions_audit after insert or update or delete on public.professional_professions
  for each row execute function private.audit_trigger();
create trigger professional_clienteles_set_updated_at before update on public.professional_clienteles
  for each row execute function private.set_updated_at();
create trigger professional_clienteles_audit after insert or update or delete on public.professional_clienteles
  for each row execute function private.audit_trigger();
create trigger professional_specialties_set_updated_at before update on public.professional_specialties
  for each row execute function private.set_updated_at();
create trigger professional_specialties_audit after insert or update or delete on public.professional_specialties
  for each row execute function private.audit_trigger();
create trigger professional_motifs_audit after insert or update or delete on public.professional_motifs
  for each row execute function private.audit_trigger();
create trigger professional_languages_audit after insert or update or delete on public.professional_languages
  for each row execute function private.audit_trigger();
create trigger professional_payer_numbers_set_updated_at before update on public.professional_payer_numbers
  for each row execute function private.set_updated_at();
create trigger professional_payer_numbers_audit after insert or update or delete on public.professional_payer_numbers
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- Email: format, duplicates in the clinic, sync from the profile
-- -----------------------------------------------------------------------------
-- The email as stored (lower-cased, trimmed), or « Courriel invalide. » (HINT email).
create function private.professional_email(p_email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, ''), E' \t\r\n'));
begin
  if pg_catalog.char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Courriel invalide.' using errcode = 'P0001', hint = 'email';
  end if;
  return v_email;
end;
$$;

-- Raises unless no other professional and no profile of the clinic uses the email (P4-34: other
-- clinics are never checked, that would reveal their data). HINT email. Callers hold the org row lock.
create function private.assert_professional_email_free(p_org uuid, p_email text, p_except uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.professionals p
              where p.org_id = p_org and p.email = p_email and p.id is distinct from p_except)
     or exists (select 1 from public.profiles pr
                 where pg_catalog.lower(pr.email) = p_email and pr.org_id = p_org) then
    raise exception 'Ce courriel est déjà utilisé.' using errcode = 'P0001', hint = 'email';
  end if;
end;
$$;

-- Once linked, the account's email (auth.users → profiles) is the professional's email.
-- Conflict: the new login address is already the email of an unlinked professional of the clinic
-- (professionals_org_email_key), or GoTrue accepted an address professionals_email_check refuses
-- (no dot in the domain, over 254 characters). Raising here would fail GoTrue's email-change
-- confirmation, and « Mon compte » answers every email change neutrally: it never reveals that an
-- address is used (decision #38, ADR 0006). So the login change goes through and
-- professionals.email keeps its old value; nothing is raised or shown. The two addresses then
-- differ: 4a.4 readiness reports it (warning login_email_mismatch). No UI pre-check either: it
-- would reveal the address.
create function private.professionals_email_from_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    update public.professionals p set email = pg_catalog.lower(new.email)
     where p.profile_id = new.user_id and p.email is distinct from pg_catalog.lower(new.email);
  exception when unique_violation or check_violation then
    -- The statement changes email alone: only professionals_org_email_key (23505) or
    -- professionals_email_check (23514) can be violated.
    null;
  end;
  return null;
end;
$$;
create trigger profiles_sync_professional_email
  after update of email on public.profiles
  for each row when (old.email is distinct from new.email)
  execute function private.professionals_email_from_profile();

revoke all on function
  private.professional_email(text),
  private.assert_professional_email_free(uuid, text, uuid),
  private.professionals_email_from_profile()
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- create_professional: the record, its 1:1 rows, French, and the primary profession
-- -----------------------------------------------------------------------------
-- A refusal about one field carries its HINT, so the form puts it under that field without
-- reading the French text (« …caractères invisibles ou non permis » is about the first name, not
-- the licence): first_name, last_name, email, title, licence (also from the guard and the email
-- helpers). Refusals without a hint (no active language, permission) are about the whole form.
create function public.create_professional(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_profession_title_id uuid default null,
  p_licence_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_first text;
  v_last text;
  v_email text;
  v_title_active boolean;
  v_id uuid;
begin
  if not private.has_permission('professionals.manage') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  -- reference_text is shared by every reference list and raises without a hint: its refusal is
  -- raised again with the field's.
  begin
    v_first := private.reference_text(p_first_name, 'Le prénom', 80, true, true);
  exception when sqlstate 'P0001' then
    raise exception using message = sqlerrm, errcode = 'P0001', hint = 'first_name';
  end;
  begin
    v_last := private.reference_text(p_last_name, 'Le nom', 80, true, true);
  exception when sqlstate 'P0001' then
    raise exception using message = sqlerrm, errcode = 'P0001', hint = 'last_name';
  end;
  v_email := private.professional_email(p_email);
  if p_profession_title_id is null then
    if nullif(pg_catalog.btrim(p_licence_number, E' \t\r\n'), '') is not null then
      raise exception 'Un numéro de permis demande un titre.' using errcode = '22023', hint = 'licence';
    end if;
  else
    select t.is_active into v_title_active
      from public.profession_titles t where t.org_id = v_org and t.id = p_profession_title_id;
    if not found then
      raise exception 'Titre inconnu.' using errcode = '22023', hint = 'title';
    end if;
    if not v_title_active then
      raise exception 'Ce titre est archivé.' using errcode = 'P0001', hint = 'title';
    end if;
  end if;

  -- One creator per clinic at a time: the duplicate check below cannot race.
  perform 1 from public.organizations o where o.id = v_org for no key update;
  perform private.assert_professional_email_free(v_org, v_email, null);

  insert into public.professionals (org_id, first_name, last_name, email, status_changed_by, created_by)
  values (v_org, v_first, v_last, v_email, auth.uid(), auth.uid())
  returning id into v_id;
  insert into public.professional_public_profiles (org_id, professional_id) values (v_org, v_id);
  insert into public.professional_matching_profiles (org_id, professional_id) values (v_org, v_id);
  -- French: the clinic's system language (P4-42), which cannot be archived. Without one (data
  -- repaired by hand), refuse rather than create a record no language can match.
  insert into public.professional_languages (org_id, professional_id, language_id)
  select v_org, v_id, l.id from public.languages l
   where l.org_id = v_org and l.is_system and l.is_active
   order by l.sort_order
   limit 1;
  if not found then
    raise exception 'Aucune langue active n''est disponible.' using errcode = 'P0001';
  end if;
  if p_profession_title_id is not null then
    -- The guard trims the licence and applies the order's rules.
    insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
    values (v_org, v_id, p_profession_title_id, p_licence_number, true);
  end if;
  return v_id;
end;
$$;

-- Only while no account exists; afterwards the professional changes it in « Mon compte ».
create function public.set_professional_email(p_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_email text;
  v_current public.professionals;
begin
  if not private.has_permission('professionals.manage') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  -- Professional row first, then the org row (conventions §6 lock order).
  perform private.lock_professional(p_id);
  v_email := private.professional_email(p_email);
  select * into v_current from public.professionals p where p.id = p_id;
  if v_current.profile_id is not null then
    raise exception 'Ce professionnel a un compte : le courriel se change dans « Mon compte ».' using errcode = 'P0001';
  end if;
  if v_current.email = v_email then
    return;
  end if;
  perform 1 from public.organizations o where o.id = v_org for no key update;
  perform private.assert_professional_email_free(v_org, v_email, p_id);
  update public.professionals p set email = v_email where p.id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Set RPCs. Each checks its permission, locks the professional, validates every id in one
-- query (22023 for an id outside the clinic's list), refuses to add an archived row (one already
-- held may stay), then replaces the set with at most three statements and returns it. When any of
-- them touched a row, the professional's updated_at is bumped (professionals_directory reads it).
-- unnest(a, b) zips arrays; it is FROM-clause syntax, so it is never written pg_catalog.unnest.
-- -----------------------------------------------------------------------------
-- [{"id": uuid, "specialized"?: boolean}, …] → distinct ids (sorted) and their flags; a repeated
-- id is specialized when any of its items says so. At most 500 items (no list holds more). Ids are
-- checked against the canonical uuid form before the cast, so a malformed one gives 22023 (not
-- 22P02 from the cast).
create function private.parse_specialized_items(p_items jsonb, out ids uuid[], out flags boolean[])
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' or pg_catalog.jsonb_array_length(p_items) > 500 then
    raise exception 'Liste invalide : tableau JSON de 500 éléments au plus attendu.' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_items) as e(v)
     where pg_catalog.jsonb_typeof(e.v) <> 'object'
        or pg_catalog.jsonb_typeof(e.v -> 'id') is distinct from 'string'
        or (e.v ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or coalesce(pg_catalog.jsonb_typeof(e.v -> 'specialized'), 'null') not in ('boolean', 'null')
  ) then
    raise exception 'Élément invalide : {"id": uuid, "specialized": booléen facultatif} attendu.' using errcode = '22023';
  end if;
  select coalesce(pg_catalog.array_agg(x.id order by x.id), '{}'), coalesce(pg_catalog.array_agg(x.flag order by x.id), '{}')
    into ids, flags
    from (select (e.v ->> 'id')::uuid as id, bool_or(coalesce((e.v ->> 'specialized')::boolean, false)) as flag
            from pg_catalog.jsonb_array_elements(p_items) as e(v)
           group by 1) x;
end;
$$;

-- A uuid[] set without nulls or repeats; null itself is refused (an empty array clears).
create function private.distinct_ids(p_ids uuid[])
returns uuid[]
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_ids is null or pg_catalog.cardinality(p_ids) > 500 then
    raise exception 'Liste invalide : tableau de 500 identifiants au plus attendu.' using errcode = '22023';
  end if;
  return coalesce((select pg_catalog.array_agg(distinct x) from pg_catalog.unnest(p_ids) as x where x is not null), '{}');
end;
$$;

revoke all on function private.parse_specialized_items(jsonb), private.distinct_ids(uuid[])
  from public, anon, authenticated, service_role;

-- The representative set RPC (plan Task 4a.3).
create function public.set_professional_motifs(p_id uuid, p_motif_ids uuid[])
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_ids uuid[];
  v_bad text;
  v_rows int;
  v_n int;
begin
  if not private.has_permission('professionals.matching') then
    raise exception 'Permission refusée : professionals.matching' using errcode = '42501';
  end if;
  v_ids := private.distinct_ids(p_motif_ids);
  perform private.lock_professional(p_id);

  if exists (select 1 from pg_catalog.unnest(v_ids) as x
              where not exists (select 1 from public.motifs m where m.org_id = v_org and m.id = x)) then
    raise exception 'Motif inconnu.' using errcode = '22023';
  end if;

  -- An archived motif may stay where it already is, never be added.
  select m.name into v_bad
    from pg_catalog.unnest(v_ids) as x
    join public.motifs m on m.org_id = v_org and m.id = x
   where not m.is_active
     and not exists (select 1 from public.professional_motifs pm where pm.professional_id = p_id and pm.motif_id = x)
   order by m.sort_order, m.name
   limit 1;
  if v_bad is not null then
    raise exception 'Le motif « % » est archivé.', v_bad using errcode = 'P0001';
  end if;

  -- A restricted motif needs a regulated profession (P4-16).
  select m.name into v_bad
    from pg_catalog.unnest(v_ids) as x
    join public.motifs m on m.org_id = v_org and m.id = x
   where m.is_restricted
     and not exists (
       select 1 from public.professional_professions pp
         join public.profession_titles t on t.org_id = pp.org_id and t.id = pp.profession_title_id
        where pp.professional_id = p_id and t.order_id is not null)
   order by m.sort_order, m.name
   limit 1;
  if v_bad is not null then
    raise exception 'Le motif « % » est réservé aux professions réglementées.', v_bad using errcode = 'P0001';
  end if;

  delete from public.professional_motifs pm where pm.professional_id = p_id and pm.motif_id <> all (v_ids);
  get diagnostics v_rows = row_count;
  insert into public.professional_motifs (org_id, professional_id, motif_id)
  select v_org, p_id, x from pg_catalog.unnest(v_ids) as x
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_rows := v_rows + v_n;
  if v_rows > 0 then
    update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id;
  end if;

  return query select pm.motif_id from public.professional_motifs pm where pm.professional_id = p_id order by pm.motif_id;
end;
$$;

create function public.set_professional_clienteles(p_id uuid, p_items jsonb)
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
  v_bad text;
  v_rows int;
  v_n int;
begin
  if not private.has_permission('professionals.matching') then
    raise exception 'Permission refusée : professionals.matching' using errcode = '42501';
  end if;
  select x.ids, x.flags into v_ids, v_flags from private.parse_specialized_items(p_items) x;
  perform private.lock_professional(p_id);

  if exists (select 1 from pg_catalog.unnest(v_ids) as x(id)
              where not exists (select 1 from public.clienteles c where c.org_id = v_org and c.id = x.id)) then
    raise exception 'Clientèle inconnue.' using errcode = '22023';
  end if;
  select c.name into v_bad
    from pg_catalog.unnest(v_ids) as x(id)
    join public.clienteles c on c.org_id = v_org and c.id = x.id
   where not c.is_active
     and not exists (select 1 from public.professional_clienteles pc where pc.professional_id = p_id and pc.clientele_id = x.id)
   order by c.sort_order, c.name
   limit 1;
  if v_bad is not null then
    raise exception 'La clientèle « % » est archivée.', v_bad using errcode = 'P0001';
  end if;

  delete from public.professional_clienteles pc where pc.professional_id = p_id and pc.clientele_id <> all (v_ids);
  get diagnostics v_rows = row_count;
  -- Only flags that change are written (no audit noise).
  update public.professional_clienteles pc set is_specialized = x.flag
    from unnest(v_ids, v_flags) as x(id, flag)
   where pc.professional_id = p_id and pc.clientele_id = x.id and pc.is_specialized <> x.flag;
  get diagnostics v_n = row_count;
  v_rows := v_rows + v_n;
  insert into public.professional_clienteles (org_id, professional_id, clientele_id, is_specialized)
  select v_org, p_id, x.id, x.flag from unnest(v_ids, v_flags) as x(id, flag)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_rows := v_rows + v_n;
  if v_rows > 0 then
    update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id;
  end if;

  return query select pc.clientele_id, pc.is_specialized from public.professional_clienteles pc
                where pc.professional_id = p_id order by pc.clientele_id;
end;
$$;

create function public.set_professional_specialties(p_id uuid, p_items jsonb)
returns table (specialty_id uuid, is_specialized boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_ids uuid[];
  v_flags boolean[];
  v_bad text;
  v_rows int;
  v_n int;
begin
  if not private.has_permission('professionals.matching') then
    raise exception 'Permission refusée : professionals.matching' using errcode = '42501';
  end if;
  select x.ids, x.flags into v_ids, v_flags from private.parse_specialized_items(p_items) x;
  perform private.lock_professional(p_id);

  if exists (select 1 from pg_catalog.unnest(v_ids) as x(id)
              where not exists (select 1 from public.specialties s where s.org_id = v_org and s.id = x.id)) then
    raise exception 'Approche inconnue.' using errcode = '22023';
  end if;
  select s.name into v_bad
    from pg_catalog.unnest(v_ids) as x(id)
    join public.specialties s on s.org_id = v_org and s.id = x.id
   where not s.is_active
     and not exists (select 1 from public.professional_specialties ps where ps.professional_id = p_id and ps.specialty_id = x.id)
   order by s.sort_order, s.name
   limit 1;
  if v_bad is not null then
    raise exception 'L''approche « % » est archivée.', v_bad using errcode = 'P0001';
  end if;

  delete from public.professional_specialties ps where ps.professional_id = p_id and ps.specialty_id <> all (v_ids);
  get diagnostics v_rows = row_count;
  update public.professional_specialties ps set is_specialized = x.flag
    from unnest(v_ids, v_flags) as x(id, flag)
   where ps.professional_id = p_id and ps.specialty_id = x.id and ps.is_specialized <> x.flag;
  get diagnostics v_n = row_count;
  v_rows := v_rows + v_n;
  insert into public.professional_specialties (org_id, professional_id, specialty_id, is_specialized)
  select v_org, p_id, x.id, x.flag from unnest(v_ids, v_flags) as x(id, flag)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_rows := v_rows + v_n;
  if v_rows > 0 then
    update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id;
  end if;

  return query select ps.specialty_id, ps.is_specialized from public.professional_specialties ps
                where ps.professional_id = p_id order by ps.specialty_id;
end;
$$;

create function public.set_professional_languages(p_id uuid, p_language_ids uuid[])
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_ids uuid[];
  v_bad text;
  v_rows int;
  v_n int;
begin
  if not private.has_permission('professionals.matching') then
    raise exception 'Permission refusée : professionals.matching' using errcode = '42501';
  end if;
  v_ids := private.distinct_ids(p_language_ids);
  perform private.lock_professional(p_id);

  if pg_catalog.cardinality(v_ids) = 0 then
    raise exception 'Au moins une langue est requise.' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_catalog.unnest(v_ids) as x
              where not exists (select 1 from public.languages l where l.org_id = v_org and l.id = x)) then
    raise exception 'Langue inconnue.' using errcode = '22023';
  end if;
  select l.name into v_bad
    from pg_catalog.unnest(v_ids) as x
    join public.languages l on l.org_id = v_org and l.id = x
   where not l.is_active
     and not exists (select 1 from public.professional_languages pl where pl.professional_id = p_id and pl.language_id = x)
   order by l.sort_order, l.name
   limit 1;
  if v_bad is not null then
    raise exception 'La langue « % » est archivée.', v_bad using errcode = 'P0001';
  end if;

  delete from public.professional_languages pl where pl.professional_id = p_id and pl.language_id <> all (v_ids);
  get diagnostics v_rows = row_count;
  insert into public.professional_languages (org_id, professional_id, language_id)
  select v_org, p_id, x from pg_catalog.unnest(v_ids) as x
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_rows := v_rows + v_n;
  if v_rows > 0 then
    update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id;
  end if;

  return query select pl.language_id from public.professional_languages pl where pl.professional_id = p_id order by pl.language_id;
end;
$$;

-- [{"title_id": uuid, "licence_number"?: text, "is_primary"?: boolean}], 0 to 2 items. The flagged
-- item is primary, else the first. Order of writes: removed titles → rows losing the primary
-- flag → upsert by title (row ids survive; the one-primary index never sees two at once; the
-- deferred check sees one primary at commit).
create function public.set_professional_professions(p_id uuid, p_items jsonb)
returns table (id uuid, profession_title_id uuid, licence_number text, is_primary boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_count int;
  v_titles uuid[];
  v_licences text[];
  v_primary boolean[];
  v_tid uuid;
  v_bad text;
  v_rows int;
  v_n int;
begin
  if not private.has_permission('professionals.manage') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
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
    into v_titles, v_licences, v_primary
    from pg_catalog.jsonb_array_elements(p_items) with ordinality as e(v, ord);
  -- The refusals about one title name it (HINT title, DETAIL its id) for the editor's row.
  select x.tid into v_tid from pg_catalog.unnest(v_titles) as x(tid) group by x.tid having count(*) > 1 limit 1;
  if v_tid is not null then
    raise exception 'Un titre ne peut être choisi qu''une fois.' using errcode = 'P0001', hint = 'title', detail = v_tid::text;
  end if;
  if (select count(*) from pg_catalog.unnest(v_primary) as f where f) > 1 then
    raise exception 'Un seul titre principal.' using errcode = 'P0001';
  end if;
  if v_count > 0 and not (true = any (v_primary)) then
    v_primary[1] := true;
  end if;

  perform private.lock_professional(p_id);

  if exists (select 1 from pg_catalog.unnest(v_titles) as x(tid)
              where not exists (select 1 from public.profession_titles t where t.org_id = v_org and t.id = x.tid)) then
    raise exception 'Titre inconnu.' using errcode = '22023';
  end if;
  select x.tid into v_tid
    from pg_catalog.unnest(v_titles) as x(tid)
    join public.profession_titles t on t.org_id = v_org and t.id = x.tid
   where not t.is_active
     and not exists (select 1 from public.professional_professions pp
                      where pp.professional_id = p_id and pp.profession_title_id = x.tid)
   limit 1;
  if v_tid is not null then
    raise exception 'Ce titre est archivé.' using errcode = 'P0001', hint = 'title', detail = v_tid::text;
  end if;

  -- Restricted motifs keep a regulated profession (P4-16): the last one cannot go while held.
  if not exists (select 1 from pg_catalog.unnest(v_titles) as x(tid)
                   join public.profession_titles t on t.org_id = v_org and t.id = x.tid
                  where t.order_id is not null) then
    select pg_catalog.string_agg(m.name, ', ' order by m.sort_order, m.name) into v_bad
      from public.professional_motifs pm
      join public.motifs m on m.org_id = pm.org_id and m.id = pm.motif_id
     where pm.professional_id = p_id and m.is_restricted;
    if v_bad is not null then
      raise exception 'Retirez d''abord les motifs réservés aux professions réglementées : %.', v_bad using errcode = 'P0001';
    end if;
  end if;

  delete from public.professional_professions pp
   where pp.professional_id = p_id and pp.profession_title_id <> all (v_titles);
  get diagnostics v_rows = row_count;
  update public.professional_professions pp set is_primary = false
    from unnest(v_titles, v_primary) as x(tid, primary_flag)
   where pp.professional_id = p_id and pp.profession_title_id = x.tid and pp.is_primary and not x.primary_flag;
  get diagnostics v_n = row_count;
  v_rows := v_rows + v_n;
  -- Counts inserted rows and rows the DO UPDATE changed (its WHERE skips the others).
  insert into public.professional_professions as pp (org_id, professional_id, profession_title_id, licence_number, is_primary)
  select v_org, p_id, x.tid, x.licence, x.primary_flag
    from unnest(v_titles, v_licences, v_primary) as x(tid, licence, primary_flag)
  on conflict on constraint professional_professions_title_key do update
    set licence_number = excluded.licence_number, is_primary = excluded.is_primary
  where (pp.licence_number, pp.is_primary) is distinct from (excluded.licence_number, excluded.is_primary);
  get diagnostics v_n = row_count;
  v_rows := v_rows + v_n;
  if v_rows > 0 then
    update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id;
  end if;

  return query select pp.id, pp.profession_title_id, pp.licence_number, pp.is_primary
                 from public.professional_professions pp
                where pp.professional_id = p_id
                order by pp.is_primary desc, pp.created_at, pp.id;
end;
$$;

-- IVAC number (P4-14): unique per clinic whatever the case (stored upper-case); blank deletes it.
-- Refusals carry HINT ivac (the field).
create function public.set_professional_payer_number(p_id uuid, p_payer_type text, p_number text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_number text := pg_catalog.upper(nullif(pg_catalog.btrim(p_number, E' \t\r\n'), ''));
  v_rows int;
begin
  if not private.has_permission('professionals.manage') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  if p_payer_type is distinct from 'ivac' then
    raise exception 'Type de payeur inconnu : %', coalesce(p_payer_type, '(null)') using errcode = '22023';
  end if;
  perform private.lock_professional(p_id);

  if v_number is null then
    delete from public.professional_payer_numbers n where n.professional_id = p_id and n.payer_type = p_payer_type;
    if found then
      update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id;
    end if;
    return;
  end if;
  if v_number !~ '^[A-Z0-9-]{3,30}$' then
    raise exception 'Numéro IVAC invalide : 3 à 30 lettres, chiffres ou traits d''union.' using errcode = 'P0001', hint = 'ivac';
  end if;
  begin
    insert into public.professional_payer_numbers as n (org_id, professional_id, payer_type, number)
    values (v_org, p_id, p_payer_type, v_number)
    on conflict on constraint professional_payer_numbers_pkey do update
      set number = excluded.number
    where n.number <> excluded.number;
    get diagnostics v_rows = row_count;  -- 1: inserted, or the number changed
  exception when unique_violation then
    -- Only (org_id, payer_type, number) can be violated here: the primary key is the arbiter.
    raise exception 'Ce numéro IVAC est déjà attribué à un autre professionnel.' using errcode = 'P0001', hint = 'ivac';
  end;
  if v_rows > 0 then
    update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Usage counts for the settings lists (archive warnings): one union of grouped counts.
-- For professionals.settings (who edits the lists) or professionals.manage. Security definer, so
-- a holder without professionals.view (an override) still gets true counts, not RLS-filtered
-- ones; every count is scoped explicitly to the caller's org (which also lets each use its
-- (org_id, <x>_id) index). Only counts per reference id leave the function.
-- -----------------------------------------------------------------------------
create function public.list_professionals_reference_usage()
returns table (kind text, id uuid, usage int)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
begin
  if not (private.has_permission('professionals.settings') or private.has_permission('professionals.manage')) then
    raise exception 'Permission refusée : professionals.settings' using errcode = '42501';
  end if;
  return query
    select 'motifs'::text, x.motif_id, count(*)::int
      from public.professional_motifs x where x.org_id = v_org group by x.motif_id
    union all
    select 'clienteles', x.clientele_id, count(*)::int
      from public.professional_clienteles x where x.org_id = v_org group by x.clientele_id
    union all
    select 'specialties', x.specialty_id, count(*)::int
      from public.professional_specialties x where x.org_id = v_org group by x.specialty_id
    union all
    select 'languages', x.language_id, count(*)::int
      from public.professional_languages x where x.org_id = v_org group by x.language_id
    union all
    select 'profession_titles', x.profession_title_id, count(*)::int
      from public.professional_professions x where x.org_id = v_org group by x.profession_title_id
    union all
    -- Professionals currently inactive for this reason.
    select 'deactivation_reasons', x.deactivation_reason_id, count(*)::int
      from public.professionals x where x.org_id = v_org and x.status = 'inactive' group by x.deactivation_reason_id
    union all
    -- Parents: their active children.
    select 'profession_categories', x.category_id, count(*)::int
      from public.profession_titles x where x.org_id = v_org and x.is_active group by x.category_id
    union all
    select 'professional_orders', x.order_id, count(*)::int
      from public.profession_titles x where x.org_id = v_org and x.is_active and x.order_id is not null group by x.order_id
    union all
    select 'motif_categories', x.category_id, count(*)::int
      from public.motifs x where x.org_id = v_org and x.is_active and x.category_id is not null group by x.category_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges (service_role: none; 4b adds the service variants it needs)
-- -----------------------------------------------------------------------------
revoke all on function
  public.create_professional(text, text, text, uuid, text),
  public.set_professional_email(uuid, text),
  public.set_professional_professions(uuid, jsonb),
  public.set_professional_clienteles(uuid, jsonb),
  public.set_professional_specialties(uuid, jsonb),
  public.set_professional_motifs(uuid, uuid[]),
  public.set_professional_languages(uuid, uuid[]),
  public.set_professional_payer_number(uuid, text, text),
  public.list_professionals_reference_usage()
from public, anon, authenticated;
grant execute on function
  public.create_professional(text, text, text, uuid, text),
  public.set_professional_email(uuid, text),
  public.set_professional_professions(uuid, jsonb),
  public.set_professional_clienteles(uuid, jsonb),
  public.set_professional_specialties(uuid, jsonb),
  public.set_professional_motifs(uuid, uuid[]),
  public.set_professional_languages(uuid, uuid[]),
  public.set_professional_payer_number(uuid, text, text),
  public.list_professionals_reference_usage()
to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
