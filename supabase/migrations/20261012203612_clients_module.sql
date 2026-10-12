-- =============================================================================
-- Module Clients (« clients »): registry, tables, published reads (plan C1)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §6 (Keep / Change / Drop, data model)
-- Roadmap:   docs/plans/2026-10-11-next-modules-roadmap.md §2.2, §2.2 bis
-- Data:      docs/research/2026-10-11-gorendezvous-tour.md §2 (the client record, the 31 tags)
-- Answers:   docs/research/2026-10-12-christine-answers.md (both parents, one payer per invoice,
--            « Statut Indien », « Entente particulière », SMS and / or email per person)
-- Decisions: R-5, R-7, R-8, R-9, R-48, R-54, R-61, R-64, CL-1 … CL-10 (decisions log)
-- Recipe:    docs/standards/database-conventions.md §9
--
-- The clinic's clients (~7 400 active, ~1 080 archived in GOrendezvous). One row per person:
-- a child and each parent are three clients joined by `client_relations`, whose three rights
-- per direction (manage appointments and forms, receive communications, receive receipts and
-- invoices) replace a « responsible » column. GOrendezvous's tags become fields where a rule
-- reads them (rate variant, tax exemption, banned, incomplete file, special agreement); the
-- rest are ≤ 5 free tags from a clinic list. Staff-only notes live in `client_notes`, so a
-- professional can read her clients' rows (`my_clients`) without them. Every write goes
-- through RPCs (C2); the module starts disabled everywhere.
--
-- Published (other modules read these, never the tables): `clients_directory` (staff),
-- `my_clients` (the professional's own clients), `private.clients_link_professional(…)` (for
-- Rendez-vous, Demandes and the import), `private.client_visible_to_professional(…)`.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_module', true);

-- -----------------------------------------------------------------------------
-- Registry
-- -----------------------------------------------------------------------------
insert into public.modules (key, name) values ('clients', 'Clients')
on conflict do nothing;

insert into public.module_dependencies (module_key, depends_on) values ('clients', 'professionals')
on conflict do nothing;

insert into public.permissions (key, module_key, description) values
  ('clients.view',    'clients', 'Voir les dossiers des clients'),
  ('clients.manage',  'clients', 'Créer et modifier les dossiers des clients'),
  ('clients.merge',   'clients', 'Fusionner des dossiers de clients en double'),
  ('clients.privacy', 'clients', 'Exporter et anonymiser un dossier (Loi 25)'),
  ('clients.self',    'clients', 'Voir ses propres clients (professionnel)')
on conflict do nothing;

-- Defaults (plan §1): the admin holds everything; the conseillère and the adjointe read and
-- change the files; the adjointe merges duplicates; the professional sees her own clients.
insert into public.role_permissions (role, permission_key) values
  ('admin',           'clients.view'),
  ('admin',           'clients.manage'),
  ('admin',           'clients.merge'),
  ('admin',           'clients.privacy'),
  ('admin',           'clients.self'),
  ('counselor',       'clients.view'),
  ('counselor',       'clients.manage'),
  ('admin_assistant', 'clients.view'),
  ('admin_assistant', 'clients.manage'),
  ('admin_assistant', 'clients.merge'),
  ('provider',        'clients.self')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- referral_sources: « Comment avez-vous entendu parler de MANA ? » (a reference list)
-- -----------------------------------------------------------------------------
-- Same shape as Professionnels' reference lists: an immutable key, a French name the clinic may
-- edit, soft delete. Seeded with the website's list (business context §3); Demandes uses the
-- same list for a request's source (R-74).
create table public.referral_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  is_system boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_sources_key_check check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint referral_sources_name_check check (char_length(name) between 1 and 120 and private.is_tidy_text(name)),
  constraint referral_sources_org_id_key_key unique (org_id, key),
  constraint referral_sources_org_id_id_key unique (org_id, id)
);
create unique index referral_sources_org_name_key on public.referral_sources (org_id, lower(normalize(name, NFKC)));
create index referral_sources_org_sort_idx on public.referral_sources (org_id, sort_order);

