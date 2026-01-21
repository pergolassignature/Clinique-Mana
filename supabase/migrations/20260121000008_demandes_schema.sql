-- Migration: demandes_schema
-- Module: demandes
-- Gate: 1 - Core Tables
-- Created: 2026-01-21

-- =============================================================================
-- DEMANDES TABLE
-- Service requests from clients requiring analysis and assignment
-- =============================================================================

create table public.demandes (
  id uuid primary key default gen_random_uuid(),

  -- Display ID (human-readable, auto-generated)
  demande_id text unique not null, -- Format: DEM-2026-0001

  -- Status workflow
  status text not null default 'toAnalyze' check (status in ('toAnalyze', 'assigned', 'closed')),

  -- Request details
  demand_type text check (demand_type in ('individual', 'couple', 'family', 'group')),
  selected_motifs text[] default '{}', -- Array of motif keys
  motif_description text default '',
  other_motif_text text default '',
  urgency text check (urgency in ('low', 'moderate', 'high')),

  -- Notes
  notes text default '',

  -- Assignment tracking
  assigned_professional_id uuid references public.professionals(id) on delete set null,
  assigned_at timestamptz,
  assigned_by uuid references public.profiles(id) on delete set null,

  -- Closure tracking
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  closure_reason text,

  -- Metadata
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- SEQUENCE FOR DEMANDE_ID
-- Auto-generate DEM-2026-0001, DEM-2026-0002, etc.
-- =============================================================================

create sequence public.demandes_demande_id_seq start 1;

create or replace function public.generate_demande_id()
returns trigger as $$
declare
  v_year text;
begin
  v_year := extract(year from now())::text;
  if new.demande_id is null then
    new.demande_id := 'DEM-' || v_year || '-' || lpad(nextval('public.demandes_demande_id_seq')::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

create trigger demandes_generate_demande_id
  before insert on public.demandes
  for each row
  execute function public.generate_demande_id();

-- =============================================================================
-- DEMANDE_PARTICIPANTS TABLE
-- Clients participating in a demande
-- =============================================================================

create table public.demande_participants (
  id uuid primary key default gen_random_uuid(),
  demande_id uuid not null references public.demandes(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,

  -- Role in the demande
  role text not null default 'principal' check (role in ('principal', 'participant')),

  -- Consent tracking
  consent_status text not null default 'missing' check (consent_status in ('valid', 'expired', 'missing')),
  consent_version text,
  consent_signed_at timestamptz,

  -- Metadata
  created_at timestamptz not null default now(),

  -- Unique constraint: one client per demande
  unique(demande_id, client_id)
);

comment on table public.demande_participants is 'Junction table linking demandes to participating clients';
comment on column public.demande_participants.role is 'Client role: principal (main requester) or participant';
comment on column public.demande_participants.consent_status is 'Consent status: valid, expired, or missing';

-- =============================================================================
-- DEMANDE_AUDIT_LOG TABLE
-- Immutable audit trail for demandes
-- =============================================================================

create table public.demande_audit_log (
  id uuid primary key default gen_random_uuid(),
  demande_id uuid not null references public.demandes(id) on delete cascade,

  -- Actor who made the change
  actor_id uuid references public.profiles(id) on delete set null,

  -- Action performed
  action text not null,

  -- State snapshots
  old_value jsonb,
  new_value jsonb,

  -- Metadata
  created_at timestamptz not null default now()
);

comment on table public.demande_audit_log is 'Append-only audit log for demande changes';

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Demandes indexes
create index demandes_demande_id_idx on public.demandes(demande_id);
create index demandes_status_idx on public.demandes(status);
create index demandes_urgency_idx on public.demandes(urgency) where urgency is not null;
create index demandes_assigned_professional_idx on public.demandes(assigned_professional_id) where assigned_professional_id is not null;
create index demandes_created_at_idx on public.demandes(created_at);

-- Demande participants indexes
create index demande_participants_demande_idx on public.demande_participants(demande_id);
create index demande_participants_client_idx on public.demande_participants(client_id);

-- Audit log indexes
create index demande_audit_log_demande_idx on public.demande_audit_log(demande_id);
create index demande_audit_log_created_at_idx on public.demande_audit_log(created_at);

-- =============================================================================
-- COMMENTS
-- =============================================================================

comment on table public.demandes is 'Service requests requiring analysis and professional assignment';
comment on column public.demandes.demande_id is 'Human-readable ID: DEM-2026-0001 format';
comment on column public.demandes.status is 'Workflow status: toAnalyze -> assigned -> closed';
comment on column public.demandes.demand_type is 'Type of service: individual, couple, family, group';
comment on column public.demandes.selected_motifs is 'Array of motif keys from predefined list';
comment on column public.demandes.urgency is 'Priority level: low, moderate, high';

-- =============================================================================
-- UPDATED_AT TRIGGER
-- =============================================================================

create trigger demandes_set_updated_at
  before update on public.demandes
  for each row
  execute function public.set_updated_at();

-- =============================================================================
-- AUDIT TRIGGER FUNCTION
-- =============================================================================

create or replace function public.audit_demande_changes()
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
    insert into public.demande_audit_log (demande_id, actor_id, action, old_value, new_value)
    values (
      new.id,
      v_actor_id,
      'created',
      null,
      jsonb_build_object('demande_id', new.demande_id, 'status', new.status)
    );
    return new;

  elsif tg_op = 'UPDATE' then
    -- Log status changes
    if old.status is distinct from new.status then
      insert into public.demande_audit_log (demande_id, actor_id, action, old_value, new_value)
      values (
        new.id,
        v_actor_id,
        case
          when new.status = 'assigned' then 'assigned'
          when new.status = 'closed' then 'closed'
          else 'status_changed'
        end,
        jsonb_build_object('status', old.status),
        jsonb_build_object('status', new.status, 'assigned_professional_id', new.assigned_professional_id)
      );
    end if;
    return new;
  end if;

  return null;
end;
$$ language plpgsql;

create trigger demandes_audit_trigger
  after insert or update on public.demandes
  for each row
  execute function public.audit_demande_changes();
