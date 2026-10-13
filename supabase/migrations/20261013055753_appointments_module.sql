-- =============================================================================
-- Module Rendez-vous (« appointments »): registry, tables, RLS, audit (plan R1)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §7 (Keep / Change / Drop, data model)
-- Data:      docs/research/2026-10-11-gorendezvous-tour.md §1, §18 (the agenda, its states and reasons)
-- Answers:   docs/research/2026-10-12-christine-answers.md (business hours, reminders, video links)
-- Decisions: R-11, R-12, R-13, R-52, R-53, R-55, R-58, AP-1 … (decisions log)
-- Recipe:    docs/standards/database-conventions.md §9
--
-- The clinic's agenda. A professional's recurring availability (`availability_rules`: a weekday,
-- local start and end in the clinic's time zone, the services allowed, valid from / to) minus its
-- exceptions (`availability_exceptions`: holiday, vacation, other) is where appointments may be
-- booked. An appointment (`appointments`) holds a professional, a service, its start and end and
-- the end of its « pause après » (`blocks_until`: a 50 min session blocks 60, R-13); two active
-- appointments of a professional never overlap (an exclusion constraint). Its clients are
-- `appointment_participants` (the client, a second person), each with a presence. Cancellation
-- reasons are GOrendezvous's, minus COVID-19. The clinic's business hours (Monday–Friday
-- 8:00–17:00) are a setting: they rule when reminders go out (R4), never when one may book (R-52).
--
-- Every write is an RPC (*_appointments_booking.sql). The module starts disabled everywhere.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_module', true);

-- -----------------------------------------------------------------------------
-- Registry
-- -----------------------------------------------------------------------------
insert into public.modules (key, name) values ('appointments', 'Rendez-vous')
on conflict do nothing;

insert into public.module_dependencies (module_key, depends_on) values
  ('appointments', 'clients'),
  ('appointments', 'services'),
  ('appointments', 'professionals')
on conflict do nothing;

insert into public.permissions (key, module_key, description) values
  ('appointments.view',             'appointments', 'Voir l''agenda de la clinique'),
  ('appointments.manage',           'appointments', 'Réserver, déplacer et annuler les rendez-vous ; gérer les disponibilités'),
  ('appointments.self',             'appointments', 'Gérer son propre agenda et ses disponibilités (professionnel)'),
  ('appointments.balance_override', 'appointments', 'Réserver malgré un solde dû (raison notée)'),
  ('appointments.settings',         'appointments', 'Modifier les heures d''ouverture et les réglages de l''agenda')
on conflict do nothing;

-- Defaults (AP-1): the staff book for every professional; the adjointe and the admin may book
-- despite a balance (R-58); the professional runs her own agenda; the admin sets the hours.
insert into public.role_permissions (role, permission_key) values
  ('admin',           'appointments.view'),
  ('admin',           'appointments.manage'),
  ('admin',           'appointments.self'),
  ('admin',           'appointments.balance_override'),
  ('admin',           'appointments.settings'),
  ('counselor',       'appointments.view'),
  ('counselor',       'appointments.manage'),
  ('admin_assistant', 'appointments.view'),
  ('admin_assistant', 'appointments.manage'),
  ('admin_assistant', 'appointments.balance_override'),
  ('provider',        'appointments.self')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- appointment_settings: one row per clinic
-- -----------------------------------------------------------------------------
-- Business hours (R-52): the weekdays (ISO, 1 = Monday) and the local hours of the clinic; they
-- rule the reminders' sending (R4: one business day before, at `reminder_local_hour`), never
-- the booking (evenings and weekends may be booked).
create table public.appointment_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  business_days smallint[] not null default '{1,2,3,4,5}',
  business_start time not null default '08:00',
  business_end time not null default '17:00',
  reminder_business_days smallint not null default 1,
  reminder_local_hour smallint not null default 8,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  constraint appointment_settings_days_check check (
    pg_catalog.cardinality(business_days) between 1 and 7 and business_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  constraint appointment_settings_hours_check check (business_end > business_start),
  constraint appointment_settings_reminder_days_check check (reminder_business_days between 1 and 5),
  constraint appointment_settings_reminder_hour_check check (reminder_local_hour between 0 and 23)
);
create index appointment_settings_updated_by_idx on public.appointment_settings (updated_by);
create trigger appointment_settings_set_updated_at before update on public.appointment_settings
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- cancellation_reasons: GOrendezvous's list, minus COVID-19 (R-12)
-- -----------------------------------------------------------------------------
create table public.cancellation_reasons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  is_system boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cancellation_reasons_key_check check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint cancellation_reasons_name_check check (char_length(name) between 1 and 120 and private.is_tidy_text(name)),
  constraint cancellation_reasons_org_id_key_key unique (org_id, key),
  constraint cancellation_reasons_org_id_id_key unique (org_id, id)
);
create trigger cancellation_reasons_set_updated_at before update on public.cancellation_reasons
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- availability_rules: a professional's recurring weekly availability
-- -----------------------------------------------------------------------------
-- Local times on a weekday (ISO, 1 = Monday) in the clinic's time zone: 9:00–17:00 stays
-- 9:00–17:00 across a daylight-saving change. `service_ids` empty: every service the professional
-- offers. `overflow_allowed`: an appointment may start in the window and end after it.
-- `visible_to_clients`: for the public booking page (later); staff book in every window.
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  weekday smallint not null,
  start_time time not null,
  end_time time not null,
  service_ids uuid[] not null default '{}',
  visible_to_clients boolean not null default true,
  overflow_allowed boolean not null default false,
  valid_from date not null,
  valid_until date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint availability_rules_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint availability_rules_weekday_check check (weekday between 1 and 7),
  constraint availability_rules_times_check check (end_time > start_time),
  constraint availability_rules_validity_check check (valid_until is null or valid_until >= valid_from),
  constraint availability_rules_services_check check (pg_catalog.cardinality(service_ids) <= 100)
);
create index availability_rules_org_professional_idx on public.availability_rules (org_id, professional_id, weekday);
create index availability_rules_created_by_idx on public.availability_rules (created_by);
create trigger availability_rules_set_updated_at before update on public.availability_rules
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- availability_exceptions: a holiday, a vacation, another absence (instants)
-- -----------------------------------------------------------------------------
create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  kind text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  label text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint availability_exceptions_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint availability_exceptions_kind_check check (kind in ('holiday', 'vacation', 'other')),
  constraint availability_exceptions_range_check check (ends_at > starts_at),
  constraint availability_exceptions_label_check check (label is null or (char_length(label) between 1 and 120 and private.is_tidy_text(label)))
);
create index availability_exceptions_org_professional_idx on public.availability_exceptions (org_id, professional_id, starts_at);
create index availability_exceptions_created_by_idx on public.availability_exceptions (created_by);
create trigger availability_exceptions_set_updated_at before update on public.availability_exceptions
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- appointments
-- -----------------------------------------------------------------------------
-- States (R-12, AP-2): `booked` (made, not confirmed by the client), `confirmed` (by the client:
-- the reminder's link or « OUI », R4), `completed` (past, set by a job, R3), `cancelled` (with a
-- reason; `kept_on_schedule` keeps its slot taken, « garder à l'horaire »). Presence is per
-- participant. `internal_note` is the staff's, `client_message` what the client is told (R-11).
-- A personal appointment (`is_personal`: no service, no client) is the professional's only.
-- The video fields are filled by R4 (fixed link) and RZ (Zoom).
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  service_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocks_until timestamptz not null,
  mode text not null default 'video',
  state text not null default 'booked',
  is_personal boolean not null default false,
  is_work boolean not null default false,
  personal_label text,
  internal_note text,
  client_message text,
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(user_id) on delete set null,
  cancel_reason_id uuid,
  cancel_details text,
  cancel_late boolean,
  kept_on_schedule boolean not null default false,
  balance_override_reason text,
  balance_override_by uuid references public.profiles(user_id) on delete set null,
  video_url text,
  video_external_id text,
  video_status text,
  external_ref text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint appointments_org_id_id_key unique (org_id, id),
  constraint appointments_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id),
  constraint appointments_service_fkey foreign key (org_id, service_id)
    references public.services (org_id, id),
  constraint appointments_cancel_reason_fkey foreign key (org_id, cancel_reason_id)
    references public.cancellation_reasons (org_id, id),
  constraint appointments_mode_check check (mode in ('video', 'phone')),
  constraint appointments_state_check check (state in ('booked', 'confirmed', 'completed', 'cancelled')),
  constraint appointments_range_check check (ends_at > starts_at and blocks_until >= ends_at),
  constraint appointments_length_check check (blocks_until - starts_at <= interval '12 hours'),
  constraint appointments_cancelled_check check ((state = 'cancelled') = (cancelled_at is not null)),
  constraint appointments_kept_check check (not kept_on_schedule or state = 'cancelled'),
  constraint appointments_completed_check check ((state = 'completed') = (completed_at is not null)),
  constraint appointments_personal_check check (not is_personal or service_id is null),
  constraint appointments_service_check check (is_personal or service_id is not null),
  constraint appointments_video_status_check check (video_status is null or video_status in ('ready', 'pending', 'failed')),
  constraint appointments_text_check check (
    (internal_note is null or char_length(internal_note) <= 5000)
    and (client_message is null or char_length(client_message) <= 2000)
    and (cancel_details is null or char_length(cancel_details) <= 1000)
    and (personal_label is null or char_length(personal_label) <= 120)
    and (balance_override_reason is null or char_length(balance_override_reason) between 3 and 500)),
  constraint appointments_external_ref_key unique (org_id, external_ref),
  -- Two appointments of a professional never overlap, « pause après » included, unless one is
  -- cancelled (and not kept on the schedule).
  constraint appointments_no_overlap exclude using gist (
    professional_id with =,
    pg_catalog.tstzrange(starts_at, blocks_until, '[)') with &&
  ) where (state <> 'cancelled' or kept_on_schedule)
);
create index appointments_org_starts_idx on public.appointments (org_id, starts_at);
create index appointments_org_professional_starts_idx on public.appointments (org_id, professional_id, starts_at);
create index appointments_org_service_idx on public.appointments (org_id, service_id);
create index appointments_org_cancel_reason_idx on public.appointments (org_id, cancel_reason_id);
create index appointments_cancelled_by_idx on public.appointments (cancelled_by);
create index appointments_balance_override_by_idx on public.appointments (balance_override_by);
create index appointments_created_by_idx on public.appointments (created_by);
create trigger appointments_set_updated_at before update on public.appointments
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- appointment_participants: the clients of an appointment
-- -----------------------------------------------------------------------------
create table public.appointment_participants (
  appointment_id uuid not null,
  client_id uuid not null,
  org_id uuid not null,
  role text not null default 'client',
  presence text not null default 'expected',
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_participants_pkey primary key (appointment_id, client_id),
  constraint appointment_participants_appointment_fkey foreign key (org_id, appointment_id)
    references public.appointments (org_id, id) on delete cascade,
  constraint appointment_participants_client_fkey foreign key (org_id, client_id)
    references public.clients (org_id, id),
  constraint appointment_participants_role_check check (role in ('client', 'second')),
  constraint appointment_participants_presence_check check (presence in ('expected', 'present', 'absent'))
);
create index appointment_participants_org_client_idx on public.appointment_participants (org_id, client_id);
create index appointment_participants_org_appointment_idx on public.appointment_participants (org_id, appointment_id);
create trigger appointment_participants_set_updated_at before update on public.appointment_participants
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS and grants: select only (every write is an RPC)
-- -----------------------------------------------------------------------------
alter table public.appointment_settings enable row level security;
alter table public.cancellation_reasons enable row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_exceptions enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_participants enable row level security;