-- -----------------------------------------------------------------------------
-- client_tags: the clinic's list of free tags (≤ 5 per client, R-7)
-- -----------------------------------------------------------------------------
-- A list per clinic rather than free text per client: a tag's name is never personal data, the
-- journal shows it, and a rename reaches every client.
create table public.client_tags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_tags_name_check check (char_length(name) between 1 and 40 and private.is_tidy_text(name)),
  constraint client_tags_org_id_id_key unique (org_id, id)
);
create unique index client_tags_org_name_key on public.client_tags (org_id, lower(normalize(name, NFKC)));
create index client_tags_org_sort_idx on public.client_tags (org_id, sort_order);

-- -----------------------------------------------------------------------------
-- clients: one person
-- -----------------------------------------------------------------------------
-- client_number: the clinic's file number (« CLI-… »), given in order at creation, never reused
-- nor changed. sex: GOrendezvous's F / M / Autre, also what « Femmes seulement » matches (CL-2).
-- pronouns: GOrendezvous's text, kept as typed (CL-3). Phones in E.164. language: of the
-- emails and the consent texts. reminders_by_sms / reminders_by_email: this person's channels
-- (a teenager by text, the parent by email: Christine, answer 3; R-54); the SMS « ARRÊT » consent
-- belongs to Communications. rate_variant: the student or reduced rate applied to this client's
-- sessions (services' variants, R-5). tax_exempt: « Statut Indien » (R-64): every line exempt.
-- special_agreement: « Entente particulière » (payment plan, custom billing): invoices wait for
-- validation (R-56); its note is in client_notes. shared_custody: both parents sign the consents
-- (R-48). external_ref: GOrendezvous's ClientId (import, unique per clinic). archived_at:
-- archived (soft delete); merged_into_id: archived by a merge into that client; anonymized_at:
-- identity blanked (Loi 25), ids and amounts kept.
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_number int not null,
  first_name text not null,
  last_name text not null,
  birth_first_name text,
  pronouns text,
  sex text,
  birthday date,
  email text,
  mobile_e164 text,
  home_e164 text,
  work_e164 text,
  work_ext text,
  language text not null default 'fr',
  time_zone text,
  reminders_by_sms boolean not null default true,
  reminders_by_email boolean not null default true,
  address_line1 text,
  address_line2 text,
  city text,
  province text,
  postal_code text,
  country text not null default 'CA',
  referral_source_id uuid,
  referred_by text,
  custom_field text,
  primary_professional_id uuid,
  rate_variant text,
  tax_exempt boolean not null default false,
  is_banned boolean not null default false,
  file_incomplete boolean not null default false,
  special_agreement boolean not null default false,
  shared_custody boolean not null default false,
  external_ref text,
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id) on delete set null,
  merged_into_id uuid,
  anonymized_at timestamptz,
  anonymized_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint clients_org_id_id_key unique (org_id, id),
  constraint clients_org_id_client_number_key unique (org_id, client_number),
  constraint clients_referral_source_fkey foreign key (org_id, referral_source_id) references public.referral_sources (org_id, id),
  constraint clients_primary_professional_fkey foreign key (org_id, primary_professional_id) references public.professionals (org_id, id),
  constraint clients_merged_into_fkey foreign key (org_id, merged_into_id) references public.clients (org_id, id),
  constraint clients_client_number_check check (client_number >= 1),
  constraint clients_first_name_check check (char_length(first_name) between 1 and 100 and private.is_tidy_text(first_name)),
  constraint clients_last_name_check check (char_length(last_name) between 1 and 100 and private.is_tidy_text(last_name)),
  constraint clients_birth_first_name_check check (char_length(birth_first_name) between 1 and 100 and private.is_tidy_text(birth_first_name)),
  constraint clients_pronouns_check check (char_length(pronouns) between 1 and 40 and private.is_tidy_text(pronouns)),
  constraint clients_sex_check check (sex in ('female', 'male', 'other')),
  constraint clients_birthday_check check (birthday >= date '1900-01-01'),
  constraint clients_email_check check (email = lower(email) and char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint clients_mobile_e164_check check (mobile_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint clients_home_e164_check check (home_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint clients_work_e164_check check (work_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint clients_work_ext_check check (work_ext ~ '^[0-9]{1,10}$'),
  constraint clients_language_check check (language in ('fr', 'en')),
  constraint clients_time_zone_check check (time_zone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){0,2}$' and char_length(time_zone) <= 64),
  constraint clients_address_line1_check check (char_length(address_line1) between 1 and 200 and private.is_tidy_text(address_line1)),
  constraint clients_address_line2_check check (char_length(address_line2) between 1 and 200 and private.is_tidy_text(address_line2)),
  constraint clients_city_check check (char_length(city) between 1 and 100 and private.is_tidy_text(city)),
  constraint clients_country_check check (country ~ '^[A-Z]{2}$'),
  constraint clients_province_check check (
    province is null
    or (country = 'CA' and province in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'))
    or (country <> 'CA' and char_length(province) between 1 and 100 and private.is_tidy_text(province))),
  constraint clients_postal_code_check check (
    postal_code is null
    or (country = 'CA' and postal_code ~ '^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$')
    or (country <> 'CA' and char_length(postal_code) between 1 and 20 and private.is_tidy_text(postal_code))),
  constraint clients_referred_by_check check (char_length(referred_by) between 1 and 200 and private.is_tidy_text(referred_by)),
  constraint clients_custom_field_check check (char_length(custom_field) between 1 and 200 and private.is_tidy_text(custom_field)),
  constraint clients_rate_variant_check check (rate_variant in ('student', 'reduced')),
  constraint clients_external_ref_check check (char_length(external_ref) between 1 and 64 and private.is_tidy_text(external_ref)),
  constraint clients_merged_not_self_check check (merged_into_id is null or merged_into_id <> id),
  constraint clients_merged_archived_check check (merged_into_id is null or archived_at is not null)
);
create unique index clients_org_external_ref_key on public.clients (org_id, external_ref) where external_ref is not null;
-- The list (keyset by name), the search and the duplicate checks (C2).
create index clients_org_name_idx on public.clients (org_id, lower(last_name), lower(first_name), id);
create index clients_org_email_idx on public.clients (org_id, email) where email is not null;
create index clients_org_mobile_idx on public.clients (org_id, mobile_e164) where mobile_e164 is not null;
create index clients_org_home_idx on public.clients (org_id, home_e164) where home_e164 is not null;
create index clients_org_birthday_idx on public.clients (org_id, birthday) where birthday is not null;
create index clients_org_referral_source_idx on public.clients (org_id, referral_source_id);
create index clients_org_primary_professional_idx on public.clients (org_id, primary_professional_id);
create index clients_org_merged_into_idx on public.clients (org_id, merged_into_id);
create index clients_archived_by_idx on public.clients (archived_by);
create index clients_anonymized_by_idx on public.clients (anonymized_by);
create index clients_created_by_idx on public.clients (created_by);

-- The next file number of the clinic, given in order: the org row is locked (the RPCs lock it
-- first anyway, conventions §6), then the highest number + 1 (an index-only read).
create function private.clients_assign_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_number is null then
    perform 1 from public.organizations o where o.id = new.org_id for no key update;
    select coalesce(max(c.client_number), 0) + 1 into new.client_number
      from public.clients c where c.org_id = new.org_id;
  end if;
  return new;
end;
$$;
revoke all on function private.clients_assign_number() from public, anon, authenticated, service_role;
create trigger clients_assign_number before insert on public.clients
  for each row execute function private.clients_assign_number();

-- The clinic and the file number of a client never change.
create function private.clients_freeze_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.org_id is distinct from old.org_id or new.client_number is distinct from old.client_number then
    raise exception 'La clinique et le numéro d''un dossier client ne changent pas.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.clients_freeze_identity() from public, anon, authenticated, service_role;
create trigger clients_freeze_identity before update on public.clients
  for each row execute function private.clients_freeze_identity();

-- -----------------------------------------------------------------------------
-- client_notes: what only staff read (never a professional, never my_clients)
-- -----------------------------------------------------------------------------
create table public.client_notes (
  client_id uuid primary key,
  org_id uuid not null,
  admin_notes text,
  special_agreement_note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  constraint client_notes_client_fkey foreign key (org_id, client_id) references public.clients (org_id, id) on delete cascade,
  constraint client_notes_admin_notes_check check (char_length(admin_notes) between 1 and 5000),
  constraint client_notes_special_agreement_note_check check (char_length(special_agreement_note) between 1 and 1000)
);
create index client_notes_org_idx on public.client_notes (org_id, client_id);
create index client_notes_updated_by_idx on public.client_notes (updated_by);

-- -----------------------------------------------------------------------------
-- client_relations: two clients and what each may do for the other (R-9)
-- -----------------------------------------------------------------------------
-- One row per pair, stored with client_a_id < client_b_id (a trigger swaps a row written the
-- other way, ids, types and rights together), read from both sides. type_a_to_b is what a is
-- to b (« parent »); type_b_to_a its inverse (« child »). Per direction: a_main_contact (a is
-- b's main contact), a_manages_appointments (a books, changes and signs forms for b: the right
-- the 14-year consent rule reads, R-48), a_receives_communications (reminders and messages
-- about b go to a, on a's own channels), a_receives_invoices (a may be the payer of b's
-- invoices, chosen per invoice: R-61); the same four for b.
create table public.client_relations (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  client_a_id uuid not null,
  client_b_id uuid not null,
  type_a_to_b text not null,
  type_b_to_a text not null,
  a_main_contact boolean not null default false,
  a_manages_appointments boolean not null default false,
  a_receives_communications boolean not null default false,
  a_receives_invoices boolean not null default false,
  b_main_contact boolean not null default false,
  b_manages_appointments boolean not null default false,
  b_receives_communications boolean not null default false,
  b_receives_invoices boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint client_relations_pkey primary key (client_a_id, id),
  constraint client_relations_id_key unique (id),
  constraint client_relations_pair_key unique (org_id, client_a_id, client_b_id),
  constraint client_relations_a_fkey foreign key (org_id, client_a_id) references public.clients (org_id, id) on delete cascade,
  constraint client_relations_b_fkey foreign key (org_id, client_b_id) references public.clients (org_id, id) on delete cascade,
  constraint client_relations_order_check check (client_a_id < client_b_id),
  constraint client_relations_types_check check ((type_a_to_b, type_b_to_a) in (
    ('parent', 'child'), ('child', 'parent'),
    ('guardian', 'ward'), ('ward', 'guardian'),
    ('spouse', 'spouse'), ('sibling', 'sibling'), ('other', 'other')))
);
create index client_relations_org_b_idx on public.client_relations (org_id, client_b_id);
create index client_relations_b_idx on public.client_relations (client_b_id);
create index client_relations_created_by_idx on public.client_relations (created_by);

-- Writes the pair in order: a row given with a > b is swapped (ids, types, rights).
create function private.client_relations_order_pair()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_type text;
  v_main boolean;
  v_manage boolean;
  v_comm boolean;
  v_inv boolean;
begin
  if new.client_a_id = new.client_b_id then
    raise exception 'Un client ne peut pas être lié à lui-même.' using errcode = 'P0001', hint = 'related_client_id';
  end if;
  if new.client_a_id > new.client_b_id then
    v_id := new.client_a_id;             new.client_a_id := new.client_b_id;                         new.client_b_id := v_id;
    v_type := new.type_a_to_b;           new.type_a_to_b := new.type_b_to_a;                         new.type_b_to_a := v_type;
    v_main := new.a_main_contact;        new.a_main_contact := new.b_main_contact;                   new.b_main_contact := v_main;
    v_manage := new.a_manages_appointments; new.a_manages_appointments := new.b_manages_appointments; new.b_manages_appointments := v_manage;
    v_comm := new.a_receives_communications; new.a_receives_communications := new.b_receives_communications; new.b_receives_communications := v_comm;
    v_inv := new.a_receives_invoices;    new.a_receives_invoices := new.b_receives_invoices;         new.b_receives_invoices := v_inv;
  end if;
  return new;
end;
$$;
revoke all on function private.client_relations_order_pair() from public, anon, authenticated, service_role;
create trigger client_relations_order_pair before insert or update on public.client_relations
  for each row execute function private.client_relations_order_pair();

-- -----------------------------------------------------------------------------
-- client_insurances: main and secondary private insurance (receipts for the insurer)
-- -----------------------------------------------------------------------------
create table public.client_insurances (
  client_id uuid not null,
  rank smallint not null,
  org_id uuid not null,
  insurer text not null,
  policy_number text,
  certificate_number text,
  holder_relation text not null default 'self',
  holder_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_insurances_pkey primary key (client_id, rank),
  constraint client_insurances_client_fkey foreign key (org_id, client_id) references public.clients (org_id, id) on delete cascade,
  constraint client_insurances_rank_check check (rank in (1, 2)),
  constraint client_insurances_insurer_check check (char_length(insurer) between 1 and 120 and private.is_tidy_text(insurer)),
  constraint client_insurances_policy_number_check check (char_length(policy_number) between 1 and 60 and private.is_tidy_text(policy_number)),
  constraint client_insurances_certificate_number_check check (char_length(certificate_number) between 1 and 60 and private.is_tidy_text(certificate_number)),
  constraint client_insurances_holder_relation_check check (holder_relation in ('self', 'spouse', 'parent', 'other')),
  constraint client_insurances_holder_name_check check (char_length(holder_name) between 1 and 200 and private.is_tidy_text(holder_name))
);
create index client_insurances_org_idx on public.client_insurances (org_id, client_id);

-- -----------------------------------------------------------------------------
-- client_payers: an IVAC file or a PAE agreement (R-29, R-61, R-62; no employer program)
-- -----------------------------------------------------------------------------
-- organisation_name: the PAE provider (null for IVAC). session_amount_cents: what the payer
-- covers per session; max_sessions / max_amount_cents: its limits (Facturation counts usage).
-- At most one active payer per kind and client; an IVAC file number is the clinic's once.
create table public.client_payers (
  id uuid not null default gen_random_uuid(),
  client_id uuid not null,
  org_id uuid not null,
  kind text not null,
  organisation_name text,
  file_number text,
  session_amount_cents int,
  max_sessions smallint,
  max_amount_cents int,
  starts_on date,
  expires_on date,
  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint client_payers_pkey primary key (client_id, id),
  constraint client_payers_id_key unique (id),
  constraint client_payers_client_fkey foreign key (org_id, client_id) references public.clients (org_id, id) on delete cascade,
  constraint client_payers_kind_check check (kind in ('ivac', 'pae')),
  constraint client_payers_organisation_name_check check (char_length(organisation_name) between 1 and 120 and private.is_tidy_text(organisation_name)),
  constraint client_payers_pae_organisation_check check (kind <> 'pae' or organisation_name is not null),
  constraint client_payers_file_number_check check (char_length(file_number) between 1 and 60 and private.is_tidy_text(file_number)),
  constraint client_payers_ivac_file_check check (kind <> 'ivac' or file_number is not null),
  constraint client_payers_session_amount_check check (session_amount_cents between 0 and 1000000),
  constraint client_payers_max_sessions_check check (max_sessions between 1 and 999),
  constraint client_payers_max_amount_check check (max_amount_cents between 1 and 100000000),
  constraint client_payers_period_check check (expires_on is null or starts_on is null or expires_on >= starts_on),
  constraint client_payers_note_check check (char_length(note) between 1 and 1000)
);
create unique index client_payers_one_active_kind_key on public.client_payers (client_id, kind) where is_active;
create unique index client_payers_ivac_file_key on public.client_payers (org_id, lower(file_number)) where kind = 'ivac' and is_active;
create index client_payers_org_idx on public.client_payers (org_id, client_id);
create index client_payers_created_by_idx on public.client_payers (created_by);

-- -----------------------------------------------------------------------------
-- client_tag_links: a client's free tags (≤ 5, R-7)
-- -----------------------------------------------------------------------------
create table public.client_tag_links (
  client_id uuid not null,
  tag_id uuid not null,
  org_id uuid not null,
  created_at timestamptz not null default now(),
  constraint client_tag_links_pkey primary key (client_id, tag_id),
  constraint client_tag_links_client_fkey foreign key (org_id, client_id) references public.clients (org_id, id) on delete cascade,
  constraint client_tag_links_tag_fkey foreign key (org_id, tag_id) references public.client_tags (org_id, id) on delete cascade
);
create index client_tag_links_org_tag_idx on public.client_tag_links (org_id, tag_id);
create index client_tag_links_org_client_idx on public.client_tag_links (org_id, client_id);

create function private.client_tag_links_max_five()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The client row is locked so two concurrent writes cannot both pass at four.
  perform 1 from public.clients c where c.id = new.client_id for no key update;
  if (select count(*) from public.client_tag_links l where l.client_id = new.client_id) > 5 then
    raise exception 'Un client a au plus 5 étiquettes.' using errcode = 'P0001', hint = 'tag_ids';
  end if;
  return null;
end;
$$;
revoke all on function private.client_tag_links_max_five() from public, anon, authenticated, service_role;
create trigger client_tag_links_max_five after insert on public.client_tag_links
  for each row execute function private.client_tag_links_max_five();

-- -----------------------------------------------------------------------------
-- client_professional_links: who a professional may see (R-8)
-- -----------------------------------------------------------------------------
-- A professional sees a client she created, saw or will see (Rendez-vous), took from a request
-- (Demandes), or of whom she is the primary professional. reason: the first link's.
-- Rows come from private.clients_link_professional (C2's RPCs, Rendez-vous, Demandes, import).
create table public.client_professional_links (
  client_id uuid not null,
  professional_id uuid not null,
  org_id uuid not null,
  reason text not null,
  first_linked_at timestamptz not null default now(),
  last_linked_at timestamptz not null default now(),
  constraint client_professional_links_pkey primary key (client_id, professional_id),
  constraint client_professional_links_client_fkey foreign key (org_id, client_id) references public.clients (org_id, id) on delete cascade,
  constraint client_professional_links_professional_fkey foreign key (org_id, professional_id) references public.professionals (org_id, id) on delete cascade,
  constraint client_professional_links_reason_check check (reason in ('created', 'primary', 'appointment', 'demande', 'import'))
);
-- The professional's side: her own clients (the RLS term and my_clients).
create index client_professional_links_professional_idx on public.client_professional_links (professional_id, client_id);
create index client_professional_links_org_professional_idx on public.client_professional_links (org_id, professional_id);

-- -----------------------------------------------------------------------------
-- client_merges: the trail of a merge (C2's merge_clients)
-- -----------------------------------------------------------------------------
-- moved: counts per kind of row moved to the kept client ({"relations": 2, …}).
create table public.client_merges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  kept_client_id uuid not null,
  merged_client_id uuid not null,
  moved jsonb not null default '{}',
  merged_at timestamptz not null default now(),
  merged_by uuid references public.profiles(user_id) on delete set null,
  constraint client_merges_kept_fkey foreign key (org_id, kept_client_id) references public.clients (org_id, id),
  constraint client_merges_merged_fkey foreign key (org_id, merged_client_id) references public.clients (org_id, id),
  constraint client_merges_distinct_check check (kept_client_id <> merged_client_id),
  constraint client_merges_moved_check check (jsonb_typeof(moved) = 'object'),
  constraint client_merges_merged_client_key unique (merged_client_id)
);
create index client_merges_org_kept_idx on public.client_merges (org_id, kept_client_id);
create index client_merges_org_merged_idx on public.client_merges (org_id, merged_client_id);
create index client_merges_merged_by_idx on public.client_merges (merged_by);

-- -----------------------------------------------------------------------------
-- Privileges, RLS, updated_at, audit
-- -----------------------------------------------------------------------------
revoke all on public.referral_sources, public.client_tags, public.clients, public.client_notes,
              public.client_relations, public.client_insurances, public.client_payers,
              public.client_tag_links, public.client_professional_links, public.client_merges
  from anon, authenticated;
grant select on public.referral_sources, public.client_tags, public.clients, public.client_notes,
                public.client_relations, public.client_insurances, public.client_payers,
                public.client_tag_links, public.client_professional_links, public.client_merges
  to authenticated;

alter table public.referral_sources enable row level security;
alter table public.client_tags enable row level security;
alter table public.clients enable row level security;
alter table public.client_notes enable row level security;
alter table public.client_relations enable row level security;
alter table public.client_insurances enable row level security;
alter table public.client_payers enable row level security;
alter table public.client_tag_links enable row level security;
alter table public.client_professional_links enable row level security;
alter table public.client_merges enable row level security;

-- Staff: the clinic's rows with clients.view.
create policy referral_sources_select on public.referral_sources
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));
create policy client_tags_select on public.client_tags
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));
create policy clients_select_staff on public.clients
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));
create policy client_notes_select on public.client_notes
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));
create policy client_relations_select on public.client_relations
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));
create policy client_insurances_select on public.client_insurances
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));
create policy client_payers_select on public.client_payers
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));
create policy client_tag_links_select on public.client_tag_links
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));
create policy client_professional_links_select_staff on public.client_professional_links
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));
create policy client_merges_select on public.client_merges
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));

