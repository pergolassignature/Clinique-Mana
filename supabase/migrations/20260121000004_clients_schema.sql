-- Migration: clients_schema
-- Module: clients
-- Gate: 2 — Schema
-- Created: 2026-01-21

-- =============================================================================
-- CLIENTS TABLE
-- Core client data - patients/consultants of the clinic
-- =============================================================================

create table public.clients (
  id uuid primary key default gen_random_uuid(),

  -- Display ID (human-readable, auto-generated)
  client_id text unique not null, -- Format: CLI-0000001

  -- Identity (8 fields)
  first_name text not null,
  last_name text not null,
  birth_first_name text, -- Legal first name if different
  pronouns text,
  sex text check (sex in ('male', 'female', 'other', 'unknown')),
  language text not null default 'fr' check (language in ('fr', 'en', 'other')),
  birthday date,

  -- Contact (8 fields)
  email text,
  cell_phone_country_code text default '+1',
  cell_phone text,
  home_phone_country_code text default '+1',
  home_phone text,
  work_phone_country_code text default '+1',
  work_phone text,
  work_phone_extension text,

  -- Address (7 fields)
  street_number text,
  street_name text,
  apartment text,
  city text,
  province text check (province in ('QC', 'ON', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'NT', 'YT', 'NU')),
  country text default 'Canada',
  postal_code text,

  -- Clinical/Admin (9 fields)
  last_appointment_at timestamptz,
  last_appointment_service text,
  last_appointment_professional text,
  primary_professional_id uuid references public.professionals(id) on delete set null,
  referred_by text,
  custom_field text,
  tags text[] default '{}',
  is_archived boolean not null default false,
  responsible_client_id uuid references public.clients(id) on delete set null, -- For minors

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- SEQUENCE FOR CLIENT_ID
-- Auto-generate CLI-0000001, CLI-0000002, etc.
-- =============================================================================

create sequence public.clients_client_id_seq start 1;

create or replace function public.generate_client_id()
returns trigger as $$
begin
  if new.client_id is null then
    new.client_id := 'CLI-' || lpad(nextval('public.clients_client_id_seq')::text, 7, '0');
  end if;
  return new;
end;
$$ language plpgsql;

create trigger clients_generate_client_id
  before insert on public.clients
  for each row
  execute function public.generate_client_id();

-- =============================================================================
-- INDEXES
-- =============================================================================

create index clients_client_id_idx on public.clients(client_id);
create index clients_last_name_idx on public.clients(last_name);
create index clients_first_name_idx on public.clients(first_name);
create index clients_email_idx on public.clients(email) where email is not null;
create index clients_cell_phone_idx on public.clients(cell_phone) where cell_phone is not null;
create index clients_primary_professional_id_idx on public.clients(primary_professional_id) where primary_professional_id is not null;
create index clients_is_archived_idx on public.clients(is_archived);
create index clients_tags_idx on public.clients using gin(tags);
create index clients_created_at_idx on public.clients(created_at);

-- =============================================================================
-- COMMENTS
-- =============================================================================

comment on table public.clients is 'Client (patient/consultant) records';
comment on column public.clients.client_id is 'Human-readable ID: CLI-0000001 format';
comment on column public.clients.birth_first_name is 'Legal first name if different from preferred first_name';
comment on column public.clients.responsible_client_id is 'For minors: links to parent/guardian client record';
comment on column public.clients.primary_professional_id is 'Default professional assigned to this client';

-- =============================================================================
-- CLIENT NOTES TABLE
-- Internal notes about clients
-- =============================================================================

create table public.client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content text not null,
  author_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index client_notes_client_id_idx on public.client_notes(client_id);
create index client_notes_created_at_idx on public.client_notes(created_at);

comment on table public.client_notes is 'Internal notes about clients';

-- =============================================================================
-- CLIENT CONSENTS TABLE
-- Track consent documents signed by clients
-- =============================================================================

create table public.client_consents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  consent_type text not null,
  status text not null default 'missing' check (status in ('valid', 'expired', 'missing')),
  signed_at timestamptz,
  expires_at timestamptz,
  signed_by text, -- Name of person who signed (may be guardian)
  document_path text, -- Storage path if uploaded
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index client_consents_client_id_idx on public.client_consents(client_id);
create index client_consents_status_idx on public.client_consents(status);
create index client_consents_expires_at_idx on public.client_consents(expires_at) where expires_at is not null;

comment on table public.client_consents is 'Consent documents signed by or for clients';

-- =============================================================================
-- CLIENT RELATIONS TABLE
-- Track relationships between clients (parent/child, spouse, etc.)
-- =============================================================================

create table public.client_relations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  related_client_id uuid not null references public.clients(id) on delete cascade,
  relation_type text not null check (relation_type in ('parent', 'child', 'spouse', 'sibling', 'guardian', 'other')),
  notes text,
  created_at timestamptz not null default now(),

  -- Prevent duplicate relationships
  unique(client_id, related_client_id)
);