revoke all on public.appointment_settings, public.cancellation_reasons, public.availability_rules,
  public.availability_exceptions, public.appointments, public.appointment_participants
  from anon, authenticated;
grant select on public.appointment_settings, public.cancellation_reasons, public.availability_rules,
  public.availability_exceptions, public.appointments, public.appointment_participants
  to authenticated;

create policy appointment_settings_select on public.appointment_settings
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('appointments.view')) or (select private.has_permission('appointments.self'))));

create policy cancellation_reasons_select on public.cancellation_reasons
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('appointments.view')) or (select private.has_permission('appointments.self'))));

-- Staff read every professional's availability; a professional her own.
create policy availability_rules_select on public.availability_rules
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('appointments.view'))
              or ((select private.has_permission('appointments.self')) and professional_id = (select private.current_professional_id()))));

create policy availability_exceptions_select on public.availability_exceptions
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('appointments.view'))
              or ((select private.has_permission('appointments.self')) and professional_id = (select private.current_professional_id()))));

-- Staff read the clinic's appointments but a professional's personal ones (busy time only,
-- through the agenda's RPC, R2); a professional reads her own, personal ones included.
create policy appointments_select on public.appointments
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and (((select private.has_permission('appointments.view')) and not is_personal)
              or ((select private.has_permission('appointments.self')) and professional_id = (select private.current_professional_id()))));