-- The professional (clients.self): her own links, and the rows of the clients they name. Notes,
-- relations, insurance, payers, tags and merges stay staff-only (CL-5).
create policy client_professional_links_select_self on public.client_professional_links
  for select to authenticated
  using (professional_id = (select private.current_professional_id()) and (select private.has_permission('clients.self')));
create policy clients_select_self on public.clients
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (select private.has_permission('clients.self'))
    and exists (select 1 from public.client_professional_links l
                 where l.client_id = clients.id
                   and l.professional_id = (select private.current_professional_id())));

create trigger referral_sources_set_updated_at before update on public.referral_sources
  for each row execute function private.set_updated_at();
create trigger client_tags_set_updated_at before update on public.client_tags
  for each row execute function private.set_updated_at();
create trigger clients_set_updated_at before update on public.clients
  for each row execute function private.set_updated_at();
create trigger client_notes_set_updated_at before update on public.client_notes
  for each row execute function private.set_updated_at();
create trigger client_relations_set_updated_at before update on public.client_relations
  for each row execute function private.set_updated_at();
create trigger client_insurances_set_updated_at before update on public.client_insurances
  for each row execute function private.set_updated_at();
create trigger client_payers_set_updated_at before update on public.client_payers
  for each row execute function private.set_updated_at();

