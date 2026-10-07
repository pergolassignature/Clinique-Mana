-- Migration: availability_schema
-- Module: availability
-- Gate: 1 - Core Tables
-- Created: 2026-01-21

-- =============================================================================
-- AVAILABILITY_BLOCKS TABLE
-- Stores professional time blocks (available, blocked, vacation, break)
-- =============================================================================

create table public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,

  -- Block type
  type text not null check (type in ('available', 'blocked', 'vacation', 'break')),
  label text,

  -- Time boundaries (timestamptz for timezone handling)
  start_time timestamptz not null,
  end_time timestamptz not null,

  -- Service restrictions (NULL = all services allowed)
  allowed_service_ids uuid[],

  -- Visibility to clients (for public booking interface)
  visible_to_clients boolean not null default true,

  -- Metadata
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Constraint: end_time must be after start_time
  constraint availability_blocks_time_check check (end_time > start_time)
);

comment on table public.availability_blocks is 'Professional time blocks for availability management';
comment on column public.availability_blocks.type is 'Block type: available (bookable), blocked (unavailable), vacation, break';
comment on column public.availability_blocks.allowed_service_ids is 'Service IDs allowed during this block. NULL means all services allowed';
comment on column public.availability_blocks.visible_to_clients is 'Whether this block is visible on public booking interface';

-- Indexes for availability_blocks
create index availability_blocks_professional_idx
  on public.availability_blocks(professional_id);

create index availability_blocks_time_range_idx
  on public.availability_blocks(start_time, end_time);

create index availability_blocks_type_idx
  on public.availability_blocks(type);

-- Composite index for common query: professional + time range
create index availability_blocks_professional_time_idx
  on public.availability_blocks(professional_id, start_time, end_time);

-- =============================================================================
-- APPOINTMENTS TABLE
-- Client bookings with multi-client support
-- =============================================================================

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,

  -- Time slot
  start_time timestamptz not null,
  duration_minutes int not null,

  -- Status workflow
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'completed', 'cancelled', 'no_show')),

  -- Modality
  mode text check (mode in ('in_person', 'video', 'phone')),

  -- Internal notes (not visible to clients)
  notes_internal text,

  -- Cancellation tracking
  cancelled_at timestamptz,
  cancellation_reason text,
  cancellation_fee_applied boolean default false,
  cancellation_fee_percent numeric(5,2),

  -- Completion tracking
  completed_at timestamptz,

  -- Reschedule tracking (link to original appointment if rescheduled)
  rescheduled_from_id uuid references public.appointments(id) on delete set null,

  -- Metadata
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Constraints
  constraint appointments_duration_positive check (duration_minutes > 0),
  constraint appointments_cancellation_consistency check (
    (status = 'cancelled' and cancelled_at is not null) or
    (status != 'cancelled' and cancelled_at is null)
  ),
  constraint appointments_completion_consistency check (
    (status = 'completed' and completed_at is not null) or
    (status != 'completed' and completed_at is null)
  )
);

comment on table public.appointments is 'Client appointment bookings';
comment on column public.appointments.status is 'Appointment lifecycle: draft -> confirmed -> completed/cancelled/no_show';
comment on column public.appointments.mode is 'Appointment modality: in_person, video, phone';
comment on column public.appointments.rescheduled_from_id is 'Reference to original appointment if this was rescheduled';

-- Indexes for appointments
create index appointments_professional_idx
  on public.appointments(professional_id);

create index appointments_service_idx
  on public.appointments(service_id);

create index appointments_status_idx
  on public.appointments(status);

create index appointments_time_idx
  on public.appointments(start_time);

-- Composite index for professional schedule queries
create index appointments_professional_time_idx
  on public.appointments(professional_id, start_time);

-- Partial index for active appointments (not cancelled/completed)
create index appointments_active_idx
  on public.appointments(professional_id, start_time)
  where status in ('draft', 'confirmed');

create index appointments_rescheduled_from_idx
  on public.appointments(rescheduled_from_id)
  where rescheduled_from_id is not null;

-- =============================================================================
-- APPOINTMENT_CLIENTS TABLE
-- Junction table for multi-client appointments
-- =============================================================================

create table public.appointment_clients (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  client_id uuid not null, -- FK to clients table when implemented

  -- Role in the appointment
  role text not null default 'primary' check (role in ('primary', 'spouse', 'partner', 'child', 'parent', 'other')),

  -- Attendance tracking
  attended boolean, -- NULL = not yet marked, true/false after completion

  -- Metadata
  created_at timestamptz not null default now(),

  -- Unique constraint: one client per appointment
  unique(appointment_id, client_id)
);

comment on table public.appointment_clients is 'Junction table linking appointments to clients (supports multi-client)';
comment on column public.appointment_clients.role is 'Client role in appointment: primary, spouse, partner, child, parent, other';
comment on column public.appointment_clients.attended is 'Attendance tracking: NULL before completion, true/false after';

-- Indexes for appointment_clients
create index appointment_clients_appointment_idx
  on public.appointment_clients(appointment_id);

create index appointment_clients_client_idx
  on public.appointment_clients(client_id);

-- =============================================================================
-- APPOINTMENT_AUDIT_LOG TABLE
-- Immutable audit trail for appointments and availability
-- =============================================================================

create table public.appointment_audit_log (
  id uuid primary key default gen_random_uuid(),

  -- Entity reference (polymorphic)
  entity_type text not null check (entity_type in ('appointment', 'availability_block')),
  entity_id uuid not null,

  -- Context: professional associated with this entity
  professional_id uuid not null references public.professionals(id) on delete cascade,

  -- Actor who made the change
  actor_id uuid references public.profiles(id), -- NULL for system/triggers

  -- Action performed
  action text not null,

  -- State snapshots
  old_value jsonb,
  new_value jsonb,

  -- Contextual data (denormalized for display without joins)
  context jsonb,

  -- Metadata
  created_at timestamptz not null default now()
);

comment on table public.appointment_audit_log is 'Append-only audit log for appointment and availability changes';
comment on column public.appointment_audit_log.entity_type is 'Type of entity: appointment or availability_block';
comment on column public.appointment_audit_log.actor_id is 'Profile ID of user who made the change. NULL for system actions';
comment on column public.appointment_audit_log.context is 'Denormalized context: client_names, service_name, time_slot, etc.';

-- Indexes for appointment_audit_log
create index appointment_audit_log_professional_idx
  on public.appointment_audit_log(professional_id);

create index appointment_audit_log_entity_idx
  on public.appointment_audit_log(entity_type, entity_id);

create index appointment_audit_log_action_idx
  on public.appointment_audit_log(action);

create index appointment_audit_log_created_at_idx
  on public.appointment_audit_log(created_at);

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- Automatically update updated_at timestamp on record changes
-- =============================================================================

-- Availability blocks updated_at trigger
create trigger availability_blocks_set_updated_at
  before update on public.availability_blocks
  for each row
  execute function public.set_updated_at();

-- Appointments updated_at trigger
create trigger appointments_set_updated_at
  before update on public.appointments
  for each row
  execute function public.set_updated_at();