create index client_relations_client_id_idx on public.client_relations(client_id);
create index client_relations_related_client_id_idx on public.client_relations(related_client_id);

comment on table public.client_relations is 'Relationships between clients (family, guardianship, etc.)';

-- =============================================================================
-- CLIENT AUDIT LOG TABLE
-- Immutable log of changes to client records
-- =============================================================================

create table public.client_audit_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null default 'client',
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index client_audit_log_client_id_idx on public.client_audit_log(client_id);
create index client_audit_log_created_at_idx on public.client_audit_log(created_at);

comment on table public.client_audit_log is 'Append-only audit log for client changes';

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================

create trigger clients_set_updated_at
  before update on public.clients
  for each row
  execute function public.set_updated_at();

create trigger client_notes_set_updated_at
  before update on public.client_notes
  for each row
  execute function public.set_updated_at();

create trigger client_consents_set_updated_at
  before update on public.client_consents
  for each row
  execute function public.set_updated_at();

-- =============================================================================
-- AUDIT TRIGGER FUNCTION FOR CLIENTS
-- =============================================================================

create or replace function public.audit_client_changes()
returns trigger
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
begin
  select id into v_actor_id
  from public.profiles
  where user_id = auth.uid();

  if tg_op = 'INSERT' then
    insert into public.client_audit_log (client_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      new.id,
      v_actor_id,
      'created',
      'client',
      new.id,
      null,
      jsonb_build_object(
        'client_id', new.client_id,
        'first_name', new.first_name,
        'last_name', new.last_name,
        'email', new.email
      )
    );
    return new;

  elsif tg_op = 'UPDATE' then
    -- Log archive/unarchive
    if old.is_archived is distinct from new.is_archived then
      insert into public.client_audit_log (client_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.id,
        v_actor_id,
        case when new.is_archived then 'archived' else 'unarchived' end,
        'client',
        new.id,
        jsonb_build_object('is_archived', old.is_archived),
        jsonb_build_object('is_archived', new.is_archived)
      );
    end if;

    -- Log other significant changes
    if old.first_name is distinct from new.first_name
       or old.last_name is distinct from new.last_name
       or old.email is distinct from new.email then
      insert into public.client_audit_log (client_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.id,
        v_actor_id,
        'updated',
        'client',
        new.id,
        jsonb_build_object('first_name', old.first_name, 'last_name', old.last_name, 'email', old.email),
        jsonb_build_object('first_name', new.first_name, 'last_name', new.last_name, 'email', new.email)
      );
    end if;

    return new;

  elsif tg_op = 'DELETE' then
    insert into public.client_audit_log (client_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      old.id,
      v_actor_id,
      'deleted',
      'client',
      old.id,
      jsonb_build_object('client_id', old.client_id, 'first_name', old.first_name, 'last_name', old.last_name),
      null
    );
    return old;
  end if;

  return null;
end;
$$ language plpgsql;

create trigger clients_audit_trigger
  after insert or update or delete on public.clients
  for each row
  execute function public.audit_client_changes();