create trigger referral_sources_freeze_identity before update on public.referral_sources
  for each row execute function private.freeze_reference_identity();

-- Personal data stays out of audit_log (Loi 25: the log outlives the record and its readers):
-- the history shows that a field changed, not its value. Ids, flags and dates stay readable.
create trigger referral_sources_audit after insert or update or delete on public.referral_sources
  for each row execute function private.audit_trigger();
create trigger client_tags_audit after insert or update or delete on public.client_tags
  for each row execute function private.audit_trigger();
create trigger clients_audit after insert or update or delete on public.clients
  for each row execute function private.audit_trigger(
    'first_name', 'last_name', 'birth_first_name', 'pronouns', 'sex', 'birthday', 'email',
    'mobile_e164', 'home_e164', 'work_e164', 'work_ext', 'time_zone', 'address_line1', 'address_line2',
    'city', 'province', 'postal_code', 'country', 'referred_by', 'custom_field', 'tax_exempt');
create trigger client_notes_audit after insert or update or delete on public.client_notes
  for each row execute function private.audit_trigger('admin_notes', 'special_agreement_note');
create trigger client_relations_audit after insert or update or delete on public.client_relations
  for each row execute function private.audit_trigger();
create trigger client_insurances_audit after insert or update or delete on public.client_insurances
  for each row execute function private.audit_trigger('insurer', 'policy_number', 'certificate_number', 'holder_relation', 'holder_name');