-- A participant row is visible with its appointment.
create policy appointment_participants_select on public.appointment_participants
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('appointments.view')) or (select private.has_permission('appointments.self')))
         and exists (select 1 from public.appointments a where a.id = appointment_id));

-- -----------------------------------------------------------------------------
-- Audit (personal values redacted: notes, messages, details, the override's reason)
-- -----------------------------------------------------------------------------
create trigger appointment_settings_audit after insert or update or delete on public.appointment_settings
  for each row execute function private.audit_trigger();
create trigger cancellation_reasons_audit after insert or update or delete on public.cancellation_reasons
  for each row execute function private.audit_trigger();
create trigger availability_rules_audit after insert or update or delete on public.availability_rules
  for each row execute function private.audit_trigger();
create trigger availability_exceptions_audit after insert or update or delete on public.availability_exceptions
  for each row execute function private.audit_trigger('label');
create trigger appointments_audit after insert or update or delete on public.appointments
  for each row execute function private.audit_trigger('personal_label', 'internal_note', 'client_message', 'cancel_details', 'balance_override_reason', 'video_url');
create trigger appointment_participants_audit after insert or update or delete on public.appointment_participants
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- Per-clinic seed: the settings row and the cancellation reasons
-- -----------------------------------------------------------------------------
create function private.seed_appointments_reference(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform pg_catalog.set_config('app.audit_source', 'seed:appointments_reference', true);
  insert into public.appointment_settings (org_id) values (p_org) on conflict do nothing;
  insert into public.cancellation_reasons (org_id, key, name, is_system, sort_order)
  select p_org, v.key, v.name, true, v.sort_order
    from (values
      ('not_specified',      'Non spécifiée',        10),
      ('no_longer_needed',   'Plus requis',          20),
      ('personal_emergency', 'Urgence personnelle',  30),
      ('family_emergency',   'Urgence familiale',    40),
      ('work_emergency',     'Urgence au travail',   50),
      ('dissatisfied',       'Insatisfaction',       60),
      ('other',              'Autre',                70)
    ) as v(key, name, sort_order)
  on conflict do nothing;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

create function private.seed_appointments_reference_on_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_appointments_reference(new.id);
  return null;
end;
$$;

create trigger organizations_seed_appointments_reference
  after insert on public.organizations
  for each row execute function private.seed_appointments_reference_on_org();

revoke all on function private.seed_appointments_reference(uuid), private.seed_appointments_reference_on_org()
  from public, anon, authenticated, service_role;

-- Existing organizations (production).
select private.seed_appointments_reference(o.id) from public.organizations o;