create trigger client_payers_audit after insert or update or delete on public.client_payers
  for each row execute function private.audit_trigger('file_number', 'note');
create trigger client_tag_links_audit after insert or update or delete on public.client_tag_links
  for each row execute function private.audit_trigger();
create trigger client_professional_links_audit after insert or update or delete on public.client_professional_links
  for each row execute function private.audit_trigger();
create trigger client_merges_audit after insert or update or delete on public.client_merges
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- Published reads
-- -----------------------------------------------------------------------------
-- clients_directory (staff, clients.view): one row per client with what other modules show and
-- decide on (Demandes' matching and intake, Rendez-vous' booking, Facturation's payer and
-- prices). Ids and codes, never labels; later batches only append columns.
create view public.clients_directory with (security_invoker = true) as
select c.id, c.org_id, c.client_number,
       c.first_name, c.last_name, c.first_name || ' ' || c.last_name as display_name,
       c.pronouns, c.sex, c.birthday, c.language, c.email, c.mobile_e164,
       c.reminders_by_sms, c.reminders_by_email,
       c.primary_professional_id, c.referral_source_id,
       c.rate_variant, c.tax_exempt, c.is_banned, c.file_incomplete, c.special_agreement, c.shared_custody,
       c.external_ref,
       c.archived_at is not null as is_archived, c.archived_at, c.merged_into_id,
       c.anonymized_at is not null as is_anonymized,
       c.created_at, c.updated_at
  from public.clients c
 -- The table's RLS scopes to the clinic; this term keeps a professional's own clients (readable
 -- through clients_select_self) out of the staff view.
 where (select private.has_permission('clients.view'));
revoke all on public.clients_directory from anon, authenticated;
grant select on public.clients_directory to authenticated;

-- my_clients (the professional, clients.self): her linked clients, with what she needs to reach
-- them, never staff notes, insurance or payers.
create view public.my_clients with (security_invoker = true) as
select c.id, c.org_id, c.client_number,
       c.first_name, c.last_name, c.first_name || ' ' || c.last_name as display_name,
       c.pronouns, c.birthday, c.language, c.email, c.mobile_e164,
       coalesce(c.primary_professional_id = l.professional_id, false) as is_primary,
       l.reason, l.first_linked_at, l.last_linked_at,
       c.archived_at is not null as is_archived
  from public.clients c
  join public.client_professional_links l on l.client_id = c.id
 where l.professional_id = (select private.current_professional_id())
   and (select private.has_permission('clients.self'))
   and c.anonymized_at is null;
revoke all on public.my_clients from anon, authenticated;
grant select on public.my_clients to authenticated;

-- Links a client to a professional (Rendez-vous on booking, Demandes on assignment, C2 on
-- creation and primary, the import): first reason kept, last time moved. For definer callers,
-- after their own permission check, with the org they verified. Granted to no role.
create function private.clients_link_professional(p_org uuid, p_client_id uuid, p_professional_id uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_client_id is null or p_professional_id is null then
    return;
  end if;
  if p_reason is null or p_reason not in ('created', 'primary', 'appointment', 'demande', 'import') then
    raise exception 'Raison de lien inconnue : %', p_reason using errcode = '22023';
  end if;
  insert into public.client_professional_links (client_id, professional_id, org_id, reason)
  values (p_client_id, p_professional_id, p_org, p_reason)
  on conflict (client_id, professional_id) do update set last_linked_at = now();
end;
$$;
revoke all on function private.clients_link_professional(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;

-- Whether a professional may see a client (Rendez-vous' and Facturation's provider reads).
create function private.client_visible_to_professional(p_client_id uuid, p_professional_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.client_professional_links l
                  where l.client_id = p_client_id and l.professional_id = p_professional_id)
$$;
revoke all on function private.client_visible_to_professional(uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Seed: the referral sources (website list, business context §3)
-- -----------------------------------------------------------------------------
create function private.seed_clients_reference(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform pg_catalog.set_config('app.audit_source', 'seed:clients_reference', true);
  insert into public.referral_sources (org_id, key, name, is_system, sort_order)
  select p_org, v.key, v.name, true, v.sort_order
    from (values
      ('google',                'Google',                                 10),
      ('social_media',          'Réseaux sociaux',                        20),
      ('word_of_mouth',         'Recommandation d''un proche',            30),
      ('professional_referral', 'Référence d''un professionnel',          40),
      ('employer_eap',          'Employeur ou PAE',                       50),
      ('school_organization',   'École ou organisme',                     60),
      ('event',                 'Conférence, atelier ou événement',       70),
      ('returning_client',      'Déjà client',                            80),
      ('other',                 'Autre',                                  90)
    ) as v(key, name, sort_order)
  on conflict do nothing;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

create function private.seed_clients_reference_on_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_clients_reference(new.id);
  return null;
end;
$$;

create trigger organizations_seed_clients_reference
  after insert on public.organizations
  for each row execute function private.seed_clients_reference_on_org();

revoke all on function private.seed_clients_reference(uuid), private.seed_clients_reference_on_org()
  from public, anon, authenticated, service_role;

-- Existing organizations (production).
select private.seed_clients_reference(o.id) from public.organizations o;
